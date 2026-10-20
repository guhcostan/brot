export interface TextPart {
  text: string;
  mention: boolean;
}

const MENTION = /(@[\p{L}]+)/u;

/** Splits a chat line into plain text and @mentions, so mentions can be set apart. */
export function splitMentions(text: string): TextPart[] {
  return text
    .split(MENTION)
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, mention: MENTION.test(part) && part.startsWith('@') }));
}
