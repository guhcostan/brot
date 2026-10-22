import type { SearchHit } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { buildSearchSnippet, MESSAGE_SEARCH_VISIBLE, SEARCH_SNIPPET_BEFORE, SEARCH_SNIPPET_ELLIPSIS, SEARCH_SNIPPET_LENGTH, visibleSearchHits } from './search';

const hit = (id: string): SearchHit => ({
  messageId: id,
  threadId: 'thread_1',
  threadTitle: 'Morning',
  role: 'assistant',
  snippet: 'text',
  createdAt: '2026-10-19T09:00:00.000Z',
});

describe('buildSearchSnippet', () => {
  it('returns the whole short message, collapsed', () => {
    expect(buildSearchSnippet('The Acme renewal\n  is ready.', 'acme')).toBe('The Acme renewal is ready.');
  });

  it('keeps at most the snippet length with an ellipsis on the cut side', () => {
    const content = `${'a'.repeat(500)}needle${'b'.repeat(500)}`;
    const snippet = buildSearchSnippet(content, 'needle');
    expect(snippet.startsWith(SEARCH_SNIPPET_ELLIPSIS)).toBe(true);
    expect(snippet.endsWith(SEARCH_SNIPPET_ELLIPSIS)).toBe(true);
    expect(snippet.replaceAll(SEARCH_SNIPPET_ELLIPSIS, '').length).toBeLessThanOrEqual(SEARCH_SNIPPET_LENGTH);
    expect(snippet).toContain('needle');
  });

  it('starts before the match when it appears late in the message', () => {
    const content = `${'x'.repeat(200)} ${'y'.repeat(SEARCH_SNIPPET_BEFORE)} needle`;
    const snippet = buildSearchSnippet(content, 'needle');
    expect(snippet.startsWith(SEARCH_SNIPPET_ELLIPSIS)).toBe(true);
    expect(snippet).toContain('needle');
  });

  it('is case insensitive and tolerates a missing match', () => {
    expect(buildSearchSnippet('ACME renewal', 'acme')).toBe('ACME renewal');
    expect(buildSearchSnippet('nothing here', 'acme')).toBe('nothing here');
  });
});

describe('visibleSearchHits', () => {
  it('caps the collapsed list and shows every hit when expanded', () => {
    const hits = Array.from({ length: 10 }, (_entry, index) => hit(`m${index}`));
    expect(visibleSearchHits(hits, false)).toHaveLength(MESSAGE_SEARCH_VISIBLE);
    expect(visibleSearchHits(hits, false)[0]?.messageId).toBe('m0');
    expect(visibleSearchHits(hits, true)).toHaveLength(10);
    expect(visibleSearchHits(hits.slice(0, 3), false)).toHaveLength(3);
    expect(visibleSearchHits(hits, false, 2)).toHaveLength(2);
  });
});
