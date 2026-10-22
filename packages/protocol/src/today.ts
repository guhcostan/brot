import { z } from 'zod';
import { IsoDateTime } from './entities';

/**
 * The query behind `GET /api/today`: an optional explicit ISO range and the IANA timezone that places the
 * default start at local midnight. Without `tz`, the server's zone is used.
 */
export const TodayQuery = z.object({
  from: IsoDateTime.optional(),
  to: IsoDateTime.optional(),
  tz: z.string().min(1).max(64).optional(),
});
export type TodayQuery = z.infer<typeof TodayQuery>;

/** Run counts by terminal status plus token and cost sums, over every run in the window. */
export const TodayTotals = z.object({
  runs: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});
export type TodayTotals = z.infer<typeof TodayTotals>;

/** One bot's share of the window, named for display. */
export const TodayBot = z.object({
  botId: z.string(),
  name: z.string().min(1),
  runs: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});
export type TodayBot = z.infer<typeof TodayBot>;

/** Routine runs in the window by status. `running` merges queued and running runs. */
export const TodayRoutines = z.object({
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
});
export type TodayRoutines = z.infer<typeof TodayRoutines>;

/** A finished run worth showing on the Today page, with the last assistant message of its thread. */
export const TodayHighlight = z.object({
  botId: z.string(),
  botName: z.string().min(1),
  threadId: z.string(),
  /** The last assistant message, trimmed, at most 200 characters. */
  text: z.string().min(1),
  at: IsoDateTime,
});
export type TodayHighlight = z.infer<typeof TodayHighlight>;

/** What `GET /api/today` returns: the window, run totals and per-bot shares, routine counts, and highlights. */
export const TodaySummary = z.object({
  from: IsoDateTime,
  to: IsoDateTime,
  totals: TodayTotals,
  byBot: z.array(TodayBot),
  routines: TodayRoutines,
  /** Pending approvals in the whole workspace, not only this window. */
  pendingApprovals: z.number().int().nonnegative(),
  highlights: z.array(TodayHighlight),
});
export type TodaySummary = z.infer<typeof TodaySummary>;
