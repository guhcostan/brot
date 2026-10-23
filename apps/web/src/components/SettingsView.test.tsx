import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../data/mockClient';
import { DEMO_BOTS, DEMO_BOT_PRESETS, DEMO_BROWSER_PROFILES, DEMO_DECISIONS, DEMO_MCP_SERVERS, DEMO_SAVED_LOGINS, DEMO_TEAMS, DEMO_WORKSPACE_MEMORIES } from '../data/fixtures';
import { DEMO_PROVIDERS } from '../data/mockClient';
import { TEAM_PACKAGE_FORMAT, TEAM_PACKAGE_VERSION, formatTeamPackage, type TeamPackage } from '@brot/protocol';
import type { VoiceInfo } from '../voice';
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
    initialSavedLogins: DEMO_SAVED_LOGINS,
    initialWorkspaceMemories: DEMO_WORKSPACE_MEMORIES,
    initialBotPresets: DEMO_BOT_PRESETS,
    initialDecisions: DEMO_DECISIONS,
    initialAdminActivity: [],
    initialProviders: DEMO_PROVIDERS,
    initialRoomDecider: {},
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

describe('settings saved logins', () => {
  it('lists logins with host, label and the TOTP badge', () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain(t('settings.savedLogins'));
    expect(text).toContain(t('settings.savedLoginsBody'));
    expect(text).toContain('GitHub');
    expect(text).toContain('X/Twitter');
    expect(text).toContain('github.com');
    expect(text).toContain('x.com');
    expect(text).toContain('Personal account');
    expect(text).toContain('Work account');
    expect(text).toContain(t('settings.savedLoginTotpBadge'));
    expect(text).toContain(t('settings.savedLoginNew'));
    expect(text).toContain(t('settings.savedLoginEditNamed', { name: 'GitHub' }));
    expect(text).toContain(t('settings.savedLoginDeleteNamed', { name: 'X/Twitter' }));
  });

  it('shows an empty line and the new-login action when none exist', () => {
    const text = textOf(render({ initialSavedLogins: [] }));

    expect(text).toContain(t('settings.savedLoginsEmpty'));
    expect(text).toContain(t('settings.savedLoginNew'));
  });
});

const voiceSystem: VoiceInfo = {
  settings: { provider: 'system', voice: 'Samantha', secretName: 'tts', updatedAt: '2026-10-19T09:00:00.000Z' },
  available: true,
};

const voiceCompatible: VoiceInfo = {
  settings: {
    provider: 'openai-compatible',
    voice: 'alloy',
    baseUrl: 'https://api.example.com/v1',
    model: 'tts-1',
    secretName: 'voice_key',
    updatedAt: '2026-10-19T09:00:00.000Z',
  },
  available: false,
  reason: 'The speech key is missing.',
};

describe('settings voice', () => {
  it('renders the voice section with providers, availability and the test action', () => {
    const text = textOf(render({ initialVoice: voiceSystem, initialSecretNames: [] }));

    expect(text).toContain(t('settings.voice'));
    expect(text).toContain(t('settings.voiceBody'));
    expect(text).toContain(t('settings.voiceProviderSystem'));
    expect(text).toContain(t('settings.voiceProviderCompatible'));
    expect(text).toContain(t('settings.voiceAvailable'));
    expect(text).toContain(t('settings.voiceTest'));
  });

  it('shows the compatible key state and the unavailable reason', () => {
    const text = textOf(render({ initialVoice: voiceCompatible, initialSecretNames: ['voice_key'] }));

    expect(text).toContain(t('settings.voiceKeySaved'));
    expect(text).toContain(t('settings.voiceUnavailable', { reason: 'The speech key is missing.' }));
    expect(text).toContain('https://api.example.com/v1');
  });
});

