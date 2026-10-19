import type { Message, RunContext } from '@brot/protocol';

export const HISTORY_LIMIT = 20;

const ROLE_LABEL: Record<Message['role'], string> = {
  user: 'User',
  assistant: 'Assistant',
  system: 'System',
};

/**
 * Flattens a run into one prompt for the first turn of a DSH session. Later turns send only the
 * new input, because the session keeps its own history.
 */
export function buildPrompt(ctx: Pick<RunContext, 'bot' | 'memories' | 'history' | 'input'>): string {
  const sections: string[] = [];
  const instructions = ctx.bot.instructions.trim();
  if (instructions) sections.push(`Instructions:\n${instructions}`);
  if (ctx.memories.length > 0) {
    sections.push(`Memories:\n${ctx.memories.map((memory) => `- ${memory.content}`).join('\n')}`);
  }
  const history = ctx.history.slice(-HISTORY_LIMIT);
  if (history.length > 0) {
    sections.push(`Conversation so far:\n${history.map((m) => `${ROLE_LABEL[m.role]}: ${m.content}`).join('\n')}`);
  }
  sections.push(`Current message:\n${ctx.input}`);
  return sections.join('\n\n');
}
