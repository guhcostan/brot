import { z } from 'zod';

/** The largest file a message may carry. */
export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
/** The most attachments one message may link. */
export const ATTACHMENT_MAX_PER_MESSAGE = 10;
/** A display name longer than this is cut; the name is never used as a path. */
export const ATTACHMENT_NAME_MAX_LENGTH = 200;

/** Image types the chat accepts, shown to the model as an image note. */
export const ATTACHMENT_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

/** Audio types the chat accepts as voice notes; an opt-in transcription model may turn them into text. */
export const ATTACHMENT_AUDIO_MIME_TYPES = [
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/aac',
  'audio/flac',
] as const;

/** Document types the chat accepts beyond `text/*`. Everything else is refused. */
export const ATTACHMENT_FILE_MIME_TYPES = ['application/json', 'application/pdf', 'application/zip'] as const;

/** The bare media type, without parameters and lower-cased. */
function baseMimeType(mimeType: string): string {
  return (mimeType.split(';')[0] ?? '').trim().toLowerCase();
}

/** Images, audio, `text/*`, JSON, PDF and ZIP. A file outside this list cannot be attached. */
export function isAllowedAttachmentMime(mimeType: string): boolean {
  const base = baseMimeType(mimeType);
  if (base === '') return false;
  return (
    (ATTACHMENT_IMAGE_MIME_TYPES as readonly string[]).includes(base) ||
    (ATTACHMENT_AUDIO_MIME_TYPES as readonly string[]).includes(base) ||
    base.startsWith('text/') ||
    (ATTACHMENT_FILE_MIME_TYPES as readonly string[]).includes(base)
  );
}

/** True when the attachment is one of the audio types above; a voice note. */
export function isAudioAttachmentMime(mimeType: string): boolean {
  return (ATTACHMENT_AUDIO_MIME_TYPES as readonly string[]).includes(baseMimeType(mimeType));
}

/** Images get an image note, audio a transcript or name, and everything else is a file. */
export function attachmentKindFor(mimeType: string): 'image' | 'audio' | 'file' {
  const base = baseMimeType(mimeType);
  if (base.startsWith('image/')) return 'image';
  if (isAudioAttachmentMime(base)) return 'audio';
  return 'file';
}

/** `text/*` and JSON can be inlined into the prompt. PDFs and ZIPs are binary. */
export function isTextAttachmentMime(mimeType: string): boolean {
  const base = baseMimeType(mimeType);
  return base.startsWith('text/') || base === 'application/json';
}

/**
 * A safe display name: the last path segment, without control characters, cut to
 * `ATTACHMENT_NAME_MAX_LENGTH` code points. It is never used as a path component.
 */
export function sanitizeAttachmentName(name: string): string {
  const base = name.split(/[\\/]/).at(-1) ?? '';
  let cleaned = '';
  for (const character of base) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) cleaned += character;
  }
  cleaned = cleaned.trim();
  const codePoints = [...cleaned];
  if (codePoints.length === 0) return 'file';
  return codePoints.slice(0, ATTACHMENT_NAME_MAX_LENGTH).join('');
}

/** A media type the chat accepts. */
export const AttachmentMime = z
  .string()
  .min(1)
  .max(200)
  .refine(isAllowedAttachmentMime, 'unsupported attachment type');

/** A display name for an attachment. */
export const AttachmentName = z.string().min(1).max(ATTACHMENT_NAME_MAX_LENGTH);

/**
 * The metadata of an upload, once the server has read and checked the multipart file. The bytes stay on the
 * server's disk; this schema carries no content.
 */
export const CreateAttachment = z.object({
  name: AttachmentName,
  mimeType: AttachmentMime,
  size: z.number().int().positive().max(ATTACHMENT_MAX_BYTES),
  threadId: z.string().min(1),
});
export type CreateAttachment = z.infer<typeof CreateAttachment>;
