import type { Approval, ApprovalDecision, CanonicalEvent, Message, PostMessage, ResolveApproval, Task, Thread } from '@brot/protocol';
import { MAX_ROOM_BOTS, MIN_ROOM_BOTS } from '@brot/protocol';
import type { BotEvent, BrotClient, NewRoom, NewTask, Room, RoomMessage, TaskFilter } from './client';
import {
  DEMO_BOTS,
  DEMO_HISTORY,
  DEMO_ROOM_HISTORY,
  DEMO_ROOMS,
  DEMO_TASKS,
  OPEN_ASK,
  PENDING_SEND,
  TASK_EMAIL,
  TASK_EXPORT,
  LAUNCH_ROOM,
  dmThreadOf,
} from './fixtures';
import { findMentions } from '../mentions';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toISOString();

let counter = 0;
const nextId = (prefix: string) => `${prefix}_${(counter += 1).toString(36)}`;

/** How long the seeded open question waits before Tamu answers it. */
const OPEN_ASK_DELAY_MS = 30_000;

type Key = { botId: string } | { roomId: string };

const nameOf = (botId: string) => DEMO_BOTS.find((bot) => bot.id === botId)?.name ?? botId;

/**
 * An in-process stand-in for the server and its mock engine. It emits the same canonical events a
 * real run would, so the UI exercises the full fold, approval, streaming and team paths without a
 * backend. A DM message that mentions send, email, or reply asks for approval before "sending". In
 * a room, "ask" or "check" makes the responder ask another member, and "task", "delegate" or
 * "assign" makes it delegate a task.
 */
