import type { Repos } from '@brot/db';
import type { Approval, CanonicalEvent } from '@brot/protocol';
import type { EventBus } from '../bus';

/** Notifications older than this are removed at boot. */
export const NOTIFICATION_RETENTION_DAYS = 30;
const RETENTION_MS = NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000;
/** A notification body is one short line; the full text stays in the thread. */
const BODY_LIMIT = 300;

export interface NotificationsService {
  /** Deletes notifications older than the retention window. Idempotent; returns how many were removed. */
  prune(): Promise<number>;
  /** Unsubscribes from the event bus. */
  stop(): void;
}

export interface NotificationServiceDeps {
  repos: Repos;
  bus: EventBus;
  /** Clock for retention. Tests pass a fixed one. */
  now?: () => Date;
}

/** The inbox record for one event, or undefined when the event should not notify. */
async function notificationFor(
  repos: Repos,
  event: Extract<CanonicalEvent, { type: 'approval.requested' | 'run.completed' | 'run.failed' }>,
): Promise<Parameters<Repos['notifications']['create']>[0] | undefined> {
  if (event.type === 'approval.requested') {
    const approval: Approval = event.approval;
    const bot = await repos.bots.get(approval.botId);
    if (bot === undefined) return undefined;
    // Approvals always notify: a blocked run needs a person whatever the bot's finished-run setting says.
    return {
      botId: bot.id,
      threadId: approval.threadId,
      kind: 'approval',
      title: `"${bot.name}" needs your approval`,
      body: clip(approval.summary),
    };
  }

  if (event.runId === undefined) return undefined;
  const run = await repos.runs.get(event.runId);
  if (run === undefined) return undefined;
  const bot = await repos.bots.get(run.botId);
  if (bot === undefined) return undefined;

  if (event.type === 'run.failed') {
    // Failures always notify, for the same reason as approvals.
    return {
      botId: bot.id,
      threadId: event.threadId,
      kind: 'failed',
      title: `"${bot.name}" failed`,
      body: clip(event.error) || 'The run failed.',
    };
  }

  // A finished run notifies only when the bot allows it and its answer has text to show.
  if (bot.notifications === false) return undefined;
  const messages = await repos.messages.listByThread(event.threadId);
  const last = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant' && (message.authorBotId === undefined || message.authorBotId === bot.id));
  const body = last === undefined ? '' : clip(last.content);
  if (body === '') return undefined;
  return {
    botId: bot.id,
    threadId: event.threadId,
    kind: 'finished',
    title: `"${bot.name}" finished`,
    body,
  };
}

function clip(text: string): string {
  return text.trim().slice(0, BODY_LIMIT);
}

/**
 * The notification inbox. It listens to the bus once and records approvals, finished runs (when the bot allows
 * them) and failures. Writing is best effort: an insert that fails is logged and swallowed, so the bus and the
 * run that published the event are never blocked. Retention is applied by `prune`, called at boot.
 */
export function createNotificationsService(deps: NotificationServiceDeps): NotificationsService {
  const { repos, bus } = deps;
  const now = deps.now ?? (() => new Date());

  const unsubscribe = bus.subscribe((event) => {
    if (event.type !== 'approval.requested' && event.type !== 'run.completed' && event.type !== 'run.failed') return;
    void notificationFor(repos, event)
      .then((record) => (record === undefined ? undefined : repos.notifications.create(record)))
      .catch((error: unknown) => {
        // Never leak message content or secrets here; the event type is enough to diagnose.
        console.error(
          `notification for ${event.type} could not be recorded`,
          error instanceof Error ? error.message : String(error),
        );
      });
  });

  return {
    async prune() {
      const cutoff = new Date(now().getTime() - RETENTION_MS).toISOString();
      return repos.notifications.pruneBefore(cutoff);
    },
    stop() {
      unsubscribe();
    },
  };
}
