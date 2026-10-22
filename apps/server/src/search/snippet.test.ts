import { describe, expect, it } from 'vitest';
import { SEARCH_SNIPPET_BEFORE, SEARCH_SNIPPET_ELLIPSIS, SEARCH_SNIPPET_LENGTH, buildSnippet } from './snippet';

describe('buildSnippet', () => {
  it('returns a short message whole, with whitespace collapsed and no ellipses', () => {
    expect(buildSnippet('Deploy the   release\ntoday', 'release')).toBe('Deploy the release today');
  });

  it('centres a cut snippet on the first match, with an ellipsis on each cut side', () => {
    const content = `${'a'.repeat(100)}NEEDLE${'b'.repeat(100)}`;
    const snippet = buildSnippet(content, 'needle');
    expect(snippet.startsWith(SEARCH_SNIPPET_ELLIPSIS)).toBe(true);
    expect(snippet.endsWith(SEARCH_SNIPPET_ELLIPSIS)).toBe(true);
    expect(snippet).toContain('NEEDLE');
    expect(snippet.length).toBe(SEARCH_SNIPPET_LENGTH + 2);
    expect(snippet.slice(1, -1)).toContain('a'.repeat(SEARCH_SNIPPET_BEFORE));
  });

  it('keeps a match near the end visible', () => {
    const snippet = buildSnippet(`${'a'.repeat(200)}needle`, 'needle');
    expect(snippet.startsWith(SEARCH_SNIPPET_ELLIPSIS)).toBe(true);
    expect(snippet.endsWith(SEARCH_SNIPPET_ELLIPSIS)).toBe(false);
    expect(snippet).toContain('needle');
    expect(snippet.length).toBe(SEARCH_SNIPPET_LENGTH + 1);
  });

  it('does not prefix a snippet that starts with the match', () => {
    const snippet = buildSnippet(`needle${'b'.repeat(200)}`, 'needle');
    expect(snippet.startsWith(SEARCH_SNIPPET_ELLIPSIS)).toBe(false);
    expect(snippet.startsWith('needle')).toBe(true);
    expect(snippet.endsWith(SEARCH_SNIPPET_ELLIPSIS)).toBe(true);
  });

  it('matches case-insensitively and keeps the original casing', () => {
    const snippet = buildSnippet('The RELEASE is out', 'release');
    expect(snippet).toBe('The RELEASE is out');
  });

  it('never escapes HTML', () => {
    expect(buildSnippet('<b>needle</b>', 'needle')).toBe('<b>needle</b>');
  });

  it('falls back to the message start when the query is not found', () => {
    const snippet = buildSnippet('x'.repeat(200), 'nowhere');
    expect(snippet.startsWith(SEARCH_SNIPPET_ELLIPSIS)).toBe(false);
    expect(snippet.endsWith(SEARCH_SNIPPET_ELLIPSIS)).toBe(true);
    expect(snippet.length).toBe(SEARCH_SNIPPET_LENGTH + 1);
    expect(snippet.startsWith('x'.repeat(50))).toBe(true);
  });

  it('returns an empty string for empty content', () => {
    expect(buildSnippet('', 'x')).toBe('');
  });
});
