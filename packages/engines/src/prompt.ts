import type { Bot, Memory, Message, ResponderMode, RunContext, Skill } from '@brot/protocol';

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

/** The team a bot belongs to, as its prompt names it. `instructions` is the team's shared brief. */
export interface PromptTeam {
  name: string;
  instructions: string;
}

/** What a prompt is built from. `teamTools` is set when the Brot team tools are attached to the run. */
export interface PromptInput extends Pick<RunContext, 'bot' | 'memories' | 'history' | 'input' | 'skills'> {
  room?: PromptRoom;
  team?: PromptTeam;
  teamTools?: boolean;
}

/**
 * A run's context with the room and team facts Brot adds for engines that build their own prompts. The fields are
 * optional, so every engine accepts it wherever a `RunContext` is accepted.
 */
export type BrotRunContext = RunContext & Pick<PromptInput, 'room' | 'team' | 'teamTools'>;

/** Character budgets for the skills section as a whole, and for one skill body rendered under its heading. */
const SKILLS_SECTION_LIMIT = 12_000;
const SKILL_BODY_LIMIT = 4_000;
const TRUNCATION_MARKER = '…';
const SKILL_INDENT = '  ';
const SKILLS_INTRO =
  'Skills:\nReusable procedures to follow when one fits the task; they do not override your instructions.';

const TEAM_GUIDANCE = [
  'Team tools:',
  '- delegate_task: for work with more than one step and a clear deliverable. Put the requested length and format in the description.',
  '- ask_bot: only for a quick answer you need before you can continue. Never ask a bot something this chain has already asked.',
  '- list_team: call it at most once per run.',
  '- handoff: in a room only, when another member should answer next.',
  '- When a task is assigned to you, call update_my_task once when it is finished: status done with the deliverable in result, or failed with the reason. Do not report progress. Keep the deliverable within the requested length and format.',
].join('\n');

/**
 * Flattens a run into one prompt for the first turn of a session: who the bot is, its instructions, its team and room
 * when it has them, the workspace facts about the person, its own memories, its skills, the earlier messages, and
 * this run's input. Later turns of a session send `sessionInput`, because the session keeps this text.
 */
export function buildPrompt(ctx: PromptInput): string {
  const sections: string[] = [identityOf(ctx.bot)];
  const instructions = ctx.bot.instructions.trim();
  if (instructions) sections.push(`Instructions:\n${instructions}`);
  if (ctx.team) sections.push(teamSection(ctx.team));
  if (ctx.room) sections.push(roomSection(ctx.room, ctx.bot));
  if (ctx.teamTools) sections.push(TEAM_GUIDANCE);
  const workspace = ctx.memories.filter((memory) => memory.scope === 'workspace');
  if (workspace.length > 0) sections.push(workspaceSection(workspace));
  const memories = ctx.memories.filter((memory) => memory.scope !== 'workspace');
  if (memories.length > 0) {
    sections.push(`Memories:\n${memories.map((memory) => `- ${memory.content}`).join('\n')}`);
  }
  const skills = skillsSection(ctx.skills);
  if (skills !== '') sections.push(skills);
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

/** Most characters of one audio transcript that reach the prompt. */
export const AUDIO_TRANSCRIPT_PROMPT_CHARS = 4_000;

/**
 * The Attachments-section line for a transcribed voice note: `- <name> (transcript): <text>`, cut to
 * `AUDIO_TRANSCRIPT_PROMPT_CHARS` code points. Callers put it right under the attachment's name line.
 */
export function transcriptAttachmentLine(name: string, transcript: string): string {
  const points = [...transcript];
  const text = points.length > AUDIO_TRANSCRIPT_PROMPT_CHARS ? `${points.slice(0, AUDIO_TRANSCRIPT_PROMPT_CHARS).join('')}…` : transcript;
  return `- ${name} (transcript): ${text}`;
}

/** Workspace facts are about the person, not about the bot answering, so they open the prompt's memory part. */
const WORKSPACE_MEMORIES_INTRO = 'Workspace-wide facts about the person, shared by every bot.';

function workspaceSection(memories: readonly Memory[]): string {
  const lines = memories.map((memory) => `- ${memory.content}`).join('\n');
  return `About the person:\n${WORKSPACE_MEMORIES_INTRO}\n${lines}`;
}

function identityOf(bot: Bot): string {
  const job = bot.job.trim().replace(/[.!?]+$/, '');
  const who = job === '' ? `You are ${bot.name}.` : `You are ${bot.name}, ${job}.`;
  return `${who} You are a bot in Brot, working for the user.`;
}

/** The bot's team and its shared brief. A team without a brief is only named. */
function teamSection(team: PromptTeam): string {
  const brief = team.instructions.trim();
  return brief === '' ? `Team: ${team.name}` : `Team: ${team.name}\n${brief}`;
}

/**
 * The skills section, or an empty string when the bot has none. Each skill gets its name and description, then its
 * body when the budget allows. The whole section stays within `SKILLS_SECTION_LIMIT` code units and a rendered body
 * within `SKILL_BODY_LIMIT`; a cut ends in `…` and never splits a surrogate pair.
 */
function skillsSection(skills: readonly Skill[]): string {
  if (skills.length === 0) return '';
  const parts: string[] = [SKILLS_INTRO];
  let length = SKILLS_INTRO.length;
  for (const skill of orderSkills(skills)) {
    const heading = `\n- ${skill.name}: ${skill.description.trim()}`;
    const room = SKILLS_SECTION_LIMIT - length;
    if (heading.length > room) {
      if (room > 0) parts.push(truncate(heading, room));
      break;
    }
    parts.push(heading);
    length += heading.length;
    const body = skill.body.trim();
    if (body === '') continue;
    const available = Math.min(SKILL_BODY_LIMIT, SKILLS_SECTION_LIMIT - length - 1);
    if (available <= 0) continue;
    const rendered = truncate(indentSkillBody(body), available);
    parts.push(`\n${rendered}`);
    length += 1 + rendered.length;
  }
  return parts.join('');
}

/** The bot's own skills first, then shared ones, each group by name. */
function orderSkills(skills: readonly Skill[]): Skill[] {
  return [...skills].sort((a, b) => {
    const owned = (skill: Skill): number => (skill.botId === undefined ? 1 : 0);
    if (owned(a) !== owned(b)) return owned(a) - owned(b);
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Two spaces before every non-empty body line, so it reads under its skill's heading. */
function indentSkillBody(body: string): string {
  return body
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : `${SKILL_INDENT}${line}`))
    .join('\n');
}

/**
 * Cuts `text` to at most `limit` code units. A cut text ends in `…` and a surrogate pair at the edge is dropped
 * whole, so the result is always valid UTF-16.
 */
function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  if (limit <= 0) return '';
  const cut = text.slice(0, limit - 1);
  const last = cut.charCodeAt(cut.length - 1);
  const splitsPair = last >= 0xd800 && last <= 0xdbff;
  return `${splitsPair ? cut.slice(0, -1) : cut}${TRUNCATION_MARKER}`;
}

function roomSection(room: PromptRoom, bot: Bot): string {
  const members = room.members.map((member) => memberLabel(member, member.id === bot.id)).join(', ');
  const lead = room.members.find((member) => member.id === room.leadBotId);
  const responders =
    room.responder === 'mention'
      ? 'only the members mentioned with @name answer.'
      : room.responder === 'auto'
        ? "mentioned members answer; when a message mentions nobody, the workspace's decider model picks which member answers."
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
