import type { Bot, Team } from '@brot/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BrowserProfile } from '../data/client';
import { t } from '../i18n';
import { BotDialog, type BotDialogProps } from './BotDialog';

const at = '2026-10-19T09:00:00.000Z';

const bot: Bot = {
  id: 'bot_1',
  name: 'Capy',
  job: 'Chief of Staff',
  instructions: '',
  engine: 'dsh',
  model: 'opencode-go/deepseek-v4.1-flash',
  computer: 'sandbox',
  egress: { mode: 'deny', allow: [] },
  pinned: false,
  archived: false,
  createdAt: at,
  updatedAt: at,
};

const noop = async () => undefined;

function render(overrides: Partial<BotDialogProps> = {}): string {
  const props: BotDialogProps = {
    open: true,
    teams: [],
    loadProviders: async () => [],
    onCreate: noop,
    onUpdate: noop,
    onDelete: noop,
    onOpenSettings: () => undefined,
    browserStatus: async () => ({ state: 'stopped', profile: { kind: 'own' } }),
    startBrowserLogin: async () => ({ state: 'login', profile: { kind: 'own' } }),
    closeBrowser: noop,
    loadBrowserProfiles: async () => [],
    onClose: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(<BotDialog {...props} />);
}

/** Server markup escapes quotes, so compare against the decoded text. */
const textOf = (html: string): string => html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"');

const TOGGLE_OFF = '<input type="checkbox" class="room-check mt-0.5"/>';
const TOGGLE_ON = '<input type="checkbox" class="room-check mt-0.5" checked=""/>';

describe('BotDialog host browser', () => {
  it('offers the host browser as an opt-in for a new bot', () => {
    const html = render();
    const text = textOf(html);
    expect(text).toContain(t('botForm.browserOnHost'));
    expect(text).toContain(t('botForm.browserHint'));
    expect(html).toContain(TOGGLE_OFF);
    expect(html).not.toContain(TOGGLE_ON);
  });

  it('hides the opt-in for a sandbox bot with a desktop and says why', () => {
    const text = textOf(render({ bot: { ...bot, desktop: true } }));
    expect(text).toContain(t('botForm.browserDesktop'));
    expect(text).not.toContain(t('botForm.browserOnHost'));
    expect(text).not.toContain(t('botForm.browserHint'));
  });

  it('shows the state and the sign-in action for a bot that already has a browser', () => {
    const html = render({ bot: { ...bot, computer: 'none', browser: true } });
    const text = textOf(html);
    expect(text).toContain(t('botForm.browserOnHost'));
    expect(html).toContain(TOGGLE_ON);
    expect(text).toContain(t('botForm.browserState.checking'));
    expect(text).toContain(t('botForm.browserLogin'));
    expect(text).not.toContain('>Close<');
  });

  it('keeps the opt-in off for an existing bot without a browser', () => {
    const html = render({ bot });
    const text = textOf(html);
    expect(text).toContain(t('botForm.browserOnHost'));
    expect(html).toContain(TOGGLE_OFF);
    expect(text).not.toContain(t('botForm.browserState.checking'));
  });
});

const team: Team = { id: 'team_growth', name: 'Growth', instructions: '', createdAt: at, updatedAt: at };

describe('BotDialog team picker', () => {
  it('offers no team plus every team for a new bot', () => {
    const html = render({ teams: [team] });
    expect(html).toContain(t('botForm.team'));
    expect(html).toContain(t('botForm.noTeam'));
    expect(html).toContain('<option value="team_growth">Growth</option>');
  });

  it('prefills the team a bot already belongs to', () => {
    const html = render({ bot: { ...bot, teamId: team.id }, teams: [team] });
    expect(html).toMatch(/<option value="team_growth" selected="">Growth<\/option>/);
  });
});

describe('BotDialog notifications toggle', () => {
  /** The notifications input, found by its name attribute so the browser test constants stay valid. */
  const notificationToggle = (html: string): string => html.match(/<input[^>]*name="notifications"[^>]*>/)?.[0] ?? '';

  it('offers run notifications on by default, noting that approvals and failures always notify', () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain(t('botForm.notifications'));
    expect(text).toContain(t('botForm.notificationsHint'));
    expect(notificationToggle(html)).toContain('checked=""');
  });

  it('unchecks the toggle for a bot that turned run notifications off', () => {
    const html = render({ bot: { ...bot, notifications: false } });

    expect(textOf(html)).toContain(t('botForm.notifications'));
    expect(notificationToggle(html)).not.toContain('checked=""');
  });
});

const sharedProfiles: BrowserProfile[] = [
  { id: 'profile_shared', name: 'Shared accounts', createdAt: at, updatedAt: at },
  { id: 'profile_promo', name: 'Promoções', createdAt: at, updatedAt: at },
];

describe('BotDialog browser profiles', () => {
  /** A host-browser bot; the profile field lives on the bot beyond the current protocol type. */
  const withBrowser = (extra: Partial<Bot> = {}): Bot =>
    ({ ...bot, computer: 'none', browser: true, ...extra }) as Bot;

  it('offers Own plus every shared profile when the host browser is on', () => {
    const html = render({ bot: withBrowser(), initialBrowserProfiles: sharedProfiles });
    const text = textOf(html);

    expect(text).toContain(t('botForm.browserProfile'));
    expect(text).toContain(t('botForm.browserProfileHint'));
    expect(html).toMatch(/<option value=""[^>]*>Own profile \(default\)<\/option>/);
    expect(html).toContain('<option value="profile_shared">Shared accounts</option>');
    expect(html).toContain('<option value="profile_promo">Promoções</option>');
  });

  it('preselects the bot shared profile and names it in the live status line', () => {
    const html = render({
      bot: withBrowser({ browserProfileId: 'profile_shared' } as Partial<Bot>),
      initialBrowserProfiles: sharedProfiles,
      initialBrowserStatus: { state: 'running', profile: { kind: 'shared', id: 'profile_shared', name: 'Shared accounts' } },
    });
    const text = textOf(html);

    expect(html).toContain('<option value="profile_shared" selected="">Shared accounts</option>');
    expect(text).toContain(
      `${t('botForm.browserState.running')} · ${t('botForm.browserProfileSharedStatus', { name: 'Shared accounts' })}`,
    );
  });

  it('names the own profile in the status line', () => {
    const text = textOf(
      render({ bot: withBrowser(), initialBrowserStatus: { state: 'stopped', profile: { kind: 'own' } } }),
    );

    expect(text).toContain(`${t('botForm.browserState.stopped')} · ${t('botForm.browserProfileOwnStatus')}`);
  });

  it('keeps the picker out of a desktop sandbox bot', () => {
    const html = render({ bot: { ...bot, desktop: true } });

    expect(textOf(html)).toContain(t('botForm.browserDesktop'));
    expect(textOf(html)).not.toContain(t('botForm.browserProfile'));
  });
});
