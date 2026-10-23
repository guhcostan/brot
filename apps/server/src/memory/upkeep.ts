import type { Repos } from '@brot/db';
import type { Memory, MemoryKind, MemoryScope, MemoryUpkeepGroup, MemoryUpkeepReport } from '@brot/protocol';

/**
 * Trailing sentence punctuation, closing quotes and brackets, and whitespace: the tail that does not change what a
 * memory says. Symbols such as `%` and `+` stay, so "50%" and "C++" keep their meaning.
 */
const TRAILING_NOISE = /[\s.,;:!?\u2026'"‘’“”)\]}]+$/u;

/**
 * The comparison form of a memory's text: trimmed, internal whitespace collapsed, trailing punctuation removed,
 * lowercased. Two memories with the same normalized text and kind are duplicates.
 */
export function normalizeMemoryContent(content: string): string {
  let text = content.trim().replace(/\s+/g, ' ');
  for (;;) {
    const stripped = text.replace(TRAILING_NOISE, '');
    if (stripped === text) break;
    text = stripped;
  }
  return text.toLowerCase();
}

/** Newest first by `updatedAt`, then `createdAt`, then id. The first memory of a duplicate group is the keeper. */
function newestFirst(left: Memory, right: Memory): number {
  return (
    compareDescending(left.updatedAt, right.updatedAt) ||
    compareDescending(left.createdAt, right.createdAt) ||
    compareDescending(left.id, right.id)
  );
}

function compareDescending(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? 1 : -1;
}

function compareAscending(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export interface MemoryUpkeepScopeInput {
  scope: MemoryScope;
  botId?: string;
}

/** The memories of exactly one scope. Bot and workspace memories are never mixed. */
async function memoriesInScope(repos: Repos, input: MemoryUpkeepScopeInput): Promise<Memory[]> {
  if (input.scope === 'workspace') return repos.memories.listWorkspace();
  if (input.botId === undefined) throw new Error('a bot memory scope needs a botId');
  return repos.memories.listByBot(input.botId);
}

/**
 * The dry-run report: duplicates within one scope and kind, grouped by normalized content. The newest memory of
 * each group is kept and the rest are removable. Blank memories are never grouped. `total` is every memory in the
 * scope; `removable` is the sum of the groups' remove sides. Groups are ordered by remove count, then content.
 */
export async function buildMemoryUpkeepReport(
  repos: Repos,
  input: MemoryUpkeepScopeInput,
): Promise<MemoryUpkeepReport> {
  const memories = await memoriesInScope(repos, input);
  const buckets = new Map<string, Memory[]>();
  for (const memory of memories) {
    const normalized = normalizeMemoryContent(memory.content);
    if (normalized === '') continue;
    const key = `${memory.kind}\u0000${normalized}`;
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [memory]);
    else bucket.push(memory);
  }

  const grouped: Array<{ normalized: string; kind: MemoryKind; group: MemoryUpkeepGroup }> = [];
  for (const [key, bucket] of buckets) {
    if (bucket.length < 2) continue;
    const [keep, ...remove] = [...bucket].sort(newestFirst);
    if (keep === undefined) continue;
    const normalized = key.slice(key.indexOf('\u0000') + 1);
    grouped.push({ normalized, kind: keep.kind, group: { kind: keep.kind, keep, remove } });
  }
  grouped.sort(
    (left, right) =>
      right.group.remove.length - left.group.remove.length ||
      compareAscending(left.normalized, right.normalized) ||
      compareAscending(left.kind, right.kind),
  );

  const groups = grouped.map((entry) => entry.group);
  return {
    scope: input.scope,
    ...(input.botId === undefined ? {} : { botId: input.botId }),
    total: memories.length,
    removable: groups.reduce((sum, group) => sum + group.remove.length, 0),
    groups,
  };
}

/** Thrown when an apply names ids that a fresh report no longer marks removable. Nothing is deleted. */
export class MemoryUpkeepConflictError extends Error {
  readonly ids: string[];

  constructor(ids: string[]) {
    super(`these memories are not removable duplicates: ${ids.join(', ')}`);
    this.name = 'MemoryUpkeepConflictError';
    this.ids = ids;
  }
}

export interface ApplyMemoryUpkeepResult {
  removed: Memory[];
  /** The memories kept from every duplicate group of the fresh report. */
  kept: Memory[];
}

/**
 * Applies a preview: recomputes the report for the same scope, validates that every requested id is on the remove
 * side of a duplicate group (and no keep, unique memory or other-scope memory is named), then deletes through the
 * memory repo so the journal records each deletion. Validation happens before the first delete; when it fails, the
 * caller gets `MemoryUpkeepConflictError` with the offending ids and nothing has been removed.
 */
export async function applyMemoryUpkeep(
  repos: Repos,
  input: MemoryUpkeepScopeInput & { removeIds: readonly string[] },
): Promise<ApplyMemoryUpkeepResult> {
  const report = await buildMemoryUpkeepReport(repos, input);
  const removable = new Map<string, Memory>();
  for (const group of report.groups) {
    for (const memory of group.remove) removable.set(memory.id, memory);
  }
  const requested = [...new Set(input.removeIds)];
  const stale = requested.filter((id) => !removable.has(id));
  if (stale.length > 0) throw new MemoryUpkeepConflictError(stale);

  const removed: Memory[] = [];
  for (const id of requested) {
    if (await repos.memories.remove(id)) {
      const memory = removable.get(id);
      if (memory !== undefined) removed.push(memory);
    }
  }
  return { removed, kept: report.groups.map((group) => group.keep) };
}
