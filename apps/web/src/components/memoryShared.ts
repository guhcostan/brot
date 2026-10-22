import type { MemoryKind } from '../data/client';
import type { TranslationKey } from '../i18n';

export const MEMORY_KIND_KEY: Record<MemoryKind, TranslationKey> = {
  fact: 'memory.kind.fact',
  preference: 'memory.kind.preference',
  summary: 'memory.kind.summary',
};

export const MEMORY_KINDS: readonly MemoryKind[] = ['fact', 'preference', 'summary'];

/** How a memory's saved date reads in lists. */
export const memorySavedOnFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
