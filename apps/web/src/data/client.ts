import type {
  Bot,
  CanonicalEvent,
  PostMessage,
  ResolveApproval,
  ResponderMode,
  Task,
  TaskStatus,
  Thread,
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

/**
 * What the web app needs from the Brot server. Posting returns before the run finishes; the run
 * arrives as canonical events through onEvent, the same way the server's SSE stream delivers them.
 * Two implementations exist: the in-process mock (mockClient.ts) and the HTTP/SSE client
 * (httpClient.ts), which maps each bot to its DM thread on the server (docs/TEAM-API.md).
 */
export interface BrotClient {
  listBots(): Promise<Bot[]>;
  history(botId: string): Promise<CanonicalEvent[]>;
  onEvent(listener: (event: BotEvent) => void): () => void;
  postMessage(botId: string, input: PostMessage): Promise<void>;
  resolveApproval(approvalId: string, input: ResolveApproval): Promise<void>;

  listRooms(): Promise<Room[]>;
  createRoom(input: NewRoom): Promise<Room>;
  roomHistory(roomId: string): Promise<CanonicalEvent[]>;
  postRoomMessage(roomId: string, input: RoomMessage): Promise<void>;

  listTasks(filter?: TaskFilter): Promise<Task[]>;
  createTask(input: NewTask): Promise<Task>;
  cancelTask(taskId: string): Promise<Task>;
}
