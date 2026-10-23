import type { Bot, Memory, Skill } from '@brot/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Room } from '../data/client';
import { createMockClient } from '../data/mockClient';
import { t } from '../i18n';
import { emptyThread } from '../state/thread';
import { ClientProvider } from './client';
import { ContextPanel, type ContextPanelProps, type ContextSubject } from './ContextPanel';
import { TeamProvider, type TeamContextValue } from './team';

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

const memory = (extra: Partial<Memory> & Pick<Memory, 'id' | 'kind' | 'content'>): Memory => ({
  botId: bot.id,
  scope: 'bot',
  createdAt: at,
  updatedAt: at,
  ...extra,
});

const memories: Memory[] = [
  memory({ id: 'mem_1', kind: 'preference', content: 'Prefers short summaries before 10am.' }),
  memory({ id: 'mem_2', kind: 'fact', content: 'The Acme renewal is the top priority until Nov 1.' }),
];

const skill = (extra: Partial<Skill> & Pick<Skill, 'id' | 'name'>): Skill => ({
  description: 'A reusable procedure.',
  body: '# Steps\n\n1. Do the thing.',
  version: 1,
  createdAt: at,
  updatedAt: at,
  ...extra,
});

const skills: Skill[] = [
  skill({ id: 'skill_1', botId: bot.id, name: 'Refund triage', description: 'Decide when a refund needs approval.' }),
  skill({ id: 'skill_shared', name: 'Weekly plan', description: 'Turn the board into a weekly plan.' }),
];

const noop = () => undefined;
const team: TeamContextValue = {
  bots: { [bot.id]: bot },
  rooms: [],
  tasks: {},
  waitingBots: new Set(),
  openBot: noop,
  openRoom: noop,
  openTask: noop,
};

/** Server markup escapes quotes, so compare against the decoded text. */
const textOf = (html: string): string => html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"');

function render(overrides: Partial<ContextPanelProps> = {}): string {
  const props: ContextPanelProps = {
    subject: { kind: 'bot', bot } satisfies ContextSubject,
    thread: emptyThread,
    tasks: [],
    onNewTask: noop,
    onUpdateMembers: async () => [],
    onClose: noop,
    initialMemories: memories,
    initialSkills: skills,
    ...overrides,
  };
  return renderToStaticMarkup(
    <TeamProvider value={team}>
      <ClientProvider value={createMockClient()}>
        <ContextPanel {...props} />
      </ClientProvider>
    </TeamProvider>,
  );
}

describe('context panel memory tab', () => {
  it('renders the entries with their kind, content and count', () => {
    const text = textOf(render());

    expect(text).toContain(t('context.memory'));
    expect(text).toContain(t('context.skills'));
    expect(text).toContain(t('memory.count', { count: '2' }));
    expect(text).toContain(t('memory.kind.preference'));
    expect(text).toContain(t('memory.kind.fact'));
    expect(text).toContain('Prefers short summaries before 10am.');
    expect(text).toContain('The Acme renewal is the top priority until Nov 1.');
    expect(text).toContain(t('memory.new'));
    expect(text).toContain(t('memory.edit'));
    expect(render()).toContain(`aria-label="${t('memory.delete')}"`);
    expect(textOf(render())).toContain(t('memory.history'));
  });

  it('explains what memory is when a bot has none', () => {
    const text = textOf(render({ initialMemories: [] }));

    expect(text).toContain(t('memory.emptyTitle'));
    expect(text).toContain(t('memory.emptyBody'));
    expect(text).toContain(t('memory.new'));
  });
});

describe('context panel skills tab', () => {
  it('renders the bot skills and the shared one with its badge', () => {
    const text = textOf(render({ initialTab: 'skills', initialMemories: [] }));

    expect(text).toContain(t('skills.count', { count: '2' }));
    expect(text).toContain('Refund triage');
    expect(text).toContain('Decide when a refund needs approval.');
    expect(text).toContain('Weekly plan');
    expect(text).toContain(t('skills.shared'));
    expect(text).toContain(t('skills.new'));
    expect(text).toContain('# Steps');
    expect(text).not.toContain(t('memory.new'));
  });

  it('explains what a skill is when a bot has none', () => {
    const text = textOf(render({ initialTab: 'skills', initialMemories: [], initialSkills: [] }));

    expect(text).toContain(t('skills.emptyTitle'));
    expect(text).toContain(t('skills.emptyBody', { name: 'Capy' }));
    expect(text).toContain(t('skills.new'));
  });
});

describe('context panel rooms', () => {
  it('keeps memory and skills out of a room panel', () => {
    const room = {
      thread: { id: 'room_1', botId: bot.id, title: 'Acme', kind: 'room' as const, leadBotId: bot.id, responder: 'lead' as const, createdAt: at, updatedAt: at },
      memberIds: [bot.id],
    };
    const text = textOf(render({ subject: { kind: 'room', room, members: [bot] } }));

    expect(text).toContain(t('context.members'));
    expect(text).not.toContain(t('context.memory'));
    expect(text).not.toContain(t('context.skills'));
  });
});

describe('context panel room routing', () => {
  it('shows the auto decider rule for an auto room', () => {
    const room: Room = {
      thread: {
        id: 'room_1',
        botId: bot.id,
        title: 'Acme renewal',
        kind: 'room',
        leadBotId: bot.id,
        responder: 'auto',
        createdAt: at,
        updatedAt: at,
      },
      memberIds: [bot.id],
    };
    const html = render({ subject: { kind: 'room', room, members: [bot] } });

    expect(textOf(html)).toContain(t('room.ruleAuto'));
  });
});