describe('settings about me', () => {
  it('renders the workspace facts with kinds and the new-fact action', () => {
    const text = textOf(render());

    expect(text).toContain(t('settings.aboutMe'));
    expect(text).toContain(t('settings.aboutMeBody'));
    expect(text).toContain(t('settings.aboutMeCount', { count: '3' }));
    expect(text).toContain(t('settings.aboutMeNew'));
    expect(text).toContain(t('memory.history'));
    expect(text).toContain(t('memory.tidyUp'));
    expect(text).toContain(t('memory.kind.preference'));
    expect(text).toContain('Prefers Portuguese (pt-BR) in conversation; writes English with customers.');
  });

  it('shows the empty state when there are no facts', () => {
    const text = textOf(render({ initialWorkspaceMemories: [] }));

    expect(text).toContain(t('settings.aboutMeEmptyTitle'));
    expect(text).toContain(t('settings.aboutMeEmptyBody'));
  });
});

describe('settings bot presets', () => {
  it('lists the presets with names, jobs and actions', () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain(t('settings.botPresets'));
    expect(text).toContain(t('settings.botPresetsBody'));
    expect(text).toContain(t('settings.botPresetsCount', { count: '2' }));
    expect(text).toContain('Support triage');
    expect(text).toContain('Social media manager');
    expect(text).toContain(t('settings.botPresetNew'));
    expect(text).toContain(t('settings.botPresetEditNamed', { name: 'Support triage' }));
    expect(html).toContain(t('settings.botPresetDeleteNamed', { name: 'Support triage' }));
  });

  it('shows the empty state when there are no presets', () => {
    const text = textOf(render({ initialBotPresets: [] }));

    expect(text).toContain(t('settings.botPresetEmptyTitle'));
    expect(text).toContain(t('settings.botPresetEmptyBody'));
    expect(text).toContain(t('settings.botPresetNew'));
  });
});

describe('settings activity', () => {
  it('lists the decision log with badges, bots, tools, summaries and the reply', () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain(t('settings.activity'));
    expect(text).toContain(t('settings.activityBody'));
    expect(text).toContain(t('settings.activityDeny'));
    expect(text).toContain(t('settings.activityAllowAlways'));
    expect(text).toContain(t('settings.activityAllowOnce'));
    expect(text).toContain('gmail.send');
    expect(text).toContain('Tuca');
    expect(text).toContain('Capy');
    expect(text).toContain('Send "Acme renewal: plans and export fix" to ana@acme.com');
    expect(text).toContain('Hold this until the export fix ships.');
    expect(html).toContain('data-tone="attention"');
  });

  it('offers the decision filter, range, refresh and CSV controls', () => {
    const text = textOf(render());

    expect(text).toContain(t('settings.activityDecision'));
    expect(text).toContain(t('settings.activityAll'));
    expect(text).toContain(t('settings.activityAllowed'));
    expect(text).toContain(t('settings.activityDenied'));
    expect(text).toContain(t('settings.activity24h'));
    expect(text).toContain(t('settings.activity7d'));
    expect(text).toContain(t('settings.activity30d'));
    expect(text).toContain(t('settings.activityRefresh'));
    expect(text).toContain(t('settings.activityDownload'));
  });

  it('shows the empty state when there are no decisions', () => {
    const text = textOf(render({ initialDecisions: [] }));

    expect(text).toContain(t('settings.activityEmptyTitle'));
    expect(text).toContain(t('settings.activityEmptyBody'));
    expect(text).toContain(t('settings.activityDownload'));
  });
});

describe('settings admin activity', () => {
  it('includes the admin activity section after the decision Activity section', () => {
    const text = textOf(render());

    expect(text).toContain(t('settings.adminActivity'));
    expect(text).toContain(t('settings.adminActivityBody'));
    expect(text).toContain(t('settings.adminActivityRefresh'));
    expect(text).toContain(t('settings.adminActivityEmptyTitle'));
  });
});

