import type { Bot, Team, Thread } from '@brot/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { Sidebar, type SidebarProps } from './Sidebar';

const at = '2026-10-19T09:00:00.000Z';

const bot: Bot = {
  id: 'bot_1',
  name: 'Capy',
  job: 'Chief of Staff',
  instructions: '',
  engine: 'mock',
  computer: 'none',
  pinned: true,
  archived: false,
  createdAt: at,
  updatedAt: at,
};

const team: Team = {
  id: 'team_growth',
  name: 'Growth',
  instructions: 'Win the Acme renewal.',
  chiefBotId: 'bot_1',
  createdAt: at,
  updatedAt: at,
};

const thread = (id: string, title: string): Thread => ({ id, botId: 'bot_1', title, kind: 'dm', createdAt: at, updatedAt: at });

const noop = () => undefined;

function render(overrides: Partial<SidebarProps> = {}): string {
  const props: SidebarProps = {
    bots: [bot],
    rooms: [],
    teams: [],
    threadLists: { bot_1: [thread('thr_2', 'Planning'), thread('thr_1', 'Morning check-in')] },
    statusOf: () => 'idle',
    threadStatusOf: () => 'idle',
    roomStatusOf: () => 'idle',
    membersOf: () => [],
    activeTasks: 0,
    approvals: 0,
    ready: true,
    selection: { kind: 'bot', id: 'bot_1', threadId: 'thr_1' },
    onSelect: noop,
    onOpenBot: noop,
    onOpenThread: noop,
    onLoadThreads: async () => [],
    onNewThread: noop,
    onNewRoom: noop,
    onNewBot: noop,
    onNewTeam: noop,
    onEditTeam: noop,
    locale: 'en',
    ...overrides,
  };
  return renderToStaticMarkup(<Sidebar {...props} />);
}

/** Server markup escapes quotes, so compare against the decoded text. */
const textOf = (html: string): string => html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"');

describe('sidebar threads', () => {
  it('renders a bot thread titles and a new-thread row once expanded', () => {
    const text = textOf(render({ defaultExpanded: ['bot_1'] }));

    expect(text).toContain(t('sidebar.threads', { name: 'Capy' }));
    expect(text).toContain('Planning');
    expect(text).toContain('Morning check-in');
    expect(text).toContain(t('sidebar.newThread'));
    expect(text).toContain(t('sidebar.collapseThreads', { name: 'Capy' }));
  });

  it('keeps the thread rows collapsed by default, with the chevron to expand them', () => {
    const text = textOf(render());

    expect(text).toContain('Capy');
    expect(text).toContain('Chief of Staff');
    expect(text).not.toContain('Morning check-in');
    expect(text).toContain(t('sidebar.expandThreads', { name: 'Capy' }));
  });

  it('shows the live status of a thread that is working or waiting', () => {
    const text = textOf(
      render({
        defaultExpanded: ['bot_1'],
        threadStatusOf: (threadId) => (threadId === 'thr_2' ? 'working' : 'idle'),
      }),
    );

    expect(text).toContain(t('status.working'));
  });

  it('expands a bot with no threads to just the new-thread row', () => {
    const text = textOf(render({ threadLists: { bot_1: [] }, defaultExpanded: ['bot_1'] }));

    expect(text).toContain(t('sidebar.newThread'));
    expect(text).not.toContain('Planning');
  });
});

describe('sidebar teams', () => {
  const solo: Bot = { ...bot, id: 'bot_2', name: 'Mico', job: 'Triage', pinned: false };

  it('groups active bots under their team, then the ones without a team', () => {
    const html = render({ bots: [{ ...bot, teamId: team.id }, solo], teams: [team] });

    expect(html).toContain('Growth');
    expect(html).toContain(t('sidebar.ungrouped'));
    expect(html.indexOf('Growth')).toBeLessThan(html.indexOf('Capy'));
    expect(html.indexOf('Capy')).toBeLessThan(html.indexOf(t('sidebar.ungrouped')));
    expect(html.indexOf(t('sidebar.ungrouped'))).toBeLessThan(html.indexOf('Mico'));
  });

  it('counts the bots in a group and offers its team dialog', () => {
    const html = render({ bots: [{ ...bot, teamId: team.id }, { ...solo, teamId: team.id }], teams: [team] });

    expect(html).toContain(t('sidebar.teamBotCountMany', { count: '2' }));
    expect(html).toContain(t('sidebar.editTeam', { name: 'Growth' }));
    expect(html).toContain(t('sidebar.newTeam'));
  });

  it('hides a team with no active bots and keeps archived bots out of the groups', () => {
    const html = render({
      bots: [{ ...bot, teamId: team.id }, { ...solo, archived: true }],
      teams: [team, { ...team, id: 'team_ops', name: 'Ops' }],
    });

    expect(html).not.toContain('Ops');
    expect(html).not.toContain(t('sidebar.ungrouped'));
    expect(html).toContain('Capy');
  });

  it('shows a bot whose team is missing as ungrouped instead of dropping it', () => {
    const html = render({ bots: [{ ...bot, teamId: 'team_deleted' }], teams: [] });

    expect(html).toContain(t('sidebar.ungrouped'));
    expect(html).toContain('Capy');
  });
});
