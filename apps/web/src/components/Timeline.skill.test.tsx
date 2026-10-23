import type { Bot } from '@brot/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { emptyThread, type ThreadState } from '../state/thread';
import { Timeline } from './Timeline';
import { TeamProvider, type TeamContextValue } from './team';

const at = '2026-10-19T09:00:00.000Z';

const bot: Bot = {
  id: 'bot_1',
  name: 'Capy',
  job: 'Chief of Staff',
  instructions: '',
  engine: 'dsh',
  model: 'opencode-go/deepseek-v4-flash',
  computer: 'none',
  pinned: false,
  archived: false,
  createdAt: at,
  updatedAt: at,
};

const noop = () => undefined;
const team: TeamContextValue = {
  bots: { bot_1: bot },
  rooms: [],
  tasks: {},
  waitingBots: new Set(),
  openBot: noop,
  openRoom: noop,
  openTask: noop,
};

function threadWith(messages: ThreadState['items']): ThreadState {
  return { ...emptyThread, items: messages };
}

function render(thread: ThreadState, onSaveAsSkill?: () => void): string {
  return renderToStaticMarkup(
    <TeamProvider value={team}>
      <Timeline
        thread={thread}
        mode="dm"
        defaultBotId={bot.id}
        members={[]}
        onDecide={async () => undefined}
        {...(onSaveAsSkill === undefined ? {} : { onSaveAsSkill })}
      />
    </TeamProvider>,
  );
}

const assistant = (id: string, content: string, streaming = false) => ({
  kind: 'message' as const,
  id,
  role: 'assistant' as const,
  content,
  streaming,
  at,
});

describe('Timeline save as a skill', () => {
  it('offers the bookmark action on completed assistant messages with text', () => {
    const html = render(threadWith([assistant('m1', 'Done, the report is ready.')]), () => undefined);

    expect(html).toContain(`aria-label="${t('timeline.saveAsSkill')}"`);
  });

  it('is absent without the handler, on user messages, on streaming and on empty messages', () => {
    expect(render(threadWith([assistant('m1', 'Done')]))).not.toContain(`aria-label="${t('timeline.saveAsSkill')}"`);

    const mixed = render(
      threadWith([
        { kind: 'message', id: 'u1', role: 'user', content: 'Hello', streaming: false, at },
        assistant('m2', 'Still typing…', true),
        { kind: 'message', id: 's1', role: 'system', content: 'System note', streaming: false, at },
        assistant('m3', '   '),
      ]),
      () => undefined,
    );
    expect(mixed).not.toContain(`aria-label="${t('timeline.saveAsSkill')}"`);
  });
});

describe('Timeline message copy', () => {
  const bubble = (id: string, role: 'user' | 'assistant' | 'system', content: string, streaming = false) => ({
    kind: 'message' as const,
    id,
    role,
    content,
    streaming,
    at,
  });

  it('offers copy on completed user and assistant messages only', () => {
    const assistantHtml = render(threadWith([assistant('m1', 'Done, the report is ready.')]), () => undefined);
    expect(assistantHtml).toContain(`aria-label="${t('copy.copyMessage')}"`);

    const user = render(threadWith([bubble('u1', 'user', 'Hello')]));
    expect(user).toContain(`aria-label="${t('copy.copyMessage')}"`);

    const system = render(threadWith([bubble('s1', 'system', 'Rate limited')]));
    expect(system).not.toContain(`aria-label="${t('copy.copyMessage')}"`);

    const streaming = render(threadWith([bubble('m2', 'assistant', 'Typing…', true)]), () => undefined);
    expect(streaming).not.toContain(`aria-label="${t('copy.copyMessage')}"`);

    const empty = render(threadWith([assistant('m3', '   ')]), () => undefined);
    expect(empty).not.toContain(`aria-label="${t('copy.copyMessage')}"`);
  });
});
