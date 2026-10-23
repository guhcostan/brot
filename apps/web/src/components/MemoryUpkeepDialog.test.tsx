import type { Memory } from '@brot/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../data/mockClient';
import { t } from '../i18n';
import type { MemoryUpkeepReport } from '@brot/protocol';
import { ClientProvider } from './client';
import { MemoryUpkeepDialog, type MemoryUpkeepDialogProps } from './MemoryUpkeepDialog';

const at = '2026-10-19T09:00:00.000Z';
const memory = (id: string, content: string, kind: Memory['kind'] = 'fact'): Memory => ({
  id,
  botId: 'bot_1',
  scope: 'bot',
  kind,
  content,
  createdAt: at,
  updatedAt: at,
});

const report: MemoryUpkeepReport = {
  scope: 'bot',
  botId: 'bot_1',
  total: 5,
  removable: 3,
  groups: [
    { kind: 'fact', keep: memory('mem_3', 'Likes tea.'), remove: [memory('mem_1', 'Likes tea.'), memory('mem_2', 'Likes tea!')] },
    { kind: 'preference', keep: memory('mem_5', 'Prefers email.'), remove: [memory('mem_4', 'Prefers e-mail.')] },
  ],
};

const textOf = (html: string): string =>
  html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

function render(overrides: Partial<MemoryUpkeepDialogProps> = {}): string {
  const props: MemoryUpkeepDialogProps = {
    open: true,
    scope: 'bot',
    botId: 'bot_1',
    botName: 'Capy',
    onClose: () => undefined,
    onChanged: () => undefined,
    initialReport: report,
    ...overrides,
  };
  return renderToStaticMarkup(
    <ClientProvider value={createMockClient()}>
      <MemoryUpkeepDialog {...props} />
    </ClientProvider>,
  );
}

const primaryButton = (html: string): string => html.match(/<button[^>]*data-variant="primary"[^>]*>/)?.[0] ?? '';

describe('MemoryUpkeepDialog', () => {
  it('shows the summary and each duplicate group with the kept note and removals', () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain(t('memoryUpkeep.title'));
    expect(text).toContain(t('memoryUpkeep.descriptionBot', { name: 'Capy' }));
    expect(text).toContain(t('memoryUpkeep.summary', { removable: '3' }));
    expect(text).toContain('Likes tea.');
    expect(text).toContain('Prefers email.');
    expect(text).toContain(t('memory.kind.fact'));
    expect(text).toContain(t('memory.kind.preference'));
    expect(text).toContain(t('memoryUpkeep.duplicates', { count: '2' }));
    expect(text).toContain(t('memoryUpkeep.duplicates', { count: '1' }));
    expect(text).toContain(t('memoryUpkeep.keptLabel'));
    expect(text).toContain(t('memoryUpkeep.removedLabel'));
    expect(primaryButton(html)).not.toContain('disabled=""');
  });

  it('describes workspace upkeep and starts clean', () => {
    const empty: MemoryUpkeepReport = { scope: 'workspace', total: 2, removable: 0, groups: [] };
    const html = render({ scope: 'workspace', botId: undefined, botName: undefined, initialReport: empty });
    const text = textOf(html);

    expect(text).toContain(t('memoryUpkeep.descriptionWorkspace'));
    expect(text).toContain(t('memoryUpkeep.emptyTitle'));
    expect(text).toContain(t('memoryUpkeep.emptyBody'));
    expect(primaryButton(html)).toContain('disabled=""');
  });

  it('shows a result line after applying and a loading skeleton before the report', () => {
    expect(textOf(render({ initialResult: t('memoryUpkeep.result', { count: '3' }) }))).toContain(
      t('memoryUpkeep.result', { count: '3' }),
    );

    expect(render({ initialReport: undefined })).toContain('aria-busy="true"');
  });

  it('shows an inline error slot', () => {
    const html = render({ initialError: t('memoryUpkeep.loadFailed') });

    expect(html).toContain('role="alert"');
    expect(textOf(html)).toContain(t('memoryUpkeep.loadFailed'));
  });
});
