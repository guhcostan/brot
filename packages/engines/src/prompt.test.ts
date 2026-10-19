import type { Message } from '@brot/protocol';
import { describe, expect, it } from 'vitest';
import { buildPrompt, HISTORY_LIMIT } from './prompt';
import { testBot } from './test-utils';

const AT = '2026-10-19T12:00:00.000Z';

function message(index: number, role: Message['role'], content: string): Message {
  return { id: `m${index}`, threadId: 'thread_1', role, content, createdAt: AT };
}

describe('buildPrompt', () => {
  it('orders instructions, memories, history and the current message', () => {
    const prompt = buildPrompt({
      bot: { ...testBot, instructions: 'Be brief.' },
      memories: [{ id: 'k1', botId: 'bot_1', kind: 'fact', content: 'Lives in Lisbon', createdAt: AT, updatedAt: AT }],
      history: [message(1, 'user', 'Hi'), message(2, 'assistant', 'Hello')],
      input: 'What is my city?',
    });

    expect(prompt).toBe(
      [
        'Instructions:\nBe brief.',
        'Memories:\n- Lives in Lisbon',
        'Conversation so far:\nUser: Hi\nAssistant: Hello',
        'Current message:\nWhat is my city?',
      ].join('\n\n'),
    );
  });

  it('leaves out empty sections and always starts with a label', () => {
    expect(buildPrompt({ bot: testBot, memories: [], history: [], input: '- not a flag' })).toBe(
      'Current message:\n- not a flag',
    );
  });

  it('keeps only the last 20 history messages', () => {
    const history = Array.from({ length: HISTORY_LIMIT + 5 }, (_, i) => message(i, 'user', `msg ${i}`));
    const prompt = buildPrompt({ bot: testBot, memories: [], history, input: 'now' });

    expect(prompt).not.toContain('msg 4\n');
    expect(prompt).toContain('User: msg 5\n');
    expect(prompt).toContain(`User: msg ${HISTORY_LIMIT + 4}`);
  });
});
