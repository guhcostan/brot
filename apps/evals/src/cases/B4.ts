import { check, info, keyOf, review } from '../checks';
import type { Case } from '../types';
import { allTexts, botSpec, eventsOfType, fixturePath, textsOf } from './shared';

const MEMBERS = ['capy', 'onca', 'lobo'] as const;

export const B4: Case = {
  id: 'B4',
  title: 'Repo bot team: Capy splits an issue, Onça writes the fix, Lobo reviews and reports only to Capy',
  status: 'now',
  note: 'Engineer bot with two workers. The engineer has the repo; the reviewer gets the diff as text.',
  async setup(ctx) {
    await ctx.createBot('capy', botSpec('capy', 'Chief of Staff, leads the team', 'You lead the room. Split an issue into tasks with delegate_task: one for the engineer, one for the reviewer. Report to the user when the reviewer is done.', []));
    await ctx.createBot('onca', botSpec('onca', 'Engineer', 'You fix bugs in the repo at /workspace/repo. Run the test, make the smallest change, and return the unified diff as your task result.', []));
    await ctx.createBot('lobo', botSpec('lobo', 'Reviewer', 'You review diffs. Report your review to the bot that asked you, in a few lines. You never message other bots.', []));
    await ctx.room('room', { title: 'slugify fix', members: [...MEMBERS], lead: 'capy' });
    await ctx.copyIn('onca', fixturePath('b4/slugify.js'), 'repo/slugify.js');
    await ctx.copyIn('onca', fixturePath('b4/slugify.test.js'), 'repo/slugify.test.js');
  },
  async run(ctx) {
    await ctx.sayAndWait(
      'room',
      "Issue: slugify('  Hello   World  ') returns 'hello---world' instead of 'hello-world'. Capy: split this into two tasks. Onça fixes /workspace/repo/slugify.js so that `node slugify.test.js` passes, and her result is the unified diff. Lobo reviews that diff (paste it into the review task description) and reports only to Capy. Keep it to these two tasks.",
    );
    ctx.probes.fix = (await ctx.exec('onca', 'cd repo && node slugify.test.js; echo "EXIT=$?"')).stdout.trim();
  },
  check(evidence) {
    const capy = evidence.bots.capy?.id;
    const lobo = evidence.bots.lobo?.id;
    const onca = evidence.bots.onca?.id;
    const created = eventsOfType(evidence, 'task.created').map((event) => event.task);
    const fromCapy = created.filter((task) => task.createdByBotId === capy);
    const chains = new Set(fromCapy.map((task) => task.chainId));
    const roomMessages = evidence.messages.filter((message) => message.threadId === evidence.threads.room && message.role === 'assistant');
    const loboBeyondCapy = roomMessages.filter((message) => message.authorBotId === lobo && message.viaBotId !== undefined && message.viaBotId !== capy);
    const askBetweenWorkers = eventsOfType(evidence, 'bot.asked').filter(
      (event) => (event.fromBotId === lobo && event.toBotId === onca) || (event.fromBotId === onca && event.toBotId === lobo),
    );
    const fix = String(evidence.probes.fix ?? '');
    return [
      check('two-tasks-from-lead', 'Capy created at least two tasks', fromCapy.length >= 2, `${fromCapy.length} task(s) from Capy`),
      check('engineer-and-reviewer', 'One task is Onça’s and one is Lobo’s', fromCapy.some((task) => task.assigneeBotId === onca) && fromCapy.some((task) => task.assigneeBotId === lobo), fromCapy.map((task) => keyOf(evidence, task.assigneeBotId)).join(', ')),
      check('one-chain', 'The tasks share one chain', chains.size === 1, `${chains.size} chain(s)`),
      check('fix-passes', 'The fix makes `node slugify.test.js` exit 0', /EXIT=0/.test(fix), fix.slice(-200)),
      check('reviewer-reports-only-to-capy', 'Lobo sent nothing to any bot except Capy', loboBeyondCapy.length === 0, `${loboBeyondCapy.length} message(s) from Lobo to others`),
      check('no-review-chatter', 'Onça and Lobo did not ask each other back and forth', askBetweenWorkers.length <= 1, `${askBetweenWorkers.length} ask(s) between them`),
      info('task-count', 'Tasks in the case', String(evidence.tasks.length)),
      review('review-quality', 'Did the reviewer find real problems, and does the final message to the user match?', `${allTexts(evidence)}\n\nLead: ${textsOf(evidence, 'capy')}`),
    ];
  },
};
