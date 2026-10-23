import type { Repos } from '@brot/db';
import type { AdminAction } from '@brot/protocol';
import type { Context } from 'hono';
import { isLocalRequest, type AppEnv } from '../auth';

export interface RecordActivityEntry {
  action: AdminAction;
  targetType: string;
  targetId?: string;
  summary: string;
  actor: string;
}

export interface RecordActivityDeps {
  repos: Pick<Repos, 'adminActivity'>;
  /** Where a best-effort failure goes. Defaults to `console.error`. */
  log?: (message: string, error: unknown) => void;
}

/**
 * The actor shown in the activity log: `local` for the machine's own user (a loopback request), the paired
 * device's name when a device token authenticated, else `local`.
 */
export function activityActor(c: Context<AppEnv>, trustLoopback: boolean): string {
  if (isLocalRequest(c, trustLoopback)) return 'local';
  return c.get('device')?.name ?? 'local';
}

/**
 * Records one admin write. Best effort by design: a failure to record (or a missing table) is logged and never
 * fails the request that caused it or hides its response.
 */
export async function recordActivity(deps: RecordActivityDeps, entry: RecordActivityEntry): Promise<void> {
  try {
    await deps.repos.adminActivity.record({
      action: entry.action,
      targetType: entry.targetType,
      ...(entry.targetId === undefined ? {} : { targetId: entry.targetId }),
      summary: entry.summary.slice(0, 300),
      actor: entry.actor,
    });
  } catch (error) {
    const log = deps.log ?? ((message: string, cause: unknown) => console.error(message, cause));
    log(`could not record admin activity (${entry.action} ${entry.targetType})`, error);
  }
}
