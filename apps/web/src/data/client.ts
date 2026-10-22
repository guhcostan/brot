import type {
  Attachment,
  Bot,
  BrowserProfile,
  BrowserStatus,
  BrowserTakeover,
  CanonicalEvent,
  ComputerInput,
  ComputerState,
  CreateBotInput,
  CreateBrowserProfile,
  CreateMcpServerInput,
  CreateMemory,
  CreateSavedLogin,
  CreateRoutineInput,
  CreateSkill,
  CreateTeamInput,
  Device,
  McpServer,
  McpServerTestResult,
  Memory,
  Notification,
  PairingStartResponse,
  PostMessage,
  ResolveApproval,
  ResponderMode,
  Routine,
  RoutineRun,
  RoutineRunStatus,
  SavedLogin,
  SearchHit,
  SetBrowserTakeover,
  SetTakeover,
  Skill,
  Takeover,
  Task,
  TaskStatus,
  Team,
  Thread,
  TodaySummary,
  UsageGrouping,
  UsageSummary,
  UpdateBot,
  UpdateBrowserProfile,
  UpdateMcpServer,
  UpdateMemory,
  UpdateRoomMembers,
  UpdateRoutine,
  UpdateSavedLogin,
  UpdateSkill,
  UpdateTeam,
  UpdateThread,
} from '@brot/protocol';

export type {
  Attachment,
  BrowserProfile,
  BrowserProfileRef,
  BrowserStatus,
  BrowserTakeover,
  CreateBrowserProfile,
  CreateMcpServerInput,
  CreateMemory,
  CreateSavedLogin,
  CreateRoutineInput,
  CreateSkill,
  McpServer,
  McpServerTestResult,
  McpServerTransport,
  Memory,
  MemoryKind,
  Notification,
  NotificationKind,
  Routine,
  RoutineRun,
  RoutineRunStatus,
  SavedLogin,
  SearchHit,
  SetBrowserTakeover,
  Skill,
  TodayBot,
  TodayHighlight,
  TodayRoutines,
  TodaySummary,
  TodayTotals,
  UpdateBrowserProfile,
  UpdateMcpServer,
  UpdateMemory,
  UpdateRoutine,
  UpdateSavedLogin,
  UpdateSkill,
  UsageGroup,
  UsageGrouping,
  UsageSummary,
  UsageTotals,
} from '@brot/protocol';
export type { Team } from '@brot/protocol';

/**
 * A live event and the conversation it belongs to: a bot's DM thread (`botId`), a room (`roomId`), or
 * neither. Every event names its thread, so many threads of one bot stay apart. Team task events
 * arrive even when their thread is unknown, so the task board stays live.
 */
export interface BotEvent {
  threadId: string;
  botId?: string;
  roomId?: string;
  event: CanonicalEvent;
}

/** A room thread with its member bot ids, the lead included. */
export interface Room {
  thread: Thread;
  memberIds: string[];
}

export interface NewRoom {
  title: string;
  botIds: string[];
  leadBotId: string;
  responder: ResponderMode;
}

export interface RoomMessage extends PostMessage {
  /** Member bot ids mentioned in the message, in mention order. */
  mentions?: string[];
}

export interface NewTask {
  title: string;
  description?: string;
  assigneeBotId: string;
  /** Where the task is requested. Absent means the assignee's most recent DM thread. */
  roomId?: string;
}

export interface TaskFilter {
  assigneeBotId?: string;
  status?: TaskStatus;
  chainId?: string;
  threadId?: string;
}

/** What `GET /api/routine-runs` can narrow down. */
export interface RoutineRunFilter {
  routineId?: string;
  botId?: string;
  status?: RoutineRunStatus;
  limit?: number;
}

/** The run a `POST /api/routines/:id/run` started. */
export interface RoutineRunStarted {
  runId: string;
}

/** What `GET /api/notifications` can narrow down. */
export interface NotificationFilter {
  unread?: boolean;
  botId?: string;
  limit?: number;
}

