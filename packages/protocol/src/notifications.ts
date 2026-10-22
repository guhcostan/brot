import { z } from 'zod';
import { IsoDateTime } from './entities';

/**
 * Why a notification exists. `approval`, `finished` and `failed` are emitted by the server today; `question`
 * and `routine_failed` are reserved for the web inbox and future wiring.
 */
export const NotificationKind = z.enum(['approval', 'question', 'finished', 'failed', 'routine_failed']);
export type NotificationKind = z.infer<typeof NotificationKind>;

/**
 * One entry of the notification inbox: something a person may need to look at. Approvals and failed runs are
 * always recorded; finished runs only when the bot's `notifications` setting allows them.
 */
export const Notification = z.object({
  id: z.string(),
  botId: z.string(),
  threadId: z.string(),
  kind: NotificationKind,
  title: z.string().min(1).max(300),
  body: z.string().max(2000),
  createdAt: IsoDateTime,
  /** When the person read it. Absent while unread. */
  readAt: IsoDateTime.optional(),
});
export type Notification = z.infer<typeof Notification>;

/** Marks notifications read. With no `ids`, marks every unread notification. */
export const MarkNotificationsRead = z.object({
  ids: z.array(z.string().min(1)).max(200).optional(),
});
export type MarkNotificationsRead = z.infer<typeof MarkNotificationsRead>;
