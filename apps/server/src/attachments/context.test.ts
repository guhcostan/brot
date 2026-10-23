import { describe, expect, it } from 'vitest';
import type { Attachment } from '@brot/protocol';
import {
  ATTACHMENT_INLINE_CHARS,
  ATTACHMENT_INLINE_TOTAL_CHARS,
  appendAttachmentContext,
  formatAttachmentSize,
  type AttachmentBytes,
} from './context';

const at = '2026-10-22T12:00:00.000Z';

function attachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'att_1',
    name: 'notes.txt',
    mimeType: 'text/plain',
    size: 5,
    kind: 'file',
    createdAt: at,
    ...overrides,
  };
}

/** In-memory bytes for the prompt builder, recording which attachments it read. */
function sourceOf(files: Record<string, string>): AttachmentBytes & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async readPrefix(id, maxBytes) {
      calls.push(id);
      const text = files[id];
      if (text === undefined) return undefined;
      return new TextEncoder().encode(text).subarray(0, maxBytes);
    },
  };
}

describe('appendAttachmentContext', () => {
  it('returns the input untouched when there are no attachments', async () => {
    const source = sourceOf({});
    expect(await appendAttachmentContext(source, 'hello', undefined)).toBe('hello');
    expect(await appendAttachmentContext(source, 'hello', [])).toBe('hello');
    expect(source.calls).toEqual([]);
  });

  it('lists an attachment and inlines its text in a fenced block', async () => {
    const source = sourceOf({ att_1: 'the cat sat' });
    const result = await appendAttachmentContext(source, 'See attached', [attachment({ size: 11 })]);

    expect(result).toContain('See attached\n\nAttachments:');
    expect(result).toContain('- notes.txt (text/plain, 11 B)');
    expect(result).toContain('the cat sat');
    expect(result).toMatch(/```\nthe cat sat\n```/);
  });

  it('inlines JSON but not a PDF or ZIP', async () => {
    const source = sourceOf({ att_1: '{"ok":true}', att_2: 'PDFDATA', att_3: 'ZIPDATA' });
    const result = await appendAttachmentContext(source, 'Files', [
      attachment({ id: 'att_1', name: 'data.json', mimeType: 'application/json', size: 11 }),
      attachment({ id: 'att_2', name: 'report.pdf', mimeType: 'application/pdf', size: 7 }),
      attachment({ id: 'att_3', name: 'bundle.zip', mimeType: 'application/zip', size: 7 }),
    ]);

    expect(result).toContain('{"ok":true}');
    expect(result).toContain('- report.pdf (application/pdf, 7 B)');
    expect(result).toContain('- bundle.zip (application/zip, 7 B)');
    expect(result).not.toContain('PDFDATA');
    expect(result).not.toContain('ZIPDATA');
    expect(source.calls).toEqual(['att_1']);
  });

  it('notes an image and never reads its bytes', async () => {
    const source = sourceOf({ att_1: 'PNGDATA' });
    const result = await appendAttachmentContext(source, 'Look', [
      attachment({ name: 'screen.png', mimeType: 'image/png', kind: 'image', size: 7 }),
    ]);
    expect(result).toContain('- screen.png (image/png, 7 B)');
    expect(result).toContain('image attached');
    expect(result).not.toContain('PNGDATA');
    expect(source.calls).toEqual([]);
  });

  it('cuts one attachment at 8000 characters and marks the cut', async () => {
    const content = 'a'.repeat(ATTACHMENT_INLINE_CHARS + 1000);
    const source = sourceOf({ att_1: content });
    const result = await appendAttachmentContext(source, 'Big', [
      attachment({ name: 'big.txt', mimeType: 'text/plain', size: content.length }),
    ]);

    expect(result).toContain('a'.repeat(ATTACHMENT_INLINE_CHARS));
    expect(result).not.toContain('a'.repeat(ATTACHMENT_INLINE_CHARS + 1));
    expect(result).toContain('[truncated]');
  });

  it('caps all attachments together at 24000 characters', async () => {
    const content = (letter: string) => letter.repeat(ATTACHMENT_INLINE_CHARS + 1000);
    const source = sourceOf({ att_1: content('x'), att_2: content('y'), att_3: content('w'), att_4: content('v') });
    const result = await appendAttachmentContext(source, 'Many', [
      attachment({ id: 'att_1', name: 'one.txt', mimeType: 'text/plain', size: content('x').length }),
      attachment({ id: 'att_2', name: 'two.txt', mimeType: 'text/plain', size: content('y').length }),
      attachment({ id: 'att_3', name: 'three.txt', mimeType: 'text/plain', size: content('w').length }),
      attachment({ id: 'att_4', name: 'four.txt', mimeType: 'text/plain', size: content('v').length }),
    ]);

    const blocks = [...result.matchAll(/`{3,}\n([\s\S]*?)\n`{3,}/g)].map((match) => match[1] ?? '').join('');
    expect((blocks.match(/x/g) ?? []).length).toBe(ATTACHMENT_INLINE_CHARS);
    expect((blocks.match(/y/g) ?? []).length).toBe(ATTACHMENT_INLINE_CHARS);
    expect((blocks.match(/w/g) ?? []).length).toBe(ATTACHMENT_INLINE_CHARS);
    expect(result).not.toContain('vvvv');
    expect(ATTACHMENT_INLINE_CHARS * 3).toBe(ATTACHMENT_INLINE_TOTAL_CHARS);
    expect(result).toContain('content omitted: the attachment text budget is used up.');
    expect(source.calls).toEqual(['att_1', 'att_2', 'att_3']);
  });

  it('never splits a surrogate pair at the cut', async () => {
    const content = '😀'.repeat(ATTACHMENT_INLINE_CHARS + 10);
    const source = sourceOf({ att_1: content });
    const result = await appendAttachmentContext(source, 'Emoji', [
      attachment({ name: 'emoji.txt', mimeType: 'text/plain', size: content.length }),
    ]);

    expect(result).toContain('😀'.repeat(ATTACHMENT_INLINE_CHARS));
    expect(result).not.toContain('😀'.repeat(ATTACHMENT_INLINE_CHARS + 1));
    expect(result).not.toContain('\ufffd');
  });

  it('uses a longer fence when the content holds backticks', async () => {
    const source = sourceOf({ att_1: 'before\n```\ninside\n```\nafter' });
    const result = await appendAttachmentContext(source, 'Fence', [
      attachment({ name: 'fence.txt', mimeType: 'text/plain', size: 30 }),
    ]);
    expect(result).toContain('````');
  });

  it('reports content that could not be read', async () => {
    const source = sourceOf({});
    const result = await appendAttachmentContext(source, 'Gone', [attachment()]);
    expect(result).toContain('- notes.txt (text/plain, 5 B)');
    expect(result).toContain('content unavailable.');
  });
});

