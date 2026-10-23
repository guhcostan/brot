import type { Memory, MemoryKind, MemoryScope } from '@brot/protocol';
import type { MemoryUpkeepGroup, MemoryUpkeepReport } from '@brot/protocol';

/** Duplicate detection compares this normalized text within the same kind. */
export function normalizeMemoryContent(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Builds the mock's report the way the server does: same kind and normalized content form a group, the
 * newest memory of each group is kept, and groups with the most removable members come first.
 */
export function buildMemoryUpkeepReport(
  scope: MemoryScope,
  botId: string | undefined,
  memories: readonly Memory[],
): MemoryUpkeepReport {
  const groups = new Map<string, Memory[]>();
  for (const memory of memories) {
    if (memory.scope !== scope) continue;
    if (botId !== undefined && memory.botId !== botId) continue;
    const key = `${memory.kind}\u0000${normalizeMemoryContent(memory.content)}`;
    const list = groups.get(key);
    if (list === undefined) groups.set(key, [memory]);
    else list.push(memory);
  }
  const duplicateGroups: MemoryUpkeepGroup[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id));
    duplicateGroups.push({ kind: sorted[0]!.kind as MemoryKind, keep: sorted[0]!, remove: sorted.slice(1) });
  }
  duplicateGroups.sort((a, b) => b.remove.length - a.remove.length || Date.parse(b.keep.createdAt) - Date.parse(a.keep.createdAt) || a.keep.id.localeCompare(b.keep.id));
  const matching = memories.filter((memory) => memory.scope === scope && (botId === undefined || memory.botId === botId));
  return {
    scope,
    ...(botId === undefined ? {} : { botId }),
    total: matching.length,
    removable: duplicateGroups.reduce((sum, group) => sum + group.remove.length, 0),
    groups: duplicateGroups,
  };
}