/** A downloaded skill: its SKILL.md text and the filename the server suggested. */
export interface SkillExport {
  content: string;
  filename: string;
}

/** A downloaded team package: its Markdown and the filename the server suggested. */
export interface TeamPackageExport {
  content: string;
  filename: string;
}

/** How many entities one import created. */
export interface TeamPackageImportCounts {
  teams: number;
  bots: number;
  rooms: number;
  routines: number;
  skills: number;
}

/** The window behind `GET /api/today`. Without bounds the server uses local midnight in `tz`. */
export interface TodayFilter {
  from?: string;
  to?: string;
  tz?: string;
}

/** What `GET /api/search` narrows down. `q` is the required search text. */
export interface MessageSearchFilter {
  q: string;
  botId?: string;
  threadId?: string;
  limit?: number;
  before?: string;
}

/** The window and grouping behind `GET /api/usage`. */
export interface UsageFilter {
  from?: string;
  to?: string;
  botId?: string;
  group?: UsageGrouping;
}

export interface ProviderModel {
  id: string;
  label: string;
}

/**
 * A model provider from `GET /api/providers`. `configured` means the vault holds `secretName`;
 * `models[].id` is the full `<provider>/<model>` ref the bot's `model` field expects.
 */
export interface Provider {
  id: string;
  label: string;
  models: ProviderModel[];
  configured: boolean;
  secretName: string;
}

/** A bot's computer from `GET /api/bots/:id/computer` (docs/COMPUTER-USE.md). */
export interface ComputerInfo {
  state: ComputerState | 'none';
  desktop: boolean;
  width: number;
  height: number;
  takeover: Takeover | null;
}

/** The screen could not be read: 404 when the bot has no desktop, 409 when the computer is not running. */
export class ScreenUnavailable extends Error {
  constructor(readonly status: number) {
    super(`Screen unavailable (${status})`);
    this.name = 'ScreenUnavailable';
  }
}

export interface ListBotsOptions {
  includeArchived?: boolean;
}

/**
 * The same-origin URL of an attachment's bytes. The id is the only key: the server serves the stored
 * content type and a safe file name, so the app can link to it directly (`<img>`, `<a href>`).
 */
export function attachmentUrl(attachmentId: string): string {
  return `/api/attachments/${encodeURIComponent(attachmentId)}`;
}

/** A team's shared brief, from the team dialog: name, instructions and an optional chief. */
export type NewTeam = CreateTeamInput;

/**
 * What the web app needs from the Brot server. Posting returns before the run finishes; the run
 * arrives as canonical events through onEvent, the same way the server's SSE stream delivers them.
 * Two implementations exist: the in-process mock (mockClient.ts) and the HTTP/SSE client
 * (httpClient.ts), which maps every conversation to its thread on the server (docs/TEAM-API.md).
 * A bot has any number of independent DM threads; a room is a thread too.
 */
export interface BrotClient {
  listBots(options?: ListBotsOptions): Promise<Bot[]>;
  createBot(input: CreateBotInput): Promise<Bot>;
  updateBot(botId: string, patch: UpdateBot): Promise<Bot>;
  deleteBot(botId: string): Promise<void>;

  /** Every team, by name. A team groups bots and gives them a shared brief. */
  listTeams(): Promise<Team[]>;
  createTeam(input: NewTeam): Promise<Team>;
  /** `chiefBotId: null` removes the chief. */
  updateTeam(teamId: string, patch: UpdateTeam): Promise<Team>;
  /** Deletes the team and ungroups its bots; the bots stay. */
  deleteTeam(teamId: string): Promise<void>;

  /** What a bot remembers, oldest first. */
  listMemories(botId: string): Promise<Memory[]>;
  createMemory(botId: string, input: CreateMemory): Promise<Memory>;
  updateMemory(memoryId: string, patch: UpdateMemory): Promise<Memory>;
  deleteMemory(memoryId: string): Promise<void>;

