import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyableConversationText, copyableMessageText, extractCodeBlocks, splitMarkdown, writeClipboard } from './copy';
import type { MessageItem, TimelineItem } from './state/thread';

const message = (id: string, role: MessageItem['role'], content: string): MessageItem => ({
  kind: 'message',
  id,
  role,
  content,
  streaming: false,
  at: '2026-10-19T09:00:00.000Z',
});

afterEach(() => vi.unstubAllGlobals());

describe('copyableMessageText', () => {
  it('returns the full text from state for every visible role', () => {
    expect(copyableMessageText(message('m1', 'user', 'Hello there'))).toBe('Hello there');
    expect(copyableMessageText(message('m2', 'assistant', 'Hi!\n\nMore.'))).toBe('Hi!\n\nMore.');
    expect(copyableMessageText(message('m3', 'system', 'Rate limited'))).toBe('Rate limited');
  });

  it('returns an empty string for an empty message', () => {
    expect(copyableMessageText(message('m1', 'assistant', '   \n '))).toBe('');
    expect(copyableMessageText(message('m1', 'assistant', ''))).toBe('');
  });
});

describe('copyableConversationText', () => {
  it('joins message text and ignores tools and other records', () => {
    const items: TimelineItem[] = [
      message('m1', 'user', 'Question'),
      { kind: 'tool', callId: 'c1', tool: 'bash', args: {}, status: 'ok', output: 'secret' },
      message('m2', 'assistant', 'Answer'),
      message('m3', 'system', 'Note'),
      { kind: 'task', taskId: 't1', at: '2026-10-19T09:00:00.000Z' },
    ];

    expect(copyableConversationText(items)).toBe('Question\n\nAnswer\n\nNote');
    expect(copyableConversationText([{ kind: 'tool', callId: 'c1', tool: 'bash', args: {}, status: 'ok' }])).toBe('');
  });
});

describe('extractCodeBlocks', () => {
  it('extracts fenced blocks with their language and exact code', () => {
    const markdown = 'Before\n\n```ts\nconst x = 1;\n\nconsole.log(x);\n```\n\nAfter';

    expect(extractCodeBlocks(markdown)).toEqual([{ language: 'ts', code: 'const x = 1;\n\nconsole.log(x);' }]);
  });

  it('handles no language, extra info words and multiple blocks', () => {
    const markdown = '```\nplain\n```\n```python title=x\nprint(1)\n```';

    expect(extractCodeBlocks(markdown)).toEqual([
      { language: '', code: 'plain' },
      { language: 'python', code: 'print(1)' },
    ]);
  });

  it('leaves unclosed fences as text', () => {
    expect(extractCodeBlocks('```ts\nconst x = 1;')).toEqual([]);
  });
});

describe('splitMarkdown', () => {
  it('splits text runs around fenced code blocks', () => {
    expect(splitMarkdown('Hello\n```js\nx()\n```\nBye')).toEqual([
      { kind: 'text', text: 'Hello\n' },
      { kind: 'code', language: 'js', code: 'x()' },
      { kind: 'text', text: '\nBye' },
    ]);
    expect(splitMarkdown('plain text')).toEqual([{ kind: 'text', text: 'plain text' }]);
  });
});

describe('writeClipboard', () => {
  it('is safe without a clipboard (SSR and old browsers)', async () => {
    vi.stubGlobal('navigator', undefined);
    await expect(writeClipboard('x')).resolves.toBe(false);

    vi.stubGlobal('navigator', {});
    await expect(writeClipboard('x')).resolves.toBe(false);
  });

  it('writes text when available and reports a throwing clipboard', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(writeClipboard('copied text')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('copied text');

    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: async () => {
          throw new Error('denied');
        },
      },
    });
    await expect(writeClipboard('x')).resolves.toBe(false);
  });
});
