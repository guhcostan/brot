import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../data/mockClient';
import { DEMO_BOTS, DEMO_BROWSER_PROFILES, DEMO_MCP_SERVERS, DEMO_TEAMS } from '../data/fixtures';
import { TEAM_PACKAGE_FORMAT, TEAM_PACKAGE_VERSION, formatTeamPackage, type TeamPackage } from '@brot/protocol';
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
    initialMcpServers: DEMO_MCP_SERVERS,
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

describe('settings MCP servers', () => {
  it('lists the servers with their transport, endpoint and enable switch', () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain(t('settings.mcpServers'));
    expect(text).toContain(t('settings.mcpServersBody'));
    expect(text).toContain('filesystem');
    expect(text).toContain('search');
    expect(text).toContain(t('settings.mcpBadgeStdio'));
    expect(text).toContain(t('settings.mcpBadgeHttp'));
    expect(text).toContain('npx -y @modelcontextprotocol/server-filesystem /data');
    expect(text).toContain('https://mcp.example.com/search');
    expect(text).toContain(t('settings.addMcpServer'));
    expect(text).toContain(t('settings.mcpTest'));
    expect(text).toContain(t('settings.mcpEditNamed', { name: 'filesystem' }));
    expect(text).toContain(t('settings.mcpDeleteNamed', { name: 'search' }));
  });

  it('shows an empty line and the add action when no server exists', () => {
    const text = textOf(render({ initialMcpServers: [] }));

    expect(text).toContain(t('settings.mcpServersEmpty'));
    expect(text).toContain(t('settings.addMcpServer'));
  });
});

const packageFixture: TeamPackage = {
  format: TEAM_PACKAGE_FORMAT,
  version: TEAM_PACKAGE_VERSION,
  exportedAt: '2026-10-19T09:00:00.000Z',
  teams: [{ key: 't1', name: 'Growth', instructions: 'Win Acme.', chief: 'b1' }],
  bots: [
    { key: 'b1', name: 'Capy', job: 'Chief', instructions: 'Lead.', team: 't1' },
    { key: 'b2', name: 'Onça', job: 'Fixer', instructions: 'Fix.' },
  ],
  rooms: [{ title: 'Acme renewal', lead: 'b1', members: ['b1', 'b2'] }],
  routines: [{ bot: 'b1', name: 'Morning brief', instruction: 'Brief me.', cron: '0 8 * * 1-5', enabled: true }],
  skills: [{ name: 'Customer follow-up', description: 'Write a follow-up.', body: '# Follow-up' }],
};

describe('settings team packages', () => {
  it('offers an export scope and the download action', () => {
    const html = render({ initialTeams: DEMO_TEAMS });
    const text = textOf(html);

    expect(text).toContain(t('settings.teamPackages'));
    expect(text).toContain(t('settings.teamPackagesBody'));
    expect(text).toContain(t('settings.teamPackageExport'));
    expect(text).toContain(t('settings.teamPackageScopeAll'));
    expect(text).toContain('>Growth<');
    expect(text).toContain('>Content<');
    expect(text).toContain(t('settings.teamPackageDownload'));
  });

  it('previews a valid package with counts, names and the import warnings', () => {
    const html = render({
      initialTeams: DEMO_TEAMS,
      initialTeamPackageContent: formatTeamPackage(packageFixture),
    });
    const text = textOf(html);

    expect(text).toContain(t('settings.teamPackageCounts', { teams: '1', bots: '2', rooms: '1', routines: '1', skills: '1' }));
    expect(text).toContain('Growth');
    expect(text).toContain('Capy');
    expect(text).toContain('Acme renewal');
    expect(text).toContain('Morning brief');
    expect(text).toContain('Customer follow-up');
    expect(text).toContain(t('settings.teamPackageWarningBots'));
    expect(text).toContain(t('settings.teamPackageWarningRoutines'));
    const importButton = html.match(/<button[^>]*>[^<]*Import package<\/button>/)?.[0] ?? '';
    expect(importButton).not.toContain('disabled=""');
  });

  it('keeps import disabled until a package parses', () => {
    const html = render({ initialTeams: DEMO_TEAMS });
    const text = textOf(html);

    expect(text).toContain(t('settings.teamPackagePreviewEmpty'));
    expect(text).toContain(t('settings.teamPackageChooseFile'));
    const importButton = html.match(/<button[^>]*>[^<]*Import package<\/button>/)?.[0] ?? '';
    expect(importButton).toContain('disabled=""');
  });
});
