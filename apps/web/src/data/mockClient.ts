import type {
  Approval,
  AdminActivity,
  ApprovalDecision,
  ApprovalKind,
  Attachment,
  Bot,
  BotPreset,
  BrowserTakeover,
  SavedLogin,
  CanonicalEvent,
  ComputerState,
  Decision,
  Device,
  Memory,
  McpServer,
  Message,
  MyChromeSettings,
  MemoryJournalEntry,
  Notification,
  PostMessage,
  ResolveApproval,
  Routine,
  RoutineRun,
  RoomDeciderSettings,
  RoutineRunStatus,
  SearchHit,
  Skill,
  Takeover,
  Task,
  Team,
  TeamPackage,
  Thread,
} from '@brot/protocol';
import {
  AdminActivityQuery,
  ComputerInput,
  CreateBot,
  CreateBotPreset,
  CreateMcpServer,
  CreatePresetFromBot,
  CreateMemory,
  CreateWorkspaceMemory,
  CreateSavedLogin,
  CreateRoutine,
  CreateSkill,
  CreateTeam,
  CreateThread,
  MemoryJournalQuery,
  MemoryUpkeepScope,
  ApplyMemoryUpkeep,
  UpdateRoomDeciderSettings,
  DecisionQuery,
  DESKTOP_HEIGHT,
  DESKTOP_WIDTH,
  myChromeEndpointIssue,
  UpdateMyChromeSettings,
  MAX_ROOM_BOTS,
  MIN_ROOM_BOTS,
  ImportSkill,
  McpServer as McpServerSchema,
  SearchQuery,
  TEAM_PACKAGE_FORMAT,
  TEAM_PACKAGE_VERSION,
  UpdateBot,
  UpdateMcpServer,
  UpdateMemory,
  UpdateRoomMembers,
  UpdateRoutine,
  UpdateBotPreset,
  UpdateSavedLogin,
  UpdateSkill,
  UpdateTeam,
  UpdateThread,
  attachmentKindFor,
  defaultEgressPolicy,
  formatSkillFile,
  formatTeamPackage,
  parseSkillFile,
  parseTeamPackage,
  sanitizeAttachmentName,
} from '@brot/protocol';
import {
  MY_CHROME_DEFAULT_ENDPOINT,
  ScreenUnavailable,
  type BotEvent,
  type BrotClient,
  type BrowserProfile,
  type BrowserProfileRef,
  type BrowserStatus,
  type ComputerInfo,
  type NewRoom,
  type NewTask,
  type Provider,
  type Room,
  type RoomMessage,
  type TaskFilter,
  type VoiceInfo,
  type VoiceSettings,
  providerSupportsDecider,
} from './client';
import { applyInput, navigate, newScreen, renderScreen, type FakeScreen } from './mockComputer';
import {
  DEFAULT_THREAD_TITLE,
  DEMO_BOT_BROWSER_PROFILES,
  DEMO_BOT_PRESETS,
  DEMO_DECISIONS,
  DEMO_BOTS,
  DEMO_BROWSER_PROFILES,
  DEMO_HISTORY,
  DEMO_MCP_SERVERS,
  DEMO_SAVED_LOGINS,
  DEMO_MEMORIES,
  DEMO_NOTIFICATIONS,
  DEMO_ROOM_HISTORY,
  DEMO_ROOMS,
  DEMO_ROUTINE_RUNS,
  DEMO_ROUTINES,
  DEMO_SKILLS,
  DEMO_TASKS,
  DEMO_TEAMS,
  DEMO_WORKSPACE_MEMORIES,
  DEMO_THREAD_TITLES,
  OPEN_ASK,
  PENDING_SEND,
  TASK_EMAIL,
  TASK_EXPORT,
  LAUNCH_ROOM,
  dmThreadOf,
} from './fixtures';
import { findMentions } from '../mentions';
import { skillFileFilename } from '../skillFileName';




import { buildMemoryUpkeepReport } from './memoryUpkeepCompute';
import { DEFAULT_BACKUP_SETTINGS, validateUpdateBackupSettings, type BackupEntry, type BackupSettings, type BackupStatus } from '../backups';
import type { StarterTeamInstallCounts, StarterTeamSummary } from '../starterTeams';
import { modelSupportsTranscription, validateUpdateTranscriptionSettings, type TranscriptionSettings, type TranscriptionStatus } from '../transcription';
import { buildSearchSnippet } from '../search';
import { DEFAULT_SYSTEM_VOICE, silentWavBlob, voiceTextAllowed } from '../voice';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const now = () => new Date().toISOString();

/** The demo's reachability rule: the Chrome on the default endpoint is listening; other ports are not. */
function myChromeStatus(settings: MyChromeSettings): import('./client').MyChromeStatus {
  const available = settings.endpoint === MY_CHROME_DEFAULT_ENDPOINT;
  return {
    settings: structuredClone(settings),
    available,
    ...(available ? {} : { reason: 'Chrome is not listening on that endpoint.' }),
  };
}

/** When the demo team's threads were last active. */
const SEEDED_AT = '2026-10-19T07:00:00.000Z';

let counter = 0;
const nextId = (prefix: string) => `${prefix}_${(counter += 1).toString(36)}`;

/** How long the seeded open question waits before Tamu answers it. */
const OPEN_ASK_DELAY_MS = 30_000;

/** Ready-made teams the demo can install; these mirror the server's built-in starter packages. */
const STARTER_TEAMS: readonly {
  summary: StarterTeamSummary;
  team: { name: string; instructions: string };
  bots: readonly { name: string; job: string }[];
  room?: { title: string; leadIndex: number; responder: 'lead' | 'mention' };
  routine: { botIndex: number; name: string; instruction: string; cron: string };
  skills: readonly { name: string; description: string; body: string }[];
}[] = [
  {
    summary: {
      id: 'dev-team',
      name: 'Dev team',
      description: 'A chief of staff, an engineer and a reviewer who ship together and check the repository every weekday.',
      teamCount: 1,
      botCount: 3,
      roomCount: 1,
      routineCount: 1,
      skillCount: 1,
    },
    team: {
      name: 'Engineering',
      instructions:
        'Ship small, reviewable changes. Keep the Build room updated on what is in flight, and ask before any risky change.',
    },
    bots: [
      { name: 'Capy', job: 'Chief of Staff' },
      { name: 'Onça', job: 'Engineer' },
      { name: 'Lobo', job: 'Reviewer' },
    ],
    room: { title: 'Build room', leadIndex: 0, responder: 'lead' },
    routine: { botIndex: 1, name: 'Daily repo check', instruction: 'Check the repository and post a short summary to the Build room.', cron: '0 9 * * 1-5' },
    skills: [{ name: 'Unified diff', description: 'How the engineering bots present changes.', body: '# Unified diff\n\nShow one focused diff.' }],
  },
  {
    summary: {
      id: 'content-studio',
      name: 'Content studio',
      description: 'An editor, a researcher and a social writer who turn ideas into reviewed posts.',
      teamCount: 1,
      botCount: 3,
      roomCount: 1,
      routineCount: 1,
      skillCount: 1,
    },
    team: {
      name: 'Content',
      instructions: 'Stay in the Editorial room. Research before writing and never publish without approval.',
    },
    bots: [
      { name: 'Arara', job: 'Editor' },
      { name: 'Mico', job: 'Researcher' },
      { name: 'Boto', job: 'Social' },
    ],
    room: { title: 'Editorial room', leadIndex: 0, responder: 'mention' },
    routine: { botIndex: 0, name: 'Weekly content review', instruction: 'Review the week’s drafts and post the review in the Editorial room.', cron: '0 10 * * 1' },
    skills: [{ name: 'Hook checklist', description: 'The questions the studio answers before any piece goes out.', body: '# Hook checklist\n\n- Who is this for?\n- What is the one claim?' }],
  },
  {
    summary: {
      id: 'ops-desk',
      name: 'Ops desk',
      description: 'Support triage and finance working a shared queue with a morning brief.',
      teamCount: 1,
      botCount: 2,
      roomCount: 1,
      routineCount: 1,
      skillCount: 1,
    },
    team: {
      name: 'Operations',
      instructions: 'Work the queue in the Ops room and escalate money questions to Finance before acting.',
    },
    bots: [
      { name: 'Tamu', job: 'Support triage' },
      { name: 'Jabuti', job: 'Finance' },
    ],
    room: { title: 'Ops room', leadIndex: 0, responder: 'lead' },
    routine: { botIndex: 0, name: 'Morning brief', instruction: 'Summarize yesterday’s support queue and post the brief to the Ops room.', cron: '0 8 * * 1-5' },
    skills: [{ name: 'Refund triage', description: 'How the ops desk decides between answering, escalating and refunding.', body: '# Refund triage\n\nCheck the policy first.' }],
  },
];

export const DEMO_PROVIDERS: Provider[] = [
  {
    id: 'opencode-go',
    label: 'OpenCode Go',
    configured: true,
    secretName: 'OPENCODE_API_KEY',
    api: 'openai-completions',
    models: [
      { id: 'opencode-go/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', transcription: true },
      { id: 'opencode-go/deepseek-v4.1', label: 'DeepSeek V4.1' },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    configured: false,
    secretName: 'DEEPSEEK_API_KEY',
    api: 'openai-completions',
    models: [{ id: 'deepseek/deepseek-v4.1', label: 'DeepSeek V4.1' }],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    configured: false,
    secretName: 'ANTHROPIC_API_KEY',
    api: 'anthropic-messages',
    models: [
      { id: 'anthropic/claude-sonnet', label: 'Claude Sonnet' },
      { id: 'anthropic/claude-haiku', label: 'Claude Haiku' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    configured: false,
    secretName: 'OPENAI_API_KEY',
    models: [{ id: 'openai/gpt-5-mini', label: 'GPT-5 mini' }],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    configured: false,
    secretName: 'OPENROUTER_API_KEY',
    models: [{ id: 'openrouter/auto', label: 'Auto' }],
  },
];

const DEMO_DEVICES: Device[] = [
  {
    id: 'dev_phone',
    name: 'iPhone',
    role: 'full',
    publicKey: 'demo-public-key',
    createdAt: '2026-10-12T18:30:00.000Z',
    lastSeenAt: '2026-10-19T07:58:00.000Z',
  },
];

/** A URL the message names, else a page that fits the bot. */
function pickUrl(content: string, botId: string): string {
  const named = content.match(/\bhttps?:\/\/[^\s]+/i)?.[0] ?? content.match(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|dev|io|net|br|app)\b[^\s]*/i)?.[0];
  if (named) return named.startsWith('http') ? named : `https://${named}`;
  if (/linkedin/i.test(content) || botId === 'bot_ara') return 'https://www.linkedin.com/feed/';
  return `https://duckduckgo.com/?q=${encodeURIComponent(content.slice(0, 60))}`;
}

/** The RFC 4648 secret without the spacing a person pastes, uppercased like the server stores it. */
const normalizeTotp = (value: string): string => value.replace(/\s+/g, '').toUpperCase();

/** A download name from a team name: lowercase ASCII words joined by dashes. */
function teamSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug === '' ? 'team' : slug;
}

const IMPORTABLE_AVATAR = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;

const byRecent = (threads: readonly Thread[]): Thread[] =>
  [...threads].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));

/**
 * The next occurrence of the cron presets the routine dialog writes, for the mock's schedule preview.
 * Anything fancier keeps no next run, like a disabled routine.
 */
function nextMockRunAt(cron: string, from = Date.now()): string | undefined {
  const [minuteField, hourField, dayField, monthField, weekdayField] = cron.trim().split(/\s+/);
  if (minuteField === undefined || hourField === undefined || dayField === undefined || monthField === undefined || weekdayField === undefined) return undefined;
  if (dayField !== '*' || monthField !== '*') return undefined;
  const date = new Date(from);
  date.setSeconds(0, 0);

  const step = /^\*\/(\d+)$/.exec(minuteField);
  if (step) {
    const size = Number(step[1]);
    if (!Number.isFinite(size) || size < 1 || size > 60) return undefined;
    date.setMinutes(date.getMinutes() + (size - (date.getMinutes() % size)), 0, 0);
    return date.toISOString();
  }
  if (hourField === '*') {
    const minute = Number(minuteField);
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) return undefined;
    date.setMinutes(minute, 0, 0);
    if (date.getTime() <= from) date.setHours(date.getHours() + 1);
    return date.toISOString();
  }

  const minute = Number(minuteField);
  const hour = Number(hourField);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59 || !Number.isInteger(hour) || hour < 0 || hour > 23) return undefined;
  const target = (daysAhead: number) => {
    const next = new Date(from);
    next.setDate(next.getDate() + daysAhead);
    next.setHours(hour, minute, 0, 0);
    return next.getTime() > from ? next.toISOString() : undefined;
  };
  if (weekdayField === '*') return target(1);
  const weekdays = /^1-5$/.test(weekdayField) ? [1, 2, 3, 4, 5] : /^[0-6]$/.test(weekdayField) ? [Number(weekdayField)] : undefined;
  if (weekdays === undefined) return undefined;
  for (let ahead = 1; ahead <= 8; ahead += 1) {
    const day = (new Date(from).getDay() + ahead) % 7;
    if (!weekdays.includes(day)) continue;
    const next = target(ahead);
    if (next !== undefined) return next;
  }
  return undefined;
}

/**
 * An in-process stand-in for the server and its mock engine. It emits the same canonical events a
 * real run would, so the UI exercises the full fold, approval, streaming and team paths without a
 * backend. Every bot has any number of DM threads; a message answers in the thread it was posted to.
 * In a DM, a message that mentions send, email, or reply asks for approval before "sending". In a
 * room, "ask" or "check" makes the responder ask another member, and "task", "delegate" or "assign"
 * makes it delegate a task.
 */
