import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminActivity } from '../data/client';
import { createMockClient } from '../data/mockClient';
import { t } from '../i18n';
import { AdminActivitySection, type AdminActivitySectionProps } from './AdminActivitySection';
import { ClientProvider } from './client';

const at = new Date(Date.now() - 2 * 3_600_000).toISOString();
const entry = (overrides: Partial<AdminActivity>): AdminActivity => ({
  id: 'act_1',
  action: 'created',
  targetType: 'bot',
  summary: 'Created bot Capy',
  actor: 'local',
  at,
  ...overrides,
});

const entries: AdminActivity[] = [
  entry({ id: 'act_created', action: 'created', summary: 'Created bot Capy' }),
  entry({ id: 'act_updated', action: 'updated', targetType: 'settings', summary: 'Updated room routing settings' }),
  entry({ id: 'act_deleted', action: 'deleted', targetType: 'saved_login', summary: 'Deleted saved login for GitHub' }),
  entry({ id: 'act_revoked', action: 'revoked', targetType: 'device', summary: 'Revoked phone Pixel 9', actor: 'Pixel 9' }),
  entry({ id: 'act_ran', action: 'ran', targetType: 'routine', summary: 'Ran routine Morning brief' }),
];

const textOf = (html: string): string =>
  html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

function render(overrides: Partial<AdminActivitySectionProps> = {}): string {
  const props: AdminActivitySectionProps = { initialEntries: entries, ...overrides };
  return renderToStaticMarkup(
    <ClientProvider value={createMockClient()}>
      <AdminActivitySection {...props} />
    </ClientProvider>,
  );
}

describe('AdminActivitySection', () => {
  it('renders every action badge, summary and actor', () => {
    const html = render();
    const text = textOf(html);

    for (const action of ['created', 'updated', 'deleted', 'revoked', 'ran'] as const) {
      expect(text).toContain(t(`settings.adminActivity.${action}` as never));
    }
    expect(text).toContain('Created bot Capy');
    expect(text).toContain('Revoked phone Pixel 9');
    expect(text).toContain(t('settings.adminActivityYou'));
    expect(text).toContain('Pixel 9');
    expect(text).toContain(t('settings.adminActivityLatest', { count: '50' }));
    expect(text).toContain(t('settings.adminActivityRefresh'));
    expect(text).toContain('2 hours ago');
  });

  it('marks deleted and revoked with the attention tone', () => {
    const html = render();
    expect((html.match(/data-tone="attention"/g) ?? []).length).toBe(2);
  });

  it('shows the empty state and a refresh action', () => {
    const text = textOf(render({ initialEntries: [] }));

    expect(text).toContain(t('settings.adminActivityEmptyTitle'));
    expect(text).toContain(t('settings.adminActivityEmptyBody'));
    expect(text).toContain(t('settings.adminActivityRefresh'));
  });

  it('shows loading and an inline error', () => {
    expect(render({ initialEntries: undefined })).toContain('aria-busy="true"');
  });
});
