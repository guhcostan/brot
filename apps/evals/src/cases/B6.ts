import { check, info } from '../checks';
import type { Case, Evidence } from '../types';
import { ANIMAL, botKeyByRun, botSpec } from './shared';

/** Each bot's file is named after the bot: `owned-by-<key>.txt`. */
const FILE_OF = (key: string): string => `owned-by-${key}.txt`;

/** The bot a file is named for, or undefined when the name does not follow the pattern. */
function ownerOf(file: string): string | undefined {
  return /^owned-by-([a-z]+)\.txt$/.exec(file)?.[1];
}

/** How a bot wrote a file: a write command in one of its tool calls, or a reply that says it wrote the file. */
interface Writer {
  bot: string;
  how: 'ran a write command' | 'claimed it in its reply';
}

/** A shell command that puts content into a file. Reads such as `cat` or `ls` do not count. */
const WRITE_COMMAND = /(>|\btee\b|\btouch\b|\bcp\b|\bmv\b|\bprintf\b|\becho\b|\bwrite|\bcreate)/i;
const WRITE_CLAIM = /\b(creat|wrote|written|saved|made|write)/i;
const NEGATED = /\b(not|never|no)\b|n't/i;

/**
 * How one bot wrote a file in its own computer, from its runs. A write lands only in the computer of the bot that ran
 * it, so only that bot's tool calls and reply can show it: a write command that names the file, or a sentence in its
 * last reply that claims the write without a negation. A sentence like "I did not touch it" does not count.
 */
function writesBy(evidence: Evidence, key: string, file: string): Writer[] {
  const keys = botKeyByRun(evidence);
  const writes: Writer[] = [];
  const commanded = evidence.events.some((event) => {
    if (event.type !== 'tool.call' || event.runId === undefined || keys.get(event.runId) !== key) return false;
    const args = JSON.stringify(event.args);
    return args.includes(file) && WRITE_COMMAND.test(args);
  });
  if (commanded) writes.push({ bot: key, how: 'ran a write command' });
  const claimed = evidence.finalTexts
    .filter((entry) => entry.botKey === key)
    .some((entry) => sentences(entry.text).some((sentence) => sentence.includes(file) && WRITE_CLAIM.test(sentence) && !NEGATED.test(sentence)));
  if (claimed) writes.push({ bot: key, how: 'claimed it in its reply' });
  return writes;
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/);
}

function describeWriters(writers: Writer[]): string {
  return writers.map((writer) => `${writer.bot}, ${writer.how}`).join('; ') || 'no bot';
}

/** One line per computer, each on its own: its files, and whether its own bot wrote each one. */
function describeWorkspaces(evidence: Evidence, workspaces: Record<string, string[]>): string {
  return Object.entries(workspaces)
    .map(([key, files]) => {
      const described = files.map((file) => {
        const own = writesBy(evidence, key, file);
        return own.length > 0 ? `${file} (written by ${describeWriters(own)})` : `${file} (not written by ${key})`;
      });
      return `${key} /workspace: ${described.join(', ') || 'empty'}`;
    })
    .join('; ');
}

export const B6: Case = {
  id: 'B6',
  title: 'Two bots, two computers: each edits only its own /workspace',
  status: 'now',
  async setup(ctx) {
    await ctx.createBot('onca', botSpec('onca', 'File writer', 'You write the file you are asked to write, in your own /workspace, and nowhere else.', []));
    await ctx.createBot('tuca', botSpec('tuca', 'File writer', 'You write the file you are asked to write, in your own /workspace, and nowhere else.', []));
    await ctx.room('room', { title: 'Two computers', members: ['onca', 'tuca'], lead: 'onca', responder: 'mention' });
  },
  async run(ctx) {
    await ctx.sayAndWait(
      'room',
      `@${ANIMAL.onca.name} create /workspace/${FILE_OF('onca')} containing the word onca. @${ANIMAL.tuca.name} create /workspace/${FILE_OF('tuca')} containing the word tuca. Write only in your own workspace.`,
      ['onca', 'tuca'],
    );
    const listing = async (key: string): Promise<string[]> =>
      (await ctx.exec(key, 'ls -1 /workspace')).stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
    ctx.probes.workspaces = { onca: await listing('onca'), tuca: await listing('tuca') };
  },
  check(evidence) {
    const workspaces = (evidence.probes.workspaces ?? {}) as Record<string, string[]>;
    const onca = workspaces.onca ?? [];
    const tuca = workspaces.tuca ?? [];
    const ownOnca = onca.includes(FILE_OF('onca'));
    const ownTuca = tuca.includes(FILE_OF('tuca'));

    // Every file that names a bot, found in a computer that is not that bot's.
    const crossed = Object.entries(workspaces).flatMap(([key, files]) =>
      files.flatMap((file) => {
        const owner = ownerOf(file);
        if (owner === undefined || owner === key) return [];
        const own = writesBy(evidence, key, file);
        return [{ key, file, owner, own, writers: writesBy(evidence, owner, file), confusion: own.length > 0 }];
      }),
    );
    // Identity confusion: the bot wrote the other bot's filename into its own workspace, by its own tool call or reply.
    const confusion = crossed.filter((entry) => entry.confusion);
    // Isolation breach: a file that the bot did not write showed up in a computer that is not its owner's.
    const breaches = crossed.filter((entry) => !entry.confusion);

    return [
      info('workspaces', 'Each computer’s /workspace, and which bot wrote each file', describeWorkspaces(evidence, workspaces)),
      check('onca-writes-own', 'Onça wrote her file in her own /workspace', ownOnca, `onca /workspace: ${onca.join(', ') || 'empty'}`),
      check('tuca-writes-own', 'Tuca wrote his file in his own /workspace', ownTuca, `tuca /workspace: ${tuca.join(', ') || 'empty'}`),
      check(
        'no-cross-write',
        'Isolation: no file reached a computer its writer does not own',
        breaches.length === 0,
        breaches.length === 0
          ? 'no isolation breach'
          : `isolation breach: ${breaches.map((entry) => `${entry.file} in ${entry.key} (${entry.owner}’s file, written by ${describeWriters(entry.writers)})`).join('; ')}`,
      ),
      check(
        'no-identity-confusion',
        'Identity: no bot wrote another bot’s filename into its own workspace',
        confusion.length === 0,
        confusion.length === 0
          ? 'no identity confusion'
          : `identity confusion: ${confusion.map((entry) => `${entry.key} wrote ${entry.file}, which is ${entry.owner}’s`).join('; ')}`,
      ),
      check('separate-computers', 'The two bots have different computers', evidence.bots.onca?.id !== evidence.bots.tuca?.id, 'distinct bot ids'),
    ];
  },
};
