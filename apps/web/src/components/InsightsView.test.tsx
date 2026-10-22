import type { TodaySummary, UsageSummary } from '@brot/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../data/mockClient';
import { t } from '../i18n';
import { InsightsView, type InsightsViewProps } from './InsightsView';
import { ClientProvider } from './client';

const at = '2026-10-19T09:00:00.000Z';

const totals = { runs: 18, completed: 15, failed: 2, cancelled: 1, tokensIn: 184_320, tokensOut: 52_880, costUsd: 0.4821 };

const today: TodaySummary = {
  from: at,
  to: '2026-10-19T18:00:00.000Z',
  totals,
  byBot: [
    { botId: 'bot_capy', name: 'Capy', runs: 7, completed: 7, failed: 0, tokensIn: 74_000, tokensOut: 21_000, costUsd: 0.1932 },
    { botId: 'bot_onca', name: 'Onça', runs: 5, completed: 3, failed: 2, tokensIn: 48_000, tokensOut: 14_000, costUsd: 0.1284 },
  ],
  routines: { completed: 3, failed: 1, skipped: 1, running: 0 },
  pendingApprovals: 2,
  highlights: [
    { botId: 'bot_capy', botName: 'Capy', threadId: 'thread_bot_capy', text: 'The renewal notes are ready for review.', at },
  ],
};

const usage: UsageSummary = {
  from: at,
  to: '2026-10-19T18:00:00.000Z',
  totals: { runs: 10, completed: 9, failed: 1, cancelled: 0, tokensIn: 24_000, tokensOut: 6_800, costUsd: 0.271 },
  groups: [
    { key: '2026-10-18', totals: { runs: 4, completed: 4, failed: 0, cancelled: 0, tokensIn: 9_600, tokensOut: 2_720, costUsd: 0.1084 } },
    { key: '2026-10-19', totals: { runs: 6, completed: 5, failed: 1, cancelled: 0, tokensIn: 14_400, tokensOut: 4_080, costUsd: 0.1626 } },
  ],
};

const botUsage: UsageSummary = {
  ...usage,
  totals: { runs: 2, completed: 2, failed: 0, cancelled: 0, tokensIn: 3_000, tokensOut: 900, costUsd: 0.02 },
  groups: [{ key: 'bot_capy', label: 'Capy', totals: { runs: 2, completed: 2, failed: 0, cancelled: 0, tokensIn: 3_000, tokensOut: 900, costUsd: 0.02 } }],
};

const emptyToday: TodaySummary = {
  ...today,
  totals: { runs: 0, completed: 0, failed: 0, cancelled: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 },
  byBot: [],
  routines: { completed: 0, failed: 0, skipped: 0, running: 0 },
  highlights: [],
};

const emptyUsage: UsageSummary = { ...usage, totals: { runs: 0, completed: 0, failed: 0, cancelled: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 }, groups: [] };

const noop = () => undefined;

/** Server markup escapes quotes, so compare against the decoded text. */
const textOf = (html: string): string =>
  html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

function render(overrides: Partial<InsightsViewProps> = {}): string {
  const props: InsightsViewProps = {
    onOpenBots: noop,
    onOpenApprovals: noop,
    onOpenBot: noop,
    initialToday: today,
    initialUsage: usage,
    ...overrides,
  };
  return renderToStaticMarkup(
    <ClientProvider value={createMockClient()}>
      <InsightsView {...props} />
    </ClientProvider>,
  );
}

describe('insights page', () => {
  it('renders today tiles, routine receipts, per-bot rows and highlights', () => {
    const text = textOf(render());

    expect(text).toContain(t('insights.title'));
    expect(text).toContain(t('insights.subtitle'));
    expect(text).toContain(t('insights.today'));
    expect(text).toContain(t('insights.runs'));
    expect(text).toContain('18');
    expect(text).toContain('15');
    expect(text).toContain('184,320 / 52,880');
    expect(text).toContain('$0.4821');
    expect(text).toContain(t('insights.pendingApprovals'));
    expect(text).toContain(t('insights.reviewApprovals'));
    expect(text).toContain(t('insights.byBot'));
    expect(text).toContain('Capy');
    expect(text).toContain('Onça');
    expect(text).toContain(t('insights.highlights'));
    expect(text).toContain('The renewal notes are ready for review.');
  });

  it('renders the usage table for the day grouping and its totals', () => {
    const text = textOf(render());

    expect(text).toContain(t('insights.usage'));
    expect(text).toContain(t('insights.groupDay'));
    expect(text).toContain(t('insights.groupBot'));
    expect(text).toMatch(/Oct 18/);
    expect(text).toContain(t('insights.usageTotals'));
    expect(text).toContain(t('insights.downloadCsv'));
  });

  it('renders the bot grouping when preselected', () => {
    const html = render({ initialGroup: 'bot', initialUsage: botUsage });
    const text = textOf(html);

    expect(text).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Bot<\/button>/);
    expect(text).toContain('Capy');
    expect(text).toContain(t('insights.usageTotals'));
  });

  it('shows empty states when there are no runs', () => {
    const text = textOf(render({ initialToday: emptyToday, initialUsage: emptyUsage }));

    expect(text).toContain(t('insights.noRuns'));
    expect(text).toContain(t('insights.noRunsBody'));
    expect(text).toContain(t('insights.usageEmpty'));
  });
});
