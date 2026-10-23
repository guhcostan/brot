import type { MessageItem, TimelineItem } from './state/thread';

/** Roles whose settled text the UI lets a person copy. */
const COPYABLE_ROLES: ReadonlySet<MessageItem['role']> = new Set(['user', 'assistant', 'system']);

/** The full text of one message, from state (never from clamped DOM nodes). */
export function copyableMessageText(message: Pick<MessageItem, 'role' | 'content'>): string {
  if (!COPYABLE_ROLES.has(message.role)) return '';
  return message.content.trim() === '' ? '' : message.content;
}

/** Joins the settled, copyable message text of a conversation; tool items and other records are ignored. */
export function copyableConversationText(items: readonly TimelineItem[]): string {
  return items
    .filter((item): item is MessageItem => item.kind === 'message')
    .map((message) => copyableMessageText(message))
    .filter((text) => text !== '')
    .join('\n\n');
}

export interface MarkdownCodeBlock {
  /** The info string's first word, e.g. "ts"; empty when the fence has no language. */
  language: string;
  /** The exact code between the fences, without the fences and without the newline before the closing fence. */
  code: string;
}

export type MarkdownSegment =
  | { kind: 'text'; text: string }
  | ({ kind: 'code' } & MarkdownCodeBlock);

const FENCE = /^```([^\n]*)\n([\s\S]*?)^```[ \t]*$/gm;

/** Fenced code blocks from Markdown source, in order. Unclosed fences stay text. */
export function extractCodeBlocks(markdown: string): MarkdownCodeBlock[] {
  return [...markdown.matchAll(FENCE)].map((match) => ({
    language: (match[1] ?? '').trim().split(/\s+/)[0] ?? '',
    code: (match[2] ?? '').replace(/\n$/, ''),
  }));
}

/** Splits Markdown into text runs and fenced code blocks, so rendered messages can offer copy per block. */
export function splitMarkdown(markdown: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  let last = 0;
  for (const match of markdown.matchAll(FENCE)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ kind: 'text', text: markdown.slice(last, start) });
    segments.push({
      kind: 'code',
      language: (match[1] ?? '').trim().split(/\s+/)[0] ?? '',
      code: (match[2] ?? '').replace(/\n$/, ''),
    });
    last = start + match[0].length;
  }
  if (last < markdown.length) segments.push({ kind: 'text', text: markdown.slice(last) });
  return segments;
}

/** Copies text with the async Clipboard API, feature-detected at call time so SSR and old browsers are safe. */
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (clipboard === undefined || typeof clipboard.writeText !== 'function') return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
