import {
  Approval,
  Attachment,
  Bot,
  BrowserProfile,
  BrowserStatus as BrowserStatusSchema,
  CanonicalEvent,
  ComputerInput,
  ComputerState,
  CreateBot,
  CreateBrowserProfile,
  CreateMemory,
  CreateWorkspaceMemory,
  CreateSavedLogin,
  CreateRoom,
  CreateRoutine,
  CreateSkill,
  CreateTask,
  CreateTeam,
  CreateThread,
  Device,
  Memory,
  BotPreset as BotPresetSchema,
  BrowserTakeover as BrowserTakeoverSchema,
  Decision as DecisionSchema,
  DecisionQuery,
  CreateBotPreset,
  CreateMcpServer,
  CreatePresetFromBot,
  ImportSkill,
  ImportTeamPackage,
  MarkNotificationsRead,
  McpServer,
  McpServerTestResult,
  Message,
  SavedLogin,
  SearchHit,
  Notification,
  PairingStartResponse,
  PostMessage,
  ResolveApproval,
  myChromeEndpointIssue,
  RoomDeciderSettings,
  RoomMember,
  Routine,
  RoutineRun,
  Run,
  SetBrowserTakeover,
  SetTakeover,
  Skill,
  Takeover,
  Task,
  Team,
  Thread,
  TodaySummary,
  UpdateBot,
  UpdateBrowserProfile,
  UpdateMcpServer,
  UpdateMemory,
  UpdateMyChromeSettings,
  UpdateRoomDeciderSettings,
  UpdateRoomMembers,
  UpdateRoutine,
  UpdateBotPreset,
  UpdateSavedLogin,
  UpdateSkill,
  UpdateTask,
  UpdateTeam,
  SearchQuery,
  UpdateThread,
  UpdateVoiceSettings,
  UsageSummary,
  VoiceInfo,
  VoiceSettings,
  VoiceSpeakRequest,
  DESKTOP_HEIGHT,
  DESKTOP_WIDTH,
  type CanonicalEventType,
} from '@brot/protocol';
import { skillFileFallbackFromId } from '../skillFileName';
import { voiceTextAllowed } from '../voice';

import {
  MY_CHROME_DEFAULT_ENDPOINT,
  ScreenUnavailable,
  type BotEvent,
  type BrotClient,
  type BrowserStatus,
  type ComputerInfo,
  type NotificationFilter,
  type Provider,
  type Room,
  type RoutineRunFilter,
  type RoutineRunStarted,
  type TeamPackageImportCounts,
  type TodayFilter,
  type UsageFilter,
  type TaskFilter,
} from './client';

