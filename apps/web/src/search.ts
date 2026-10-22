import type { SearchHit } from '@brot/protocol';

/** Characters a snippet keeps from the message. Matches the server's snippet rule. */
export const SEARCH_SNIPPET_LENGTH = 140;
/** Characters kept before the first match when a snippet starts mid-message. */
export const SEARCH_SNIPPET_BEFORE = 60;
/** Marks a side of a snippet that was cut from a longer message. */
export const SEARCH_SNIPPET_ELLIPSIS = '…';
/** Results shown before the "show all" expander. */
export const MESSAGE_SEARCH_VISIBLE = 8;

/**
 * The plain-text snippet for a match: up to 60 characters before the first case-insensitive match and
 * 140 characters in all, whitespace collapsed, with an ellipsis for each side that was cut. The server
 * builds identical snippets; this local copy keeps the mock honest and is never HTML-escaped.
 */
export function buildSearchSnippet(content: string, query: string): string {
  const matchIndex = content.toLowerCase().indexOf(query.toLowerCase());
  let start = matchIndex <= 0 ? 0 : Math.max(0, matchIndex - SEARCH_SNIPPET_BEFORE);
  const end = Math.min(content.length, start + SEARCH_SNIPPET_LENGTH);
  if (end - start < SEARCH_SNIPPET_LENGTH && start > 0) start = Math.max(0, end - SEARCH_SNIPPET_LENGTH);
  const clipped = content.slice(start, end).replace(/\s+/g, ' ').trim();
  const prefix = start > 0 ? SEARCH_SNIPPET_ELLIPSIS : '';
  const suffix = end < content.length ? SEARCH_SNIPPET_ELLIPSIS : '';
  return `${prefix}${clipped}${suffix}`;
}

/** The hits shown before expanding: the first `limit` (8 by default), or all when expanded. */
export function visibleSearchHits(hits: readonly SearchHit[], expanded: boolean, limit = MESSAGE_SEARCH_VISIBLE): SearchHit[] {
  return expanded ? [...hits] : hits.slice(0, limit);
}