  /** A bot's skills plus the shared ones, by name. Without a bot, every skill. */
  listSkills(botId?: string): Promise<Skill[]>;
  /** `botId` absent creates a shared skill. */
  createSkill(input: CreateSkill): Promise<Skill>;
  updateSkill(skillId: string, patch: UpdateSkill): Promise<Skill>;
  deleteSkill(skillId: string): Promise<void>;
  /** Downloads the skill as a SKILL.md file. */
  exportSkill(skillId: string): Promise<SkillExport>;
  /** Imports a SKILL.md file; without a botId the skill is shared. */
  importSkill(input: { content: string; botId?: string }): Promise<Skill>;

  /** Uploads one file into a conversation. The bytes stay on the server; only metadata comes back. */
  uploadAttachment(threadId: string, file: File): Promise<Attachment>;
  /** Deletes an upload that never reached a message. Rejects while a message still links it. */
  deleteAttachment(attachmentId: string): Promise<void>;

  /** The notification inbox, newest first. */
  listNotifications(filter?: NotificationFilter): Promise<Notification[]>;
  unreadNotificationCount(): Promise<number>;
  /** Marks these notifications read, or every unread one when `ids` is omitted. Returns how many changed. */
  markNotificationsRead(ids?: readonly string[]): Promise<number>;
  deleteNotification(notificationId: string): Promise<void>;

  /** A bot's DM threads, most recently active first. */
  listThreads(botId: string): Promise<Thread[]>;
  createThread(botId: string, input?: { title?: string }): Promise<Thread>;
  /** Renames a thread (`PATCH /api/threads/:id`) and returns the updated thread. */
  /** Renames a thread and/or overrides its model (null goes back to the bot's model). DMs only. */
  updateThread(threadId: string, patch: UpdateThread): Promise<Thread>;
  /** A DM thread's events, oldest first. */
  history(threadId: string): Promise<CanonicalEvent[]>;
  onEvent(listener: (event: BotEvent) => void): () => void;
  /** Sends a message into a DM thread and starts its run. */
  postMessage(threadId: string, input: PostMessage): Promise<void>;
  resolveApproval(approvalId: string, input: ResolveApproval): Promise<void>;

  listRooms(): Promise<Room[]>;
  createRoom(input: NewRoom): Promise<Room>;
  roomHistory(roomId: string): Promise<CanonicalEvent[]>;
  postRoomMessage(roomId: string, input: RoomMessage): Promise<void>;
  /** Returns the member bot ids after the change. */
  updateRoomMembers(roomId: string, change: UpdateRoomMembers): Promise<string[]>;

  listTasks(filter?: TaskFilter): Promise<Task[]>;
  createTask(input: NewTask): Promise<Task>;
  cancelTask(taskId: string): Promise<Task>;

  /** Every routine, or one bot's routines. */
  listRoutines(botId?: string): Promise<Routine[]>;
  createRoutine(input: CreateRoutineInput): Promise<Routine>;
  updateRoutine(routineId: string, patch: UpdateRoutine): Promise<Routine>;
  /** Deletes the routine and its run history. */
  deleteRoutine(routineId: string): Promise<void>;
  /** Starts a run now. Rejects with the server's 409 message when the routine is already running. */
  runRoutineNow(routineId: string): Promise<RoutineRunStarted>;
  /** Run history, newest first. */
  listRoutineRuns(filter?: RoutineRunFilter): Promise<RoutineRun[]>;

  listProviders(): Promise<Provider[]>;
  /** Stores a secret in the vault. The value is never read back. */
  setSecret(name: string, value: string): Promise<void>;
  listDevices(): Promise<Device[]>;
  removeDevice(deviceId: string): Promise<void>;
  startPairing(): Promise<PairingStartResponse>;