/** The slice of EventSource this client uses. The browser's EventSource satisfies it; tests pass a fake. */
export interface EventStream {
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

export type EventStreamFactory = new (url: string) => EventStream;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpClientOptions {
  /** Prefix for every request. Empty means same origin, where the dev proxy and the built app serve /api. */
  baseUrl?: string;
  fetch?: FetchLike;
  EventSource?: EventStreamFactory;
}

/**
 * The server names each SSE frame by its event type, and EventSource only delivers named frames to
 * listeners registered for that name, so every type needs a listener. The Record turns a missing
 * type into a compile error when the protocol adds one.
 */
/** How many recently delivered event ids are remembered for replay dedupe. */
export const RECENT_EVENT_LIMIT = 1000;

const EVENT_NAMES: Record<CanonicalEventType, true> = {
  'run.started': true,
  'message.delta': true,
  'message.completed': true,
  'tool.call': true,
  'tool.result': true,
  'approval.requested': true,
  'approval.resolved': true,
  'memory.written': true,
  'cost.updated': true,
  'computer.status': true,
  'computer.takeover': true,
  'network.blocked': true,
  'task.created': true,
  'task.updated': true,
  'handoff': true,
  'bot.asked': true,
  'bot.answered': true,
  'room.members': true,
  'run.completed': true,
  'run.failed': true,
};

/**
 * Talks to a running Brot server over its /api routes (docs/TEAM-API.md). A bot has any number of DM
 * threads; `threadId -> botId` is learned from the thread lists and creations, so live events reach
 * the right conversation. A thread the client has not seen yet gets one lazy lookup across every
 * known bot's threads and the rooms. Rooms are their own threads.
 */
export function createHttpClient({
  baseUrl = '',
  fetch = globalThis.fetch,
  EventSource = globalThis.EventSource,
}: HttpClientOptions = {}): BrotClient {
  const root = baseUrl.replace(/\/$/, '');
  const knownBots = new Set<string>();
  const botOfThread = new Map<string, string>();
  const threadsOfBot = new Map<string, Thread[]>();
  const creatingThread = new Map<string, Promise<Thread>>();
  const roomIds = new Set<string>();
  const listeners = new Set<(event: BotEvent) => void>();
  let roomsLoaded: Promise<void> | undefined;
  let stream: EventStream | undefined;
  let delivery: Promise<void> = Promise.resolve();
  let threadsLookup: Promise<void> | undefined;

  async function request(path: string, init?: RequestInit): Promise<Response> {
    const response = await fetch(`${root}${path}`, init);
    if (!response.ok) {
      throw new Error(`${init?.method ?? 'GET'} ${path} failed: ${await describeFailure(response)}`);
    }
    return response;
  }

  async function read<T>(path: string, schema: { parse(value: unknown): T }): Promise<T> {
    const response = await request(path, { headers: { Accept: 'application/json' } });
    return schema.parse(await response.json());
  }

  function write(method: 'POST' | 'PATCH' | 'PUT', path: string, body: unknown): Promise<Response> {
    return request(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  function rememberThread(thread: Thread): Thread {
    botOfThread.set(thread.id, thread.botId);
    return thread;
  }

  function cacheThreads(botId: string, threads: Thread[]): Thread[] {
    const dms = threads.filter((thread) => (thread.kind ?? 'dm') === 'dm');
    for (const thread of dms) rememberThread(thread);
    threadsOfBot.set(botId, dms);
    return dms;
  }

  /** A bot's DM threads, most recently active first, straight from the server. */
  async function fetchThreads(botId: string): Promise<Thread[]> {
    return cacheThreads(botId, await read(`/api/bots/${encodeURIComponent(botId)}/threads?kind=dm`, Thread.array()));
  }

  function addThread(botId: string, thread: Thread): Thread {
    rememberThread(thread);
    const cached = threadsOfBot.get(botId) ?? [];
    threadsOfBot.set(botId, [thread, ...cached.filter((entry) => entry.id !== thread.id)]);
    return thread;
  }

  async function createDmThread(botId: string, input: { title?: string } = {}): Promise<Thread> {
    const body = CreateThread.parse(input);
    const response = await write('POST', `/api/bots/${encodeURIComponent(botId)}/threads`, body);
    return addThread(botId, Thread.parse(await response.json()));
  }

  /** The bot's most recent DM thread, creating the first one when it has none. Concurrent callers share it. */
  function ensureThread(botId: string): Promise<Thread> {
    const cached = threadsOfBot.get(botId)?.[0];
    if (cached !== undefined) return Promise.resolve(cached);
    let pending = creatingThread.get(botId);
    if (pending === undefined) {
      pending = (async () => (await fetchThreads(botId))[0] ?? (await createDmThread(botId)))().finally(() =>
        creatingThread.delete(botId),
      );
      creatingThread.set(botId, pending);
    }
    return pending;
  }

  async function fetchRooms(): Promise<Room[]> {
    const threads = await read('/api/rooms', Thread.array());
    const rooms = await Promise.all(
      threads.map(async (thread) => {
        roomIds.add(thread.id);
        const members = await read(`/api/rooms/${encodeURIComponent(thread.id)}/members`, RoomMember.array());
        return { thread, memberIds: members.map((member) => member.botId) };
      }),
    );
    return rooms;
  }

  /** One lazy lookup of every known bot's threads and the rooms, shared by concurrent unseen events. */
  function lookupUnseen(): Promise<void> {
    threadsLookup ??= (async () => {
      await Promise.all([...knownBots].map((botId) => fetchThreads(botId).catch(() => undefined)));
      if (roomsLoaded !== undefined) await fetchRooms().catch(() => undefined);
    })().finally(() => {
      threadsLookup = undefined;
    });
    return threadsLookup;
  }

  /**
   * Maps a live event's thread to its conversation. A thread the client has not seen yet (created on
   * another device, or by a routine) gets one lookup before delivery.
   */
  async function targetOf(threadId: string): Promise<{ botId: string } | { roomId: string } | undefined> {
    const known = botOfThread.get(threadId);
    if (known !== undefined) return { botId: known };
    if (roomIds.has(threadId)) return { roomId: threadId };
    await lookupUnseen();
    const found = botOfThread.get(threadId);
    if (found !== undefined) return { botId: found };
    if (roomIds.has(threadId)) return { roomId: threadId };
    return undefined;
  }

  /**
   * A thread's events: the server's event log when it has one, else a replay of its records. Only a
   * 404 falls back, so a real failure still surfaces.
   */
  async function threadEvents(threadId: string): Promise<CanonicalEvent[]> {
    const path = `/api/threads/${encodeURIComponent(threadId)}`;
    const response = await fetch(`${root}${path}/events`, { headers: { Accept: 'application/json' } });
    if (response.ok) return CanonicalEvent.array().parse(await response.json());
    if (response.status !== 404) {
      throw new Error(`GET ${path}/events failed: ${await describeFailure(response)}`);
    }
    const [messages, runs, approvals] = await Promise.all([
      read(`${path}/messages`, Message.array()),
      read(`${path}/runs`, Run.array()),
      read('/api/approvals', Approval.array()),
    ]);
    return replay({
      threadId,
      messages,
      runs,
      approvals: approvals.filter((approval) => approval.threadId === threadId),
    });
  }

  /**
   * Event ids recently delivered, oldest first (FIFO, capped). A reconnect that replays frames after the
   * server's Last-Event-ID is therefore idempotent for the client; an id evicted after this many newer
   * events could be delivered again, which is acceptable because it takes >1000 events to forget it.
   */
  const recentEventIds = new Set<string>();
  const recentEventQueue: string[] = [];

  function rememberEventId(id: string): boolean {
    if (recentEventIds.has(id)) return false;
    recentEventIds.add(id);
    recentEventQueue.push(id);
    if (recentEventQueue.length > RECENT_EVENT_LIMIT) {
      const evicted = recentEventQueue.shift();
      if (evicted !== undefined) recentEventIds.delete(evicted);
    }
    return true;
  }

  /** Events are delivered in arrival order, even when a thread lookup is needed first. */
  function receive(data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      console.warn('Dropped a server event that is not JSON');
      return;
    }
    const result = CanonicalEvent.safeParse(parsed);
    if (!result.success) {
      console.warn('Dropped a server event that does not match the protocol', result.error.issues);
      return;
    }
    const event = result.data;
    // Dedupe by id before scheduling: a replayed frame never reaches the fold a second time. Frames without
    // an id cannot pass CanonicalEvent.parse, so they are dropped (with the warning above) before this point.
    if (!rememberEventId(event.id)) return;
    delivery = delivery
      .then(async () => {
        const target = await targetOf(event.threadId);
        const isTask = event.type === 'task.created' || event.type === 'task.updated';
        if (target === undefined && !isTask) return;
        const item: BotEvent = { threadId: event.threadId, ...target, event };
        for (const listener of [...listeners]) listener(item);
      })
      .catch((error: unknown) => {
        console.error('Event delivery failed', error);
      });
  }

  function openStream(): EventStream {
    const source = new EventSource(`${root}/api/events`);
    for (const name of Object.keys(EVENT_NAMES)) {
      source.addEventListener(name, (message) => receive(message.data));
    }
    return source;
  }

  const botPath = (botId: string) => `/api/bots/${encodeURIComponent(botId)}`;

  async function computerInfo(response: Response): Promise<ComputerInfo> {
    return parseComputerInfo(await response.json());
  }

  return {
    async listBots(options = {}) {
      const path = options.includeArchived ? '/api/bots?includeArchived=true' : '/api/bots';
      const bots = await read(path, Bot.array());
      for (const bot of bots) knownBots.add(bot.id);
      return bots;
    },

    async createBot(input) {
      const parsed = CreateBot.parse(input);
      // 'ask' is the server default, so it is not sent: only an explicit 'edits' travels.
      const { approvalMode, speakReplies, mcpServerIds, fallbackModels, runBudgetUsd, dailyBudgetUsd, browserMode, ...defaults } = parsed;
      const body = {
        ...(approvalMode === 'edits' ? { approvalMode } : {}),
        ...(speakReplies ? { speakReplies: true } : {}),
        ...(mcpServerIds === undefined || mcpServerIds === null ? {} : { mcpServerIds }),
        ...(fallbackModels === undefined || fallbackModels === null || fallbackModels.length === 0 ? {} : { fallbackModels }),
        ...(typeof runBudgetUsd === 'number' ? { runBudgetUsd } : {}),
        ...(typeof dailyBudgetUsd === 'number' ? { dailyBudgetUsd } : {}),
        ...(browserMode === 'my-chrome' ? { browserMode } : {}),
        ...defaults,
      };
      const response = await write('POST', '/api/bots', body);
      const bot = Bot.parse(await response.json());
      knownBots.add(bot.id);
      return bot;
    },

    async updateBot(botId, patch) {
      const body = UpdateBot.parse(patch);
      const response = await write('PATCH', botPath(botId), body);
      return Bot.parse(await response.json());
    },

    async deleteBot(botId) {
      await request(botPath(botId), { method: 'DELETE' });
      knownBots.delete(botId);
      for (const thread of threadsOfBot.get(botId) ?? []) botOfThread.delete(thread.id);
      threadsOfBot.delete(botId);
    },

    listTeams() {
      return read('/api/teams', Team.array());
    },

    async createTeam(input) {
      const body = CreateTeam.parse(input);
      const response = await write('POST', '/api/teams', body);
      return Team.parse(await response.json());
    },

    async updateTeam(teamId, patch) {
      const body = UpdateTeam.parse(patch);
      const response = await write('PATCH', `/api/teams/${encodeURIComponent(teamId)}`, body);
      return Team.parse(await response.json());
    },

    async deleteTeam(teamId) {
      await request(`/api/teams/${encodeURIComponent(teamId)}`, { method: 'DELETE' });
    },

    listMemories(botId) {
      return read(`/api/bots/${encodeURIComponent(botId)}/memories`, Memory.array());
    },

    async createMemory(botId, input) {
      const body = CreateMemory.parse(input);
      const response = await write('POST', `/api/bots/${encodeURIComponent(botId)}/memories`, body);
      return Memory.parse(await response.json());
    },

    async updateMemory(memoryId, patch) {
      const body = UpdateMemory.parse(patch);
      const response = await write('PATCH', `/api/memories/${encodeURIComponent(memoryId)}`, body);
      return Memory.parse(await response.json());
    },

    async deleteMemory(memoryId) {
      await request(`/api/memories/${encodeURIComponent(memoryId)}`, { method: 'DELETE' });
    },

    listSkills(botId) {
      const suffix = botId === undefined ? '' : `?${new URLSearchParams({ botId }).toString()}`;
      return read(`/api/skills${suffix}`, Skill.array());
    },

    async createSkill(input) {
      const body = CreateSkill.parse(input);
      const response = await write('POST', '/api/skills', body);
      return Skill.parse(await response.json());
    },

    async updateSkill(skillId, patch) {
      const body = UpdateSkill.parse(patch);
      const response = await write('PATCH', `/api/skills/${encodeURIComponent(skillId)}`, body);
      return Skill.parse(await response.json());
    },

    async deleteSkill(skillId) {
      await request(`/api/skills/${encodeURIComponent(skillId)}`, { method: 'DELETE' });
    },

    async exportSkill(skillId) {
      const response = await request(`/api/skills/${encodeURIComponent(skillId)}/export`, { headers: { Accept: 'text/markdown' } });
      const content = await response.text();
      const fallback = skillFileFallbackFromId(skillId);
      return { content, filename: downloadName(response.headers.get('content-disposition')) ?? fallback };
    },

    async importSkill(input) {
      if (input.content.trim() === '') throw new Error('A skill file is required');
      const body = ImportSkill.parse({ content: input.content, ...(input.botId === undefined ? {} : { botId: input.botId }) });
      const response = await write('POST', '/api/skills/import', body);
      return Skill.parse(await response.json());
    },

    getVoiceSettings() {
      return read('/api/voice', VoiceInfo);
    },

    async updateVoiceSettings(patch) {
      const body = UpdateVoiceSettings.parse(patch);
      const response = await write('PUT', '/api/voice', body);
      return VoiceSettings.parse(await response.json());
    },

    async speakText(text) {
      if (!voiceTextAllowed(text)) throw new Error('Voice text must be 1 to 2000 characters');
      const body = VoiceSpeakRequest.parse({ text });
      const response = await write('POST', '/api/voice/speak', body);
      const blob = await response.blob();
      return { blob, contentType: response.headers.get('content-type') ?? blob.type };
    },

    async uploadAttachment(threadId, file) {
      // The browser sets the multipart boundary itself, so no Content-Type header here.
      const form = new FormData();
      form.set('threadId', threadId);
      form.set('file', file, file.name);
      const response = await fetch(`${root}/api/attachments`, {
        method: 'POST',
        body: form,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`POST /api/attachments failed: ${await describeFailure(response)}`);
      return Attachment.parse(await response.json());
    },

    async deleteAttachment(attachmentId) {
      await request(`/api/attachments/${encodeURIComponent(attachmentId)}`, { method: 'DELETE' });
    },

    listNotifications(filter: NotificationFilter = {}) {
      const query = new URLSearchParams();
      if (filter.unread !== undefined) query.set('unread', String(filter.unread));
      if (filter.botId !== undefined) query.set('botId', filter.botId);
      if (filter.limit !== undefined) query.set('limit', String(filter.limit));
      const suffix = query.size > 0 ? `?${query.toString()}` : '';
      return read(`/api/notifications${suffix}`, Notification.array());
    },

    async unreadNotificationCount() {
      const response = await request('/api/notifications/unread-count', { headers: { Accept: 'application/json' } });
      return parseUnreadCount(await response.json());
    },

    async markNotificationsRead(ids?) {
      const body = MarkNotificationsRead.parse(ids === undefined ? {} : { ids: [...ids] });
      const response = await write('POST', '/api/notifications/read', body);
      return parseUpdatedCount(await response.json());
    },

    async deleteNotification(notificationId) {
      await request(`/api/notifications/${encodeURIComponent(notificationId)}`, { method: 'DELETE' });
    },

    listThreads(botId) {
      return fetchThreads(botId);
    },

    createThread(botId, input) {
      return createDmThread(botId, input);
    },

    async updateThread(threadId, patch) {
      const body = UpdateThread.parse(patch);
      const response = await write('PATCH', `/api/threads/${encodeURIComponent(threadId)}`, body);
      const thread = rememberThread(Thread.parse(await response.json()));
      const cached = threadsOfBot.get(thread.botId);
      if (cached !== undefined) {
        threadsOfBot.set(
          thread.botId,
          cached.map((entry) => (entry.id === thread.id ? thread : entry)),
        );
      }
      return thread;
    },

    async cancelRun(runId) {
      await write('POST', `/api/runs/${encodeURIComponent(runId)}/cancel`, {});
    },

    async deleteRoom(roomId) {
      await request(`/api/rooms/${encodeURIComponent(roomId)}`, { method: 'DELETE' });
    },

    history(threadId) {
      return threadEvents(threadId);
    },

    onEvent(listener) {
      listeners.add(listener);
      stream ??= openStream();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stream?.close();
          stream = undefined;
        }
      };
    },

    async postMessage(threadId, input) {
      const body = PostMessage.parse(input);
      await write('POST', `/api/threads/${encodeURIComponent(threadId)}/messages`, body);
    },

    async resolveApproval(approvalId, input) {
      const body = ResolveApproval.parse(input);
      const response = await write('POST', `/api/approvals/${encodeURIComponent(approvalId)}`, body);
      Approval.parse(await response.json());
    },

    listRooms() {
      const pending = fetchRooms();
      roomsLoaded = pending.then(() => undefined, () => undefined);
      return pending;
    },

    async createRoom(input) {
      const body = CreateRoom.parse(input);
      const response = await write('POST', '/api/rooms', body);
      const thread = Thread.parse(await response.json());
      roomIds.add(thread.id);
      return { thread, memberIds: [...body.botIds] };
    },

    async getRoomDeciderSettings() {
      const response = await request('/api/room-decider', { headers: { Accept: 'application/json' } });
      return RoomDeciderSettings.parse(await response.json());
    },

    async updateRoomDeciderSettings(input) {
      const body = UpdateRoomDeciderSettings.parse(input);
      const response = await write('PUT', '/api/room-decider', body);
      return RoomDeciderSettings.parse(await response.json());
    },

    roomHistory(roomId) {
      roomIds.add(roomId);
      return threadEvents(roomId);
    },

    async postRoomMessage(roomId, input) {
      const body = PostMessage.parse(input);
      await write('POST', `/api/threads/${encodeURIComponent(roomId)}/messages`, {
        content: body.content,
        ...(body.mentions?.length ? { mentions: body.mentions } : {}),
        ...(body.attachmentIds?.length ? { attachmentIds: body.attachmentIds } : {}),
      });
    },

    async updateRoomMembers(roomId, change) {
      const body = UpdateRoomMembers.parse(change);
      const response = await write('PATCH', `/api/rooms/${encodeURIComponent(roomId)}/members`, body);
      return RoomMember.array().parse(await response.json()).map((member) => member.botId);
    },

    listTasks(filter: TaskFilter = {}) {
      const query = new URLSearchParams();
      for (const [name, value] of Object.entries(filter)) if (value !== undefined) query.set(name, value);
      const suffix = query.size > 0 ? `?${query.toString()}` : '';
      return read(`/api/tasks${suffix}`, Task.array());
    },

    async createTask(input) {
      const threadId = input.roomId ?? (await ensureThread(input.assigneeBotId)).id;
      const body = CreateTask.parse({
        title: input.title,
        ...(input.description ? { description: input.description } : {}),
        assigneeBotId: input.assigneeBotId,
        threadId,
      });
      const response = await write('POST', '/api/tasks', body);
      return Task.parse(await response.json());
    },

    async cancelTask(taskId) {
      const body = UpdateTask.parse({ status: 'cancelled' });
      const response = await write('PATCH', `/api/tasks/${encodeURIComponent(taskId)}`, body);
      return Task.parse(await response.json());
    },

    listRoutines(botId) {
      const suffix = botId === undefined ? '' : `?${new URLSearchParams({ botId }).toString()}`;
      return read(`/api/routines${suffix}`, Routine.array());
    },

    async createRoutine(input) {
      const body = CreateRoutine.parse(input);
      const response = await write('POST', '/api/routines', body);
      return Routine.parse(await response.json());
    },

    async updateRoutine(routineId, patch) {
      const body = UpdateRoutine.parse(patch);
      const response = await write('PATCH', `/api/routines/${encodeURIComponent(routineId)}`, body);
      return Routine.parse(await response.json());
    },

    async deleteRoutine(routineId) {
      await request(`/api/routines/${encodeURIComponent(routineId)}`, { method: 'DELETE' });
    },

    async runRoutineNow(routineId) {
      const response = await write('POST', `/api/routines/${encodeURIComponent(routineId)}/run`, {});
      return parseRunStarted(await response.json());
    },

    listRoutineRuns(filter: RoutineRunFilter = {}) {
      const query = new URLSearchParams();
      for (const [name, value] of Object.entries(filter)) if (value !== undefined) query.set(name, String(value));
      const suffix = query.size > 0 ? `?${query.toString()}` : '';
      return read(`/api/routine-runs${suffix}`, RoutineRun.array());
    },

    async listProviders() {
      const response = await request('/api/providers', { headers: { Accept: 'application/json' } });
      return parseProviders(await response.json());
    },

    async setSecret(name, value) {
      await write('PUT', `/api/secrets/${encodeURIComponent(name)}`, { value });
    },

    async listSecretNames() {
      const response = await request('/api/secrets', { headers: { Accept: 'application/json' } });
      const raw: unknown = await response.json();
      if (!Array.isArray(raw) || raw.some((name) => typeof name !== 'string')) throw new Error('Expected the secret names');
      return raw as string[];
    },


    listDevices() {
      return read('/api/devices', Device.array());
    },

    async removeDevice(deviceId) {
      await request(`/api/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
    },

    async startPairing() {
      const response = await write('POST', '/api/pairing/start', {});
      return PairingStartResponse.parse(await response.json());
    },

    async getComputer(botId) {
      return computerInfo(await request(`${botPath(botId)}/computer`, { headers: { Accept: 'application/json' } }));
    },

    async startComputer(botId) {
      return computerInfo(await write('POST', `${botPath(botId)}/computer/start`, {}));
    },

    async computerScreen(botId, signal) {
      const response = await fetch(`${root}${botPath(botId)}/computer/screen`, {
        headers: { Accept: 'image/jpeg' },
        cache: 'no-store',
        ...(signal ? { signal } : {}),
      });
      if (response.status === 404 || response.status === 409) throw new ScreenUnavailable(response.status);
      if (!response.ok) throw new Error(`GET ${botPath(botId)}/computer/screen failed: ${await describeFailure(response)}`);
      return response.blob();
    },

    async computerInput(botId, input) {
      await write('POST', `${botPath(botId)}/computer/input`, ComputerInput.parse(input));
    },

    async setTakeover(botId, input) {
      const response = await write('POST', `${botPath(botId)}/computer/takeover`, SetTakeover.parse(input));
      return Takeover.parse(await response.json());
    },

    async browserStatus(botId) {
      const response = await request(`${botPath(botId)}/browser`, { headers: { Accept: 'application/json' } });
      return parseBrowserStatus(await response.json());
    },

    async getMyChrome() {
      const response = await request('/api/my-chrome', { headers: { Accept: 'application/json' } });
      return parseMyChromeStatus(await response.json());
    },

    async updateMyChrome(input) {
      const body = UpdateMyChromeSettings.parse(input);
      const issue = myChromeEndpointIssue(body.endpoint);
      if (issue !== undefined) throw new Error(issue);
      const response = await write('PUT', '/api/my-chrome', body);
      return parseMyChromeStatus(await response.json());
    },

    async startBrowserLogin(botId) {
      const response = await write('POST', `${botPath(botId)}/browser/login`, {});
      return parseBrowserStatus(await response.json());
    },

    async closeBrowser(botId) {
      await write('POST', `${botPath(botId)}/browser/close`, {});
    },

    async browserScreen(botId, signal) {
      const response = await fetch(`${root}${botPath(botId)}/browser/screen`, {
        headers: { Accept: 'image/jpeg' },
        cache: 'no-store',
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) {
        if (response.status === 404 || response.status === 409) throw new ScreenUnavailable(response.status);
        throw new Error(`GET ${botPath(botId)}/browser/screen failed: ${await describeFailure(response)}`);
      }
      return response.blob();
    },

    getBrowserTakeover(botId) {
      return read(`${botPath(botId)}/browser/takeover`, BrowserTakeoverSchema);
    },

    async setBrowserTakeover(botId, input) {
      const body = SetBrowserTakeover.parse(input);
      const response = await write('POST', `${botPath(botId)}/browser/takeover`, body);
      return BrowserTakeoverSchema.parse(await response.json());
    },

    async browserInput(botId, input) {
      const body = ComputerInput.parse(input);
      await write('POST', `${botPath(botId)}/browser/input`, body);
    },

    listBrowserProfiles() {
      return read('/api/browser/profiles', BrowserProfile.array());
    },

    async createBrowserProfile(input) {
      const body = CreateBrowserProfile.parse(input);
      const response = await write('POST', '/api/browser/profiles', body);
      return BrowserProfile.parse(await response.json());
    },

    async updateBrowserProfile(profileId, input) {
      const body = UpdateBrowserProfile.parse(input);
      const response = await write('PATCH', `/api/browser/profiles/${encodeURIComponent(profileId)}`, body);
      return BrowserProfile.parse(await response.json());
    },

    async deleteBrowserProfile(profileId) {
      await request(`/api/browser/profiles/${encodeURIComponent(profileId)}`, { method: 'DELETE' });
    },

    listMcpServers() {
      return read('/api/mcp/servers', McpServer.array());
    },

    async createMcpServer(input) {
      const body = CreateMcpServer.parse(input);
      const response = await write('POST', '/api/mcp/servers', body);
      return McpServer.parse(await response.json());
    },

    async updateMcpServer(serverId, patch) {
      const body = UpdateMcpServer.parse(patch);
      const response = await write('PATCH', `/api/mcp/servers/${encodeURIComponent(serverId)}`, body);
      return McpServer.parse(await response.json());
    },

    async deleteMcpServer(serverId) {
      await request(`/api/mcp/servers/${encodeURIComponent(serverId)}`, { method: 'DELETE' });
    },

    async testMcpServer(serverId) {
      const response = await write('POST', `/api/mcp/servers/${encodeURIComponent(serverId)}/test`, {});
      return McpServerTestResult.parse(await response.json());
    },

    async exportTeamPackage(teamId?: string) {
      const suffix = teamId === undefined ? '' : `?${new URLSearchParams({ teamId }).toString()}`;
      const path = `/api/team-packages/export${suffix}`;
      const response = await fetch(`${root}${path}`, { headers: { Accept: 'text/markdown' } });
      if (!response.ok) throw new Error(`GET ${path} failed: ${await describeFailure(response)}`);
      const content = await response.text();
      return {
        content,
        filename: downloadName(response.headers.get('content-disposition')) ?? 'brot-team.md',
      };
    },

    async importTeamPackage(content) {
      const body = ImportTeamPackage.parse({ content });
      const response = await write('POST', '/api/team-packages/import', body);
      return parseImportCounts(await response.json());
    },

    getToday(filter: TodayFilter = {}) {
      const suffix = querySuffix({ from: filter.from, to: filter.to, tz: filter.tz });
      return read(`/api/today${suffix}`, TodaySummary);
    },

    getUsage(filter: UsageFilter = {}) {
      const suffix = querySuffix({ from: filter.from, to: filter.to, botId: filter.botId, group: filter.group });
      return read(`/api/usage${suffix}`, UsageSummary);
    },

    usageExportUrl(filter: Omit<UsageFilter, 'group'> = {}) {
      const suffix = querySuffix({ from: filter.from, to: filter.to, botId: filter.botId });
      return `${root}/api/usage/export.csv${suffix}`;
    },

    async listDecisions(filter = {}) {
      const query = DecisionQuery.parse(filter);
      const suffix = querySuffix({
        from: query.from,
        to: query.to,
        botId: query.botId,
        decision: query.decision,
        limit: String(query.limit),
      });
      const response = await request(`/api/decisions${suffix}`, { headers: { Accept: 'application/json' } });
      return DecisionSchema.array().parse(await response.json());
    },

    decisionsExportUrl(filter = {}) {
      const suffix = querySuffix({ from: filter.from, to: filter.to, botId: filter.botId, decision: filter.decision });
      return `${root}/api/decisions/export.csv${suffix}`;
    },

    listSavedLogins() {
      return read('/api/logins', SavedLogin.array());
    },

    async createSavedLogin(input) {
      const body = CreateSavedLogin.parse(input);
      const response = await write('POST', '/api/logins', body);
      return SavedLogin.parse(await response.json());
    },

    async updateSavedLogin(loginId, patch) {
      const body = UpdateSavedLogin.parse(patch);
      const response = await write('PATCH', `/api/logins/${encodeURIComponent(loginId)}`, body);
      return SavedLogin.parse(await response.json());
    },

    async deleteSavedLogin(loginId) {
      await request(`/api/logins/${encodeURIComponent(loginId)}`, { method: 'DELETE' });
    },

    listBotPresets() {
      return read('/api/presets', BotPresetSchema.array());
    },

    async createBotPreset(input) {
      const body = CreateBotPreset.parse(input);
      const response = await write('POST', '/api/presets', body);
      return BotPresetSchema.parse(await response.json());
    },

    async updateBotPreset(presetId, patch) {
      const body = UpdateBotPreset.parse(patch);
      const response = await write('PATCH', `/api/presets/${encodeURIComponent(presetId)}`, body);
      return BotPresetSchema.parse(await response.json());
    },

    async deleteBotPreset(presetId) {
      await request(`/api/presets/${encodeURIComponent(presetId)}`, { method: 'DELETE' });
    },

    async createPresetFromBot(botId, input = {}) {
      const body = CreatePresetFromBot.parse(input);
      const response = await write('POST', `/api/presets/from-bot/${encodeURIComponent(botId)}`, body);
      return BotPresetSchema.parse(await response.json());
    },

    listWorkspaceMemories() {
      return read('/api/profile/memories', Memory.array());
    },

    async createWorkspaceMemory(input) {
      const body = CreateWorkspaceMemory.parse(input);
      const response = await write('POST', '/api/profile/memories', body);
      return Memory.parse(await response.json());
    },

    async searchMessages(filter) {
      const query = SearchQuery.parse({ ...filter, q: filter.q.trim() });
      const suffix = querySuffix({
        q: query.q,
        botId: query.botId,
        threadId: query.threadId,
        limit: String(query.limit),
        before: query.before,
      });
      return read(`/api/search${suffix}`, SearchHit.array());
    },
  };
}

/** The `filename` of a Content-Disposition header, preferring its RFC 5987 form. */
export function downloadName(disposition: string | null): string | undefined {
  if (disposition === null) return undefined;
  const extended = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (extended?.[1] !== undefined) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // Fall through to the plain form.
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain?.[1]?.trim() || undefined;
}

/** Validates the counts a successful import answers. */
export function parseImportCounts(value: unknown): TeamPackageImportCounts {
  if (!isRecord(value)) throw new Error('Expected the import counts');
  const count = (name: keyof TeamPackageImportCounts): number => {
    const raw = value[name];
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) throw new Error(`Expected ${name} to be a count`);
    return raw;
  };
  return { teams: count('teams'), bots: count('bots'), rooms: count('rooms'), routines: count('routines'), skills: count('skills') };
}

/** Validates `GET /api/providers`. The shape lives in docs/COMPUTER-USE.md, not yet in @brot/protocol. */
export function parseProviders(value: unknown): Provider[] {
  if (!Array.isArray(value)) throw new Error('Expected a list of providers');
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`Provider ${index} is not an object`);
    const id = textField(entry.id, 'provider.id');
    const models = Array.isArray(entry.models) ? entry.models : [];
    return {
      id,
      label: textField(entry.label, 'provider.label'),
      configured: entry.configured === true,
      secretName: textField(entry.secretName, 'provider.secretName'),
      ...(entry.api === 'openai-completions' || entry.api === 'openai-responses' || entry.api === 'anthropic-messages' ? { api: entry.api } : {}),
      models: models.map((model) => {
        if (!isRecord(model)) throw new Error('A provider model is not an object');
        const modelId = textField(model.id, 'model.id');
        return { id: `${id}/${modelId}`, label: textField(model.label ?? modelId, 'model.label') };
      }),
    };
  });
}

/** Validates `GET /api/my-chrome`; an empty endpoint falls back to the protocol default. */
export function parseMyChromeStatus(value: unknown): import('./client').MyChromeStatus {
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const settings = typeof record.settings === 'object' && record.settings !== null ? (record.settings as Record<string, unknown>) : {};
  return {
    settings: {
      endpoint: typeof settings.endpoint === 'string' && settings.endpoint !== '' ? settings.endpoint : MY_CHROME_DEFAULT_ENDPOINT,
      ...(typeof settings.updatedAt === 'string' ? { updatedAt: settings.updatedAt } : {}),
    },
    available: record.available === true,
    ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
    ...(typeof record.automation === 'boolean' ? { automation: record.automation } : {}),
    ...(typeof record.hint === 'string' ? { hint: record.hint } : {}),
    ...(typeof record.browser === 'object' && record.browser !== null
      ? (() => {
          const browser = record.browser as Record<string, unknown>;
          return typeof browser.version === 'string' && typeof browser.userAgent === 'string'
            ? { browser: { version: browser.version, userAgent: browser.userAgent } }
            : {};
        })()
      : {}),
  };
}

/** Validates `GET /api/bots/:id/computer`. */
export function parseComputerInfo(value: unknown): ComputerInfo {
  if (!isRecord(value)) throw new Error('Expected a computer object');
  const state = value.state === 'none' ? 'none' : ComputerState.parse(value.state);
  const size = (raw: unknown, fallback: number) => (typeof raw === 'number' && raw > 0 ? raw : fallback);
  return {
    state,
    desktop: value.desktop === true,
    width: size(value.width, DESKTOP_WIDTH),
    height: size(value.height, DESKTOP_HEIGHT),
    takeover: value.takeover == null ? null : Takeover.parse(value.takeover),
  };
}

/** A query string for the optional filters, or '' when every one is absent. */
function querySuffix(values: Readonly<Record<string, string | undefined>>): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) if (value !== undefined) query.set(name, value);
  return query.size === 0 ? '' : `?${query.toString()}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const textField = (value: unknown, field: string): string => {
  if (typeof value !== 'string') throw new Error(`Expected ${field} to be a string`);
  return value;
};

/**
 * Validates `GET /api/bots/:id/browser` (and the login response) with the protocol schema, keeping a
 * friendlier message than a raw zod issue list.
 */
export function parseBrowserStatus(value: unknown): BrowserStatus {
  const result = BrowserStatusSchema.safeParse(value);
  if (result.success) return result.data;
  if (!isRecord(value) || Array.isArray(value)) throw new Error('Expected a browser status object');
  if (value.state !== 'stopped' && value.state !== 'running' && value.state !== 'login') {
    throw new Error('Expected browser state to be stopped, running or login');
  }
  if (!isRecord(value.profile)) throw new Error('Expected a browser profile reference');
  const issue = result.error.issues[0];
  throw new Error(`Expected a browser status: ${issue?.message ?? 'invalid shape'}`);
}

async function describeFailure(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
      const message = `${response.status} ${body.error}`;
      // A validation 400 carries the specific issue (e.g. an invalid cron pattern); show it.
      if ('issues' in body && Array.isArray(body.issues)) {
        const first = body.issues.find((issue: unknown): issue is { message: string } =>
          typeof issue === 'object' && issue !== null && 'message' in issue && typeof issue.message === 'string',
        );
        if (first !== undefined) return `${message}: ${first.message}`;
      }
      return message;
    }
  } catch {
    // Not JSON: fall through to the status line.
  }
  return `${response.status} ${response.statusText}`.trim();
}

/** Validates the `{ runId }` body of `POST /api/routines/:id/run`. */
export function parseRunStarted(value: unknown): RoutineRunStarted {
  if (!isRecord(value)) throw new Error('Expected a routine run object');
  return { runId: textField(value.runId, 'runId') };
}

/** Validates the `{ count }` body of `GET /api/notifications/unread-count`. */
export function parseUnreadCount(value: unknown): number {
  if (!isRecord(value) || typeof value.count !== 'number') throw new Error('Expected an unread count object');
  return value.count;
}

/** Validates the `{ updated }` body of `POST /api/notifications/read`. */
export function parseUpdatedCount(value: unknown): number {
  if (!isRecord(value) || typeof value.updated !== 'number') throw new Error('Expected an updated count object');
  return value.updated;
}

interface HistoryRecords {
  threadId: string;
  messages: Message[];
  runs: Run[];
  approvals: Approval[];
}

/**
 * Rebuilds a thread's canonical events from the records the server exposes. The server has no JSON
 * route for the event log, so tool calls, streamed deltas and memories do not come back on reload.
 * Messages, run boundaries, run costs and approvals do. Event ids are derived from record ids, so a
 * reload yields the same ids every time.
 */
function replay({ threadId, messages, runs, approvals }: HistoryRecords): CanonicalEvent[] {
  const events: CanonicalEvent[] = [];

  for (const message of messages) {
    events.push({
      id: `history:message:${message.id}`,
      at: message.createdAt,
      threadId,
      type: 'message.completed',
      message,
    });
  }

  for (const run of runs) {
    const endedAt = run.endedAt ?? run.startedAt;
    const key = `history:run:${run.id}`;
    events.push({
      id: `${key}:started`,
      at: run.startedAt,
      threadId,
      runId: run.id,
      type: 'run.started',
      botId: run.botId,
      engine: run.engine,
      model: run.model,
    });
    events.push({
      id: `${key}:cost`,
      at: endedAt,
      threadId,
      runId: run.id,
      type: 'cost.updated',
      tokensIn: run.tokensIn,
      tokensOut: run.tokensOut,
      costUsd: run.costUsd,
    });
    if (run.status === 'completed') {
      events.push({ id: `${key}:completed`, at: endedAt, threadId, runId: run.id, type: 'run.completed' });
    } else if (run.status === 'failed' || run.status === 'cancelled') {
      // The live path reports cancellation as run.failed, so history does the same.
      const fallback = run.status === 'cancelled' ? 'Run cancelled.' : 'Run failed.';
      events.push({
        id: `${key}:failed`,
        at: endedAt,
        threadId,
        runId: run.id,
        type: 'run.failed',
        error: run.error ?? fallback,
      });
    }
  }

  for (const approval of approvals) {
    const key = `history:approval:${approval.id}`;
    const requested: Approval = {
      id: approval.id,
      runId: approval.runId,
      threadId: approval.threadId,
      botId: approval.botId,
      kind: approval.kind,
      tool: approval.tool,
      summary: approval.summary,
      args: approval.args,
      status: 'pending',
      createdAt: approval.createdAt,
    };
    events.push({
      id: `${key}:requested`,
      at: approval.createdAt,
      threadId,
      runId: approval.runId,
      type: 'approval.requested',
      approval: requested,
    });
    if (approval.status !== 'pending') {
      events.push({
        id: `${key}:resolved`,
        at: approval.resolvedAt ?? approval.createdAt,
        threadId,
        runId: approval.runId,
        type: 'approval.resolved',
        approval,
      });
    }
  }

  // Array.prototype.sort is stable, so records sharing a timestamp keep the order pushed above.
  return events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** One preset from the server, validated with the protocol schema. */
export function parseBotPreset(value: unknown): import('@brot/protocol').BotPreset {
  return BotPresetSchema.parse(value);
}

/** A list of bot presets from the server. */
export function parseBotPresets(value: unknown): import('@brot/protocol').BotPreset[] {
  return BotPresetSchema.array().parse(value);
}
