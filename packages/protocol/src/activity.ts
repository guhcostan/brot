import { z } from 'zod';
import { IsoDateTime } from './entities';

/** What an admin write did: created, updated, deleted, revoked (a device) or ran (a routine). */
export const AdminAction = z.enum(['created', 'updated', 'deleted', 'revoked', 'ran']);
export type AdminAction = z.infer<typeof AdminAction>;

/**
 * One write from the admin UI or CLI, for the activity log. `summary` is human text for display and never holds a
 * secret value; `actor` is `local` for the machine's own user or the paired device's name.
 */
export const AdminActivity = z.object({
  id: z.string(),
  action: AdminAction,
  /** What was changed: `bot`, `team`, `routine`, `mcp-server`, `preset`, `saved-login`, `browser-profile`, `device` or `settings`. */
  targetType: z.string().min(1),
  /** The changed row's id, when it has one (settings entries have no single row). */
  targetId: z.string().optional(),
  summary: z.string().min(1).max(300),
  actor: z.string().min(1),
  at: IsoDateTime,
});
export type AdminActivity = z.infer<typeof AdminActivity>;

/** The filters GET /api/activity accepts. `limit` defaults to 50 and is capped at 200. */
export const AdminActivityQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AdminActivityQuery = z.infer<typeof AdminActivityQuery>;
