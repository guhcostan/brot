import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_PER_MESSAGE,
  ATTACHMENT_NAME_MAX_LENGTH,
  CreateAttachment,
  attachmentKindFor,
  isAllowedAttachmentMime,
  isTextAttachmentMime,
  sanitizeAttachmentName,
} from './attachments';

describe('attachment limits', () => {
  it('caps a file at 20 MB and a message at 10 attachments', () => {
    expect(ATTACHMENT_MAX_BYTES).toBe(20 * 1024 * 1024);
    expect(ATTACHMENT_MAX_PER_MESSAGE).toBe(10);
    expect(ATTACHMENT_NAME_MAX_LENGTH).toBe(200);
  });
});

describe('isAllowedAttachmentMime', () => {
  it('accepts images, text, JSON, PDF and ZIP, with or without parameters', () => {
    for (const mimeType of [
      'image/png',
      'image/jpeg',
      'image/gif',
      'image/webp',
      'text/plain',
      'text/markdown',
      'text/csv',
      'text/plain; charset=utf-8',
      'application/json',
      'application/pdf',
      'application/zip',
      'IMAGE/PNG',
    ]) {
      expect(isAllowedAttachmentMime(mimeType)).toBe(true);
    }
  });

  it('refuses other media types', () => {
    for (const mimeType of ['', 'application/octet-stream', 'video/mp4', 'audio/mpeg', 'image/svg+xml', 'application/x-msdownload']) {
      expect(isAllowedAttachmentMime(mimeType)).toBe(false);
    }
  });
});

describe('attachmentKindFor and isTextAttachmentMime', () => {
  it('makes images images and everything else a file', () => {
    expect(attachmentKindFor('image/png')).toBe('image');
    expect(attachmentKindFor('image/webp; q=1')).toBe('image');
    expect(attachmentKindFor('text/plain')).toBe('file');
    expect(attachmentKindFor('application/pdf')).toBe('file');
  });

  it('inlines text and JSON only', () => {
    expect(isTextAttachmentMime('text/plain')).toBe(true);
    expect(isTextAttachmentMime('text/csv; charset=utf-8')).toBe(true);
    expect(isTextAttachmentMime('application/json')).toBe(true);
    expect(isTextAttachmentMime('application/pdf')).toBe(false);
    expect(isTextAttachmentMime('application/zip')).toBe(false);
    expect(isTextAttachmentMime('image/png')).toBe(false);
  });
});

describe('sanitizeAttachmentName', () => {
  it('drops directories and control characters', () => {
    expect(sanitizeAttachmentName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeAttachmentName('C:\\Users\\ada\\report.pdf')).toBe('report.pdf');
    expect(sanitizeAttachmentName('re\u0000po\u001frt.pdf')).toBe('report.pdf');
    expect(sanitizeAttachmentName('  notes.txt  ')).toBe('notes.txt');
    expect(sanitizeAttachmentName('')).toBe('file');
    expect(sanitizeAttachmentName('..')).toBe('..');
  });

  it('cuts a long name at 200 code points without splitting a surrogate pair', () => {
    expect(sanitizeAttachmentName('a'.repeat(300))).toHaveLength(200);
    const emoji = '😀'.repeat(300);
    const cut = sanitizeAttachmentName(emoji);
    expect([...cut]).toHaveLength(200);
    expect(cut).toBe('😀'.repeat(200));
  });
});

describe('CreateAttachment', () => {
  it('parses a valid upload and refuses an unsupported type or oversize file', () => {
    expect(
      CreateAttachment.parse({ name: 'notes.txt', mimeType: 'text/plain', size: 10, threadId: 't1' }),
    ).toEqual({ name: 'notes.txt', mimeType: 'text/plain', size: 10, threadId: 't1' });
    expect(() =>
      CreateAttachment.parse({ name: 'x.bin', mimeType: 'application/octet-stream', size: 10, threadId: 't1' }),
    ).toThrow(/unsupported attachment type/);
    expect(() =>
      CreateAttachment.parse({ name: 'big.bin', mimeType: 'application/pdf', size: ATTACHMENT_MAX_BYTES + 1, threadId: 't1' }),
    ).toThrow();
    expect(() =>
      CreateAttachment.parse({ name: 'empty.txt', mimeType: 'text/plain', size: 0, threadId: 't1' }),
    ).toThrow();
    expect(() =>
      CreateAttachment.parse({ name: 'a'.repeat(201), mimeType: 'text/plain', size: 10, threadId: 't1' }),
    ).toThrow();
  });
});