export function createMockClient(): BrotClient {
  const bots = new Map<string, Bot>(DEMO_BOTS.map((bot) => [bot.id, structuredClone(bot)]));
  const botPresets = new Map<string, BotPreset>(DEMO_BOT_PRESETS.map((preset) => [preset.id, structuredClone(preset)]));
  const decisions: Decision[] = DEMO_DECISIONS.map((decision) => structuredClone(decision));
  const activityAt = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const adminActivity: AdminActivity[] = [
    { id: nextId('activity'), action: 'updated', targetType: 'settings', summary: 'Updated transcription settings', actor: 'local', at: activityAt(12) },
    { id: nextId('activity'), action: 'created', targetType: 'bot', summary: 'Created bot Capy', actor: 'local', at: activityAt(65) },
    { id: nextId('activity'), action: 'revoked', targetType: 'device', summary: 'Revoked phone Pixel 9', actor: 'Pixel 9', at: activityAt(190) },
    { id: nextId('activity'), action: 'deleted', targetType: 'saved-login', summary: 'Deleted saved login for GitHub', actor: 'local', at: activityAt(430) },
    { id: nextId('activity'), action: 'ran', targetType: 'routine', summary: 'Ran routine Morning brief', actor: 'local', at: activityAt(960) },
  ];
  const recordAdminActivity = (entry: Omit<AdminActivity, 'id' | 'at'>): void => {
    adminActivity.unshift({ id: nextId('activity'), at: now(), ...entry });
  };
  let backupSettings: BackupSettings = { ...DEFAULT_BACKUP_SETTINGS };
  const backupEntries: BackupEntry[] = [
    {
      name: 'brot-backup-2026-10-21-030000',
      createdAt: activityAt(2 * 24 * 60),
      sizeBytes: 2_400_000,
      includesSecrets: true,
    },
    {
      name: 'brot-backup-2026-10-17-030000',
      createdAt: activityAt(6 * 24 * 60),
      sizeBytes: 2_100_000,
      includesSecrets: true,
    },
  ];
  const backupStatus = (): BackupStatus => {
    const newest = [...backupEntries].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    const settings: BackupSettings = {
      ...backupSettings,
      ...(newest === undefined ? {} : { lastRunAt: newest.createdAt, lastBackupName: newest.name }),
    };
    if (settings.enabled) {
      const base = newest === undefined ? Date.now() : Date.parse(newest.createdAt) + settings.intervalHours * 3_600_000;
      const next = Math.max(base, Date.now() + 60_000);
      return {
        settings,
        backups: [...backupEntries].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map((entry) => structuredClone(entry)),
        nextRunAt: new Date(next).toISOString(),
      };
    }
    return {
      settings,
      backups: [...backupEntries].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).map((entry) => structuredClone(entry)),
    };
  };
  const teams = new Map<string, Team>(DEMO_TEAMS.map((team) => [team.id, structuredClone(team)]));
  const nameOf = (botId: string) => bots.get(botId)?.name ?? botId;
  const byTeamName = (a: Team, b: Team) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  /** Mirrors the server: a chief must be a bot that exists and is not archived. */
  const requireChief = (chiefBotId: string | null | undefined) => {
    if (chiefBotId === undefined || chiefBotId === null) return;
    const chief = bots.get(chiefBotId);
    if (!chief || chief.archived) throw new Error(`Unknown bot: ${chiefBotId}`);
  };
  const clearChiefOf = (botId: string) => {
    for (const [teamId, team] of teams) {
      if (team.chiefBotId !== botId) continue;
      const cleared = { ...team };
      delete cleared.chiefBotId;
      teams.set(teamId, cleared);
    }
  };
  const providers = DEMO_PROVIDERS.map((provider) => structuredClone(provider));
  let roomDecider: RoomDeciderSettings = {};
  let myChrome: MyChromeSettings = { endpoint: MY_CHROME_DEFAULT_ENDPOINT };
  let transcription: TranscriptionSettings = {};
  const transcriptionStatus = (): TranscriptionStatus => {
    const model = transcription.model;
    if (model === undefined) return { settings: structuredClone(transcription), available: false, reason: 'No transcription model is configured.' };
    const provider = providers.find((candidate) => model.startsWith(`${candidate.id}/`));
    const entry = provider?.models.find((candidate) => candidate.id === model);
    if (provider === undefined || entry === undefined) return { settings: structuredClone(transcription), available: false, reason: 'The configured transcription model is unknown.' };
    if (!modelSupportsTranscription(entry)) return { settings: structuredClone(transcription), available: false, reason: 'That model cannot transcribe audio.' };
    if (!provider.configured) return { settings: structuredClone(transcription), available: false, reason: `${provider.label} has no API key yet.` };
    return { settings: structuredClone(transcription), available: true };
  };

  /** The server's fallback rules: at most 3 ordered refs, no repeats, each a known `<provider>/<model>`. */
  const validateFallbackModels = (models: readonly string[]): void => {
    if (models.length > 3) throw new Error('A bot has at most 3 fallback models');
    if (new Set(models).size !== models.length) throw new Error('Fallback models must be unique');
    for (const ref of models) {
      if (!providers.some((provider) => provider.models.some((model) => model.id === ref))) throw new Error(`Unknown model: ${ref}`);
    }
  };
  const devices = DEMO_DEVICES.map((device) => ({ ...device }));
  const screens = new Map<string, FakeScreen>();
  const browserProfiles = new Map<string, BrowserProfile>(DEMO_BROWSER_PROFILES.map((profile) => [profile.id, structuredClone(profile)]));
  const mcpServers = new Map<string, McpServer>(DEMO_MCP_SERVERS.map((server) => [server.id, structuredClone(server)]));
  /** Value-free views the API returns; the credentials live only in `savedLoginSecrets`. */
  const savedLogins = new Map<string, SavedLogin>(DEMO_SAVED_LOGINS.map((login) => [login.id, structuredClone(login)]));
  /** Vault secret names only: the mock never stores or returns values. */
  const secretNames = new Set<string>();
  let voiceSettings: VoiceSettings = {
    provider: 'system',
    voice: DEFAULT_SYSTEM_VOICE,
    secretName: 'tts',
    updatedAt: SEEDED_AT,
  };
  const voiceAvailability = (): VoiceInfo => {
    const settings = structuredClone(voiceSettings);
    if (settings.provider === 'system') return { settings, available: true };
    const baseUrl = settings.baseUrl?.trim() ?? '';
    const model = settings.model?.trim() ?? '';
    const secretName = settings.secretName.trim();
    if (baseUrl !== '' && model !== '' && secretName !== '' && secretNames.has(secretName)) return { settings, available: true };
    return {
      settings,
      available: false,
      reason: 'The OpenAI-compatible provider needs a base URL, a model and a saved key.',
    };
  };
  const savedLoginSecrets = new Map<string, { username: string; password: string; totp?: string }>([
    ['login_github', { username: 'capivara', password: 'fake-password', totp: 'JBSWY3DPEHPK3PXP' }],
    ['login_x', { username: 'capivara', password: 'fake-password' }],
  ]);
  /** Browser session state keyed by effective profile: `own:<botId>` or `profile:<id>`. */
  const browserStates = new Map<string, BrowserStatus['state']>();
  /** Browser takeover per effective profile key, like the server's per-profile state. */
  const browserTakeovers = new Map<string, BrowserTakeover>();
  const takeoverWaiters = new Map<string, () => void>();
  const listeners = new Set<(event: BotEvent) => void>();
  /** Every event a thread has produced, keyed by thread id. */
  const histories = new Map<string, CanonicalEvent[]>();
  /** Every thread, DM or room, keyed by thread id. */
  const threads = new Map<string, Thread>();
  /** Each bot's DM threads, most recently active first. */
  const threadsOfBot = new Map<string, Thread[]>();
  const approvals = new Map<string, { threadId: string; approval: Approval }>();
  const waiting = new Map<string, (decision: ApprovalDecision, reply?: string) => void>();
  const rooms = new Map<string, Room>();
  const tasks = new Map<string, Task>(DEMO_TASKS.map((task) => [task.id, { ...task }]));
  const taskTimers = new Map<string, Array<ReturnType<typeof setTimeout>>>();
  const batons = new Map<string, string>();
  /** Uploaded attachment metadata and the conversation it was uploaded to, keyed by attachment id. */
  const attachments = new Map<string, { attachment: Attachment; threadId: string }>();
  /** Workspace facts (About me): no botId, scope 'workspace'. */
  const workspaceMemories = new Map<string, Memory>(
    DEMO_WORKSPACE_MEMORIES.map((memory) => [memory.id, structuredClone(memory)]),
  );
  const memories = new Map<string, Memory>(DEMO_MEMORIES.map((memory) => [memory.id, structuredClone(memory)]));
  /** Memory changes, newest first; seeded memories predate the journal. */
  const memoryJournal: MemoryJournalEntry[] = [];
  const journalMemory = (entry: Omit<MemoryJournalEntry, 'id' | 'at'>, at = now()): void => {
    memoryJournal.unshift({ id: nextId('memjournal'), at, ...entry });
  };
  const conflictError = () => new Error('This memory changed since that entry; refresh and try again.');
  const notifications = new Map<string, Notification>(
    DEMO_NOTIFICATIONS.map((notification) => [notification.id, structuredClone(notification)]),
  );
  const skills = new Map<string, Skill>(DEMO_SKILLS.map((skill) => [skill.id, structuredClone(skill)]));
  const routines = new Map<string, Routine>(DEMO_ROUTINES.map((routine) => [routine.id, structuredClone(routine)]));
  /** Runs per routine, newest first. */
  const routineRuns = new Map<string, RoutineRun[]>();
  /** Routines with a run still in flight, for the 409 the server answers with. */
  const runningRoutines = new Set<string>();

  for (const run of DEMO_ROUTINE_RUNS) {
    const list = routineRuns.get(run.routineId) ?? [];
    list.push(structuredClone(run));
    routineRuns.set(run.routineId, list);
  }

  const browserProfileRefOf = (bot: Bot): BrowserProfileRef => {
    const profile = browserProfiles.get(bot.browserProfileId ?? '');
    return profile === undefined ? { kind: 'own' } : { kind: 'shared', id: profile.id, name: profile.name };
  };

  const browserStateKeyOf = (bot: Bot): string => {
    const ref = browserProfileRefOf(bot);
    return ref.kind === 'shared' ? `profile:${ref.id}` : `own:${bot.id}`;
  };

  const browserStateOf = (bot: Bot): BrowserStatus['state'] => browserStates.get(browserStateKeyOf(bot)) ?? 'stopped';

  const setBrowserStateOf = (bot: Bot, state: BrowserStatus['state']): void => {
    browserStates.set(browserStateKeyOf(bot), state);
  };

  /** Drops the shared profile binding, sending the bot back to its own profile. */
  const clearBrowserProfile = (bot: Bot): Bot => {
    const next = { ...bot };
    delete next.browserProfileId;
    return next;
  };

  const dmThreadsOf = (botId: string): Thread[] => threadsOfBot.get(botId) ?? [];
  const defaultThreadOf = (botId: string): Thread | undefined => dmThreadsOf(botId)[0];

  const targetOf = (threadId: string): { botId: string } | { roomId: string } | undefined => {
    const thread = threads.get(threadId);
    if (!thread) return undefined;
    return thread.kind === 'room' ? { roomId: threadId } : { botId: thread.botId };
  };

  const record = (threadId: string, event: CanonicalEvent) => {
    const list = histories.get(threadId) ?? [];
    list.push(event);
    histories.set(threadId, list);
    const target = targetOf(threadId);
    for (const listener of listeners) listener({ threadId, ...target, event });
  };

  const base = (threadId: string, runId?: string) => ({ id: nextId('evt'), at: now(), threadId, runId });

  function remember(thread: Thread): Thread {
    threads.set(thread.id, thread);
    return thread;
  }

  function rememberDm(thread: Thread): Thread {
    remember(thread);
    threadsOfBot.set(thread.botId, byRecent([thread, ...dmThreadsOf(thread.botId).filter((entry) => entry.id !== thread.id)]));
    return thread;
  }

  function touch(threadId: string): void {
    const thread = threads.get(threadId);
    if (!thread || thread.kind === 'room') return;
    const next = { ...thread, updatedAt: now() };
    rememberDm(next);
  }

  function createThreadFor(botId: string, title?: string): Thread {
    const at = now();
    const thread: Thread = {
      id: nextId('thread'),
      botId,
      title: title ?? DEFAULT_THREAD_TITLE,
      kind: 'dm',
      createdAt: at,
      updatedAt: at,
    };
    histories.set(thread.id, []);
    return rememberDm(thread);
  }

  function ensureDefaultThread(botId: string): Thread {
    const thread = defaultThreadOf(botId);
    if (thread) return thread;
    if (!bots.has(botId)) throw new Error(`Unknown bot: ${botId}`);
    return createThreadFor(botId);
  }

  const routineThreadOf = (botId: string) => defaultThreadOf(botId)?.id ?? createThreadFor(botId).id;

  const scheduledRuns = (): RoutineRun[] =>
    [...routineRuns.values()].flat().sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || b.id.localeCompare(a.id));

  /** Links uploaded attachment ids to a message the way the server does, or throws like its 400. */
  function linkAttachments(threadId: string, ids: readonly string[] | undefined, messageId: string): Attachment[] {
    const linked: Attachment[] = [];
    for (const id of ids ?? []) {
      const entry = attachments.get(id);
      if (!entry) throw new Error(`Unknown attachment: ${id}`);
      if (entry.threadId !== threadId) throw new Error('This attachment belongs to another thread');
      if (entry.attachment.messageId !== undefined) throw new Error('This attachment is already linked to a message');
      linked.push({ ...entry.attachment, messageId });
    }
    for (const attachment of linked) {
      const entry = attachments.get(attachment.id);
      if (entry) attachments.set(attachment.id, { ...entry, attachment });
    }
    return linked;
  }

  function seededThread(botId: string): Thread {
    const at = SEEDED_AT;
    const thread: Thread = {
      id: dmThreadOf(botId),
      botId,
      title: DEMO_THREAD_TITLES[botId] ?? DEFAULT_THREAD_TITLE,
      kind: 'dm',
      createdAt: at,
      updatedAt: at,
    };
    threads.set(thread.id, thread);
    threadsOfBot.set(botId, [thread]);
    histories.set(thread.id, [...(DEMO_HISTORY[botId] ?? [])]);
    return thread;
  }

  for (const bot of DEMO_BOTS) {
    seededThread(bot.id);
    const profileId = DEMO_BOT_BROWSER_PROFILES[bot.id];
    if (profileId !== undefined) {
      const seeded = bots.get(bot.id);
      if (seeded) bots.set(bot.id, { ...seeded, browserProfileId: profileId });
    }
  }
  for (const room of DEMO_ROOMS) {
    const created = structuredClone(room);
    rooms.set(created.thread.id, created);
    remember(created.thread);
    const seed = [...(DEMO_ROOM_HISTORY[created.thread.id] ?? [])];
    histories.set(created.thread.id, seed);
    for (const event of seed) if (event.type === 'handoff') batons.set(created.thread.id, event.toBotId);
  }
  approvals.set(PENDING_SEND.id, { threadId: PENDING_SEND.threadId, approval: PENDING_SEND });

  const screenOf = (bot: Bot): FakeScreen | undefined => {
    if (bot.computer === 'none') return undefined;
    let screen = screens.get(bot.id);
    if (!screen) {
      screen = newScreen(bot.id === 'bot_boto' ? 'ready' : 'stopped', bot.desktop === true);
      if (bot.id === 'bot_boto') navigate(screen, 'https://news.ycombinator.com/item?id=4242');
      screens.set(bot.id, screen);
    }
    screen.desktop = bot.desktop === true;
    return screen;
  };

  const infoOf = (botId: string): ComputerInfo => {
    const bot = bots.get(botId);
    if (!bot) throw new Error(`Unknown bot: ${botId}`);
    const screen = screenOf(bot);
    return {
      state: screen ? screen.state : 'none',
      desktop: screen?.desktop ?? false,
      width: DESKTOP_WIDTH,
      height: DESKTOP_HEIGHT,
      takeover: screen?.takeover ?? null,
    };
  };

  /** Mirrors the server: only a bot with `browser: true` has a host browser. */
  const hostBrowserOf = (botId: string): Bot => {
    const bot = bots.get(botId);
    if (!bot) throw new Error(`Unknown bot: ${botId}`);
    if (bot.browser !== true) throw new Error('409 This bot has no browser.');
    return bot;
  };

  /** A sandbox with a desktop already has a browser, so the server refuses a sign-in window for it. */
  const loginBotOf = (botId: string): Bot => {
    const bot = hostBrowserOf(botId);
    if (bot.computer === 'sandbox' && bot.desktop === true) {
      throw new Error('409 This bot already has a browser in its desktop.');
    }
    return bot;
  };

  const saveTask = (next: Task) => {
    tasks.set(next.id, next);
    record(next.threadId, { ...base(next.threadId), type: 'task.updated', task: next });
  };

  const updateTask = (taskId: string, patch: Partial<Task>) => {
    const current = tasks.get(taskId);
    if (!current) return;
    saveTask({ ...current, ...patch, updatedAt: now() });
  };

  const setComputerState = (botId: string, threadId: string, state: ComputerState) => {
    const bot = bots.get(botId);
    const screen = bot ? screenOf(bot) : undefined;
    if (!screen) return;
    screen.state = state;
    record(threadId, { ...base(threadId), type: 'computer.status', computerId: `cmp_${botId}`, botId, state });
  };

  /** Boots a stopped computer the way the server does: starting, then ready a moment later. */
  async function boot(botId: string, threadId: string): Promise<void> {
    const screen = screens.get(botId);
    if (!screen || screen.state === 'ready') return;
    if (screen.state !== 'starting') setComputerState(botId, threadId, 'starting');
    await sleep(1400);
    if (screen.state === 'starting') {
      setComputerState(botId, threadId, 'ready');
      navigate(screen, 'about:blank');
    }
  }

  const setTakeoverState = (botId: string, threadId: string, next: Omit<Takeover, 'botId' | 'at'>): Takeover => {
    const bot = bots.get(botId);
    const screen = bot ? screenOf(bot) : undefined;
    if (!screen || !screen.desktop) throw new Error('404 This bot has no desktop.');
    const takeover: Takeover = { botId, at: now(), ...next };
    screen.takeover = takeover;
    record(threadId, { ...base(threadId), type: 'computer.takeover', takeover });
    if (!takeover.active) {
      const resume = takeoverWaiters.get(botId);
      takeoverWaiters.delete(botId);
      resume?.();
    }
    return takeover;
  };

  async function step(threadId: string, runId: string, tool: string, args: Record<string, unknown>, output: () => string, delayMs = 600, ok = true): Promise<void> {
    const callId = nextId('call');
    record(threadId, { ...base(threadId, runId), type: 'tool.call', callId, tool, args });
    await sleep(delayMs);
    record(threadId, { ...base(threadId, runId), type: 'tool.result', callId, ok, output: output() });
  }

  async function askApproval(threadId: string, runId: string, botId: string, kind: ApprovalKind, tool: string, summary: string, args: Record<string, unknown>): Promise<ApprovalDecision> {
    const approval: Approval = {
      id: nextId('appr'),
      runId,
      threadId,
      botId,
      kind,
      tool,
      summary,
      args,
      status: 'pending',
      createdAt: now(),
    };
    approvals.set(approval.id, { threadId, approval });
    record(threadId, { ...base(threadId, runId), type: 'approval.requested', approval });
    return new Promise<ApprovalDecision>((resolve) => {
      waiting.set(approval.id, (value) => resolve(value));
    });
  }

  /** A desktop bot drives its browser: open, read, and hand the screen to the person at a sign-in. */
  async function runDesktopAgent(botId: string, threadId: string, runId: string, content: string): Promise<void> {
    const bot = bots.get(botId);
    const screen = bot ? screenOf(bot) : undefined;
    if (!screen) return;
    if (screen.state !== 'ready') await boot(botId, threadId);
    const url = pickUrl(content, botId);
    const page = () => JSON.stringify({ url: screen.url, title: screen.title });
    await step(threadId, runId, 'browser_open', { url }, () => {
      navigate(screen, url);
      return page();
    }, 900);
    await step(threadId, runId, 'browser_snapshot', {}, () => `${screen.title}\n  textbox "Search" [ref=2]\n  link "Home" [ref=4]\n  button "Sign in" [ref=7]`, 700);

    if (screen.page === 'signin') {
      const reason = 'LinkedIn asks for a sign-in. Please sign in on my screen, then give control back.';
      const callId = nextId('call');
      record(threadId, { ...base(threadId, runId), type: 'tool.call', callId, tool: 'request_takeover', args: { reason } });
      setTakeoverState(botId, threadId, { active: true, requestedBy: 'bot', reason });
      await new Promise<void>((resolve) => takeoverWaiters.set(botId, resolve));
      record(threadId, { ...base(threadId, runId), type: 'tool.result', callId, ok: true, output: 'Control is back. Take a new snapshot.' });
      await step(threadId, runId, 'browser_snapshot', {}, () => `${screen.title}\n  button "Start a post" [ref=31]`, 700);
      if (screen.page === 'signin') {
        await stream(threadId, runId, botId, 'The page still asks for a sign-in, so I stopped here. Take control again whenever you are ready.');
        finish(threadId, runId);
        return;
      }
      const decision = await askApproval(threadId, runId, botId, 'publish', 'browser_click', 'Post the release note on LinkedIn', { ref: 31, text: 'We just shipped Brot 0.4. A team of bots in a chat app.' });
      if (decision === 'deny') {
        await stream(threadId, runId, botId, 'Understood. The post stays a draft.');
        finish(threadId, runId);
        return;
      }
      await step(threadId, runId, 'browser_click', { ref: 31 }, page, 800);
      await stream(threadId, runId, botId, 'Posted. I will keep an eye on the comments.');
      finish(threadId, runId);
      return;
    }

    await step(threadId, runId, 'browser_click', { ref: 12 }, () => {
      if (screen.page === 'search' || screen.page === 'feed') screen.scroll = 120;
      return page();
    }, 700);
    await stream(threadId, runId, botId, `I opened ${screen.title} and read the page. The first results look relevant; tell me which one to dig into.`);
    finish(threadId, runId);
  }

  async function stream(threadId: string, runId: string, botId: string, text: string): Promise<void> {
    const messageId = nextId('msg');
    for (const delta of text.split(/(?<=\s)/)) {
      record(threadId, { ...base(threadId, runId), type: 'message.delta', messageId, delta });
      await sleep(28);
    }
    const message: Message = {
      id: messageId,
      threadId,
      role: 'assistant',
      content: text,
      createdAt: now(),
      authorBotId: botId,
    };
    record(threadId, { ...base(threadId, runId), type: 'message.completed', message });
  }

  function finish(threadId: string, runId: string) {
    record(threadId, { ...base(threadId, runId), type: 'cost.updated', tokensIn: 120, tokensOut: 24, costUsd: 0.0004 });
    record(threadId, { ...base(threadId, runId), type: 'run.completed' });
  }

  async function runAgent(botId: string, threadId: string, content: string): Promise<void> {
    const runId = nextId('run');
    const bot = bots.get(botId);
    record(threadId, { ...base(threadId, runId), type: 'run.started', botId, engine: bot?.engine ?? 'mock', model: bot?.model ?? 'mock-1' });
    await sleep(250);

    if (bot?.desktop && bot.computer === 'sandbox') {
      await runDesktopAgent(botId, threadId, runId, content);
      return;
    }

    if (/\b(send|email|reply)\b/i.test(content)) {
      const args = { body: content };
      const decision = await askApproval(threadId, runId, botId, 'send', 'gmail.send', `Send the drafted follow-up for "${content.slice(0, 40)}"`, args);

      if (decision === 'deny') {
        await stream(threadId, runId, botId, 'Understood. I did not send it.');
        record(threadId, { ...base(threadId, runId), type: 'run.completed' });
        return;
      }

      await step(threadId, runId, 'gmail.send', args, () => 'Sent.', 400);
    }

    if (/\b(fail|break|crash)\b/i.test(content)) {
      await step(threadId, runId, 'shell', { command: 'npm test' }, () => '2 failing', 700, false);
      record(threadId, { ...base(threadId, runId), type: 'run.failed', error: 'Stopped. Two tests still fail, and I need your call on the fix.' });
      return;
    }

    await stream(threadId, runId, botId, 'On it. I will report back with the details shortly.');
    finish(threadId, runId);
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
    const threadId = room.thread.id;
    const runId = nextId('run');
    const other = room.memberIds.find((id) => id !== botId);
    record(threadId, { ...base(threadId, runId), type: 'run.started', botId, engine: 'mock', model: 'mock-1' });
    await sleep(500);

    if (other && /\b(ask|check)\b/i.test(content)) {
      const askId = nextId('ask');
      await stream(threadId, runId, botId, `Let me check with ${nameOf(other)}.`);
      record(threadId, {
        ...base(threadId, runId),
        type: 'bot.asked',
        askId,
        fromBotId: botId,
        toBotId: other,
        question: `Can you confirm this for me? "${content.slice(0, 80)}"`,
      });
      await sleep(2200);
      record(threadId, {
        ...base(threadId, runId),
        type: 'bot.answered',
        askId,
        fromBotId: botId,
        toBotId: other,
        answer: 'Confirmed. Nothing in my notes contradicts it.',
      });
      await stream(threadId, runId, botId, `${nameOf(other)} confirmed it. All set.`);
      finish(threadId, runId);
      return;
    }

    if (other && /\b(task|delegate|assign)\b/i.test(content)) {
      await stream(threadId, runId, botId, `I will hand this to ${nameOf(other)} and track it on the board.`);
      const created = makeTask({ title: content.replace(/@[\p{L}\p{N}_-]+\s*/gu, '').slice(0, 80) || 'Follow up', assigneeBotId: other, roomId: threadId }, botId);
      record(threadId, { ...base(threadId), type: 'task.created', task: created });
      startTask(created.id);
      finish(threadId, runId);
      return;
    }

    await stream(threadId, runId, botId, 'Got it. I will take this one and post an update here.');
    finish(threadId, runId);
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
      threadId: input.roomId ?? ensureDefaultThread(input.assigneeBotId).id,
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
      setTimeout(() => {
        const current = tasks.get(taskId);
        if (!current) return;
        const workThreadId = defaultThreadOf(current.assigneeBotId)?.id;
        updateTask(taskId, { status: 'in_progress', ...(workThreadId ? { workThreadId } : {}) });
      }, 900),
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
      record(LAUNCH_ROOM, {
        ...base(LAUNCH_ROOM, OPEN_ASK.runId),
        type: 'bot.answered',
        askId: OPEN_ASK.askId,
        fromBotId: OPEN_ASK.from,
        toBotId: OPEN_ASK.to,
        answer: 'Per request. Pages of 20k rows stay under it.',
      });
      void stream(LAUNCH_ROOM, OPEN_ASK.runId, OPEN_ASK.from, 'Per request, so pages of 20k rows keep us under the cap. The fix is in review.').then(() => {
        finish(LAUNCH_ROOM, OPEN_ASK.runId);
        updateTask(TASK_EXPORT, { status: 'done', result: 'Exports now stream in pages of 20k rows. Fix is in review.' });
      });
    }, OPEN_ASK_DELAY_MS);
  }

  return {
    async listBots(options = {}) {
      return [...bots.values()].filter((bot) => options.includeArchived || !bot.archived).map((bot) => structuredClone(bot));
    },

    async createBot(input) {
      const parsed = CreateBot.parse(input);
      if (parsed.browserProfileId !== undefined && !browserProfiles.has(parsed.browserProfileId)) {
        throw new Error(`Unknown browser profile: ${parsed.browserProfileId}`);
      }
      const at = now();
      const { hostAcknowledged: _ack, approvalMode, speakReplies, fallbackModels, runBudgetUsd, dailyBudgetUsd, ...fields } = parsed;
      const created: Bot = {
        ...fields,
        ...(approvalMode === 'edits' ? { approvalMode } : {}),
        ...(speakReplies ? { speakReplies: true } : {}),
        id: nextId('bot'),
        egress: parsed.egress ?? defaultEgressPolicy(),
        pinned: false,
        archived: false,
        createdAt: at,
        updatedAt: at,
      };
      if (created.mcpServerIds !== undefined && created.mcpServerIds !== null) {
        for (const serverId of created.mcpServerIds) if (!mcpServers.has(serverId)) throw new Error(`Unknown MCP server: ${serverId}`);
        if (created.mcpServerIds.length === 0) created.mcpServerIds = [];
      }
      if (fallbackModels !== undefined && fallbackModels.length > 0) {
        validateFallbackModels(fallbackModels);
        created.fallbackModels = [...fallbackModels];
      }
      if (typeof runBudgetUsd === 'number') created.runBudgetUsd = runBudgetUsd;
      if (typeof dailyBudgetUsd === 'number') created.dailyBudgetUsd = dailyBudgetUsd;
      bots.set(created.id, created);

      if (created.browser === true) setBrowserStateOf(created, 'stopped');
      recordAdminActivity({ action: 'created', targetType: 'bot', targetId: created.id, summary: `Created bot ${created.name}`, actor: 'local' });
      return structuredClone(created);
    },

    async updateBot(botId, patch) {
      const current = bots.get(botId);
      if (!current) throw new Error(`Unknown bot: ${botId}`);
      const { teamBudgetUsd, teamId, hostAcknowledged: _ack, browserProfileId, approvalMode, speakReplies, mcpServerIds, fallbackModels, runBudgetUsd, dailyBudgetUsd, ...rest } = UpdateBot.parse(patch);
      if (browserProfileId !== undefined && browserProfileId !== null && !browserProfiles.has(browserProfileId)) {
        throw new Error(`Unknown browser profile: ${browserProfileId}`);
      }
      let next: Bot = { ...current, ...rest, updatedAt: now() };
      if (approvalMode === 'edits') next.approvalMode = 'edits';
      else if (approvalMode === 'ask') delete next.approvalMode;
      if (speakReplies === true) next.speakReplies = true;
      else if (speakReplies === false) delete next.speakReplies;
      if (runBudgetUsd === null) delete next.runBudgetUsd;
      else if (runBudgetUsd !== undefined) next.runBudgetUsd = runBudgetUsd;
      if (dailyBudgetUsd === null) delete next.dailyBudgetUsd;
      else if (dailyBudgetUsd !== undefined) next.dailyBudgetUsd = dailyBudgetUsd;
      if (fallbackModels === null || (fallbackModels !== undefined && fallbackModels.length === 0)) delete next.fallbackModels;
      else if (fallbackModels !== undefined) {
        validateFallbackModels(fallbackModels);
        next.fallbackModels = [...fallbackModels];
      }
      if (mcpServerIds === null) delete next.mcpServerIds;
      else if (mcpServerIds !== undefined) {
        for (const serverId of mcpServerIds) if (!mcpServers.has(serverId)) throw new Error(`Unknown MCP server: ${serverId}`);
        next.mcpServerIds = [...mcpServerIds];
      }
      if (teamBudgetUsd === null) delete next.teamBudgetUsd;
      else if (teamBudgetUsd !== undefined) next.teamBudgetUsd = teamBudgetUsd;
      if (teamId === null) delete next.teamId;
      else if (teamId !== undefined) next.teamId = teamId;
      if (next.computer !== 'sandbox') delete next.desktop;
      if (browserProfileId === null) next = clearBrowserProfile(next);
      else if (browserProfileId !== undefined) next.browserProfileId = browserProfileId;
      bots.set(botId, next);
      const screen = screens.get(botId);
      if (screen && (current.desktop !== next.desktop || next.computer === 'none')) screens.delete(botId);
      const previousKey = browserStateKeyOf(current);
      if (next.browser !== true || (next.computer === 'sandbox' && next.desktop === true)) {
        browserStates.delete(previousKey);
      } else {
        const nextKey = browserStateKeyOf(next);
        if (nextKey !== previousKey) {
          browserStates.delete(previousKey);
          if (!browserStates.has(nextKey)) browserStates.set(nextKey, 'stopped');
        }
      }
      recordAdminActivity({ action: 'updated', targetType: 'bot', targetId: botId, summary: `Updated bot ${next.name}`, actor: 'local' });
      return structuredClone(next);
    },

    async deleteBot(botId) {
      const removed = bots.get(botId);
      if (!bots.delete(botId)) throw new Error(`Unknown bot: ${botId}`);
      if (removed !== undefined) recordAdminActivity({ action: 'deleted', targetType: 'bot', targetId: botId, summary: `Deleted bot ${removed.name}`, actor: 'local' });
      if (removed) {
        const key = browserStateKeyOf(removed);
        browserStates.delete(key);
        if (browserProfileRefOf(removed).kind === 'own') browserTakeovers.delete(key);
      }
      clearChiefOf(botId);
      for (const thread of dmThreadsOf(botId)) {
        threads.delete(thread.id);
        histories.delete(thread.id);
      }
      threadsOfBot.delete(botId);
      screens.delete(botId);
      for (const [attachmentId, entry] of attachments) {
        if (threads.has(entry.threadId)) continue;
        attachments.delete(attachmentId);
      }
      for (const [notificationId, notification] of notifications) if (notification.botId === botId) notifications.delete(notificationId);
      for (const [memoryId, memory] of memories) if (memory.botId === botId) memories.delete(memoryId);
      for (const [skillId, skill] of skills) if (skill.botId === botId) skills.delete(skillId);
      for (const room of rooms.values()) room.memberIds = room.memberIds.filter((id) => id !== botId);
    },

    async listTeams() {
      return [...teams.values()].map((team) => structuredClone(team)).sort(byTeamName);
    },

    async createTeam(input) {
      const data = CreateTeam.parse(input);
      requireChief(data.chiefBotId);
      const at = now();
      const created: Team = {
        id: nextId('team'),
        name: data.name,
        instructions: data.instructions,
        ...(data.chiefBotId === undefined ? {} : { chiefBotId: data.chiefBotId }),
        createdAt: at,
        updatedAt: at,
      };
      teams.set(created.id, created);
      return structuredClone(created);
    },

    async updateTeam(teamId, patch) {
      const current = teams.get(teamId);
      if (!current) throw new Error(`Unknown team: ${teamId}`);
      const data = UpdateTeam.parse(patch);
      requireChief(data.chiefBotId);
      const next: Team = {
        id: current.id,
        name: data.name ?? current.name,
        instructions: data.instructions ?? current.instructions,
        createdAt: current.createdAt,
        updatedAt: now(),
      };
      const chiefBotId = data.chiefBotId === undefined ? current.chiefBotId : (data.chiefBotId ?? undefined);
      if (chiefBotId !== undefined) next.chiefBotId = chiefBotId;
      teams.set(teamId, next);
      return structuredClone(next);
    },

    async deleteTeam(teamId) {
      if (!teams.delete(teamId)) throw new Error(`Unknown team: ${teamId}`);
      const at = now();
      for (const [botId, bot] of bots) {
        if (bot.teamId !== teamId) continue;
        const ungrouped = { ...bot, updatedAt: at };
        delete ungrouped.teamId;
        bots.set(botId, ungrouped);
      }
    },

    async listMemories(botId) {
      if (!bots.has(botId)) throw new Error(`Unknown bot: ${botId}`);
      return [...memories.values()]
        .filter((memory) => memory.botId === botId)
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))
        .map((memory) => structuredClone(memory));
    },

    async createMemory(botId, input) {
      if (!bots.has(botId)) throw new Error(`Unknown bot: ${botId}`);
      const data = CreateMemory.parse(input);
      const at = now();
      const created: Memory = { id: nextId('mem'), botId, scope: 'bot', kind: data.kind, content: data.content, createdAt: at, updatedAt: at };
      memories.set(created.id, created);
      journalMemory({ memoryId: created.id, botId, scope: 'bot', kind: created.kind, action: 'created', contentAfter: created.content });
      return structuredClone(created);
    },

    async updateMemory(memoryId, patch) {
      const data = UpdateMemory.parse(patch);
      const current = memories.get(memoryId);
      if (current) {
        const next: Memory = {
          ...current,
          ...(data.kind === undefined ? {} : { kind: data.kind }),
          ...(data.content === undefined ? {} : { content: data.content }),
          updatedAt: now(),
        };
        memories.set(memoryId, next);
        journalMemory({ memoryId, ...(current.botId === undefined ? {} : { botId: current.botId }), scope: 'bot', kind: next.kind, action: 'updated', contentBefore: current.content, contentAfter: next.content });
        return structuredClone(next);
      }
      const workspace = workspaceMemories.get(memoryId);
      if (!workspace) throw new Error(`Unknown memory: ${memoryId}`);
      const next: Memory = {
        ...workspace,
        ...(data.kind === undefined ? {} : { kind: data.kind }),
        ...(data.content === undefined ? {} : { content: data.content }),
        updatedAt: now(),
      };
      workspaceMemories.set(memoryId, next);
      journalMemory({ memoryId, scope: 'workspace', kind: next.kind, action: 'updated', contentBefore: workspace.content, contentAfter: next.content });
      return structuredClone(next);
    },

    async deleteMemory(memoryId) {
      const botMemory = memories.get(memoryId);
      if (botMemory !== undefined) {
        memories.delete(memoryId);
        journalMemory({ memoryId, ...(botMemory.botId === undefined ? {} : { botId: botMemory.botId }), scope: 'bot', kind: botMemory.kind, action: 'deleted', contentBefore: botMemory.content });
        return;
      }
      const workspaceMemory = workspaceMemories.get(memoryId);
      if (workspaceMemory !== undefined) {
        workspaceMemories.delete(memoryId);
        journalMemory({ memoryId, scope: 'workspace', kind: workspaceMemory.kind, action: 'deleted', contentBefore: workspaceMemory.content });
        return;
      }
      throw new Error(`Unknown memory: ${memoryId}`);
    },

    async getMemoryUpkeep(input) {
      const scope = MemoryUpkeepScope.parse(input);
      const all = [...memories.values(), ...workspaceMemories.values()];
      return structuredClone(buildMemoryUpkeepReport(scope.scope, scope.botId, all));
    },

    async applyMemoryUpkeep(input) {
      const parsed = ApplyMemoryUpkeep.parse(input);
      const all = [...memories.values(), ...workspaceMemories.values()];
      const report = buildMemoryUpkeepReport(parsed.scope, parsed.botId, all);
      const allowed = new Set(report.groups.flatMap((group) => group.remove.map((memory) => memory.id)));
      if (parsed.removeIds.some((id) => !allowed.has(id))) throw new Error('Only duplicates can be removed by upkeep');
      const removed: Memory[] = [];
      for (const id of parsed.removeIds) {
        const memory = memories.get(id) ?? workspaceMemories.get(id);
        if (memory === undefined) continue;
        if (memory.scope === 'workspace') workspaceMemories.delete(id);
        else memories.delete(id);
        removed.push(memory);
        journalMemory({ memoryId: id, ...(memory.botId === undefined ? {} : { botId: memory.botId }), scope: memory.scope, kind: memory.kind, action: 'deleted', contentBefore: memory.content });
      }
      const kept = [...memories.values(), ...workspaceMemories.values()]
        .filter((memory) => memory.scope === parsed.scope && (parsed.botId === undefined || memory.botId === parsed.botId))
        .map((memory) => structuredClone(memory));
      return { removed: removed.map((memory) => structuredClone(memory)), kept };
    },

    async listAdminActivity(filter = {}) {
      const query = AdminActivityQuery.parse(filter);
      return adminActivity
        .slice()
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
        .slice(0, query.limit)
        .map((entry) => structuredClone(entry));
    },

    async listStarterTeams() {
      return STARTER_TEAMS.map((starter) => structuredClone(starter.summary));
    },

    async installStarterTeam(starterId) {
      const starter = STARTER_TEAMS.find((candidate) => candidate.summary.id === starterId);
      if (starter === undefined) throw new Error(`404 Unknown starter team: ${starterId}`);
      const at = now();
      const createdBots: Bot[] = starter.bots.map(({ name, job }) => {
        const parsed = CreateBot.parse({ name, job });
        const bot: Bot = {
          ...parsed,
          id: nextId('bot'),
          egress: parsed.egress ?? defaultEgressPolicy(),
          pinned: false,
          archived: false,
          createdAt: at,
          updatedAt: at,
        };
        bots.set(bot.id, bot);
        return bot;
      });
      const teamId = nextId('team');
      const chief = createdBots[0];
      teams.set(teamId, {
        id: teamId,
        name: starter.team.name,
        instructions: starter.team.instructions,
        ...(chief === undefined ? {} : { chiefBotId: chief.id }),
        createdAt: at,
        updatedAt: at,
      });
      for (const bot of createdBots) bots.set(bot.id, { ...bot, teamId });
      if (starter.room !== undefined) {
        const lead = createdBots[starter.room.leadIndex] ?? chief;
        if (lead !== undefined) {
          const roomThread: Thread = {
            id: nextId('room'),
            botId: lead.id,
            title: starter.room.title,
            kind: 'room',
            leadBotId: lead.id,
            responder: starter.room.responder,
            createdAt: at,
            updatedAt: at,
          };
          rooms.set(roomThread.id, { thread: roomThread, memberIds: createdBots.map((bot) => bot.id) });
          histories.set(roomThread.id, []);
          remember(roomThread);
        }
      }
      const routineBot = createdBots[starter.routine.botIndex] ?? chief;
      const routineId = nextId('routine');
      routines.set(routineId, {
        id: routineId,
        botId: routineBot?.id ?? '',
        name: starter.routine.name,
        instruction: starter.routine.instruction,
        trigger: { type: 'cron', cron: starter.routine.cron },
        enabled: false,
        catchUp: true,
        rememberLastRun: false,
        createdAt: at,
        updatedAt: at,
      });
      for (const skill of starter.skills) {
        const skillId = nextId('skill');
        skills.set(skillId, {
          id: skillId,
          name: skill.name,
          description: skill.description,
          body: skill.body,
          version: 1,
          createdAt: at,
          updatedAt: at,
        });
      }
      recordAdminActivity({ action: 'created', targetType: 'team', targetId: teamId, summary: `Installed starter team ${starter.summary.name}`, actor: 'local' });
      return {
        teams: 1,
        bots: createdBots.length,
        rooms: starter.room === undefined ? 0 : 1,
        routines: 1,
        skills: starter.skills.length,
      } satisfies StarterTeamInstallCounts;
    },

    async getBackups() {
      return structuredClone(backupStatus());
    },

    async updateBackupSettings(patch) {
      const body = validateUpdateBackupSettings(patch);
      backupSettings = { ...backupSettings, ...body };
      return structuredClone(backupStatus().settings);
    },

    async runBackupNow() {
      const at = now();
      const stamp = at.replace(/[-:T]/g, '').slice(0, 14);
      const entry: BackupEntry = {
        name: `brot-backup-${stamp.slice(0, 8)}-${stamp.slice(8, 14)}`,
        createdAt: at,
        sizeBytes: 2_500_000 + backupEntries.length * 1_024,
        includesSecrets: true,
      };
      backupEntries.unshift(entry);
      const keep = backupStatus().settings.keep;
      if (backupEntries.length > keep) backupEntries.splice(keep);
      recordAdminActivity({ action: 'created', targetType: 'backup', targetId: entry.name, summary: `Created backup ${entry.name}`, actor: 'local' });
      return structuredClone(entry);
    },

    async listMemoryJournal(filter = {}) {
      const query = MemoryJournalQuery.parse(filter);
      return memoryJournal
        .filter((entry) => (query.botId === undefined || entry.botId === query.botId) && (query.scope === undefined || entry.scope === query.scope))
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id))
        .slice(0, query.limit)
        .map((entry) => structuredClone(entry));
    },

    async undoMemoryJournal(entryId) {
      const entry = memoryJournal.find((candidate) => candidate.id === entryId);
      if (entry === undefined) throw new Error(`Unknown journal entry: ${entryId}`);
      const current = entry.memoryId === undefined ? undefined : memories.get(entry.memoryId) ?? workspaceMemories.get(entry.memoryId);
      if (entry.action === 'created') {
        if (current === undefined || current.kind !== entry.kind || (entry.contentAfter !== undefined && current.content !== entry.contentAfter)) throw conflictError();
        if (current.scope === 'workspace') workspaceMemories.delete(current.id);
        else memories.delete(current.id);
        journalMemory({ memoryId: current.id, ...(current.botId === undefined ? {} : { botId: current.botId }), scope: current.scope, kind: current.kind, action: 'deleted', contentBefore: current.content });
        return { result: 'removed' as const };
      }
      if (entry.action === 'updated') {
        if (current === undefined || (entry.contentAfter !== undefined && current.content !== entry.contentAfter)) throw conflictError();
        const restored: Memory = { ...current, content: entry.contentBefore ?? current.content, updatedAt: now() };
        if (restored.scope === 'workspace') workspaceMemories.set(restored.id, restored);
        else memories.set(restored.id, restored);
        journalMemory({ memoryId: restored.id, ...(restored.botId === undefined ? {} : { botId: restored.botId }), scope: restored.scope, kind: restored.kind, action: 'updated', contentBefore: current.content, contentAfter: restored.content });
        return { result: 'restored' as const, memory: structuredClone(restored) };
      }
      if (current !== undefined) throw conflictError();
      const restored: Memory = {
        id: entry.memoryId ?? nextId('mem'),
        ...(entry.botId === undefined ? {} : { botId: entry.botId }),
        scope: entry.scope,
        kind: entry.kind,
        content: entry.contentBefore ?? '',
        createdAt: now(),
        updatedAt: now(),
      };
      if (restored.scope === 'workspace') workspaceMemories.set(restored.id, restored);
      else memories.set(restored.id, restored);
      journalMemory({ memoryId: restored.id, ...(restored.botId === undefined ? {} : { botId: restored.botId }), scope: restored.scope, kind: restored.kind, action: 'created', contentAfter: restored.content });
      return { result: 'restored' as const, memory: structuredClone(restored) };
    },

    async listDecisions(filter = {}) {
      const query = DecisionQuery.parse(filter);
      const from = query.from === undefined ? undefined : Date.parse(query.from);
      const to = query.to === undefined ? undefined : Date.parse(query.to);
      return decisions
        .filter((decision) => {
          if (query.decision !== undefined && decision.decision !== query.decision) return false;
          if (query.botId !== undefined && decision.botId !== query.botId) return false;
          const at = Date.parse(decision.decidedAt);
          if (from !== undefined && at < from) return false;
          if (to !== undefined && at >= to) return false;
          return true;
        })
        .sort((a, b) => Date.parse(b.decidedAt) - Date.parse(a.decidedAt) || b.id.localeCompare(a.id))
        .slice(0, query.limit)
        .map((decision) => structuredClone(decision));
    },

    decisionsExportUrl(filter = {}) {
      const query = new URLSearchParams();
      if (filter.from !== undefined) query.set('from', filter.from);
      if (filter.to !== undefined) query.set('to', filter.to);
      if (filter.botId !== undefined) query.set('botId', filter.botId);
      if (filter.decision !== undefined) query.set('decision', filter.decision);
      const suffix = query.size === 0 ? '' : `?${query.toString()}`;
      return `/api/decisions/export.csv${suffix}`;
    },

    async listBotPresets() {
      return [...botPresets.values()]
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
        .map((preset) => structuredClone(preset));
    },

    async createBotPreset(input) {
      const data = CreateBotPreset.parse(input);
      const at = now();
      const created: BotPreset = {
        id: nextId('preset'),
        name: data.name.trim(),
        job: data.job.trim(),
        instructions: data.instructions,
        ...(data.avatar === undefined ? {} : { avatar: data.avatar }),
        createdAt: at,
        updatedAt: at,
      };
      botPresets.set(created.id, created);
      return structuredClone(created);
    },

    async updateBotPreset(presetId, patch) {
      const current = botPresets.get(presetId);
      if (!current) throw new Error(`Unknown bot preset: ${presetId}`);
      const data = UpdateBotPreset.parse(patch);
      const next: BotPreset = {
        ...current,
        ...(data.name === undefined ? {} : { name: data.name.trim() }),
        ...(data.job === undefined ? {} : { job: data.job.trim() }),
        ...(data.instructions === undefined ? {} : { instructions: data.instructions }),
        ...(data.avatar === undefined ? {} : { avatar: data.avatar }),
        updatedAt: now(),
      };
      botPresets.set(presetId, next);
      return structuredClone(next);
    },

    async deleteBotPreset(presetId) {
      if (!botPresets.delete(presetId)) throw new Error(`Unknown bot preset: ${presetId}`);
    },

    async createPresetFromBot(botId, input = {}) {
      const bot = bots.get(botId);
      if (!bot) throw new Error(`Unknown bot: ${botId}`);
      const at = now();
      const data = CreatePresetFromBot.parse(input);
      const created: BotPreset = {
        id: nextId('preset'),
        name: data.name?.trim() || bot.name,
        job: bot.job,
        instructions: bot.instructions,
        ...(bot.avatar === undefined ? {} : { avatar: bot.avatar }),
        createdAt: at,
        updatedAt: at,
      };
      botPresets.set(created.id, created);
      return structuredClone(created);
    },

    async listWorkspaceMemories() {
      return [...workspaceMemories.values()]
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))
        .map((memory) => structuredClone(memory));
    },

    async createWorkspaceMemory(input) {
      const data = CreateWorkspaceMemory.parse(input);
      const at = now();
      const created: Memory = {
        id: nextId('wmem'),
        scope: 'workspace',
        kind: data.kind,
        content: data.content,
        createdAt: at,
        updatedAt: at,
      };
      workspaceMemories.set(created.id, created);
      journalMemory({ memoryId: created.id, scope: 'workspace', kind: created.kind, action: 'created', contentAfter: created.content });
      return structuredClone(created);
    },

    async listSkills(botId?: string) {
      if (botId !== undefined && !bots.has(botId)) throw new Error(`Unknown bot: ${botId}`);
      return [...skills.values()]
        .filter((skill) => botId === undefined || skill.botId === botId || skill.botId === undefined)
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
        .map((skill) => structuredClone(skill));
    },

    async createSkill(input) {
      const data = CreateSkill.parse(input);
      if (data.botId !== undefined && !bots.has(data.botId)) throw new Error(`Unknown bot: ${data.botId}`);
      const at = now();
      const created: Skill = {
        id: nextId('skill'),
        ...(data.botId === undefined ? {} : { botId: data.botId }),
        name: data.name,
        description: data.description,
        body: data.body,
        version: 1,
        createdAt: at,
        updatedAt: at,
      };
      skills.set(created.id, created);
      return structuredClone(created);
    },

    async exportSkill(skillId) {
      const skill = skills.get(skillId);
      if (!skill) throw new Error(`Unknown skill: ${skillId}`);
      return { content: formatSkillFile(skill), filename: skillFileFilename(skill.name) };
    },

    async importSkill(input) {
      if (input.content.trim() === '') throw new Error('A skill file is required');
      const body = ImportSkill.parse(input);
      const parsed = parseSkillFile(body.content, body.name === undefined ? {} : { name: body.name });
      if (!parsed.ok) throw new Error(`Invalid skill file: ${parsed.issues[0]?.message ?? 'invalid file'}`);
      if (body.botId !== undefined && !bots.has(body.botId)) throw new Error(`Unknown bot: ${body.botId}`);
      const at = now();
      const created: Skill = {
        id: nextId('skill'),
        ...(body.botId === undefined ? {} : { botId: body.botId }),
        name: parsed.skill.name,
        description: parsed.skill.description,
        body: parsed.skill.body,
        version: 1,
        createdAt: at,
        updatedAt: at,
      };
      skills.set(created.id, created);
      return structuredClone(created);
    },

    async updateSkill(skillId, patch) {
      const current = skills.get(skillId);
      if (!current) throw new Error(`Unknown skill: ${skillId}`);
      const data = UpdateSkill.parse(patch);
      const next: Skill = {
        ...current,
        ...(data.name === undefined ? {} : { name: data.name }),
        ...(data.description === undefined ? {} : { description: data.description }),
        ...(data.body === undefined ? {} : { body: data.body }),
        ...(data.botId === undefined ? {} : { botId: data.botId }),
        version: current.version + 1,
        updatedAt: now(),
      };
      skills.set(skillId, next);
      return structuredClone(next);
    },

    async deleteSkill(skillId) {
      if (!skills.delete(skillId)) throw new Error(`Unknown skill: ${skillId}`);
    },

    async uploadAttachment(threadId, file) {
      if (!threads.has(threadId)) throw new Error(`Unknown thread: ${threadId}`);
      const mimeType = file.type === '' ? 'application/octet-stream' : file.type;
      const attachment: Attachment = {
        id: nextId('att'),
        name: sanitizeAttachmentName(file.name),
        mimeType,
        size: Math.max(file.size, 1),
        kind: attachmentKindFor(mimeType),
        createdAt: now(),
      };
      attachments.set(attachment.id, { attachment, threadId });
      return structuredClone(attachment);
    },

    async deleteAttachment(attachmentId) {
      const entry = attachments.get(attachmentId);
      if (!entry) throw new Error(`Unknown attachment: ${attachmentId}`);
      if (entry.attachment.messageId !== undefined) throw new Error('409 This attachment belongs to a message and cannot be deleted');
      attachments.delete(attachmentId);
    },

    async listNotifications(filter = {}) {
      const list = [...notifications.values()]
        .filter((notification) => filter.unread !== true || notification.readAt === undefined)
        .filter((notification) => filter.botId === undefined || notification.botId === filter.botId)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
      const limit = Math.min(Math.max(1, filter.limit ?? 50), 200);
      return list.slice(0, limit).map((notification) => structuredClone(notification));
    },

    async unreadNotificationCount() {
      return [...notifications.values()].filter((notification) => notification.readAt === undefined).length;
    },

    async markNotificationsRead(ids?: readonly string[]) {
      if (ids !== undefined && ids.length === 0) return 0;
      const at = now();
      let updated = 0;
      for (const [id, notification] of notifications) {
        if (notification.readAt !== undefined) continue;
        if (ids !== undefined && !ids.includes(id)) continue;
        notifications.set(id, { ...notification, readAt: at });
        updated += 1;
      }
      return updated;
    },

    async deleteNotification(notificationId) {
      if (!notifications.delete(notificationId)) throw new Error(`Unknown notification: ${notificationId}`);
    },

    async listThreads(botId) {
      if (!bots.has(botId)) throw new Error(`Unknown bot: ${botId}`);
      return byRecent(dmThreadsOf(botId)).map((thread) => structuredClone(thread));
    },

    async createThread(botId, input) {
      if (!bots.has(botId)) throw new Error(`Unknown bot: ${botId}`);
      const data = CreateThread.parse(input ?? {});
      return structuredClone(createThreadFor(botId, data.title));
    },

    async updateThread(threadId, patch) {
      const data = UpdateThread.parse(patch);
      const thread = threads.get(threadId);
      if (!thread) throw new Error(`Unknown thread: ${threadId}`);
      if (thread.kind === 'room' && typeof data.model === 'string') {
        throw new Error('A room has no thread-wide model; each bot keeps its own.');
      }
      const next: Thread = { ...thread, updatedAt: now() };
      if (data.title !== undefined) next.title = data.title;
      if (data.model === null) delete next.model;
      else if (data.model !== undefined) next.model = data.model;
      remember(next);
      if (next.kind === 'room') {
        const room = rooms.get(threadId);
        if (room) rooms.set(threadId, { ...room, thread: next });
      } else {
        rememberDm(next);
      }
      return structuredClone(next);
    },

    async cancelRun(runId) {
      const known = [...histories.values()].some((events) => events.some((event) => event.runId === runId));
      if (!known) throw new Error(`Unknown run: ${runId}`);
    },

    async deleteRoom(roomId) {
      if (!rooms.delete(roomId)) throw new Error(`Unknown room: ${roomId}`);
      threads.delete(roomId);
      histories.delete(roomId);
    },

    async history(threadId) {
      return [...(histories.get(threadId) ?? [])];
    },

    onEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async postMessage(threadId, input: PostMessage) {
      const thread = threads.get(threadId);
      if (!thread || thread.kind === 'room') throw new Error(`Unknown thread: ${threadId}`);
      const messageId = nextId('msg');
      const linked = linkAttachments(threadId, input.attachmentIds, messageId);
      record(threadId, {
        ...base(threadId),
        type: 'message.completed',
        message: {
          id: messageId,
          threadId,
          role: 'user',
          content: input.content,
          createdAt: now(),
          ...(linked.length > 0 ? { attachments: linked } : {}),
        },
      });
      touch(threadId);
      void runAgent(thread.botId, threadId, input.content);
    },

    async resolveApproval(approvalId, input: ResolveApproval) {
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
      approvals.set(approvalId, { threadId: entry.threadId, approval: resolved });
      decisions.unshift({
        id: nextId('decision'),
        runId: resolved.runId,
        threadId: entry.threadId,
        botId: resolved.botId,
        kind: resolved.kind,
        tool: resolved.tool,
        summary: resolved.summary,
        decision: input.decision,
        ...(input.reply === undefined ? {} : { reply: input.reply }),
        decidedAt: now(),
      });
      record(entry.threadId, { ...base(entry.threadId, resolved.runId), type: 'approval.resolved', approval: resolved });

      const resume = waiting.get(approvalId);
      if (resume) {
        waiting.delete(approvalId);
        resume(input.decision);
        return;
      }

      // No live run is waiting on this approval (seeded history), so close it out here.
      const botId = entry.approval.botId;
      if (input.decision === 'deny') {
        await stream(entry.threadId, resolved.runId, botId, input.reply ? `Not sent. Noted: ${input.reply}` : 'Not sent.');
        if (approvalId === PENDING_SEND.id) updateTask(TASK_EMAIL, { status: 'cancelled', result: 'You declined the send.' });
      } else {
        const callId = nextId('call');
        record(entry.threadId, { ...base(entry.threadId, resolved.runId), type: 'tool.call', callId, tool: entry.approval.tool, args: entry.approval.args });
        await sleep(400);
        record(entry.threadId, { ...base(entry.threadId, resolved.runId), type: 'tool.result', callId, ok: true, output: 'Sent.' });
        await stream(entry.threadId, resolved.runId, botId, 'Sent. I will tell you when Ana replies.');
        if (approvalId === PENDING_SEND.id) updateTask(TASK_EMAIL, { status: 'done', result: 'Sent to ana@acme.com.' });
      }
      record(entry.threadId, { ...base(entry.threadId, resolved.runId), type: 'run.completed' });
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
      remember(thread);
      rooms.set(thread.id, created);
      histories.set(thread.id, []);
      record(thread.id, { ...base(thread.id), type: 'room.members', botIds: [...input.botIds] });
      return structuredClone(created);
    },

    getRoomDeciderSettings() {
      return Promise.resolve(structuredClone(roomDecider));
    },

    async updateRoomDeciderSettings(input) {
      const body = UpdateRoomDeciderSettings.parse(input);
      if (typeof body.model === 'string') {
        const ref = body.model;
        const provider = providers.find((candidate) => ref.startsWith(`${candidate.id}/`));
        if (provider === undefined || !provider.models.some((model) => model.id === ref)) {
          throw new Error(`Unknown decider model: ${ref}`);
        }
        if (!providerSupportsDecider(provider)) throw new Error(`Provider ${provider.id} cannot be the room decider`);
      }
      roomDecider = {
        ...(typeof body.model === 'string' ? { model: body.model } : {}),
        updatedAt: now(),
      };
      recordAdminActivity({ action: 'updated', targetType: 'settings', summary: 'Updated room routing settings', actor: 'local' });
      return structuredClone(roomDecider);
    },

    async roomHistory(roomId) {
      if (roomId === LAUNCH_ROOM) scheduleOpenAsk();
      return [...(histories.get(roomId) ?? [])];
    },

    async postRoomMessage(roomId: string, input: RoomMessage) {
      const room = rooms.get(roomId);
      if (!room) throw new Error(`Unknown room: ${roomId}`);
      const mentions = input.mentions ?? findMentions(
        input.content,
        [...bots.values()].filter((bot) => room.memberIds.includes(bot.id)),
      );
      const messageId = nextId('msg');
      const linked = linkAttachments(roomId, input.attachmentIds, messageId);
      record(roomId, {
        ...base(roomId),
        type: 'message.completed',
        message: {
          id: messageId,
          threadId: roomId,
          role: 'user',
          content: input.content,
          createdAt: now(),
          ...(mentions.length > 0 ? { mentions } : {}),
          ...(linked.length > 0 ? { attachments: linked } : {}),
        },
      });
      const responders = respondersFor(room, mentions);
      void (async () => {
        for (const botId of responders) await runRoomAgent(room, botId, input.content);
      })();
    },

    async updateRoomMembers(roomId, change) {
      const room = rooms.get(roomId);
      if (!room) throw new Error(`Unknown room: ${roomId}`);
      const { add = [], remove = [] } = UpdateRoomMembers.parse(change);
      const lead = room.thread.leadBotId ?? room.thread.botId;
      if (remove.includes(lead)) throw new Error('The lead bot cannot leave the room.');
      for (const botId of add) if (!bots.has(botId)) throw new Error(`Unknown bot: ${botId}`);
      const next = [...room.memberIds.filter((id) => !remove.includes(id)), ...add.filter((id) => !room.memberIds.includes(id))];
      if (next.length < MIN_ROOM_BOTS || next.length > MAX_ROOM_BOTS) {
        throw new Error(`A room needs ${MIN_ROOM_BOTS} to ${MAX_ROOM_BOTS} bots.`);
      }
      room.memberIds = next;
      record(roomId, { ...base(roomId), type: 'room.members', botIds: [...next] });
      return [...next];
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
      record(created.threadId, { ...base(created.threadId), type: 'task.created', task: created });
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

    async listRoutines(botId?: string) {
      return [...routines.values()]
        .filter((routine) => botId === undefined || routine.botId === botId)
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id))
        .map((routine) => structuredClone(routine));
    },

    async createRoutine(input) {
      const data = CreateRoutine.parse(input);
      if (!bots.has(data.botId)) throw new Error(`Unknown bot: ${data.botId}`);
      const at = now();
      const created: Routine = {
        id: nextId('routine'),
        botId: data.botId,
        name: data.name,
        instruction: data.instruction,
        trigger: data.trigger,
        enabled: data.enabled,
        catchUp: data.catchUp,
        rememberLastRun: data.rememberLastRun,
        createdAt: at,
        updatedAt: at,
      };
      const nextRunAt = data.enabled && data.trigger.type === 'cron' ? nextMockRunAt(data.trigger.cron) : undefined;
      if (nextRunAt !== undefined) created.nextRunAt = nextRunAt;
      routines.set(created.id, created);
      routineRuns.set(created.id, []);
      return structuredClone(created);
    },

    async updateRoutine(routineId, patch) {
      const current = routines.get(routineId);
      if (!current) throw new Error(`Unknown routine: ${routineId}`);
      const data = UpdateRoutine.parse(patch);
      const next: Routine = {
        ...current,
        ...(data.name === undefined ? {} : { name: data.name }),
        ...(data.instruction === undefined ? {} : { instruction: data.instruction }),
        ...(data.trigger === undefined ? {} : { trigger: data.trigger }),
        ...(data.enabled === undefined ? {} : { enabled: data.enabled }),
        ...(data.catchUp === undefined ? {} : { catchUp: data.catchUp }),
        ...(data.rememberLastRun === undefined ? {} : { rememberLastRun: data.rememberLastRun }),
        updatedAt: now(),
      };
      const nextRunAt = next.enabled && next.trigger.type === 'cron' ? nextMockRunAt(next.trigger.cron) : undefined;
      if (nextRunAt === undefined) delete next.nextRunAt;
      else next.nextRunAt = nextRunAt;
      routines.set(routineId, next);
      return structuredClone(next);
    },

    async deleteRoutine(routineId) {
      if (!routines.delete(routineId)) throw new Error(`Unknown routine: ${routineId}`);
      routineRuns.delete(routineId);
      runningRoutines.delete(routineId);
    },

    async runRoutineNow(routineId) {
      const routine = routines.get(routineId);
      if (!routine) throw new Error('404 Routine not found');
      recordAdminActivity({ action: 'ran', targetType: 'routine', targetId: routineId, summary: `Ran routine ${routine.name}`, actor: 'local' });
      if (runningRoutines.has(routineId)) throw new Error('409 Routine is already running');
      runningRoutines.add(routineId);
      const startedAt = now();
      const runId = nextId('run');
      const started: RoutineRun = {
        id: nextId('rr'),
        routineId,
        botId: routine.botId,
        threadId: routineThreadOf(routine.botId),
        runId,
        trigger: 'manual',
        status: 'running',
        startedAt,
        createdAt: startedAt,
      };
      routineRuns.set(routineId, [started, ...(routineRuns.get(routineId) ?? [])]);
      // Finish on the next tick: a second request in the same moment still hits the overlap guard.
      setTimeout(() => {
        const endedAt = now();
        const completed: RoutineRun = {
          ...started,
          status: 'completed',
          result: `Ran ${routine.name} on demand. The routine finished its instruction and reported back in its thread.`,
          endedAt,
        };
        routineRuns.set(routineId, (routineRuns.get(routineId) ?? []).map((run) => (run.id === started.id ? completed : run)));
        const current = routines.get(routineId);
        if (current) {
          const next: Routine = { ...current, lastRunAt: endedAt, updatedAt: endedAt };
          const nextRunAt = current.enabled && current.trigger.type === 'cron' ? nextMockRunAt(current.trigger.cron, Date.parse(endedAt)) : undefined;
          if (nextRunAt === undefined) delete next.nextRunAt;
          else next.nextRunAt = nextRunAt;
          routines.set(routineId, next);
        }
        runningRoutines.delete(routineId);
      }, 0);
      return { runId };
    },

    async listRoutineRuns(filter: { routineId?: string; botId?: string; status?: RoutineRunStatus; limit?: number } = {}) {
      const matching = scheduledRuns().filter(
        (run) =>
          (filter.routineId === undefined || run.routineId === filter.routineId) &&
          (filter.botId === undefined || run.botId === filter.botId) &&
          (filter.status === undefined || run.status === filter.status),
      );
      return matching.slice(0, filter.limit ?? 50).map((run) => structuredClone(run));
    },

    async listProviders() {
      return providers.map((provider) => structuredClone(provider));
    },

    async setSecret(name, value) {
      if (!value) throw new Error('A secret needs a value.');
      secretNames.add(name);
      for (const provider of providers) if (provider.secretName === name) provider.configured = true;
    },

    async listSecretNames() {
      return [...secretNames].sort();
    },

    async getVoiceSettings() {
      return voiceAvailability();
    },

    async updateVoiceSettings(patch) {
      const previous = voiceSettings;
      const provider = patch.provider;
      if (provider !== 'system' && provider !== 'openai-compatible') throw new Error('Unknown voice provider');
      voiceSettings = {
        provider,
        voice: patch.voice ?? previous.voice ?? (provider === 'system' ? DEFAULT_SYSTEM_VOICE : ''),
        secretName: patch.secretName ?? previous.secretName,
        ...(patch.model ?? previous.model) === undefined ? {} : { model: patch.model ?? previous.model },
        ...(patch.baseUrl ?? previous.baseUrl) === undefined ? {} : { baseUrl: patch.baseUrl ?? previous.baseUrl },
        updatedAt: now(),
      };
      recordAdminActivity({ action: 'updated', targetType: 'settings', summary: 'Updated voice settings', actor: 'local' });
      return structuredClone(voiceSettings);
    },

    async speakText(text) {
      if (!voiceTextAllowed(text)) throw new Error('Voice text must be 1 to 2000 characters');
      const availability = voiceAvailability();
      if (!availability.available) throw new Error(`503 Voice is not available: ${availability.reason ?? 'unavailable'}`);
      return { blob: silentWavBlob(), contentType: 'audio/wav' };
    },

    async listDevices() {
      return devices.map((device) => ({ ...device }));
    },

    async removeDevice(deviceId) {
      const index = devices.findIndex((device) => device.id === deviceId);
      if (index < 0) throw new Error(`Unknown device: ${deviceId}`);
      const [removed] = devices.splice(index, 1);
      if (removed !== undefined) recordAdminActivity({ action: 'revoked', targetType: 'device', targetId: removed.id, summary: `Revoked phone ${removed.name}`, actor: removed.name });
    },

    async startPairing() {
      const code = String(100000 + Math.floor(Math.random() * 900000));
      const token = nextId('pair');
      return {
        token,
        code,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        qrPayload: `brot://pair?host=127.0.0.1&port=8799&token=${token}&code=${code}`,
      };
    },

    async getComputer(botId) {
      return infoOf(botId);
    },

    async startComputer(botId) {
      const info = infoOf(botId);
      if (info.state === 'none') throw new Error('This bot has no computer.');
      if (info.state === 'stopped' || info.state === 'error') void boot(botId, ensureDefaultThread(botId).id);
      return infoOf(botId);
    },

    async computerScreen(botId) {
      const bot = bots.get(botId);
      const screen = bot ? screenOf(bot) : undefined;
      if (!screen || !screen.desktop) throw new ScreenUnavailable(404);
      if (screen.state !== 'ready') throw new ScreenUnavailable(409);
      return new Blob([renderScreen(screen)], { type: 'image/svg+xml' });
    },

    async computerInput(botId, input) {
      const screen = screens.get(botId);
      if (!screen?.takeover?.active) throw new Error('409 Take control first.');
      applyInput(screen, input);
    },

    async setTakeover(botId, input) {
      const threadId = ensureDefaultThread(botId).id;
      const previous = screens.get(botId)?.takeover;
      return setTakeoverState(botId, threadId, {
        active: input.active,
        ...(input.reason ? { reason: input.reason } : previous?.reason && !input.active ? { reason: previous.reason } : {}),
        requestedBy: input.active ? 'user' : (previous?.requestedBy ?? 'user'),
      });
    },

    async browserStatus(botId) {
      const bot = hostBrowserOf(botId);
      return { state: browserStateOf(bot), profile: browserProfileRefOf(bot) };
    },

    getMyChrome() {
      return Promise.resolve(myChromeStatus(myChrome));
    },

    getTranscriptionStatus() {
      return Promise.resolve(transcriptionStatus());
    },

    async updateTranscriptionSettings(input) {
      const body = validateUpdateTranscriptionSettings(input);
      if (body.model !== null) {
        const provider = providers.find((candidate) => body.model !== null && body.model.startsWith(`${candidate.id}/`));
        const entry = provider?.models.find((model) => model.id === body.model);
        if (provider === undefined || entry === undefined) throw new Error(`Unknown transcription model: ${body.model}`);
        if (!modelSupportsTranscription(entry)) throw new Error(`Model ${body.model} cannot transcribe audio`);
      }
      transcription = {
        ...(body.model === null ? {} : { model: body.model }),
        updatedAt: now(),
      };
      recordAdminActivity({ action: 'updated', targetType: 'settings', summary: 'Updated transcription settings', actor: 'local' });
      return transcriptionStatus();
    },

    async updateMyChrome(input) {
      const body = UpdateMyChromeSettings.parse(input);
      const issue = myChromeEndpointIssue(body.endpoint);
      if (issue !== undefined) throw new Error(issue);
      myChrome = { endpoint: body.endpoint, updatedAt: now() };
      recordAdminActivity({ action: 'updated', targetType: 'settings', summary: 'Updated My Chrome settings', actor: 'local' });
      return myChromeStatus(myChrome);
    },

    async startBrowserLogin(botId) {
      const bot = loginBotOf(botId);
      setBrowserStateOf(bot, 'login');
      return { state: 'login', profile: browserProfileRefOf(bot) };
    },

    async closeBrowser(botId) {
      const bot = hostBrowserOf(botId);
      setBrowserStateOf(bot, 'stopped');
    },

    async browserScreen(botId) {
      const bot = bots.get(botId);
      if (!bot || bot.browser !== true) throw new ScreenUnavailable(409);
      const state = browserStateOf(bot);
      // The real route refuses the sign-in window; a stopped browser starts lazily.
      if (state === 'login') throw new ScreenUnavailable(409);
      if (state !== 'running') setBrowserStateOf(bot, 'running');
      return new Blob(['jpeg'], { type: 'image/jpeg' });
    },

    async getBrowserTakeover(botId) {
      const bot = hostBrowserOf(botId);
      return structuredClone(browserTakeovers.get(browserStateKeyOf(bot)) ?? { active: false });
    },

    async setBrowserTakeover(botId, input) {
      const bot = hostBrowserOf(botId);
      const takeover: BrowserTakeover = {
        active: input.active,
        ...(input.active ? { since: now() } : {}),
        ...(input.reason === undefined ? {} : { reason: input.reason }),
      };
      browserTakeovers.set(browserStateKeyOf(bot), takeover);
      return structuredClone(takeover);
    },

    async browserInput(botId, input) {
      const bot = hostBrowserOf(botId);
      const parsed = ComputerInput.parse(input);
      if (browserTakeovers.get(browserStateKeyOf(bot))?.active !== true) throw new Error('409 No takeover is active.');
      if (browserStateOf(bot) !== 'running') throw new Error('409 The browser is not running.');
      if ((parsed.type === 'click' || parsed.type === 'move' || parsed.type === 'scroll') && (parsed.x >= 1280 || parsed.y >= 800)) {
        throw new Error('400 The point is outside the browser viewport');
      }
    },

    async listBrowserProfiles() {
      return [...browserProfiles.values()]
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
        .map((profile) => structuredClone(profile));
    },

    async createBrowserProfile(input) {
      const name = input.name.trim();
      if (name === '') throw new Error('A browser profile needs a name');
      const at = now();
      const created: BrowserProfile = { id: nextId('profile'), name, createdAt: at, updatedAt: at };
      browserProfiles.set(created.id, created);
      return structuredClone(created);
    },

    async updateBrowserProfile(profileId, input) {
      const current = browserProfiles.get(profileId);
      if (!current) throw new Error(`Unknown browser profile: ${profileId}`);
      const name = input.name.trim();
      if (name === '') throw new Error('A browser profile needs a name');
      const next: BrowserProfile = { ...current, name, updatedAt: now() };
      browserProfiles.set(profileId, next);
      return structuredClone(next);
    },

    async deleteBrowserProfile(profileId) {
      if (!browserProfiles.delete(profileId)) throw new Error(`Unknown browser profile: ${profileId}`);
      browserStates.delete(`profile:${profileId}`);
      browserTakeovers.delete(`profile:${profileId}`);
      for (const [botId, bot] of bots) {
        if (bot.browserProfileId !== profileId) continue;
        bots.set(botId, clearBrowserProfile(bot));
      }
    },

    async listMcpServers() {
      return [...mcpServers.values()]
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
        .map((server) => structuredClone(server));
    },

    async createMcpServer(input) {
      const data = CreateMcpServer.parse(input);
      if ([...mcpServers.values()].some((server) => server.name === data.name)) {
        throw new Error(`An MCP server named ${data.name} already exists`);
      }
      const at = now();
      const created: McpServer = McpServerSchema.parse({
        id: nextId('mcp'),
        name: data.name,
        transport: data.transport,
        args: data.args,
        env: data.env,
        enabled: data.enabled,
        ...(data.command === undefined ? {} : { command: data.command }),
        ...(data.url === undefined ? {} : { url: data.url }),
        createdAt: at,
        updatedAt: at,
      });
      mcpServers.set(created.id, created);
      return structuredClone(created);
    },

    async updateMcpServer(serverId, patch) {
      const current = mcpServers.get(serverId);
      if (!current) throw new Error(`Unknown MCP server: ${serverId}`);
      const data = UpdateMcpServer.parse(patch);
      const next = McpServerSchema.parse({ ...current, ...data, updatedAt: now() });
      if ([...mcpServers.values()].some((server) => server.id !== serverId && server.name === next.name)) {
        throw new Error(`An MCP server named ${next.name} already exists`);
      }
      mcpServers.set(serverId, next);
      return structuredClone(next);
    },

    async deleteMcpServer(serverId) {
      if (!mcpServers.delete(serverId)) throw new Error(`Unknown MCP server: ${serverId}`);
    },

    async testMcpServer(serverId) {
      const server = mcpServers.get(serverId);
      if (!server) throw new Error(`Unknown MCP server: ${serverId}`);
      const configured = server.transport === 'stdio' ? server.command !== undefined && server.command !== '' : server.url !== undefined && server.url !== '';
      if (!configured) return { ok: false, error: `The ${server.transport} server has no ${server.transport === 'stdio' ? 'command' : 'URL'}` };
      const tools = server.transport === 'stdio' ? ['read_file', 'list_directory'] : ['search'];
      return { ok: true, tools, latencyMs: server.transport === 'stdio' ? 18 : 42 };
    },

    async exportTeamPackage(teamId?: string) {
      const scopeTeams = teamId === undefined ? [...teams.values()] : (() => {
        const team = teams.get(teamId);
        if (!team) throw new Error('404 Team not found');
        return [team];
      })();
      const scopeBots = [...bots.values()].filter((bot) => !bot.archived && (teamId === undefined || bot.teamId === teamId));
      if (scopeBots.length === 0) {
        throw new Error(teamId === undefined ? 'There are no bots to export.' : 'This team has no bots to export.');
      }
      const teamKeys = new Map(scopeTeams.map((team, index) => [team.id, `t${index + 1}`]));
      const botKeys = new Map(scopeBots.map((bot, index) => [bot.id, `b${index + 1}`]));
      const teamKeyOf = (id: string): string => {
        const key = teamKeys.get(id);
        if (key === undefined) throw new Error(`No key for team ${id}`);
        return key;
      };
      const botKeyOf = (id: string): string => {
        const key = botKeys.get(id);
        if (key === undefined) throw new Error(`No key for bot ${id}`);
        return key;
      };
      const roomEntries = [...rooms.values()].flatMap((room) => {
        const lead = room.thread.leadBotId ?? room.thread.botId;
        const members = room.memberIds.filter((botId) => botKeys.has(botId)).map(botKeyOf);
        if (!botKeys.has(lead) || members.length < MIN_ROOM_BOTS) return [];
        return [{
          title: room.thread.title,
          lead: botKeyOf(lead),
          members,
          responder: room.thread.responder ?? 'lead',
        }];
      });
      const routineEntries = [...routines.values()].flatMap((routine) => {
        if (!botKeys.has(routine.botId) || routine.trigger.type !== 'cron') return [];
        return [{
          bot: botKeyOf(routine.botId),
          name: routine.name,
          instruction: routine.instruction,
          cron: routine.trigger.cron,
          ...(routine.trigger.timezone === undefined ? {} : { timezone: routine.trigger.timezone }),
          ...(routine.catchUp === undefined ? {} : { catchUp: routine.catchUp }),
          ...(routine.rememberLastRun === undefined ? {} : { rememberLastRun: routine.rememberLastRun }),
          enabled: false,
        }];
      });
      const skillEntries = [...skills.values()].flatMap((skill) =>
        skill.botId === undefined || !botKeys.has(skill.botId)
          ? []
          : [{ name: skill.name, description: skill.description, body: skill.body, bot: botKeyOf(skill.botId) }],
      );
      const pkg: TeamPackage = {
        format: TEAM_PACKAGE_FORMAT,
        version: TEAM_PACKAGE_VERSION,
        exportedAt: now(),
        teams: scopeTeams.map((team) => ({
          key: teamKeyOf(team.id),
          name: team.name,
          instructions: team.instructions,
          ...(team.chiefBotId !== undefined && botKeys.has(team.chiefBotId) ? { chief: botKeyOf(team.chiefBotId) } : {}),
        })),
        bots: scopeBots.map((bot) => ({
          key: botKeyOf(bot.id),
          name: bot.name,
          job: bot.job,
          instructions: bot.instructions,
          ...(bot.avatar === undefined ? {} : { avatar: bot.avatar }),
          ...(bot.teamId !== undefined && teamKeys.has(bot.teamId) ? { team: teamKeyOf(bot.teamId) } : {}),
        })),
        rooms: roomEntries,
        routines: routineEntries,
        skills: skillEntries,
      };
      const content = formatTeamPackage(pkg);
      const filename = teamId === undefined ? 'brot-workspace.md' : `brot-team-${teamSlug(teams.get(teamId)?.name ?? 'team')}.md`;
      return { content, filename };
    },

    async importTeamPackage(content: string) {
      const parsed = parseTeamPackage(content);
      if (!parsed.ok) throw new Error(`Invalid team package: ${parsed.issues[0]?.message ?? 'invalid package'}`);
      const pkg = parsed.package;
      const at = now();
      const botIds = new Map<string, string>();
      const teamIds = new Map<string, string>();
      for (const entry of pkg.teams) {
        const id = nextId('team');
        teams.set(id, { id, name: entry.name, instructions: entry.instructions, createdAt: at, updatedAt: at });
        teamIds.set(entry.key, id);
      }
      for (const entry of pkg.bots) {
        const id = nextId('bot');
        const teamId = entry.team === undefined ? undefined : teamIds.get(entry.team);
        const bot: Bot = {
          id,
          name: entry.name,
          job: entry.job,
          instructions: entry.instructions,
          ...(entry.avatar !== undefined && IMPORTABLE_AVATAR.test(entry.avatar) ? { avatar: entry.avatar } : {}),
          engine: 'mock',
          computer: 'sandbox',
          egress: defaultEgressPolicy(),
          pinned: false,
          archived: false,
          ...(teamId === undefined ? {} : { teamId }),
          createdAt: at,
          updatedAt: at,
        };
        bots.set(id, bot);
        threadsOfBot.set(id, []);
        botIds.set(entry.key, id);
      }
      for (const entry of pkg.teams) {
        const teamId = teamIds.get(entry.key);
        const chiefId = entry.chief === undefined ? undefined : botIds.get(entry.chief);
        const team = teamId === undefined ? undefined : teams.get(teamId);
        if (teamId !== undefined && team !== undefined && chiefId !== undefined) teams.set(teamId, { ...team, chiefBotId: chiefId });
      }
      for (const entry of pkg.rooms) {
        const leadId = botIds.get(entry.lead);
        if (leadId === undefined) continue;
        const memberIds = entry.members.flatMap((key) => {
          const id = botIds.get(key);
          return id === undefined ? [] : [id];
        });
        const id = nextId('room');
        const thread: Thread = {
          id,
          botId: leadId,
          title: entry.title,
          kind: 'room',
          leadBotId: leadId,
          responder: entry.responder === 'mention' ? 'mention' : 'lead',
          createdAt: at,
          updatedAt: at,
        };
        rooms.set(id, { thread, memberIds });
        remember(thread);
        histories.set(id, []);
        record(id, { ...base(id), type: 'room.members', botIds: [...memberIds] });
      }
      for (const entry of pkg.routines) {
        const botId = botIds.get(entry.bot);
        if (botId === undefined) continue;
        const id = nextId('routine');
        routines.set(id, {
          id,
          botId,
          name: entry.name,
          instruction: entry.instruction,
          trigger: { type: 'cron', cron: entry.cron, ...(entry.timezone === undefined ? {} : { timezone: entry.timezone }) },
          enabled: false,
          catchUp: entry.catchUp ?? true,
          rememberLastRun: entry.rememberLastRun ?? false,
          createdAt: at,
          updatedAt: at,
        });
        routineRuns.set(id, []);
      }
      for (const entry of pkg.skills) {
        const id = nextId('skill');
        const botId = entry.bot === undefined ? undefined : botIds.get(entry.bot);
        skills.set(id, {
          id,
          ...(botId === undefined ? {} : { botId }),
          name: entry.name,
          description: entry.description,
          body: entry.body,
          version: 1,
          createdAt: at,
          updatedAt: at,
        });
      }
      return {
        teams: pkg.teams.length,
        bots: pkg.bots.length,
        rooms: pkg.rooms.length,
        routines: pkg.routines.length,
        skills: pkg.skills.length,
      };
    },
    async searchMessages(filter) {
      const query = SearchQuery.parse(filter);
      const needle = query.q.trim().toLowerCase();
      const hits: SearchHit[] = [];
      for (const [threadId, events] of histories) {
        if (query.threadId !== undefined && query.threadId !== threadId) continue;
        const thread = threads.get(threadId);
        if (!thread) continue;
        const botId = thread.kind === 'room' ? thread.leadBotId : thread.botId;
        const bot = botId === undefined ? undefined : bots.get(botId);
        if (query.botId !== undefined && query.botId !== botId) continue;
        for (const event of events) {
          if (event.type !== 'message.completed') continue;
          const { message } = event;
          if (query.before !== undefined && message.createdAt >= query.before) continue;
          if (!message.content.toLowerCase().includes(needle)) continue;
          hits.push({
            messageId: message.id,
            threadId,
            threadTitle: thread.title,
            ...(botId === undefined ? {} : { botId }),
            ...(bot === undefined ? {} : { botName: bot.name }),
            role: message.role,
            snippet: buildSearchSnippet(message.content, query.q),
            createdAt: message.createdAt,
          });
        }
      }
      hits.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.messageId.localeCompare(a.messageId)));
      return hits.slice(0, query.limit);
    },

    async listSavedLogins() {
      return [...savedLogins.values()]
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
        .map((login) => structuredClone(login));
    },

    async createSavedLogin(input) {
      const data = CreateSavedLogin.parse(input);
      if ([...savedLogins.values()].some((login) => login.name === data.name)) {
        throw new Error('A saved login with this name already exists');
      }
      const id = nextId('login');
      const at = now();
      const totp = data.totp === undefined ? undefined : normalizeTotp(data.totp);
      savedLoginSecrets.set(id, { username: data.username, password: data.password, ...(totp === undefined ? {} : { totp }) });
      const created: SavedLogin = {
        id,
        name: data.name,
        host: data.host,
        ...(data.label === undefined ? {} : { label: data.label }),
        hasTotp: totp !== undefined,
        createdAt: at,
        updatedAt: at,
      };
      savedLogins.set(id, created);
      recordAdminActivity({ action: 'created', targetType: 'saved-login', targetId: id, summary: `Added saved login for ${created.name}`, actor: 'local' });
      return structuredClone(created);
    },

    async updateSavedLogin(loginId, patch) {
      const current = savedLogins.get(loginId);
      if (!current) throw new Error(`Unknown saved login: ${loginId}`);
      const data = UpdateSavedLogin.parse(patch);
      if (data.name !== undefined && data.name !== current.name) {
        if ([...savedLogins.values()].some((login) => login.id !== loginId && login.name === data.name)) {
          throw new Error('A saved login with this name already exists');
        }
      }
      const secrets = savedLoginSecrets.get(loginId) ?? { username: '', password: '' };
      if (data.username !== undefined) secrets.username = data.username;
      if (data.password !== undefined) secrets.password = data.password;
      if (data.totp === null) delete secrets.totp;
      else if (data.totp !== undefined) secrets.totp = normalizeTotp(data.totp);
      savedLoginSecrets.set(loginId, secrets);
      const next: SavedLogin = {
        ...current,
        ...(data.name === undefined ? {} : { name: data.name }),
        ...(data.host === undefined ? {} : { host: data.host }),
        hasTotp: secrets.totp !== undefined,
        updatedAt: now(),
      };
      if (data.label === null) delete next.label;
      else if (data.label !== undefined) next.label = data.label;
      savedLogins.set(loginId, next);
      return structuredClone(next);
    },

    async deleteSavedLogin(loginId) {
      const removed = savedLogins.get(loginId);
      if (!savedLogins.delete(loginId)) throw new Error(`Unknown saved login: ${loginId}`);
      if (removed !== undefined) recordAdminActivity({ action: 'deleted', targetType: 'saved-login', targetId: loginId, summary: `Deleted saved login for ${removed.name}`, actor: 'local' });
      savedLoginSecrets.delete(loginId);
    },

    async getToday(filter = {}) {
      const to = filter.to ?? now();
      const from = filter.from ?? new Date(new Date(to).setHours(0, 0, 0, 0)).toISOString();
      const pendingApprovals = [...approvals.values()].filter((entry) => entry.approval.status === 'pending').length;
      const routineStatuses = [...routineRuns.values()].flat();
      const routineCounts = {
        completed: routineStatuses.filter((run) => run.status === 'completed').length,
        failed: routineStatuses.filter((run) => run.status === 'failed').length,
        skipped: routineStatuses.filter((run) => run.status === 'skipped').length,
        running: routineStatuses.filter((run) => run.status === 'running' || run.status === 'queued').length,
      };
      const byBot = [
        { botId: 'bot_capy', name: 'Capy', runs: 7, completed: 7, failed: 0, tokensIn: 74_000, tokensOut: 21_000, costUsd: 0.1932 },
        { botId: 'bot_onca', name: 'Onça', runs: 5, completed: 3, failed: 2, tokensIn: 48_000, tokensOut: 14_000, costUsd: 0.1284 },
        { botId: 'bot_tuca', name: 'Tuca', runs: 3, completed: 3, failed: 0, tokensIn: 32_000, tokensOut: 9_000, costUsd: 0.0912 },
        { botId: 'bot_tamu', name: 'Tamu', runs: 3, completed: 2, failed: 0, tokensIn: 30_320, tokensOut: 8_880, costUsd: 0.0693 },
      ];
      const totals = byBot.reduce(
        (sum, bot) => ({
          runs: sum.runs + bot.runs,
          completed: sum.completed + bot.completed,
          failed: sum.failed + bot.failed,
          cancelled: sum.cancelled,
          tokensIn: sum.tokensIn + bot.tokensIn,
          tokensOut: sum.tokensOut + bot.tokensOut,
          costUsd: Number((sum.costUsd + bot.costUsd).toFixed(4)),
        }),
        { runs: 0, completed: 0, failed: 0, cancelled: 1, tokensIn: 0, tokensOut: 0, costUsd: 0 },
      );
      const highlight = (botId: string, botName: string, text: string, agoMs: number) => ({
        botId,
        botName,
        threadId: dmThreadOf(botId),
        text,
        at: new Date(Date.now() - agoMs).toISOString(),
      });
      return {
        from,
        to,
        totals,
        byBot,
        routines: routineCounts,
        pendingApprovals,
        highlights: [
          highlight('bot_capy', 'Capy', 'Three things today: finish the renewal notes, review the export fix, and send Tuca the pricing update.', 20 * 60_000),
          highlight('bot_onca', 'Onça', 'The export fix is in review, and two tests still fail on the row limit. Want me to take the last one?', 2 * 3_600_000),
          highlight('bot_tuca', 'Tuca', 'Sent the renewal follow-up to Ana and flagged the export fix as the open item before the call.', 5 * 3_600_000),
        ],
      };
    },

    async getUsage(filter = {}) {
      const to = filter.to ?? now();
      const from = filter.from ?? new Date(Date.parse(to) - 30 * 24 * 3_600_000).toISOString();
      const group = filter.group ?? 'day';
      const usageBots = [
        { key: 'bot_capy', label: 'Capy', runs: 42, completed: 39, failed: 2, cancelled: 1, tokensIn: 420_000, tokensOut: 118_000, costUsd: 1.0864 },
        { key: 'bot_onca', label: 'Onça', runs: 31, completed: 27, failed: 3, cancelled: 1, tokensIn: 298_000, tokensOut: 82_000, costUsd: 0.7688 },
        { key: 'bot_tuca', label: 'Tuca', runs: 18, completed: 18, failed: 0, cancelled: 0, tokensIn: 164_000, tokensOut: 47_000, costUsd: 0.4372 },
        { key: 'bot_tamu', label: 'Tamu', runs: 14, completed: 13, failed: 1, cancelled: 0, tokensIn: 126_000, tokensOut: 38_000, costUsd: 0.3414 },
      ];
      const botGroups = usageBots.map((bot) => ({
        key: bot.key,
        label: bot.label,
        totals: {
          runs: bot.runs,
          completed: bot.completed,
          failed: bot.failed,
          cancelled: bot.cancelled,
          tokensIn: bot.tokensIn,
          tokensOut: bot.tokensOut,
          costUsd: bot.costUsd,
        },
      }));
      const days = 7;
      const dayGroups = Array.from({ length: days }, (_entry, index) => {
        const key = new Date(Date.parse(to) - (days - 1 - index) * 24 * 3_600_000).toISOString().slice(0, 10);
        const runs = 6 + (index % 3) * 2;
        return {
          key,
          totals: {
            runs,
            completed: runs - 1,
            failed: index % 4 === 0 ? 1 : 0,
            cancelled: 0,
            tokensIn: runs * 2_400,
            tokensOut: runs * 680,
            costUsd: Number((runs * 0.0271).toFixed(4)),
          },
        };
      });
      const selected = filter.botId === undefined ? (group === 'day' ? dayGroups : botGroups) : botGroups.filter((entry) => entry.key === filter.botId);
      const totals = selected.reduce(
        (sum, entry) => ({
          runs: sum.runs + entry.totals.runs,
          completed: sum.completed + entry.totals.completed,
          failed: sum.failed + entry.totals.failed,
          cancelled: sum.cancelled + entry.totals.cancelled,
          tokensIn: sum.tokensIn + entry.totals.tokensIn,
          tokensOut: sum.tokensOut + entry.totals.tokensOut,
          costUsd: Number((sum.costUsd + entry.totals.costUsd).toFixed(4)),
        }),
        { runs: 0, completed: 0, failed: 0, cancelled: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 },
      );
      return { from, to, totals, groups: selected.map((entry) => structuredClone(entry)) };
    },

    usageExportUrl(filter = {}) {
      const query = new URLSearchParams();
      if (filter.from !== undefined) query.set('from', filter.from);
      if (filter.to !== undefined) query.set('to', filter.to);
      if (filter.botId !== undefined) query.set('botId', filter.botId);
      const suffix = query.size === 0 ? '' : `?${query.toString()}`;
      return `/api/usage/export.csv${suffix}`;
    },

  };
}
