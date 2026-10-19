/** Who can be mentioned: a bot's id and display name. */
export interface Mentionable {
  id: string;
  name: string;
}

const MENTION = /@([\p{L}\p{N}_-]+)/gu;

function byName(members: readonly Mentionable[], name: string): Mentionable | undefined {
  const needle = name.toLocaleLowerCase();
  return members.find((member) => member.name.toLocaleLowerCase() === needle);
}

/** Ids of the members mentioned as `@Name`, in first-mention order. Names may hold any letter, like "Onça". */
export function findMentions(content: string, members: readonly Mentionable[]): string[] {
  const found: string[] = [];
  for (const match of content.matchAll(MENTION)) {
    const member = byName(members, match[1] ?? '');
    if (member && !found.includes(member.id)) found.push(member.id);
  }
  return found;
}

export type MentionPart = { kind: 'text'; text: string } | { kind: 'mention'; text: string; botId: string };

/** Splits text into plain runs and `@Name` mentions of known members, for rendering mention chips. */
export function splitMentions(content: string, members: readonly Mentionable[]): MentionPart[] {
  const parts: MentionPart[] = [];
  let last = 0;
  for (const match of content.matchAll(MENTION)) {
    const member = byName(members, match[1] ?? '');
    if (!member) continue;
    const start = match.index;
    if (start > last) parts.push({ kind: 'text', text: content.slice(last, start) });
    parts.push({ kind: 'mention', text: match[0], botId: member.id });
    last = start + match[0].length;
  }
  if (last < content.length) parts.push({ kind: 'text', text: content.slice(last) });
  return parts;
}

/**
 * The mention being typed right before the caret: the `@` position and the query after it. A mention
 * starts the text or follows whitespace, so emails like ana@acme.com never open the menu.
 */
export function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(?:^|\s)@([\p{L}\p{N}_-]*)$/u.exec(before);
  if (!match) return null;
  const query = match[1] ?? '';
  return { start: caret - query.length - 1, query };
}

/** Members whose name starts with the query, then those that contain it. */
export function matchMembers<T extends Mentionable>(members: readonly T[], query: string): T[] {
  const needle = query.toLocaleLowerCase();
  const starts = members.filter((member) => member.name.toLocaleLowerCase().startsWith(needle));
  const contains = members.filter(
    (member) => !starts.includes(member) && member.name.toLocaleLowerCase().includes(needle),
  );
  return [...starts, ...contains];
}

/** Replaces the typed `@query` with `@Name ` and returns the new text and caret. */
export function insertMention(
  text: string,
  mention: { start: number; query: string },
  name: string,
): { text: string; caret: number } {
  const end = mention.start + 1 + mention.query.length;
  const inserted = `@${name} `;
  const rest = text.slice(end).replace(/^ /, '');
  return { text: text.slice(0, mention.start) + inserted + rest, caret: mention.start + inserted.length };
}
