import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../data/mockClient';
import { DEMO_BOTS, DEMO_BROWSER_PROFILES } from '../data/fixtures';
import { t } from '../i18n';
import { ClientProvider } from './client';
import { SettingsView, type SettingsViewProps } from './SettingsView';
import { TeamProvider, type TeamContextValue } from './team';

const noop = () => undefined;

const profileOf: Record<string, string> = { bot_tuca: 'profile_shared', bot_mico: 'profile_promo' };
const demoBots = DEMO_BOTS.map((bot) =>
  profileOf[bot.id] === undefined ? bot : ({ ...bot, browserProfileId: profileOf[bot.id] } as (typeof DEMO_BOTS)[number]),
);
const botsRecord = Object.fromEntries(demoBots.map((bot) => [bot.id, bot]));

const team = (bots = botsRecord): TeamContextValue => ({
  bots,
  rooms: [],
  tasks: {},
  waitingBots: new Set(),
  openBot: noop,
  openRoom: noop,
  openTask: noop,
});

/** Server markup escapes quotes, so compare against the decoded text. */
const textOf = (html: string): string => html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"');

function render(overrides: Partial<SettingsViewProps> = {}, bots = botsRecord): string {
  const props: SettingsViewProps = {
    locale: 'en',
    onLocaleChange: noop,
    theme: 'system',
    onThemeChange: noop,
    onOpenBots: noop,
    initialBrowserProfiles: DEMO_BROWSER_PROFILES,
    ...overrides,
  };
  return renderToStaticMarkup(
    <TeamProvider value={team(bots)}>
      <ClientProvider value={createMockClient()}>
        <SettingsView {...props} />
      </ClientProvider>
    </TeamProvider>,
  );
}

describe('settings browser profiles', () => {
  it('lists the shared profiles with how many bots use them', () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain(t('settings.browserProfiles'));
    expect(text).toContain(t('settings.browserProfilesBody'));
    expect(text).toContain('Shared accounts');
    expect(text).toContain('Promoções');
    expect(text).toContain(t('settings.browserProfileBotCount', { count: '1' }));
    expect(text).toContain(t('settings.newBrowserProfile'));
    expect(text).toContain(t('settings.browserProfileRename', { name: 'Shared accounts' }));
    expect(text).toContain(t('settings.browserProfileDeleteNamed', { name: 'Promoções' }));
    expect(text).toContain('2026');
  });

  it('says no bots use a profile yet when nobody is bound to it', () => {
    const text = textOf(render({}, {}));

    expect(text).toContain(t('settings.browserProfileUnused'));
  });

  it('shows an empty line and the create action when no profile exists', () => {
    const text = textOf(render({ initialBrowserProfiles: [] }));

    expect(text).toContain(t('settings.browserProfilesEmpty'));
    expect(text).toContain(t('settings.newBrowserProfile'));
  });
});
