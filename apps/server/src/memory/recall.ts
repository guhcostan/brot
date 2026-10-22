import type { Memory } from '@brot/protocol';

/** Default caps for one prompt's recalled memories. */
export const RECALL_MAX_ITEMS = 12;
export const RECALL_MAX_CHARS = 6000;

export interface RecallOptions {
  maxItems?: number;
  maxChars?: number;
  /** The run's clock, for the recency tiebreak. Defaults to the current time. */
  now?: Date;
}

const MIN_TOKEN_LENGTH = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
/** How much age can add to a memory's score. Far below one matched token, so relevance dominates. */
const RECENCY_BONUS = 0.001;

const STOPWORDS: ReadonlySet<string> = new Set([
  // English
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'your', 'with', 'this', 'that', 'from', 'have', 'has',
  'was', 'were', 'will', 'what', 'when', 'where', 'which', 'who', 'how', 'its', 'can', 'could', 'should',
  'would', 'about', 'into', 'they', 'them', 'their', 'there', 'then', 'than', 'over', 'under', 'also', 'just',
  'all', 'any', 'some', 'more', 'most', 'very', 'too', 'use', 'does', 'did', 'done', 'been', 'being', 'our',
  'out', 'off', 'onto', 'one', 'two', 'get', 'got', 'like', 'her', 'his', 'she', 'him',
  // Portuguese, accents stripped by `normalize`
  'que', 'para', 'com', 'uma', 'nao', 'por', 'dos', 'das', 'nos', 'nas', 'pelo', 'pela', 'como', 'mais',
  'mas', 'seu', 'sua', 'seus', 'suas', 'ele', 'ela', 'eles', 'elas', 'voce', 'voces', 'isso', 'isto', 'esse',
  'essa', 'este', 'esta', 'sao', 'foi', 'ser', 'tem', 'ter', 'vai', 'bem', 'tambem', 'sobre', 'entre',
  'quando', 'onde', 'qual', 'quais', 'quem', 'porque', 'pode', 'podem', 'deve', 'devem',
]);

/**
 * The memories to put in one run's prompt. Ranked by lexical overlap with the run's input: the memory that matches
 * more distinct query tokens comes first, and ties go to the newer memory. Memories that match nothing follow,
 * newest first. At most `maxItems` memories are returned and their contents total at most `maxChars` code units; a
 * memory that would break the character budget is skipped so a smaller later one can still fit. The same inputs and
 * clock always give the same result.
 */
export function selectForPrompt(
  memories: readonly Memory[],
  query: string,
  options: RecallOptions = {},
): Memory[] {
  const maxItems = Math.max(0, options.maxItems ?? RECALL_MAX_ITEMS);
  const maxChars = Math.max(0, options.maxChars ?? RECALL_MAX_CHARS);
  const now = options.now ?? new Date();
  const queryTokens = [...new Set(tokenize(query))];

  const ranked = memories.map((memory) => {
    const lexical = lexicalScore(memory, queryTokens);
    const at = Date.parse(memory.createdAt);
    return {
      memory,
      lexical,
      score: lexical + recencyBonus(now, at),
      at: Number.isNaN(at) ? 0 : at,
    };
  });

  const matched = ranked.filter((entry) => entry.lexical > 0).sort(byScore);
  const unmatched = ranked.filter((entry) => entry.lexical === 0).sort(byNewest);

  const selected: Memory[] = [];
  let chars = 0;
  for (const { memory } of [...matched, ...unmatched]) {
    if (selected.length >= maxItems) break;
    if (chars + memory.content.length > maxChars) continue;
    selected.push(memory);
    chars += memory.content.length;
  }
  return selected;
}

/** NFD plus lowercase, with combining marks stripped, so "Informação" matches "informacao". */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(token));
}

/** Distinct query tokens found in the memory; a longer token counts a little more. */
function lexicalScore(memory: Memory, queryTokens: readonly string[]): number {
  const memoryTokens = new Set(tokenize(memory.content));
  let score = 0;
  for (const token of queryTokens) {
    if (memoryTokens.has(token)) score += 1 + Math.min(token.length, 12) / 100;
  }
  return score;
}

function recencyBonus(now: Date, createdAt: number): number {
  if (Number.isNaN(createdAt)) return 0;
  const ageDays = Math.max(0, now.getTime() - createdAt) / DAY_MS;
  return RECENCY_BONUS / (1 + ageDays);
}

interface Ranked {
  memory: Memory;
  score: number;
  at: number;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byScore(a: Ranked, b: Ranked): number {
  if (a.score !== b.score) return b.score - a.score;
  return byNewest(a, b);
}

function byNewest(a: Ranked, b: Ranked): number {
  if (a.at !== b.at) return b.at - a.at;
  return compareIds(a.memory.id, b.memory.id);
}
