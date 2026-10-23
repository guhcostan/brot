import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../data/mockClient';
import { t } from '../i18n';
import type { MemoryJournalEntry } from '@brot/protocol';
import { ClientProvider } from './client';
import { MemoryJournalDialog, type MemoryJournalDialogProps } from './MemoryJournalDialog';

const at = '2026-10-19T09:00:00.000Z';

const entry = (overrides: Partial<MemoryJournalEntry>): MemoryJournalEntry => ({
  id: 'j_1',
  memoryId: 'mem_1',
  botId: 'bot_1',
  scope: 'bot',
  kind: 'fact',
  action: 'created',
  contentAfter: 'Acme renews in June.',
  at,
  ...overrides,
});

const entries: MemoryJournalEntry[] = [
  entry({ id: 'j_created', action: 'created', contentAfter: 'Acme renews in June.' }),
  entry({
    id: 'j_updated',
    action: 'updated',
    kind: 'preference',
    contentBefore: 'Prefers email before 9am.',
    contentAfter: 'Prefers email before 10am.',
  }),
  entry({ id: 'j_deleted', action: 'deleted', contentBefore: 'Old supplier note.', contentAfter: undefined }),
];

const textOf = (html: string): string =>
  html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

function render(overrides: Partial<MemoryJournalDialogProps> = {}): string {
  const props: MemoryJournalDialogProps = {
    open: true,
    scope: 'bot',
    botId: 'bot_1',
    botName: 'Capy',
    onClose: () => undefined,
    onChanged: () => undefined,
    initialEntries: entries,
    ...overrides,
  };
  return renderToStaticMarkup(
    <ClientProvider value={createMockClient()}>
      <MemoryJournalDialog {...props} />
    </ClientProvider>,
  );
}

describe('MemoryJournalDialog', () => {
  it('lists the three actions with kind, content and relative time', () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain(t('memoryJournal.title'));
    expect(text).toContain(t('memoryJournal.descriptionBot', { name: 'Capy' }));
    expect(text).toContain(t('memoryJournal.action.created'));
    expect(text).toContain(t('memoryJournal.action.updated'));
    expect(text).toContain(t('memoryJournal.action.deleted'));
    expect(text).toContain(t('memory.kind.fact'));
    expect(text).toContain(t('memory.kind.preference'));
    expect(text).toContain('Acme renews in June.');
    expect(text).toContain('Old supplier note.');
    expect(html.match(new RegExp(`>${t('memoryJournal.undo')}<`, 'g'))).toHaveLength(3);
    expect(text).toContain(t('memoryJournal.limit', { count: '50' }));
  });

  it('shows before and after for an updated entry', () => {
    const text = textOf(render());

    expect(text).toContain('Before:');
    expect(text).toContain('Prefers email before 9am.');
    expect(text).toContain('After:');
    expect(text).toContain('Prefers email before 10am.');
  });

  it('marks deleted entries with the attention tone', () => {
    const html = render();
    expect(html).toContain('data-tone="attention"');
  });

  it('describes workspace history', () => {
    const text = textOf(render({ scope: 'workspace', botId: undefined, botName: undefined }));

    expect(text).toContain(t('memoryJournal.descriptionWorkspace'));
  });

  it('shows the empty state', () => {
    const text = textOf(render({ initialEntries: [] }));

    expect(text).toContain(t('memoryJournal.emptyTitle'));
    expect(text).toContain(t('memoryJournal.emptyBody'));
  });

  it('shows loading and an error/conflict slot', () => {
    const loading = render({ initialEntries: undefined });
    expect(loading).toContain('aria-busy="true"');

    const conflict = textOf(render({ initialEntries: [], initialConflict: t('memoryJournal.conflict') }));
    expect(conflict).toContain(t('memoryJournal.conflict'));
    expect(render({ initialEntries: [], initialError: t('memoryJournal.loadFailed') })).toContain('role="alert"');
  });
});
