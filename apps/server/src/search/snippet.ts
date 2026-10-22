/** Characters a snippet keeps from the message. */
export const SEARCH_SNIPPET_LENGTH = 140;

/** Characters kept before the first match when a snippet starts mid-message. */
export const SEARCH_SNIPPET_BEFORE = 60;

/** Marks a side of a snippet that was cut from a longer message. */
export const SEARCH_SNIPPET_ELLIPSIS = '…';

/**
 * Builds the plain-text snippet for one search hit: the first case-insensitive match plus up to 60 characters
 * before it, 140 characters in all, with runs of whitespace collapsed to one space. An ellipsis marks each side
 * that was cut. The text is never HTML-escaped: the web UI renders it as text.
 */
export function buildSnippet(content: string, query: string): string {
  const needle = query.toLowerCase();
  const matchIndex = content.toLowerCase().indexOf(needle);
  let start = matchIndex <= 0 ? 0 : Math.max(0, matchIndex - SEARCH_SNIPPET_BEFORE);
  const end = Math.min(content.length, start + SEARCH_SNIPPET_LENGTH);
  if (end - start < SEARCH_SNIPPET_LENGTH && start > 0) start = Math.max(0, end - SEARCH_SNIPPET_LENGTH);
  const clipped = content.slice(start, end).replace(/\s+/g, ' ').trim();
  const prefix = start > 0 ? SEARCH_SNIPPET_ELLIPSIS : '';
  const suffix = end < content.length ? SEARCH_SNIPPET_ELLIPSIS : '';
  return `${prefix}${clipped}${suffix}`;
}
