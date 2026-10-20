import type { Bot, Message, ResponderMode, RunContext } from '@brot/protocol';

export const HISTORY_LIMIT = 20;

const ROLE_LABEL: Record<Message['role'], string> = {
  user: 'User',
  assistant: 'Assistant',
  system: 'System',
};

/** A room member as a prompt names it. */
export interface PromptMember {
  id: string;
  name: string;
  job: string;
}

/** The room a run answers in. Set only for runs in a room. */
export interface PromptRoom {
  title: string;
  responder: ResponderMode;
  leadBotId?: string;
  members: PromptMember[];
}

/** What a prompt is built from. `teamTools` is set when the Brot team tools are attached to the run. */
export interface PromptInput extends Pick<RunContext, 'bot' | 'memories' | 'history' | 'input'> {
  room?: PromptRoom;
  teamTools?: boolean;
}

/**
 * A run's context with the room and team facts Brot adds for engines that build their own prompts. The fields are
 * optional, so every engine accepts it wherever a `RunContext` is accepted.
 */
export type BrotRunContext = RunContext & Pick<PromptInput, 'room' | 'teamTools'>;

const TEAM_GUIDANCE = [
  'Team tools:',
  '- delegate_task: for work with more than one step and a clear deliverable. Put the requested length and format in the description.',
  '- ask_bot: only for a quick answer you need before you can continue. Never ask a bot something this chain has already asked.',
  '- list_team: call it at most once per run.',
  '- handoff: in a room only, when another member should answer next.',
  '- When a task is assigned to you, call update_my_task once when it is finished: status done with the deliverable in result, or failed with the reason. Do not report progress. Keep the deliverable within the requested length and format.',
].join('\n');

/**
 * Flattens a run into one prompt for the first turn of a session: who the bot is, its instructions, its room and team
 * when it has them, its memories, the earlier messages, and this run's input. Later turns of a session send
 * `sessionInput`, because the session keeps this text.
 */
export function buildPrompt(ctx: PromptInput): string {
  const sections: string[] = [identityOf(ctx.bot)];
  const instructions = ctx.bot.instructions.trim();
  if (instructions) sections.push(`Instructions:\n${instructions}`);
  if (ctx.room) sections.push(roomSection(ctx.room, ctx.bot));
  if (ctx.teamTools) sections.push(TEAM_GUIDANCE);
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

/**
 * The text a resumed session receives: the new input alone. In a room it starts with a one-line reminder of the bot's
 * name, because the room's history labels other bots' messages with their names.
 */
export function sessionInput(ctx: PromptInput): string {
  return ctx.room ? `[You are ${ctx.bot.name}]\n${ctx.input}` : ctx.input;
}

function identityOf(bot: Bot): string {
  const job = bot.job.trim().replace(/[.!?]+$/, '');
  const who = job === '' ? `You are ${bot.name}.` : `You are ${bot.name}, ${job}.`;
  return `${who} You are a bot in Brot, working for the user.`;
}

function roomSection(room: PromptRoom, bot: Bot): string {
  const members = room.members.map((member) => memberLabel(member, member.id === bot.id)).join(', ');
  const lead = room.members.find((member) => member.id === room.leadBotId);
  const responders =
    room.responder === 'mention'
      ? 'only the members mentioned with @name answer.'
      : 'mentioned members answer; a message that mentions nobody goes to the lead.';
  const lines = [`Room "${room.title}".`, `Members: ${members}.`];
  if (lead) lines.push(`Lead: ${lead.name}.`);
  lines.push(`Responders: ${responders}`, `Messages labeled [Name] were written by that bot; you are ${bot.name}.`);
  return lines.join('\n');
}

function memberLabel(member: PromptMember, isYou: boolean): string {
  const details = [member.job.trim(), isYou ? 'you' : ''].filter((part) => part !== '');
  return details.length === 0 ? member.name : `${member.name} (${details.join(', ')})`;
}
