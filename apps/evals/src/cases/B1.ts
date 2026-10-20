import { check, keyOf, review } from '../checks';
import type { Case } from '../types';
import { allTexts, botSpec, eventsOfType, fixturePath } from './shared';

const MEMBERS = ['capy', 'onca', 'tuca', 'tamu'] as const;

export const B1: Case = {
  id: 'B1',
  title: 'Room "Acme renewal": the lead delegates a bug and an email, and asks one question',
  status: 'now',
  note: 'Team tools: delegate_task, ask_bot, task board, results flowing back.',
  async setup(ctx) {
    await ctx.createBot('capy', botSpec('capy', 'Chief of Staff, leads the team', 'You lead the room. Split the request into tasks with delegate_task, one per piece of work, and send questions with ask_bot. Reply to the user with a short plan and the status.', []));
    await ctx.createBot('onca', botSpec('onca', 'Bug fixer', 'You fix bugs that other bots delegate to you. The invoice export code is in /workspace/repo: run `node invoice-export.test.js` there. Report the result in one short paragraph.', []));
    await ctx.createBot('tuca', botSpec('tuca', 'Sales follow-ups', 'You draft customer follow-up emails. Never send them; drafts only.', []));
    await ctx.createBot('tamu', botSpec('tamu', 'Researcher', 'You answer one question at a time with sources. Keep it short.', []));
    await ctx.room('room', { title: 'Acme renewal', members: [...MEMBERS], lead: 'capy' });
    // The fixtures are CommonJS sources (.cjs here, so the eval package stays ESM). The computer runs them as .js.
    await ctx.copyIn('onca', fixturePath('b1/invoice-export.cjs'), 'repo/invoice-export.js');
    await ctx.copyIn('onca', fixturePath('b1/invoice-export.test.cjs'), 'repo/invoice-export.test.js');
  },
  async run(ctx) {
    await ctx.sayAndWait(
      'room',
      'Get the Acme renewal ready by Friday. The renewal is blocked: the invoice export drops rows when the file has a byte-order mark. Ana still needs the follow-up.',
    );
  },
  check(evidence) {
    const capy = evidence.bots.capy?.id;
    const onca = evidence.bots.onca?.id;
    const tuca = evidence.bots.tuca?.id;
    const tamu = evidence.bots.tamu?.id;
    const roomRuns = evidence.runs.filter((run) => run.threadId === evidence.threads.room).sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    const created = eventsOfType(evidence, 'task.created').map((event) => event.task);
    const delegatedTo = (botId: string | undefined): boolean => created.some((task) => task.assigneeBotId === botId && task.createdByBotId === capy);
    const asked = eventsOfType(evidence, 'bot.asked').filter((event) => event.fromBotId === capy && event.toBotId === tamu);
    const terminal = created.map((task) => evidence.tasks.find((candidate) => candidate.id === task.id)?.status ?? task.status);
    const doneWithResult = evidence.tasks.filter((task) => task.status === 'done' && (task.result ?? '') !== '').length;
    return [
      check('lead-answers-first', 'The lead (Capy) is the first responder in the room', roomRuns[0]?.botId === capy, `first responder ${keyOf(evidence, roomRuns[0]?.botId)}`),
      check('delegates-bug-to-onca', 'Capy delegated a task to Onça', delegatedTo(onca), `${created.length} task(s) created`),
      check('delegates-email-to-tuca', 'Capy delegated the follow-up email to Tuca', delegatedTo(tuca), `${created.length} task(s) created`),
      check('asks-tamu-one-question', 'Capy asked Tamu one question with ask_bot', asked.length >= 1, `${asked.length} bot.asked event(s)`),
      check(
        'results-flow-back',
        'Delegated tasks reached a terminal state, and a done task carries its result',
        created.length >= 2 && terminal.every((status) => ['done', 'failed', 'cancelled'].includes(status)) && doneWithResult >= 1,
        `statuses ${terminal.join(', ') || 'none'}; ${doneWithResult} done with result`,
      ),
      check('no-task-to-self', 'No bot delegated to itself', created.every((task) => task.createdByBotId !== task.assigneeBotId), 'checked'),
      review('room-summary', 'Is the plan to the user sensible and does it match the tasks?', allTexts(evidence)),
    ];
  },
};
