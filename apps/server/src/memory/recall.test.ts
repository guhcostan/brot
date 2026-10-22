import type { Memory } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { RECALL_MAX_CHARS, RECALL_MAX_ITEMS, selectForPrompt } from './recall';

const NOW = new Date('2026-10-22T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

let sequence = 0;

function memory(content: string, createdAt: string, overrides: Partial<Memory> = {}): Memory {
  sequence += 1;
  return { id: `mem_${sequence}`, botId: 'bot_1', scope: 'bot', kind: 'fact', content, createdAt, updatedAt: createdAt, ...overrides };
}

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

function ids(memories: readonly Memory[]): string[] {
  return memories.map((item) => item.id);
}

describe('selectForPrompt', () => {
  it('puts a relevant memory before a newer unrelated one', () => {
    const relevant = memory('Prefers green tea in the morning', daysAgo(30));
    const newer = memory('Owns a red bicycle', daysAgo(1));

    const selected = selectForPrompt([relevant, newer], 'Recommend a tea', { now: NOW });

    expect(ids(selected)).toEqual([relevant.id, newer.id]);
  });

  it('matches regardless of accent and case', () => {
    const portuguese = memory('Informação do cliente: plano Pro', daysAgo(20));
    const unrelated = memory('Gosta de corridas', daysAgo(1));

    const selected = selectForPrompt([unrelated, portuguese], 'INFORMAÇÃO DO CLIENTE', { now: NOW });

    expect(ids(selected)).toEqual([portuguese.id, unrelated.id]);
  });

  it('ignores stopwords, falling back to the newest memories', () => {
    const old = memory('Nota sobre o cliente', daysAgo(10));
    const recent = memory('Outra nota', daysAgo(2));

    const selected = selectForPrompt([old, recent], 'o que é para o the and of', { now: NOW });

    expect(ids(selected)).toEqual([recent.id, old.id]);
  });

  it('falls back to the newest memories when the query is empty', () => {
    const oldest = memory('alpha fact', daysAgo(3));
    const middle = memory('beta fact', daysAgo(2));
    const newest = memory('gamma fact', daysAgo(1));

    expect(ids(selectForPrompt([oldest, middle, newest], '', { now: NOW }))).toEqual([
      newest.id,
      middle.id,
      oldest.id,
    ]);
  });

  it('never returns more than maxItems, and ranks matches before the rest', () => {
    const relevant = memory('The launch code is 4321', daysAgo(90));
    const fillers = Array.from({ length: 20 }, (_, index) => memory(`Stored fact number ${index}`, daysAgo(index)));
    const selected = selectForPrompt([...fillers, relevant], 'what is the launch code', {
      maxItems: 5,
      now: NOW,
    });

    expect(selected).toHaveLength(5);
    expect(selected[0]?.id).toBe(relevant.id);
  });

  it('never lets the recalled contents exceed maxChars, and skips one that would', () => {
    const huge = memory('z'.repeat(50), daysAgo(0));
    const small = memory('tiny fact', daysAgo(1));

    const selected = selectForPrompt([huge, small], '', { maxChars: 20, now: NOW });

    expect(ids(selected)).toEqual([small.id]);
    expect(selected.reduce((total, item) => total + item.content.length, 0)).toBeLessThanOrEqual(20);
  });

  it('keeps more relevant memories ahead of unrelated ones while there is room', () => {
    const olderRelevant = memory('Prefers green tea', daysAgo(30));
    const newerRelevant = memory('Keeps tea in the desk drawer', daysAgo(20));
    const fillers = Array.from({ length: 10 }, (_, index) => memory(`Bicycle part ${index}`, daysAgo(index)));

    const selected = selectForPrompt([...fillers, olderRelevant, newerRelevant], 'tea', { now: NOW });

    expect(ids(selected).slice(0, 2)).toEqual([newerRelevant.id, olderRelevant.id]);
    expect(selected).toHaveLength(12);
  });

  it('orders equally relevant memories newest first', () => {
    const oldest = memory('stored fact one', daysAgo(30));
    const middle = memory('stored fact two', daysAgo(10));
    const newest = memory('stored fact three', daysAgo(1));

    expect(ids(selectForPrompt([oldest, middle, newest], 'stored fact', { now: NOW }))).toEqual([
      newest.id,
      middle.id,
      oldest.id,
    ]);
  });

  it('applies the 12-item and 6000-character defaults', () => {
    const many = Array.from({ length: 15 }, (_, index) => memory('x'.repeat(1000), daysAgo(index)));
    const selected = selectForPrompt(many, '', { now: NOW });

    expect(selected).toHaveLength(6);
    expect(selected.reduce((total, item) => total + item.content.length, 0)).toBe(RECALL_MAX_CHARS);

    const listed = selectForPrompt(
      Array.from({ length: 20 }, (_, index) => memory(`fact ${index}`, daysAgo(index))),
      '',
      { now: NOW },
    );
    expect(listed).toHaveLength(RECALL_MAX_ITEMS);
  });

  it('is deterministic for the same memories, query and clock', () => {
    const memories = [
      memory('Prefers green tea', daysAgo(3)),
      memory('Owns a red bicycle', daysAgo(2)),
      memory('Tea is kept in the kitchen', daysAgo(1)),
    ];
    const first = selectForPrompt(memories, 'tea kitchen', { now: NOW });
    const second = selectForPrompt(memories, 'tea kitchen', { now: NOW });

    expect(ids(first)).toEqual(ids(second));
  });
});