describe('formatAttachmentSize', () => {
  it('uses bytes, kilobytes and megabytes', () => {
    expect(formatAttachmentSize(0)).toBe('0 B');
    expect(formatAttachmentSize(1023)).toBe('1023 B');
    expect(formatAttachmentSize(1024)).toBe('1.0 KB');
    expect(formatAttachmentSize(1536)).toBe('1.5 KB');
    expect(formatAttachmentSize(20 * 1024 * 1024)).toBe('20.0 MB');
  });
});

describe('audio transcripts in the attachment list', () => {
  const voice = attachment({
    id: 'att_voice',
    name: 'voice-note.webm',
    mimeType: 'audio/webm',
    kind: 'audio',
    size: 120,
  });

  it('renders the transcript right under the attachment name', async () => {
    const source = sourceOf({});
    const result = await appendAttachmentContext(source, 'listen', [voice], {
      transcripts: [{ name: 'voice-note.webm', transcript: 'hello from the voice note' }],
    });
    expect(result).toBe(
      'listen\n\nAttachments:\n- voice-note.webm (audio/webm, 120 B)\n- voice-note.webm (transcript): hello from the voice note',
    );
    // Audio bytes are never read for the prompt; only the transcript text is rendered.
    expect(source.calls).toEqual([]);
  });

  it('lists an untranscribed voice note by name and size only', async () => {
    const result = await appendAttachmentContext(sourceOf({}), 'listen', [voice], { transcripts: [] });
    expect(result).toBe('listen\n\nAttachments:\n- voice-note.webm (audio/webm, 120 B)');
    expect(result).not.toContain('(transcript)');
  });
});
