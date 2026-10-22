import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../data/mockClient';
import { DEMO_BOTS, DEMO_NOTIFICATIONS } from '../data/fixtures';
import { t } from '../i18n';
import { ClientProvider } from './client';
import { NotificationsView, type NotificationsViewProps } from './NotificationsView';

const noop = () => undefined;

/** Server markup escapes quotes, so compare against the decoded text. */
const textOf = (html: string): string => html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"');

function render(overrides: Partial<NotificationsViewProps> = {}): string {
  const props: NotificationsViewProps = {
    bots: DEMO_BOTS,
    onOpenBots: noop,
    onOpenNotification: noop,
    onInboxChanged: noop,
    initialNotifications: DEMO_NOTIFICATIONS,
    ...overrides,
  };
  return renderToStaticMarkup(
    <ClientProvider value={createMockClient()}>
      <NotificationsView {...props} />
    </ClientProvider>,
  );
}

describe('notifications page', () => {
  it('renders the inbox rows with bot, kind, title, body and unread marks', () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain(t('notifications.title'));
    expect(text).toContain(t('notifications.summary', { unread: '3', count: '4' }));
    expect(text).toContain(t('notifications.markAll'));
    expect(text).toContain(t('notifications.refresh'));

    expect(text).toContain('Tuca needs your OK');
    expect(text).toContain('Onça stopped on the export fix');
    expect(text).toContain('Morning brief is ready');
    expect(text).toContain('Morning brief did not run');
    expect(text).toContain(t('notifications.kind.approval'));
    expect(text).toContain(t('notifications.kind.failed'));
    expect(text).toContain(t('notifications.kind.finished'));
    expect(text).toContain(t('notifications.kind.routine_failed'));
    expect(text).toContain('Tuca');
    expect(text).toContain('Capy');
    expect(html).toContain('data-species="capivara"');
    expect(html).toContain('data-tone="attention"');
    expect(html).toContain(`aria-label="${t('notifications.delete')}"`);

    // Three unread rows carry the unread dot; the read one does not.
    expect(html.match(new RegExp(`aria-label="${t('notifications.unread')}"`, 'g'))).toHaveLength(3);
  });

  it('explains what lands in the inbox when it is empty', () => {
    const text = textOf(render({ initialNotifications: [] }));

    expect(text).toContain(t('notifications.emptyTitle'));
    expect(text).toContain(t('notifications.emptyBody'));
    expect(text).not.toContain('Tuca needs your OK');
  });
});
