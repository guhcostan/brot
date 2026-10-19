import { check, keyOf } from '../checks';
import type { Case } from '../types';
import { ANIMAL, botSpec, textsOf } from './shared';

const MEMBERS = ['capy', 'onca', 'tuca', 'tamu'] as const;

export const B2: Case = {
  id: 'B2',
  title: 'Mention mid-way: @Onça answers in her own session, not the lead',
  status: 'now',
  async setup(ctx) {
    await ctx.createBot('capy', botSpec('capy', 'Chief of Staff, leads the team', 'You lead the room and answer questions about the renewal.', []));
    await ctx.createBot('onca', botSpec('onca', 'Bug fixer', 'You fix bugs. When asked for status, answer with the status of your work in one paragraph.', []));
    await ctx.createBot('tuca', botSpec('tuca', 'Sales follow-ups', 'You draft customer follow-up emails.', []));
    await ctx.createBot('tamu', botSpec('tamu', 'Researcher', 'You answer research questions.', []));
    await ctx.room('room', { title: 'Acme renewal (mentions)', members: [...MEMBERS], lead: 'capy' });
    ctx.notes.onca = ANIMAL.onca.name;
  },
  async run(ctx) {
    await ctx.sayAndWait('room', 'Capy, what is the status of the Acme renewal?');
    const threadId = ctx.threadId('room');
    const before = new Set((await ctx.api.listRuns(threadId)).map((run) => run.id));
    await ctx.sayAndWait('room', `@${ANIMAL.onca.name} what is the status of the invoice export bug?`, ['onca']);
    ctx.notes.mentionRunIds = (await ctx.api.listRuns(threadId)).filter((run) => !before.has(run.id)).map((run) => run.id);
  },
  check(evidence) {
    const onca = evidence.bots.onca?.id;
    const mentionRuns = evidence.runs.filter((run) => ((evidence.notes.mentionRunIds as string[] | undefined) ?? []).includes(run.id));
    const roomAfter = evidence.messages.filter((message) => message.threadId === evidence.threads.room && message.role === 'assistant');
    const answeredBy = roomAfter.slice(-3).map((message) => message.authorBotId ?? 'unknown');
    return [
      check('mention-run-exists', 'The mention started at least one run', mentionRuns.length > 0, `${mentionRuns.length} run(s)`),
      check('only-onca-answers', 'Only Onça ran for the mention, not the lead', mentionRuns.length > 0 && mentionRuns.every((run) => run.botId === onca), mentionRuns.map((run) => keyOf(evidence, run.botId)).join(', ')),
      check('onca-wrote-the-answer', 'Onça wrote the reply in the room', answeredBy.includes(onca ?? ''), `recent authors: ${answeredBy.join(', ')}`),
      check('own-session', 'Onça answered in her own session, not the lead thread', textsOf(evidence, 'onca') !== '', 'final text recorded'),
    ];
  },
};