export function createMockClient(): BrotClient {
  const listeners = new Set<(event: BotEvent) => void>();
  const histories = new Map<string, CanonicalEvent[]>();
  const approvals = new Map<string, { key: Key; approval: Approval }>();
  const waiting = new Map<string, (decision: ApprovalDecision, reply?: string) => void>();
  const rooms = new Map<string, Room>(DEMO_ROOMS.map((room) => [room.thread.id, structuredClone(room)]));
  const tasks = new Map<string, Task>(DEMO_TASKS.map((task) => [task.id, { ...task }]));
  const taskTimers = new Map<string, Array<ReturnType<typeof setTimeout>>>();
  const batons = new Map<string, string>();

  const storeKey = (key: Key) => ('botId' in key ? `dm:${key.botId}` : `room:${key.roomId}`);
  const threadIdOf = (key: Key) => ('botId' in key ? dmThreadOf(key.botId) : key.roomId);
  const keyOfThread = (threadId: string): Key =>
    rooms.has(threadId) ? { roomId: threadId } : { botId: threadId.replace(/^thread_/, '') };

  for (const bot of DEMO_BOTS) {
    const seed = [...(DEMO_HISTORY[bot.id] ?? [])];
    histories.set(storeKey({ botId: bot.id }), seed);
  }
  for (const [roomId, seed] of Object.entries(DEMO_ROOM_HISTORY)) {
    histories.set(storeKey({ roomId }), [...seed]);
    for (const event of seed) if (event.type === 'handoff') batons.set(roomId, event.toBotId);
  }
  approvals.set(PENDING_SEND.id, { key: { botId: PENDING_SEND.botId }, approval: PENDING_SEND });

  const record = (key: Key, event: CanonicalEvent) => {
    const list = histories.get(storeKey(key)) ?? [];
    list.push(event);
    histories.set(storeKey(key), list);
    for (const listener of listeners) listener({ ...key, event });
  };

  const base = (key: Key, runId?: string) => ({ id: nextId('evt'), at: now(), threadId: threadIdOf(key), runId });

  const saveTask = (next: Task) => {
    tasks.set(next.id, next);
    record(keyOfThread(next.threadId), { ...base(keyOfThread(next.threadId)), type: 'task.updated', task: next });
  };

  const updateTask = (taskId: string, patch: Partial<Task>) => {
    const current = tasks.get(taskId);
    if (!current) return;
    saveTask({ ...current, ...patch, updatedAt: now() });
  };

  async function stream(key: Key, runId: string, botId: string, text: string): Promise<void> {
    const messageId = nextId('msg');
    for (const delta of text.split(/(?<=\s)/)) {
      record(key, { ...base(key, runId), type: 'message.delta', messageId, delta });
      await sleep(28);
    }
    const message: Message = {
      id: messageId,
      threadId: threadIdOf(key),
      role: 'assistant',
      content: text,
      createdAt: now(),
      authorBotId: botId,
    };
    record(key, { ...base(key, runId), type: 'message.completed', message });
  }

  function finish(key: Key, runId: string) {
    record(key, { ...base(key, runId), type: 'cost.updated', tokensIn: 120, tokensOut: 24, costUsd: 0.0004 });
    record(key, { ...base(key, runId), type: 'run.completed' });
  }

  async function runAgent(botId: string, content: string): Promise<void> {
    const key: Key = { botId };
    const runId = nextId('run');
    const threadId = threadIdOf(key);
    record(key, { ...base(key, runId), type: 'run.started', botId, engine: 'mock', model: 'mock-1' });
    await sleep(250);

    if (/\b(send|email|reply)\b/i.test(content)) {
      const approval: Approval = {
        id: nextId('appr'),
        runId,
        threadId,
        botId,
        kind: 'send',
        tool: 'gmail.send',
        summary: `Send the drafted follow-up for "${content.slice(0, 40)}"`,
        args: { body: content },
        status: 'pending',
        createdAt: now(),
      };
      approvals.set(approval.id, { key, approval });
      record(key, { ...base(key, runId), type: 'approval.requested', approval });

      const decision = await new Promise<ApprovalDecision>((resolve) => {
        waiting.set(approval.id, (value) => resolve(value));
      });

      if (decision === 'deny') {
        await stream(key, runId, botId, 'Understood. I did not send it.');
        record(key, { ...base(key, runId), type: 'run.completed' });
        return;
      }

      const callId = nextId('call');
      record(key, { ...base(key, runId), type: 'tool.call', callId, tool: 'gmail.send', args: approval.args });
      await sleep(400);
      record(key, { ...base(key, runId), type: 'tool.result', callId, ok: true, output: 'Sent.' });
    }

    await stream(key, runId, botId, 'On it. I will report back with the details shortly.');
    finish(key, runId);
  }

  /** Answers with the bot that the room's rules pick: mentions first, else the baton holder or lead. */
  function respondersFor(room: Room, mentions: string[]): string[] {
    const members = mentions.filter((botId) => room.memberIds.includes(botId));
    if (members.length > 0) return members;
    if (room.thread.responder === 'mention') return [];
    const baton = batons.get(room.thread.id);
    return [baton && room.memberIds.includes(baton) ? baton : (room.thread.leadBotId ?? room.thread.botId)];
  }

  async function runRoomAgent(room: Room, botId: string, content: string): Promise<void> {
    const key: Key = { roomId: room.thread.id };
    const runId = nextId('run');
    const other = room.memberIds.find((id) => id !== botId);
    record(key, { ...base(key, runId), type: 'run.started', botId, engine: 'mock', model: 'mock-1' });
    await sleep(500);

    if (other && /\b(ask|check)\b/i.test(content)) {
      const askId = nextId('ask');
      await stream(key, runId, botId, `Let me check with ${nameOf(other)}.`);
      record(key, {
        ...base(key, runId),
        type: 'bot.asked',
        askId,
        fromBotId: botId,
        toBotId: other,
        question: `Can you confirm this for me? "${content.slice(0, 80)}"`,
      });
      await sleep(2200);
      record(key, {
        ...base(key, runId),
        type: 'bot.answered',
        askId,
        fromBotId: botId,
        toBotId: other,
        answer: 'Confirmed. Nothing in my notes contradicts it.',
      });
      await stream(key, runId, botId, `${nameOf(other)} confirmed it. All set.`);
      finish(key, runId);
      return;
    }

    if (other && /\b(task|delegate|assign)\b/i.test(content)) {
      await stream(key, runId, botId, `I will hand this to ${nameOf(other)} and track it on the board.`);
      const created = makeTask({ title: content.replace(/@[\p{L}\p{N}_-]+\s*/gu, '').slice(0, 80) || 'Follow up', assigneeBotId: other, roomId: room.thread.id }, botId);
      record(key, { ...base(key), type: 'task.created', task: created });
      startTask(created.id);
      finish(key, runId);
      return;
    }

    await stream(key, runId, botId, 'Got it. I will take this one and post an update here.');
    finish(key, runId);
  }

  function makeTask(input: NewTask, createdByBotId?: string): Task {
    const id = nextId('task');
    const at = now();
    const parent = createdByBotId ? [...tasks.values()].find((entry) => entry.assigneeBotId === createdByBotId && entry.status === 'in_progress') : undefined;
    const created: Task = {
      id,
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      status: 'open',
      assigneeBotId: input.assigneeBotId,
      createdByUser: createdByBotId === undefined,
      ...(createdByBotId ? { createdByBotId } : {}),
      ...(parent && parent.depth < 3 ? { parentTaskId: parent.id } : {}),
      threadId: input.roomId ?? dmThreadOf(input.assigneeBotId),
      chainId: parent && parent.depth < 3 ? parent.chainId : id,
      depth: createdByBotId === undefined ? 0 : parent && parent.depth < 3 ? parent.depth + 1 : 1,
      createdAt: at,
      updatedAt: at,
    };
    tasks.set(id, created);
    return created;
  }

  /** Walks a new task through in progress to done, the way an assignee's run would report it. */
  function startTask(taskId: string) {
    const timers = [
      setTimeout(() => updateTask(taskId, { status: 'in_progress', workThreadId: dmThreadOf(tasks.get(taskId)?.assigneeBotId ?? '') }), 900),
      setTimeout(() => {
        const current = tasks.get(taskId);
        if (!current || current.status !== 'in_progress') return;
        updateTask(taskId, { status: 'done', result: `Done. ${nameOf(current.assigneeBotId)} finished "${current.title}".` });
      }, 6000),
    ];
    taskTimers.set(taskId, timers);
  }

  let openAskScheduled = false;
  function scheduleOpenAsk() {
    if (openAskScheduled) return;
    openAskScheduled = true;
    setTimeout(() => {
      const key: Key = { roomId: LAUNCH_ROOM };
      record(key, {
        ...base(key, OPEN_ASK.runId),
        type: 'bot.answered',
        askId: OPEN_ASK.askId,
        fromBotId: OPEN_ASK.from,
        toBotId: OPEN_ASK.to,
        answer: 'Per request. Pages of 20k rows stay under it.',
      });
      void stream(key, OPEN_ASK.runId, OPEN_ASK.from, 'Per request, so pages of 20k rows keep us under the cap. The fix is in review.').then(() => {
        finish(key, OPEN_ASK.runId);
        updateTask(TASK_EXPORT, { status: 'done', result: 'Exports now stream in pages of 20k rows. Fix is in review.' });
      });
    }, OPEN_ASK_DELAY_MS);
  }

  return {
    async listBots() {
      return DEMO_BOTS.map((bot) => ({ ...bot }));
    },

    async history(botId) {
      return [...(histories.get(storeKey({ botId })) ?? [])];
    },

    onEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async postMessage(botId: string, input: PostMessage) {
      const key: Key = { botId };
      if (!histories.has(storeKey(key))) throw new Error(`Unknown bot: ${botId}`);
      record(key, {
        ...base(key),
        type: 'message.completed',
        message: { id: nextId('msg'), threadId: threadIdOf(key), role: 'user', content: input.content, createdAt: now() },
      });
      void runAgent(botId, input.content);
    },

    async resolveApproval(approvalId: string, input: ResolveApproval) {
      const entry = approvals.get(approvalId);
      if (!entry) throw new Error(`Unknown approval: ${approvalId}`);
      if (entry.approval.status !== 'pending') return;

      const resolved: Approval = {
        ...entry.approval,
        status: input.decision === 'deny' ? 'denied' : 'allowed',
        decision: input.decision,
        reply: input.reply,
        resolvedAt: now(),
      };
      approvals.set(approvalId, { key: entry.key, approval: resolved });
      record(entry.key, { ...base(entry.key, resolved.runId), type: 'approval.resolved', approval: resolved });

      const resume = waiting.get(approvalId);
      if (resume) {
        waiting.delete(approvalId);
        resume(input.decision);
        return;
      }

      // No live run is waiting on this approval (seeded history), so close it out here.
      const botId = entry.approval.botId;
      if (input.decision === 'deny') {
        await stream(entry.key, resolved.runId, botId, input.reply ? `Not sent. Noted: ${input.reply}` : 'Not sent.');
        if (approvalId === PENDING_SEND.id) updateTask(TASK_EMAIL, { status: 'cancelled', result: 'You declined the send.' });
      } else {
        const callId = nextId('call');
        record(entry.key, { ...base(entry.key, resolved.runId), type: 'tool.call', callId, tool: entry.approval.tool, args: entry.approval.args });
        await sleep(400);
        record(entry.key, { ...base(entry.key, resolved.runId), type: 'tool.result', callId, ok: true, output: 'Sent.' });
        await stream(entry.key, resolved.runId, botId, 'Sent. I will tell you when Ana replies.');
        if (approvalId === PENDING_SEND.id) updateTask(TASK_EMAIL, { status: 'done', result: 'Sent to ana@acme.com.' });
      }
      record(entry.key, { ...base(entry.key, resolved.runId), type: 'run.completed' });
    },

    async listRooms() {
      return [...rooms.values()].map((room) => structuredClone(room));
    },

    async createRoom(input: NewRoom) {
      if (input.botIds.length < MIN_ROOM_BOTS || input.botIds.length > MAX_ROOM_BOTS) {
        throw new Error(`A room needs ${MIN_ROOM_BOTS} to ${MAX_ROOM_BOTS} bots.`);
      }
      if (!input.botIds.includes(input.leadBotId)) throw new Error('The lead bot must be a member.');
      const at = now();
      const thread: Thread = {
        id: nextId('room'),
        botId: input.leadBotId,
        title: input.title,
        kind: 'room',
        leadBotId: input.leadBotId,
        responder: input.responder,
        createdAt: at,
        updatedAt: at,
      };
      const created: Room = { thread, memberIds: [...input.botIds] };
      rooms.set(thread.id, created);
      const key: Key = { roomId: thread.id };
      histories.set(storeKey(key), []);
      record(key, { ...base(key), type: 'room.members', botIds: [...input.botIds] });
      return structuredClone(created);
    },

    async roomHistory(roomId) {
      if (roomId === LAUNCH_ROOM) scheduleOpenAsk();
      return [...(histories.get(storeKey({ roomId })) ?? [])];
    },

    async postRoomMessage(roomId: string, input: RoomMessage) {
      const room = rooms.get(roomId);
      if (!room) throw new Error(`Unknown room: ${roomId}`);
      const key: Key = { roomId };
      const mentions = input.mentions ?? findMentions(
        input.content,
        DEMO_BOTS.filter((bot) => room.memberIds.includes(bot.id)),
      );
      record(key, {
        ...base(key),
        type: 'message.completed',
        message: {
          id: nextId('msg'),
          threadId: roomId,
          role: 'user',
          content: input.content,
          createdAt: now(),
          ...(mentions.length > 0 ? { mentions } : {}),
        },
      });
      const responders = respondersFor(room, mentions);
      void (async () => {
        for (const botId of responders) await runRoomAgent(room, botId, input.content);
      })();
    },

    async listTasks(filter: TaskFilter = {}) {
      return [...tasks.values()].filter(
        (entry) =>
          (filter.assigneeBotId === undefined || entry.assigneeBotId === filter.assigneeBotId) &&
          (filter.status === undefined || entry.status === filter.status) &&
          (filter.chainId === undefined || entry.chainId === filter.chainId) &&
          (filter.threadId === undefined || entry.threadId === filter.threadId),
      );
    },

    async createTask(input: NewTask) {
      if (!input.title.trim()) throw new Error('A task needs a title.');
      const created = makeTask(input);
      const key = keyOfThread(created.threadId);
      record(key, { ...base(key), type: 'task.created', task: created });
      startTask(created.id);
      return { ...created };
    },

    async cancelTask(taskId: string) {
      const current = tasks.get(taskId);
      if (!current) throw new Error(`Unknown task: ${taskId}`);
      for (const timer of taskTimers.get(taskId) ?? []) clearTimeout(timer);
      taskTimers.delete(taskId);
      if (current.status === 'done' || current.status === 'failed' || current.status === 'cancelled') return { ...current };
      updateTask(taskId, { status: 'cancelled' });
      return { ...tasks.get(taskId)! };
    },
  };
}