  getComputer(botId: string): Promise<ComputerInfo>;
  startComputer(botId: string): Promise<ComputerInfo>;
  /** The current frame. Throws ScreenUnavailable for 404 and 409. */
  computerScreen(botId: string, signal?: AbortSignal): Promise<Blob>;
  computerInput(botId: string, input: ComputerInput): Promise<void>;
  setTakeover(botId: string, input: SetTakeover): Promise<Takeover>;

  /** The bot's browser on the server machine. Throws when the bot has no host browser. */
  browserStatus(botId: string): Promise<BrowserStatus>;
  /** Opens a headed window so the person can sign in; the bot keeps the profile afterwards. */
  startBrowserLogin(botId: string): Promise<BrowserStatus>;
  /** Closes the browser, saving its profile. Shared profiles close for every bot using them. */
  closeBrowser(botId: string): Promise<void>;
  /** A JPEG of the live browser page; throws ScreenUnavailable for 404/409. */
  browserScreen(botId: string, signal?: AbortSignal): Promise<Blob>;
  /** Who currently holds the bot's browser (shared with every bot on its profile). */
  getBrowserTakeover(botId: string): Promise<BrowserTakeover>;
  setBrowserTakeover(botId: string, input: SetBrowserTakeover): Promise<BrowserTakeover>;
  /** One mouse or keyboard event from the person; refused while they do not hold control. */
  browserInput(botId: string, input: ComputerInput): Promise<void>;

  /** Shared host-browser profiles, by name. */
  listBrowserProfiles(): Promise<BrowserProfile[]>;
  createBrowserProfile(input: CreateBrowserProfile): Promise<BrowserProfile>;
  updateBrowserProfile(profileId: string, input: UpdateBrowserProfile): Promise<BrowserProfile>;
  /** Deletes a room: active runs are cancelled and the conversation goes; the member bots stay. */
  deleteRoom(roomId: string): Promise<void>;
  /** Deletes the profile's saved logins and ungroups its bots, which fall back to their own profiles. */
  deleteBrowserProfile(profileId: string): Promise<void>;

  /** User MCP servers whose tools every run can call. */
  listMcpServers(): Promise<McpServer[]>;
  createMcpServer(input: CreateMcpServerInput): Promise<McpServer>;
  updateMcpServer(serverId: string, patch: UpdateMcpServer): Promise<McpServer>;
  deleteMcpServer(serverId: string): Promise<void>;
  /** Runs a real handshake with the server; a failed handshake is a normal result with `ok: false`. */
  testMcpServer(serverId: string): Promise<McpServerTestResult>;

  /** Downloads a portable package of one team, or of the whole workspace when `teamId` is absent. */
  exportTeamPackage(teamId?: string): Promise<TeamPackageExport>;
  /** Imports a package previously produced by the export, or hand-written in the same format. */
  importTeamPackage(content: string): Promise<TeamPackageImportCounts>;

  /** The Today summary: totals, per-bot shares, routine counts, pending approvals and highlights. */
  getToday(filter?: TodayFilter): Promise<TodaySummary>;
  /** A usage summary over a range, grouped by UTC day or by bot. */
  getUsage(filter?: UsageFilter): Promise<UsageSummary>;
  /** The same-origin CSV export URL for the same range, for a link or the download helper. */
  usageExportUrl(filter?: Omit<UsageFilter, 'group'>): string;

  /** Saved logins, without their values: the API never returns a username, password or TOTP secret. */
  listSavedLogins(): Promise<SavedLogin[]>;
  createSavedLogin(input: CreateSavedLogin): Promise<SavedLogin>;
  updateSavedLogin(loginId: string, patch: UpdateSavedLogin): Promise<SavedLogin>;
  /** Deletes the login and the vault values behind it. */
  deleteSavedLogin(loginId: string): Promise<void>;

  /** Full-text message search, newest first; snippets are plain text. */
  searchMessages(filter: MessageSearchFilter): Promise<SearchHit[]>;
}
