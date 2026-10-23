import type { MessageItem } from './state/thread';

/** Caps applied to a skill saved from a conversation. CreateSkill itself has no explicit length caps. */
export const SKILL_NAME_MAX = 120;
export const SKILL_DESCRIPTION_MAX = 500;
export const SKILL_BODY_MAX = 20_000;
/** How many of the most recent messages the transcript keeps. */
export const SKILL_TRANSCRIPT_MAX = 10;

/** One line of the saved transcript: a message, or a tool the bot used between messages. */
export type SkillTranscriptEntry =
  | { kind: 'message'; role: MessageItem['role']; content: string; author?: string }
  | { kind: 'tool'; tool: string };

export interface SkillDraft {
  name: string;
  description: string;
  body: string;
}

const ROLE_AUTHOR: Record<MessageItem['role'], string> = {
  user: 'You',
  assistant: 'Assistant',
  system: 'System',
};

const truncate = (text: string, max: number): string => (text.length <= max ? text : text.slice(0, max).trimEnd());

/** The first paragraph of the first assistant message, flattened to one line. */
function firstAssistantDescription(entries: readonly SkillTranscriptEntry[]): string {
  const assistant = entries.find((entry) => entry.kind === 'message' && entry.role === 'assistant');
  if (assistant === undefined || assistant.kind !== 'message') return '';
  const paragraph = assistant.content
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find((part) => part !== '');
  if (paragraph === undefined) return '';
  return truncate(paragraph.replace(/\s+/g, ' '), SKILL_DESCRIPTION_MAX);
}

/**
 * Builds the editable prefill for "Save as a skill": a name from the thread title, a description from the
 * first assistant paragraph, and a Markdown transcript of the last messages (with tools used between them).
 * Unknown or empty inputs yield empty fields rather than throwing; every field is capped.
 */
export function buildSkillDraft(
  entries: readonly SkillTranscriptEntry[],
  options: { title?: string; fallbackName?: string } = {},
): SkillDraft {
  const fallbackName = options.fallbackName?.trim() || 'Conversation';
  const name = truncate(options.title?.trim() || fallbackName, SKILL_NAME_MAX);
  const description = firstAssistantDescription(entries);

  const messagePositions = entries.flatMap((entry, index) => (entry.kind === 'message' ? [index] : []));
  const window = messagePositions.slice(-SKILL_TRANSCRIPT_MAX);
  const start = window[0] ?? entries.length;
  const lines: string[] = [];
  for (let index = start; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined) continue;
    if (entry.kind === 'tool') {
      lines.push(`used tool ${entry.tool}`);
      continue;
    }
    const content = entry.content.trim();
    if (content === '') continue;
    lines.push(`**${entry.author?.trim() || ROLE_AUTHOR[entry.role]}:** ${content}`);
  }

  return {
    name,
    description,
    body: truncate(lines.join('\n\n'), SKILL_BODY_MAX),
  };
}
