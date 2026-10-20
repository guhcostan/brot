import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CanonicalEvent } from '@brot/protocol';
import type { BotSpec } from '../context';
import type { Evidence } from '../types';

/** `fixtures/` at the package root. Fixtures are synthetic; see the README-free layout in apps/evals/fixtures. */
export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');

export function fixturePath(relative: string): string {
  return join(FIXTURES, relative);
}

export function readFixture(relative: string): string {
  return readFileSync(fixturePath(relative), 'utf8');
}

export function readFixtureJson<T>(relative: string): T {
  return JSON.parse(readFixture(relative)) as T;
}

/** The text a command printed, stdout first, then stderr. Checks that read an exit code need both streams. */
export function outputOf(result: { stdout: string; stderr: string }): string {
  return [result.stdout, result.stderr].filter((part) => part !== '').join('\n');
}

/**
 * The public repo the repo cases use. It is pinned to a commit, and the commit already has the bug that A1 reports:
 * `leftPad('ab', 6, 'xy')` returns 10 characters.
 */
export const LEFT_PAD = {
  url: 'https://github.com/stevemao/left-pad',
  sha: '2fca6157fcca165438e0f9495cf0e5a4e6f71349',
  reproducer: "leftPad('ab', 6, 'xy').length",
} as const;

/** Bot personas. Names and species come from docs/USE-CASES.md; colors are design tokens. */
export const ANIMAL = {
  onca: { name: 'Onça', species: 'onca', color: 'orange' },
  tuca: { name: 'Tuca', species: 'tucano', color: 'amber' },
  tamu: { name: 'Tamu', species: 'tamandua', color: 'brown' },
  capy: { name: 'Capy', species: 'capivara', color: 'teal' },
  jabuti: { name: 'Jabuti', species: 'jabuti', color: 'black' },
  mico: { name: 'Mico', species: 'mico', color: 'violet' },
  boto: { name: 'Boto', species: 'boto', color: 'blue' },
  preguica: { name: 'Preguiça', species: 'preguica', color: 'gray' },
  lobo: { name: 'Lobo', species: 'lobo', color: 'pink' },
  arara: { name: 'Arara', species: 'arara', color: 'white' },
} as const;

export type AnimalKey = keyof typeof ANIMAL;

export function botSpec(
  animal: AnimalKey,
  job: string,
  instructions: string,
  egress: string[],
  extra: Partial<Pick<BotSpec, 'teamBudgetUsd'>> = {},
): BotSpec {
  const persona = ANIMAL[animal];
  return {
    name: persona.name,
    job,
    instructions,
    species: persona.species,
    color: persona.color,
    egress,
    ...extra,
  };
}

/** The bot key of a run's bot, keyed by run id. */
export function botKeyByRun(evidence: Evidence): Map<string, string> {
  const keyByBotId = new Map(Object.values(evidence.bots).map((bot) => [bot.id, bot.key]));
  return new Map(evidence.runs.map((run) => [run.id, keyByBotId.get(run.botId) ?? run.botId]));
}

/** Whether a tool name is the bot's tool, however the engine prefixed it (`http_request`, `brot.http_request`). */
export function isTool(name: string, tool: string): boolean {
  return tool === name || tool.endsWith(`.${name}`) || tool.endsWith(`__${name}`) || tool.endsWith(`/${name}`);
}

export interface HttpCall {
  botKey: string;
  runId: string;
  callId: string;
  method: string;
  url: string;
  host: string;
  headers: string[];
  at: string;
}

/** Every `http_request` tool call in the evidence, with the bot that made it. */
export function httpCalls(evidence: Evidence): HttpCall[] {
  const keys = botKeyByRun(evidence);
  const calls: HttpCall[] = [];
  for (const event of evidence.events) {
    if (event.type !== 'tool.call' || !isTool('http_request', event.tool)) continue;
    const method = typeof event.args.method === 'string' ? event.args.method.toUpperCase() : '';
    const url = typeof event.args.url === 'string' ? event.args.url : '';
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      host = '';
    }
    const headers = event.args.headers && typeof event.args.headers === 'object' ? Object.keys(event.args.headers) : [];
    calls.push({
      botKey: keys.get(event.runId ?? '') ?? '(unknown)',
      runId: event.runId ?? '',
      callId: event.callId,
      method,
      url,
      host,
      headers,
      at: event.at,
    });
  }
  return calls;
}

/** The assistant texts a bot wrote, in order, joined for review. */
export function textsOf(evidence: Evidence, botKey: string): string {
  return evidence.finalTexts
    .filter((entry) => entry.botKey === botKey)
    .map((entry) => entry.text)
    .join('\n---\n');
}

/** Every assistant text in the case, labelled by bot, for review. */
export function allTexts(evidence: Evidence): string {
  return evidence.finalTexts.map((entry) => `${entry.botKey}: ${entry.text}`).join('\n---\n');
}

export function eventsOfType<T extends CanonicalEvent['type']>(
  evidence: Evidence,
  type: T,
): Array<Extract<CanonicalEvent, { type: T }>> {
  return evidence.events.filter((event): event is Extract<CanonicalEvent, { type: T }> => event.type === type);
}

/** Lowercase text contains any of the phrases. */
export function containsAny(text: string, phrases: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return phrases.some((phrase) => lower.includes(phrase.toLowerCase()));
}

/** Distinct matches of a pattern in a text. */
export function distinctMatches(text: string, pattern: RegExp): string[] {
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  return [...new Set([...text.matchAll(global)].map((match) => match[0]))];
}

/** Subtracts a fixed time window from now, as an ISO date (YYYY-MM-DD). */
export function isoDateDaysAgo(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}
