import { z } from 'zod';
import { IsoDateTime } from './entities';

/** How a usage summary is bucketed: by UTC day, or by bot. */
export const UsageGrouping = z.enum(['day', 'bot']);
export type UsageGrouping = z.infer<typeof UsageGrouping>;

/**
 * The query behind `GET /api/usage`: runs whose `startedAt` falls in the half-open range [`from`, `to`).
 * Both bounds default on the server (`to` = now, `from` = 30 days before it). `group` defaults to `day`, whose
 * keys are UTC dates (`YYYY-MM-DD`).
 */
export const UsageRange = z.object({
  from: IsoDateTime.optional(),
  to: IsoDateTime.optional(),
  botId: z.string().min(1).optional(),
  group: UsageGrouping.default('day'),
});
export type UsageRange = z.infer<typeof UsageRange>;

/**
 * Run counts by terminal status plus token and cost sums. The counts cover completed, failed and cancelled runs;
 * `runs` and the token/cost sums cover every run in range, including running and waiting-for-approval ones.
 */
export const UsageTotals = z.object({
  runs: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
});
export type UsageTotals = z.infer<typeof UsageTotals>;

/**
 * One bucket of a usage summary. `key` is a UTC date (`YYYY-MM-DD`) for day groups, or a bot id for bot groups;
 * `label` is the bot's name for bot groups and absent for day groups.
 */
export const UsageGroup = z.object({
  key: z.string(),
  label: z.string().optional(),
  totals: UsageTotals,
});
export type UsageGroup = z.infer<typeof UsageGroup>;

/** What `GET /api/usage` returns: the resolved range, its totals, and the buckets sorted by key. */
export const UsageSummary = z.object({
  from: IsoDateTime,
  to: IsoDateTime,
  totals: UsageTotals,
  groups: z.array(UsageGroup),
});
export type UsageSummary = z.infer<typeof UsageSummary>;
