import type { Repos } from '@brot/db';
import type { Bot, Message, Thread } from '@brot/protocol';

/** What the engine receives for one run: the earlier messages, and this run's input. */
export interface Turn {
  history: Message[];
  input: string;
}

export interface TurnRequest {
  thread: Thread;
  bot: Bot;
  /** The stored message this run answers. */
  trigger: Message;
  /** Whether the engine resumes this bot's session. A resumed session already holds the earlier turns. */
  resumed: boolean;
  /** The message this bot's previous run in the thread answered, when this process started that run. */
  previousTriggerId?: string;
}

const HUMAN_LABEL = 'User';
const UNKNOWN_BOT_LABEL = 'Bot';

/**
 * Builds one run's context. In a room, and for any bot that is not the thread's own, each message is
 * labeled with its author ("[Capy]: ...") and the bot's own replies stay assistant turns. In a plain DM
 * messages keep their roles, and only bot-authored messages get a label.
 *
 * A resumed session already holds what its bot has seen, so the input also carries the messages posted
 * since that bot last ran here, minus its own. Without that, another bot's reply would never reach it.
 */
export async function buildTurn(repos: Repos, request: TurnRequest): Promise<Turn> {
  const { thread, bot, trigger, resumed, previousTriggerId } = request;
  const names = new Map((await repos.bots.list({ includeArchived: true })).map((item) => [item.id, item.name]));
  const labelHumans = thread.kind === 'room' || bot.id !== thread.botId;
  const nameOf = (botId: string): string => names.get(botId) ?? UNKNOWN_BOT_LABEL;

  const turnOf = (message: Message): Message => {
    if (message.role === 'assistant') {
      const author = message.authorBotId ?? thread.botId;
      if (author === bot.id) return message;
      return { ...message, role: 'user', content: `[${nameOf(author)}]: ${message.content}` };
    }
    if (message.role === 'user') {
      if (message.authorBotId !== undefined) {
        return { ...message, content: `[${nameOf(message.authorBotId)}]: ${message.content}` };
      }
      if (labelHumans) return { ...message, content: `[${HUMAN_LABEL}]: ${message.content}` };
    }
    return message;
  };

  const all = await repos.messages.listByThread(thread.id);
  const history = all.filter((message) => message.id !== trigger.id).map(turnOf);
  const input = turnOf(trigger).content;
  if (!labelHumans || !resumed) return { history, input };

  const unseen = (message: Message): boolean => message.id !== trigger.id && message.authorBotId !== bot.id;
  const previousAt = previousTriggerId === undefined ? -1 : all.findIndex((message) => message.id === previousTriggerId);
  let missed: Message[];
  if (previousAt >= 0) {
    missed = all.slice(previousAt + 1).filter(unseen);
  } else {
    // Started before this process ran, so the last run's trigger is unknown. Fall back to its start time.
    const lastRun = (await repos.runs.listByThread(thread.id)).filter((run) => run.botId === bot.id).at(-1);
    missed = lastRun ? all.filter((message) => unseen(message) && message.createdAt > lastRun.startedAt) : [];
  }
  return { history, input: [...missed.map((message) => turnOf(message).content), input].join('\n') };
}
