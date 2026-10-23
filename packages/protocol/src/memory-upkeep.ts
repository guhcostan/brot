import { z } from 'zod';
import { Memory, MemoryKind, MemoryScope } from './entities';

/** One group of duplicates: `keep` is the newest memory, `remove` the older members of the same group. */
export const MemoryUpkeepGroup = z.object({
  kind: MemoryKind,
  keep: Memory,
  remove: z.array(Memory).min(1),
});
export type MemoryUpkeepGroup = z.infer<typeof MemoryUpkeepGroup>;

/**
 * The dry-run result for one scope. `total` is every memory in the scope; `removable` counts the duplicates a
 * merge would delete; `groups` are the duplicates, most removable first.
 */
export const MemoryUpkeepReport = z.object({
  scope: MemoryScope,
  botId: z.string().optional(),
  total: z.number().int().nonnegative(),
  removable: z.number().int().nonnegative(),
  groups: z.array(MemoryUpkeepGroup),
});
export type MemoryUpkeepReport = z.infer<typeof MemoryUpkeepReport>;

type UpkeepScopeValue = { scope: MemoryScope; botId?: string };

/** A bot scope needs its bot; a workspace scope belongs to no bot. */
function requireUpkeepScope(value: UpkeepScopeValue, ctx: z.RefinementCtx): void {
  if (value.scope === 'bot' && value.botId === undefined) {
    ctx.addIssue({ code: 'custom', path: ['botId'], message: 'a bot scope needs a botId' });
  }
  if (value.scope === 'workspace' && value.botId !== undefined) {
    ctx.addIssue({ code: 'custom', path: ['botId'], message: 'a workspace scope has no botId' });
  }
}

/** The scope a report is computed for: required `scope`, and `botId` only for a bot scope. */
export const MemoryUpkeepScope = z.object({
  scope: MemoryScope,
  botId: z.string().min(1).optional(),
}).superRefine(requireUpkeepScope);
export type MemoryUpkeepScope = z.infer<typeof MemoryUpkeepScope>;
export type MemoryUpkeepScopeInput = z.input<typeof MemoryUpkeepScope>;

/** The apply body: the scope, and 1..200 ids a fresh report marked removable. */
export const ApplyMemoryUpkeep = z
  .object({
    scope: MemoryScope,
    botId: z.string().min(1).optional(),
    removeIds: z.array(z.string().min(1)).min(1).max(200),
  })
  .superRefine(requireUpkeepScope);
export type ApplyMemoryUpkeep = z.infer<typeof ApplyMemoryUpkeep>;
export type ApplyMemoryUpkeepInput = z.input<typeof ApplyMemoryUpkeep>;
