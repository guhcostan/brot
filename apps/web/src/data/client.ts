import type { Bot, CanonicalEvent, PostMessage, ResolveApproval } from '@brot/protocol';

export interface BotEvent {
  botId: string;
  event: CanonicalEvent;
}

/**
 * What the web app needs from the Brot server. Posting returns before the run finishes; the run
 * arrives as canonical events through onEvent, the same way the server's SSE stream delivers them.
 * The in-process mock implements this interface; an HTTP/SSE client will implement it once the
 * server routes exist.
 */
export interface BrotClient {
  listBots(): Promise<Bot[]>;
  history(botId: string): Promise<CanonicalEvent[]>;
  onEvent(listener: (event: BotEvent) => void): () => void;
  postMessage(botId: string, input: PostMessage): Promise<void>;
  resolveApproval(approvalId: string, input: ResolveApproval): Promise<void>;
}
