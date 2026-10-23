import type { Bot, Team } from '@brot/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BrowserProfile } from '../data/client';
import { DEMO_BOT_PRESETS, DEMO_MCP_SERVERS } from '../data/fixtures';
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
    loadMcpServers: async () => [],
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

describe('BotDialog approval mode', () => {
  const radio = (html: string, mode: 'ask' | 'edits'): string =>
    html.match(new RegExp(`<input[^>]*name="approvalMode"[^>]*value="${mode}"[^>]*>`))?.[0] ?? '';

  it('defaults a new bot to asking before risky actions', () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain(t('botForm.approvals'));
    expect(text).toContain(t('botForm.approvalAsk'));
    expect(text).toContain(t('botForm.approvalAskHint'));
    expect(text).toContain(t('botForm.approvalEdits'));
    expect(text).toContain(t('botForm.approvalSafety'));
    expect(radio(html, 'ask')).toContain('checked=""');
    expect(radio(html, 'edits')).not.toContain('checked=""');
  });

  it('shows the auto-approve hint and selects edits when editing such a bot', () => {
    const html = render({ bot: { ...bot, approvalMode: 'edits' } });
    const text = textOf(html);

    expect(text).toContain(t('botForm.approvalEditsHint'));
    expect(radio(html, 'edits')).toContain('checked=""');
    expect(radio(html, 'ask')).not.toContain('checked=""');
  });

  it('treats a bot without an approval mode as the ask default', () => {
    const html = render({ bot });

    expect(radio(html, 'ask')).toContain('checked=""');
    expect(radio(html, 'edits')).not.toContain('checked=""');
  });
});

describe('BotDialog speak replies', () => {
  const speakInput = (html: string): string => html.match(/<input[^>]*name="speakReplies"[^>]*>/)?.[0] ?? '';

  it('is off by default for a new bot and explains the hint', () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain(t('botForm.speakReplies'));
    expect(text).toContain(t('botForm.speakRepliesHint'));
    expect(speakInput(html)).not.toContain('checked=""');
  });

  it('is checked when the bot already speaks its replies', () => {
    const html = render({ bot: { ...bot, speakReplies: true } });

    expect(speakInput(html)).toContain('checked=""');
  });
});

describe('BotDialog MCP grants', () => {
  const checkboxForServer = (html: string, name: string): string => {
    const nameAt = html.indexOf(`>${name}<`);
    if (nameAt === -1) return '';
    const start = html.lastIndexOf('<input', nameAt);
    return start === -1 ? '' : html.slice(start, html.indexOf('>', start) + 1);
  };

  it('defaults a new bot to every enabled server', () => {
    const html = render({ initialMcpServers: DEMO_MCP_SERVERS });
    const text = textOf(html);

    expect(text).toContain(t('botForm.mcpServers'));
    expect(text).toContain(t('botForm.mcpEvery'));
    expect(text).toContain(t('botForm.mcpEveryHint'));
    expect(text).toContain(t('botForm.mcpChoose'));
    expect(text).not.toContain(t('botForm.mcpEveryHint') + 'x');
    expect(text).not.toContain(t('botForm.mcpEmpty'));
  });

  it('lists servers in choose mode, dimming the ones disabled in Settings', () => {
    const html = render({ initialMcpMode: 'custom', initialMcpServers: DEMO_MCP_SERVERS });
    const text = textOf(html);

    expect(text).toContain(t('botForm.mcpChoose'));
    expect(text).toContain(t('botForm.mcpChooseHint'));
    expect(text).toContain('filesystem');
    expect(text).toContain('search');
    expect(text).toContain(t('settings.mcpBadgeStdio'));
    expect(text).toContain(t('settings.mcpBadgeHttp'));
    expect(text).toContain('npx');
    expect(text).toContain('https://mcp.example.com/search');
    expect(text).toContain(t('botForm.mcpDisabled'));
    expect(checkboxForServer(html, 'search')).toContain('disabled=""');
    expect(checkboxForServer(html, 'filesystem')).not.toContain('disabled=""');
  });

  it('prefills an allowlist from the bot and checks its servers', () => {
    const html = render({ bot: { ...bot, mcpServerIds: ['mcp_filesystem'] }, initialMcpServers: DEMO_MCP_SERVERS });
    const text = textOf(html);

    expect(text).toContain(t('botForm.mcpChoose'));
    expect(checkboxForServer(html, 'filesystem')).toContain('checked=""');
    expect(checkboxForServer(html, 'search')).not.toContain('checked=""');
  });

  it('shows the settings hint when no server exists', () => {
    const text = textOf(render({ initialMcpMode: 'custom', initialMcpServers: [] }));

    expect(text).toContain(t('botForm.mcpEmpty'));
    expect(text).toContain(t('botForm.mcpEmptyAction'));
  });

  it('says when a custom list has no server ticked', () => {
    const text = textOf(render({ bot: { ...bot, mcpServerIds: [] }, initialMcpServers: DEMO_MCP_SERVERS }));

    expect(text).toContain(t('botForm.mcpNoneSelected'));
  });
});

