import type { Routine, RoutineRun } from '@brot/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createMockClient } from '../data/mockClient';
import { DEMO_BOTS } from '../data/fixtures';
import { t } from '../i18n';
import { ClientProvider } from './client';
import { RoutinesView, type RoutinesViewProps } from './RoutinesView';

const at = '2026-10-19T09:00:00.000Z';
const future = new Date(Date.now() + 2 * 3_600_000).toISOString();
const past = new Date(Date.now() - 3 * 3_600_000).toISOString();

const routine = (extra: Partial<Routine> & Pick<Routine, 'id' | 'name'>): Routine => ({
  botId: 'bot_sol',
  instruction: 'Do the thing.',
  trigger: { type: 'cron', cron: '0 8 * * 1-5', timezone: 'America/Sao_Paulo' },
  enabled: true,
  catchUp: true,
  rememberLastRun: false,
  createdAt: at,
  updatedAt: at,
  ...extra,
});

const morning = routine({ id: 'r_morning', name: 'Morning brief', nextRunAt: future, lastRunAt: past });
const sweep = routine({
  id: 'r_sweep',
  name: 'Follow-up sweep',
  botId: 'bot_tuca',
  enabled: false,
  trigger: { type: 'cron', cron: '*/15 * * * *' },
  lastRunAt: past,
});

const run = (extra: Partial<RoutineRun> & Pick<RoutineRun, 'id' | 'routineId' | 'status'>): RoutineRun => ({
  botId: 'bot_sol',
  threadId: 'thread_bot_sol',
  trigger: 'schedule',
  startedAt: past,
  endedAt: past,
  createdAt: past,
  ...extra,
});

const runs: RoutineRun[] = [
  run({ id: 'rr_1', routineId: 'r_morning', status: 'completed', result: 'Three priorities for today.' }),
  run({ id: 'rr_2', routineId: 'r_sweep', status: 'skipped', botId: 'bot_tuca', error: 'The previous run was still active.' }),
];

/** Server markup escapes quotes, so compare against the decoded text. */
const textOf = (html: string): string => html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"');

function render(overrides: Partial<RoutinesViewProps> = {}): string {
  const props: RoutinesViewProps = {
    bots: DEMO_BOTS,
    onOpenBots: () => undefined,
    onNewBot: () => undefined,
    initialRoutines: [morning, sweep],
    initialRuns: runs,
    ...overrides,
  };
  return renderToStaticMarkup(
    <ClientProvider value={createMockClient()}>
      <RoutinesView {...props} />
    </ClientProvider>,
  );
}

describe('routines page', () => {
  it('renders a row per routine with its schedule, next run and last status', () => {
    const text = textOf(render());

    expect(text).toContain(t('routines.title'));
    expect(text).toContain('Morning brief');
    expect(text).toContain('Follow-up sweep');
    expect(text).toContain('Sol · Weekdays at 08:00 · America/Sao_Paulo');
    expect(text).toContain('Tuca · Every 15 min');
    expect(text).toContain(t('routines.run.completed'));
    expect(text).toContain(t('routines.run.skipped'));
    expect(text).toContain(t('routines.paused'));
    expect(text).toContain(t('routines.pausedHint'));
    expect(text).toContain(t('routines.runNow'));
    expect(text).toContain(t('routines.history'));
    expect(text).toContain(t('routines.edit'));
    expect(text).toContain(t('routines.deleteNamed', { name: 'Morning brief' }));
    expect(text).toContain(t('routines.summary', { enabled: '1', total: '2', next: t('routines.relative.hours', { count: '2' }) }));
  });

  it('explains what a routine is when there are none, with a create action', () => {
    const text = textOf(render({ initialRoutines: [], initialRuns: [] }));

    expect(text).toContain(t('routines.emptyTitle'));
    expect(text).toContain(t('routines.emptyBody'));
    expect(text).toContain(t('routines.newRoutine'));
  });

  it('points to a new bot when no bot exists to schedule', () => {
    const html = render({ bots: [], initialRoutines: [], initialRuns: [] });
    const text = textOf(html);

    expect(text).toContain(t('routines.noBotsTitle'));
    expect(text).toContain(t('routines.noBotsBody'));
    expect(text).toContain(t('sidebar.newBot'));
    // The header's create button is there, but disabled until a bot exists.
    expect(text).toContain(t('routines.newRoutine'));
    expect(html).toContain('disabled=""');
  });
});
