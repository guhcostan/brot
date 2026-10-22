import { describe, expect, it } from 'vitest';
import { newestSpokenMessage } from './useAutoSpeak';
import type { MessageItem, ThreadState } from '../state/thread';

const at = '2026-10-19T09:00:00.000Z';

const message = (id: string, extra: Partial<MessageItem> = {}): MessageItem => ({
  kind: 'message',
  id,
  role: 'assistant',
  content: `Reply ${id}`,
  streaming: false,
  at,
  ...extra,
});

const items = (list: Array<MessageItem | ThreadState['items'][number]>): ThreadState['items'] => list as ThreadState['items'];

describe('newestSpokenMessage', () => {
  it('returns the last completed assistant message with text', () => {
    const found = newestSpokenMessage(
      items([
        { kind: 'message', id: 'u1', role: 'user', content: 'Hello', streaming: false, at },
        message('a1'),
        message('a2', { authorBotId: 'bot_1' }),
        { kind: 'tool', callId: 'c1', tool: 'search', args: {}, status: 'ok' },
      ]),
    );

    expect(found?.id).toBe('a2');
  });

  it('skips streaming, empty, via-bot and non-assistant messages', () => {
    expect(newestSpokenMessage(items([message('a1', { streaming: true })]))).toBeUndefined();
    expect(newestSpokenMessage(items([message('a1', { content: '   ' })]))).toBeUndefined();
    expect(newestSpokenMessage(items([message('a1', { viaBotId: 'bot_2' })]))).toBeUndefined();
    expect(newestSpokenMessage(items([{ kind: 'message', id: 's1', role: 'system', content: 'Note', streaming: false, at }]))).toBeUndefined();
    expect(newestSpokenMessage(items([]))).toBeUndefined();
  });
});