describe('BotDialog fallback models', () => {
  const refs = ['opencode-go/kimi-k2', 'opencode-go/deepseek-v4.1-flash'];
  const providers = [
    {
      id: 'opencode-go',
      label: 'OpenCode Go',
      secretName: 'opencode_go_key',
      configured: true,
      models: [
        { id: 'opencode-go/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' },
        { id: 'opencode-go/kimi-k2', label: 'Kimi K2' },
      ],
    },
    {
      id: 'anthropic',
      label: 'Anthropic',
      secretName: 'anthropic_key',
      configured: false,
      models: [{ id: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5' }],
    },
  ];

  it('explains the retry order and starts with the failure copy when empty', () => {
    const text = textOf(render({ loadProviders: async () => providers, initialProviders: providers }));

    expect(text).toContain(t('botForm.fallbackModels'));
    expect(text).toContain(t('botForm.fallbackHint'));
    expect(text).toContain(t('botForm.fallbackEmpty'));
    expect(text).toContain(t('botForm.fallbackAdd'));
  });

  it('renders the selected fallbacks in order and offers a remove action each', () => {
    const html = render({ bot: { ...bot, fallbackModels: refs }, loadProviders: async () => providers, initialProviders: providers });
    const text = textOf(html);

    const sectionStart = text.indexOf(t('botForm.fallbackModels'));
    const section = text.slice(sectionStart, sectionStart + 6000);
    const kimi = section.indexOf('Kimi K2');
    const deepseek = section.indexOf('DeepSeek V4.1 Flash');
    expect(kimi).toBeGreaterThan(-1);
    expect(deepseek).toBeGreaterThan(-1);
    expect(kimi).toBeLessThan(deepseek);
    expect(html.match(new RegExp(`aria-label="${t('botForm.fallbackRemove', { model: 'Kimi K2' })}"`, 'g')) ?? []).toHaveLength(1);
    expect(html.match(new RegExp(`aria-label="${t('botForm.fallbackRemove', { model: 'DeepSeek V4.1 Flash' })}"`, 'g')) ?? []).toHaveLength(1);
  });

  it('disables adding once three fallbacks are chosen', () => {
    const three = ['opencode-go/deepseek-v4.1-flash', 'opencode-go/kimi-k2', 'anthropic/claude-sonnet-5'];
    const html = render({ bot: { ...bot, fallbackModels: three }, loadProviders: async () => providers, initialProviders: providers });
    const select = html.match(new RegExp(`<select[^>]*aria-label="${t('botForm.fallbackAdd')}"[^>]*>`))?.[0] ?? '';

    expect(select).toContain('disabled=""');
    expect(textOf(html).match(new RegExp(t('botForm.fallbackMax'), 'g'))?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('marks unconfigured provider models as needing their key', () => {
    const text = textOf(render({ loadProviders: async () => providers, initialProviders: providers }));

    expect(text).toContain(t('botForm.fallbackUnconfigured'));
    expect(text).toContain('Claude Sonnet 5');
  });
});

describe('BotDialog budgets', () => {
  const budgetInputs = (html: string): string[] => html.match(/<input[^>]*type="number"[^>]*placeholder="0.00"[^>]*>/g) ?? [];

  it('shows two empty caps by default with dollar signs and hints', () => {
    const html = render();
    const text = textOf(html);

    expect(text).toContain(t('botForm.budgets'));
    expect(text).toContain(t('botForm.runBudget'));
    expect(text).toContain(t('botForm.dailyBudget'));
    expect(text).toContain(t('botForm.budgetsHint'));
    expect(text).toContain('$');
    expect(budgetInputs(html)).toHaveLength(2);
    expect(budgetInputs(html).every((tag) => /value=""/.test(tag))).toBe(true);
  });

  it('prefills a bot with caps and shows the parsed USD hint', () => {
    const html = render({ bot: { ...bot, runBudgetUsd: 0.5, dailyBudgetUsd: 2 } });
    const text = textOf(html);

    expect(html).toContain('value="0.5"');
    expect(html).toContain('value="2"');
    expect(text).toContain(t('botForm.budgetParsed', { amount: '$0.5000' }));
    expect(text).toContain(t('botForm.budgetParsed', { amount: '$2.0000' }));
  });

  it('flags negative and over-precise drafts inline', () => {
    const text = textOf(render({ initialBudgets: { runBudget: '-1', dailyBudget: '1.234' } }));

    expect(text).toContain(t('botForm.budgetNegative'));
    expect(text).toContain(t('botForm.budgetDecimals'));
  });

  it('flags a non-numeric draft inline', () => {
    const text = textOf(render({ initialBudgets: { runBudget: 'abc' } }));

    expect(text).toContain(t('botForm.budgetInvalidNumber'));
  });
});

describe('BotDialog presets', () => {
  const savePreset = async () => DEMO_BOT_PRESETS[0]!;

  it('shows the start-from-a-preset strip for a new bot', () => {
    const html = render({ initialPresets: DEMO_BOT_PRESETS });
    const text = textOf(html);

    expect(text).toContain(t('botForm.presetTitle'));
    expect(text).toContain('Support triage');
    expect(text).toContain('Social media manager');
    expect(text).toContain(t('botForm.presetHint'));
  });

  it('hides the strip when there are no presets', () => {
    const text = textOf(render({ initialPresets: [] }));

    expect(text).not.toContain(t('botForm.presetTitle'));
    expect(text).not.toContain(t('botForm.presetHint'));
  });

  it('applies a chosen preset to the draft', () => {
    const html = render({ initialPresets: DEMO_BOT_PRESETS, initialPresetId: 'preset_support' });
    const text = textOf(html);

    expect(html).toContain('value="Support triage"');
    expect(html).toContain('value="Read incoming support mail, sort it by urgency, and draft replies for the person to approve."');
    expect(text).toContain('Be concise and kind.');
    expect(text).toContain(t('botForm.presetApplied', { name: 'Support triage' }));
  });

  it('is not offered when editing an existing bot', () => {
    const text = textOf(render({ bot, initialPresets: DEMO_BOT_PRESETS }));

    expect(text).not.toContain(t('botForm.presetTitle'));
  });

  it('offers Save as preset only when editing', () => {
    const createText = textOf(render({ initialPresets: DEMO_BOT_PRESETS }));
    expect(createText).not.toContain(t('botForm.saveAsPreset'));

    const editText = textOf(render({ bot, savePresetFromBot: savePreset }));
    expect(editText).toContain(t('botForm.saveAsPreset'));
  });
});

describe('BotDialog browser source', () => {
  const browsing = { ...bot, browser: true };

  it('offers own profile and My Chrome only while the browser is on', () => {
    expect(textOf(render())).not.toContain(t('botForm.browserSource'));

    const html = render({ bot: browsing });
    const text = textOf(html);

    expect(text).toContain(t('botForm.browserSource'));
    expect(text).toContain(t('botForm.browserSourceOwn'));
    expect(text).toContain(t('botForm.browserSourceOwnHint'));
    expect(text).toContain(t('botForm.browserSourceMine'));
    expect(text).toContain(t('botForm.browserSourceMineHint'));
    expect(text).toContain(t('botForm.browserSourceMineNote'));
    expect(html.match(/name="bot-browser-mode"/g)).toHaveLength(2);
    expect(html).toMatch(/<input[^>]*name="bot-browser-mode"[^>]*checked=""\/>/);
  });

  it('prefills My Chrome and hides the shared profile picker', () => {
    const text = textOf(render({ bot: { ...browsing, browserMode: 'my-chrome' } }));

    expect(text).toContain(t('botForm.browserSourceMineHint'));
    expect(text).not.toContain(t('botForm.browserProfile'));
  });
});
