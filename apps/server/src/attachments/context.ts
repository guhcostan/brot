import { isTextAttachmentMime, type Attachment } from '@brot/protocol';
import { transcriptAttachmentLine } from '@brot/engines';

/** Most characters one attachment contributes to the prompt. */
export const ATTACHMENT_INLINE_CHARS = 8_000;
/** Most characters all attachments together contribute to one prompt. */
export const ATTACHMENT_INLINE_TOTAL_CHARS = 24_000;

/** UTF-8 uses at most four bytes per code point, so this many bytes always hold the inline budget. */
const BYTES_PER_CHAR = 4;
const TRUNCATION_NOTE = '[truncated]';

/** Where attachment bytes come from, for the prompt. Absent bytes are reported, never fatal. */
export interface AttachmentBytes {
  readPrefix(id: string, maxBytes: number): Promise<Uint8Array | undefined>;
}

/** A human-sized size, e.g. `5 B`, `1.2 KB`, `3.4 MB`. */
export function formatAttachmentSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The prompt-visible list of a message's attachments, appended to its input. Text and JSON content is inlined
 * up to `ATTACHMENT_INLINE_CHARS` per attachment and `ATTACHMENT_INLINE_TOTAL_CHARS` overall; an image is noted,
 * a transcribed voice note carries its transcript line, and a PDF, ZIP or other binary only lists its name and
 * size. With no attachments the input is returned as-is, so prompts without attachments are unchanged. Names,
 * media types and sizes only: no filesystem path enters.
 */
export async function appendAttachmentContext(
  source: AttachmentBytes,
  input: string,
  attachments: readonly Attachment[] | undefined,
  options: { transcripts?: ReadonlyArray<{ name: string; transcript: string }> } = {},
): Promise<string> {
  if (attachments === undefined || attachments.length === 0) return input;
  const transcripts = new Map((options.transcripts ?? []).map((entry) => [entry.name, entry.transcript]));
  const lines: string[] = ['Attachments:'];
  let remaining = ATTACHMENT_INLINE_TOTAL_CHARS;
  for (const attachment of attachments) {
    lines.push(`- ${attachment.name} (${attachment.mimeType}, ${formatAttachmentSize(attachment.size)})`);
    if (attachment.kind === 'image') {
      lines.push('  image attached; the image itself is not part of this text prompt.');
      continue;
    }
    const transcript = transcripts.get(attachment.name);
    if (transcript !== undefined) {
      lines.push(transcriptAttachmentLine(attachment.name, transcript));
      continue;
    }
    if (!isTextAttachmentMime(attachment.mimeType)) continue;
    if (remaining <= 0) {
      lines.push('  content omitted: the attachment text budget is used up.');
      continue;
    }
    const perFile = Math.min(ATTACHMENT_INLINE_CHARS, remaining);
    const bytes = await source.readPrefix(attachment.id, perFile * BYTES_PER_CHAR).catch(() => undefined);
    if (bytes === undefined) {
      lines.push('  content unavailable.');
      continue;
    }
    const decoded = new TextDecoder().decode(bytes);
    const cut = cutText(decoded, perFile);
    const truncated = cut.truncated || bytes.byteLength < attachment.size;
    const fence = fenceFor(cut.text);
    lines.push(fence, cut.text, fence);
    if (truncated) lines.push(TRUNCATION_NOTE);
    remaining -= codePointLength(cut.text);
  }
  return `${input}\n\n${lines.join('\n')}`;
}

/** Cuts `text` to `limit` code points, never splitting a surrogate pair. */
function cutText(text: string, limit: number): { text: string; truncated: boolean } {
  if (limit <= 0) return { text: '', truncated: text.length > 0 };
  let count = 0;
  let index = 0;
  while (index < text.length && count < limit) {
    const code = text.codePointAt(index) ?? 0;
    index += code > 0xffff ? 2 : 1;
    count += 1;
  }
  if (index >= text.length) return { text, truncated: false };
  return { text: text.slice(0, index), truncated: true };
}

function codePointLength(text: string): number {
  return [...text].length;
}

/** A backtick fence longer than any backtick run in the content, so the block cannot end early. */
function fenceFor(content: string): string {
  const runs = content.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}
