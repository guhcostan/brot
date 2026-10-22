import type { SearchHit } from '@brot/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEMO_BOTS } from '../data/fixtures';
import { t } from '../i18n';
import { MessageSearchResults, type MessageSearchResultsProps } from './MessageSearchResults';

const at = '2026-10-19T09:00:00.000Z';

const hit = (index: number, overrides: Partial<SearchHit> = {}): SearchHit => ({
  messageId: `msg_${index}`,
  threadId: 'thread_bot_capy',
  threadTitle: 'Morning plan',
  botId: 'bot_capy',
  botName: 'Capy',
  role: 'assistant',
  snippet: `The Acme renewal is ready for review (${index}).`,
  createdAt: at,
  ...overrides,
});

const noop = () => undefined;

/** Server markup escapes quotes, so compare against the decoded text. */
const textOf = (html: string): string =>
  html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

function render(overrides: Partial<MessageSearchResultsProps> = {}): string {
  const props: MessageSearchResultsProps = {
    hits: [hit(1), hit(2)],
    loading: false,
    error: null,
    bots: DEMO_BOTS,
    onOpenHit: noop,
    ...overrides,
  };
  return renderToStaticMarkup(<MessageSearchResults {...props} />);
}

describe('message search results', () => {
  it('renders the rows with titles, bot names and snippets', () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain(t('sidebar.messages'));
    expect(html.match(/<button/g)?.length ?? 0).toBeGreaterThan(0);
    expect(text).toContain('Morning plan');
    expect(text).toContain('Capy');
    expect(text).toContain('The Acme renewal is ready for review (1).');
    expect(text).toContain('The Acme renewal is ready for review (2).');
    expect(html).toContain('line-clamp-2');
    expect(text).not.toContain(t('sidebar.messagesEmpty'));
  });

  it('shows a loading state while the search is in flight', () => {
    const html = render({ hits: [], loading: true });
    const text = textOf(html);

    expect(text).toContain(t('sidebar.messages'));
    expect(html).toContain('aria-busy="true"');
    expect(text).not.toContain(t('sidebar.messagesEmpty'));
  });

  it('shows the empty and error states', () => {
    expect(textOf(render({ hits: [] }))).toContain(t('sidebar.messagesEmpty'));

    const error = textOf(render({ hits: [], error: '500 boom' }));
    expect(error).toContain(t('sidebar.messagesError', { message: '500 boom' }));
    expect(error).toContain('role="alert"');
  });

  it('caps the list and expands it with show all', () => {
    const many = Array.from({ length: 10 }, (_entry, index) => hit(index));
    const collapsed = textOf(render({ hits: many }));

    expect(collapsed).toContain(t('sidebar.showAllResults', { count: '10' }));
    expect(collapsed).not.toContain('(9).');

    const expanded = textOf(render({ hits: many, initialExpanded: true }));
    expect(expanded).toContain(t('sidebar.showFewerResults'));
    expect(expanded).toContain('(9).');
  });

  it('does not render the expander when every hit fits', () => {
    expect(textOf(render())).not.toContain(t('sidebar.showAllResults', { count: '2' }));
  });
});