describe('settings room routing', () => {
  it('explains auto rooms and shows the unset state', () => {
    const text = textOf(render());

    expect(text).toContain(t('settings.roomRouting'));
    expect(text).toContain(t('settings.roomRoutingBody'));
    expect(text).toContain(t('settings.roomRoutingModel'));
    expect(text).toContain(t('settings.roomRoutingUnset'));
    expect(text).toContain(t('settings.roomRoutingUnsupported'));
    expect(text).toContain('opencode-go/deepseek-v4.1-flash');
    expect(text).toContain('anthropic/claude-sonnet');
  });

  it('shows the saved model and enables clear', () => {
    const text = textOf(render({ initialRoomDecider: { model: 'opencode-go/deepseek-v4.1-flash', updatedAt: '2026-10-19T09:00:00.000Z' } }));

    expect(text).toContain(t('settings.roomRoutingCurrent', { model: 'opencode-go/deepseek-v4.1-flash' }));
    expect(text).not.toContain(t('settings.roomRoutingUnset'));
    const clear = render({ initialRoomDecider: { model: 'opencode-go/deepseek-v4.1-flash' } }).match(/<button[^>]*>Clear<\/button>/)?.[0] ?? '';
    expect(clear).not.toContain('disabled=""');
  });

  it('dims providers that cannot be the decider', () => {
    const html = render();
    const disabledAnthropic = html.match(/<input[^>]*value="anthropic\/claude-sonnet"[^>]*>/)?.[0] ?? '';

    expect(disabledAnthropic).toContain('disabled=""');
    expect(textOf(html)).toContain(t('settings.roomRoutingUnsupportedBody'));
  });
});

describe('settings my chrome', () => {
  it('shows the default endpoint and connected state', () => {
    const html = render({
      initialMyChrome: { settings: { endpoint: 'http://127.0.0.1:9333' }, available: true },
    });
    const text = textOf(html);

    expect(text).toContain(t('settings.myChrome'));
    expect(text).toContain(t('settings.myChromeBody'));
    expect(html).toContain('value="http://127.0.0.1:9333"');
    expect(text).toContain(t('settings.myChromeConnected'));
  });

  it('shows a configured endpoint and the unavailable reason', () => {
    const text = textOf(
      render({
        initialMyChrome: {
          settings: { endpoint: 'http://127.0.0.1:9444' },
          available: false,
          reason: 'Chrome is not listening on that endpoint.',
        },
      }),
    );

    expect(text).toContain('http://127.0.0.1:9444');
    expect(text).toContain(t('settings.myChromeUnavailableReason', { reason: 'Chrome is not listening on that endpoint.' }));
  });
});

describe('settings transcription', () => {
  it('shows the unset state and dims models that cannot transcribe', () => {
    const text = textOf(render({ initialTranscription: { settings: {}, available: false, reason: 'No transcription model is configured.' } }));

    expect(text).toContain(t('settings.transcription'));
    expect(text).toContain(t('settings.transcriptionBody'));
    expect(text).toContain(t('settings.transcriptionUnset'));
    expect(text).toContain(t('settings.transcriptionModel'));
    expect(text).toContain(t('settings.transcriptionUnavailableReason', { reason: 'No transcription model is configured.' }));
    expect(text).toContain(t('settings.transcriptionCannot'));
    expect(text).toContain('opencode-go/deepseek-v4.1-flash');
    expect(text).toContain('deepseek/deepseek-v4.1');
  });

  it('shows the configured model and availability', () => {
    const text = textOf(
      render({
        initialTranscription: {
          settings: { model: 'opencode-go/deepseek-v4.1-flash', updatedAt: '2026-10-19T09:00:00.000Z' },
          available: true,
        },
      }),
    );

    expect(text).toContain(t('settings.transcriptionCurrent', { model: 'opencode-go/deepseek-v4.1-flash' }));
    expect(text).toContain(t('settings.transcriptionAvailable'));
    expect(text).not.toContain(t('settings.transcriptionUnset'));
  });

  it('shows the unavailable reason', () => {
    const text = textOf(
      render({
        initialTranscription: { settings: {}, available: false, reason: 'The provider has no key.' },
      }),
    );

    expect(text).toContain(t('settings.transcriptionUnavailableReason', { reason: 'The provider has no key.' }));
  });
});
