/** The commands the composer understands. */
export type CommandName = 'help' | 'new' | 'rename' | 'model' | 'stop';

export interface ParsedCommand {
  /** Lowercased command word; an unknown word still parses so the UI can hint. */
  name: string;
  /** Everything after the command word, trimmed. */
  args: string;
}

export interface CommandSpec {
  name: CommandName;
  usage: string;
  descriptionKey:
    | 'composer.commands.helpDesc'
    | 'composer.commands.newDesc'
    | 'composer.commands.renameDesc'
    | 'composer.commands.modelDesc'
    | 'composer.commands.stopDesc';
  /** DM-only commands are refused in rooms. */
  directOnly: boolean;
}

/** Every command, in the order /help lists them. */
export const COMMANDS: readonly CommandSpec[] = [
  { name: 'help', usage: '/help', descriptionKey: 'composer.commands.helpDesc', directOnly: false },
  { name: 'new', usage: '/new', descriptionKey: 'composer.commands.newDesc', directOnly: true },
  { name: 'rename', usage: '/rename <title>', descriptionKey: 'composer.commands.renameDesc', directOnly: false },
  { name: 'model', usage: '/model <provider>/<model> | default', descriptionKey: 'composer.commands.modelDesc', directOnly: true },
  { name: 'stop', usage: '/stop', descriptionKey: 'composer.commands.stopDesc', directOnly: false },
];

const COMMAND = /^\/([A-Za-z][A-Za-z0-9_-]*)(?:\s+([\s\S]*))?$/;

/**
 * Parses a slash command. Text without `/word` at the start is a normal message and returns null.
 * An unknown command still parses (name is not a CommandName) so the composer can hint instead of sending.
 */
export function parseCommand(text: string): ParsedCommand | null {
  const match = COMMAND.exec(text.trim());
  if (match === null) return null;
  return { name: (match[1] ?? '').toLowerCase(), args: (match[2] ?? '').trim() };
}

/** Whether the parsed name is one the composer knows. */
export function isKnownCommand(name: string): name is CommandName {
  return COMMANDS.some((command) => command.name === name);
}

/** The command suggestions for a partially typed `/word` (no arguments yet). */
export function suggestCommands(prefix: string): readonly CommandSpec[] {
  const word = prefix.replace(/^\//, '').toLowerCase();
  if (word.includes(' ')) return [];
  return COMMANDS.filter((command) => command.name.startsWith(word));
}

/** A model reference as the protocol expects it: `<provider>/<model>`, split at the first slash. */
export function isValidModelRef(ref: string): boolean {
  const slash = ref.indexOf('/');
  return slash > 0 && slash < ref.length - 1 && !/\s/.test(ref);
}

/** Inserts dictated text at the caret, keeping the existing draft and one space between words. */
export function insertDictation(draft: string, caret: number, text: string): { text: string; caret: number } {
  const spoken = text.trim();
  if (spoken === '') return { text: draft, caret };
  const at = Math.max(0, Math.min(caret, draft.length));
  const before = draft.slice(0, at);
  const after = draft.slice(at);
  const prefix = before === '' || /\s$/.test(before) ? '' : ' ';
  const suffix = after === '' || /^\s/.test(after) ? '' : ' ';
  const inserted = `${prefix}${spoken}${suffix}`;
  const next = `${before}${inserted}${after}`;
  return { text: next, caret: before.length + inserted.length };
}
