import type { Bot, Thread } from '@brot/protocol';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { emptyThread } from '../state/thread';
import { t } from '../i18n';
import { ThreadView, type ThreadViewProps } from './ThreadView';

const at = '2026-10-19T09:00:00.000Z';

const bot: Bot = {
  id: 'bot_1',
  name: 'Capy',
  job: 'Chief of Staff',
  instructions: '',
  engine: 'dsh',
  model: 'opencode-go/deepseek-v4.1-flash',
  computer: 'none',
  pinned: false,
  archived: false,
  createdAt: at,
  updatedAt: at,
};

const thread: Thread = { id: 'thr_1', botId: 'bot_1', title: 'Planning', createdAt: at, updatedAt: at };

const noopAsync = async () => undefined;

const textOf = (html: string): string => html.replaceAll('&#x27;', "'").replaceAll('&quot;', '"');

function render(overrides: Partial<ThreadViewProps> = {}): string {
  const props: ThreadViewProps = {
    bot,
    title: 'Planning',
    threadMeta: thread,
    loadProviders: async () => [],
    onPickThreadModel: noopAsync,
    thread: emptyThread,
    loaded: true,
    status: 'idle',
    onSend: noopAsync,
    onEdit: () => undefined,
    onDecide: noopAsync,
    onOpenBots: () => undefined,
    onOpenContext: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(<ThreadView {...props} />);
}

describe('ThreadView model badge', () => {
  it("shows the bot's model with a default hint when the thread has no override", () => {
    const text = textOf(render());

    expect(text).toContain(bot.model ?? '');
    expect(text).toContain(t('thread.modelDefault'));
    expect(text).toContain(t('thread.modelChange', { model: bot.model ?? '' }));
  });

  it('shows the thread override without the default hint', () => {
    const text = textOf(render({ threadMeta: { ...thread, model: 'opencode-go/kimi-k2' } }));

    expect(text).toContain('opencode-go/kimi-k2');
    expect(text).not.toContain(t('thread.modelDefault'));
  });

  it('omits the badge while the thread entity is unknown', () => {
    const text = textOf(render({ threadMeta: undefined }));

    expect(text).not.toContain(t('thread.modelUseBot'));
    expect(text).not.toContain(t('thread.modelDefault'));
  });
});
