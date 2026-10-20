import type {
  Bot,
  CanonicalEvent,
  ComputerInput,
  ComputerState,
  CreateBotInput,
  Device,
  PairingStartResponse,
  PostMessage,
  ResolveApproval,
  ResponderMode,
  SetTakeover,
  Takeover,
  Task,
  TaskStatus,
  Thread,
  UpdateBot,
  UpdateRoomMembers,
} from '@brot/protocol';

/**
 * A live event and the conversation it belongs to: a bot's DM (`botId`), a room (`roomId`), or
 * neither. Team task events arrive even when their thread is unknown, so the task board stays live.
 */
export interface BotEvent {
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
  /** Where the task is requested. Absent means the assignee's DM. */
  roomId?: string;
}

export interface TaskFilter {
  assigneeBotId?: string;
  status?: TaskStatus;
  chainId?: string;
  threadId?: string;
}

export interface ProviderModel {
  id: string;
  label: string;
}

/** A model provider from `GET /api/providers`. `configured` means the vault holds `secretName`. */
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
 * What the web app needs from the Brot server. Posting returns before the run finishes; the run
 * arrives as canonical events through onEvent, the same way the server's SSE stream delivers them.
 * Two implementations exist: the in-process mock (mockClient.ts) and the HTTP/SSE client
 * (httpClient.ts), which maps each bot to its DM thread on the server (docs/TEAM-API.md).
 */
export interface BrotClient {
  listBots(options?: ListBotsOptions): Promise<Bot[]>;
  createBot(input: CreateBotInput): Promise<Bot>;
  updateBot(botId: string, patch: UpdateBot): Promise<Bot>;
  deleteBot(botId: string): Promise<void>;
  history(botId: string): Promise<CanonicalEvent[]>;
  onEvent(listener: (event: BotEvent) => void): () => void;
  postMessage(botId: string, input: PostMessage): Promise<void>;
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
}
