import type { Approval, Bot } from '@brot/protocol';
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

const approval = (status: Approval['status']): Approval => ({
  id: 'a1',
  runId: 'r1',
  threadId: 'thr_1',
  botId: 'bot_1',
  kind: 'send',
  tool: 'gmail.send',
  summary: 'Send the follow-up',
  args: {},
  status,
  createdAt: at,
  ...(status === 'pending' ? {} : { resolvedAt: at }),
});

function render(status: Approval['status']): string {
  const thread: ThreadState = { ...emptyThread, items: [{ kind: 'approval', approval: approval(status) }] };
  return renderToStaticMarkup(
    <TeamProvider value={team}>
      <Timeline thread={thread} mode="dm" defaultBotId={bot.id} members={[]} onDecide={async () => undefined} />
    </TeamProvider>,
  );
}

const textOf = (html: string): string => html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"');

describe('Timeline expired approvals', () => {
  it('shows the muted Expired label and no decision badge', () => {
    const html = render('expired');
    const text = textOf(html);

    expect(text).toContain(t('approval.status.expired'));
    expect(html).toContain('data-status="expired"');
    expect(text).not.toContain(t('approval.decided.deny'));
    expect(text).not.toContain(t('approval.decided.allow_once'));
    expect(html).not.toContain('data-tone="attention"');
  });

  it('keeps a pending approval waiting without a status label', () => {
    const html = render('pending');
    const text = textOf(html);

    expect(text).toContain(t('status.waiting'));
    expect(text).not.toContain(t('approval.status.expired'));
    expect(html).toContain('data-status="pending"');
  });
});
