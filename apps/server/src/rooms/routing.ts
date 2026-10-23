import type { ResponderMode } from '@brot/protocol';

export interface MentionableBot {
  id: string;
  name: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Member bots named in a message, in the order they first appear. `@Name` matches case-insensitively
 * and must stand alone, so `@Ana` does not match `@Anastasia`. `extraIds` (explicit mentions) follow,
 * and only members survive.
 */
export function resolveMentions(content: string, members: readonly MentionableBot[], extraIds: readonly string[] = []): string[] {
  const hits: Array<{ id: string; index: number }> = [];
  for (const bot of members) {
    const name = bot.name.trim();
    if (name === '') continue;
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])@${escapeRegExp(name)}(?![\\p{L}\\p{N}_])`, 'iu');
    const match = pattern.exec(content);
    if (match) hits.push({ id: bot.id, index: match.index });
  }
  const mentioned = hits.sort((a, b) => a.index - b.index).map((hit) => hit.id);
  const memberIds = new Set(members.map((bot) => bot.id));
  for (const id of extraIds) {
    if (memberIds.has(id) && !mentioned.includes(id)) mentioned.push(id);
  }
  return mentioned;
}

/**
 * The bots that answer one room message, in order. Mentioned bots answer in every mode. With nobody mentioned,
 * `lead` answers with the baton holder or the lead bot, and `mention` stays silent. `auto` returns nothing here:
 * the room service asks the decider for a pick first, then falls back to the lead rules.
 */
export function chooseResponders(input: {
  responder: ResponderMode;
  mentions: readonly string[];
  leadBotId: string;
  baton?: string;
}): string[] {
  if (input.mentions.length > 0) return [...input.mentions];
  if (input.responder === 'mention' || input.responder === 'auto') return [];
  return [input.baton ?? input.leadBotId];
}
