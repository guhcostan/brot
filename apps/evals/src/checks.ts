import type { CheckResult, Evidence } from './types';
import { truncate } from './util';

/** An objective check: passes or fails on a fact the evidence proves. */
export function check(id: string, label: string, ok: boolean, evidence: string): CheckResult {
  return { id, label, status: ok ? 'pass' : 'fail', evidence: truncate(evidence, 800) };
}

/** A subjective check: the stored output goes to a human. The case is marked needs-review. */
export function review(id: string, label: string, evidence: string): CheckResult {
  return { id, label, status: 'review', evidence: truncate(evidence, 800) };
}

/** A fact recorded for the report without a verdict, such as a measured context size. */
export function info(id: string, label: string, evidence: string): CheckResult {
  return { id, label, status: 'info', evidence: truncate(evidence, 800) };
}

/** A capability the product does not have yet. Recorded so the report shows the gap, not a failure. */
export function gap(id: string, label: string, evidence: string): CheckResult {
  return { id, label, status: 'info', evidence: truncate(`gap: ${evidence}`, 800) };
}

/** The key of the bot with this id, or the id itself when the bot is not a case bot. */
export function keyOf(evidence: Evidence, botId: string | undefined): string {
  if (botId === undefined) return '(none)';
  const found = Object.values(evidence.bots).find((bot) => bot.id === botId);
  return found?.key ?? botId;
}

/** Assistant messages a run wrote, keyed by run id, in order. */
export function assistantTextsByRun(evidence: Evidence): Map<string, string> {
  return new Map(evidence.finalTexts.map((entry) => [entry.runId, entry.text]));
}

/** Run ids a bot started, in the order they were created. */
export function runsOf(evidence: Evidence, botKey: string): Evidence['runs'] {
  const id = evidence.bots[botKey]?.id;
  return evidence.runs
    .filter((run) => run.botId === id)
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

/** Parses a JSON artifact, or returns undefined when the file is missing or not JSON. */
export function parseArtifact<T = unknown>(evidence: Evidence, key: string): T | undefined {
  const text = evidence.artifacts[key];
  if (text === undefined || text === null) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

/** Parses a CSV without quoted commas, which is all the fixtures and the report need. */
export function parseSimpleCsv(text: string): Array<Record<string, string>> {
  const [headerLine = '', ...rows] = text.trim().split('\n');
  const header = headerLine.split(',').map((cell) => cell.trim());
  return rows
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const cells = line.split(',').map((cell) => cell.trim().replace(/^"(.*)"$/, '$1'));
      return Object.fromEntries(header.map((name, index) => [name, cells[index] ?? '']));
    });
}

const GERMAN_STOPWORDS: ReadonlySet<string> = new Set([
  'der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'mit', 'zu', 'auf', 'für', 'dass', 'wir', 'ich', 'du',
  'sie', 'den', 'dem', 'im', 'sind', 'wenn', 'oder', 'auch', 'noch', 'aber', 'bei', 'von', 'dein', 'mein',
]);
const ENGLISH_STOPWORDS: ReadonlySet<string> = new Set([
  'the', 'and', 'is', 'are', 'you', 'to', 'of', 'with', 'this', 'that', 'it', 'for', 'not', 'in', 'on', 'your', 'we',
  'be', 'or', 'but', 'at', 'from',
]);

/** Counts German and English stopwords. A stopword heuristic, not a language detector: it is enough to tell German from English. */
export function languageHints(text: string): { german: number; english: number; words: number } {
  const words = text.toLowerCase().match(/[a-zäöüß]+/g) ?? [];
  let german = 0;
  let english = 0;
  for (const word of words) {
    if (GERMAN_STOPWORDS.has(word)) german += 1;
    if (ENGLISH_STOPWORDS.has(word)) english += 1;
  }
  return { german, english, words: words.length };
}

/** German when it has at least five German stopwords and more than twice as many as English ones. */
export function looksGerman(text: string): boolean {
  const hints = languageHints(text);
  return hints.german >= 5 && hints.german > 2 * hints.english;
}

/** Shot numbers in a text, from lines that start with `Shot N` or `Szene N`, in order of appearance. */
export function shotNumbers(text: string): number[] {
  return [...text.matchAll(/^\s*[#*_>\-\s]*(?:Shot|Szene)\s+(\d+)/gim)].map((match) => Number(match[1]));
}

/** Spoken words of a script: letters and digits, without markdown headings, shot labels and bracketed stage notes. */
export function spokenWordCount(script: string): number {
  const spoken = script
    .split('\n')
    .filter((line) => !/^\s*#/.test(line) && !/^\s*[#*_>\-\s]*(?:Shot|Szene|On-screen|Text|Titel|Title)\b/i.test(line))
    .map((line) => line.replace(/\[[^\]]*\]/g, ' '))
    .join(' ');
  return (spoken.match(/[\p{L}\p{N}']+/gu) ?? []).length;
}
