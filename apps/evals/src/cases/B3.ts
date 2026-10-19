import { check, keyOf } from '../checks';
import type { Case } from '../types';
import { botSpec } from './shared';

const MEMBERS = ['capy', 'onca', 'tuca'] as const;

export const B3: Case = {
  id: 'B3',
  title: 'Baton: Capy hands the conversation to Tuca once; the next plain message goes back to the lead',
  status: 'now',
  async setup(ctx) {
    await ctx.createBot('capy', botSpec('capy', 'Chief of Staff, leads the team', 'You lead the room. When the user asks you to hand the baton to someone, call handoff to that bot. Otherwise answer briefly.', []));
    await ctx.createBot('onca', botSpec('onca', 'Bug fixer', 'You fix bugs and answer briefly.', []));
    await ctx.createBot('tuca', botSpec('tuca', 'Sales follow-ups', 'You draft customer follow-up emails and answer briefly.', []));
    await ctx.room('room', { title: 'Acme renewal (baton)', members: [...MEMBERS], lead: 'capy' });
  },
  async run(ctx) {
    const threadId = ctx.threadId('room');
    const responders = async (content: string): Promise<string[]> => {
      const before = new Set((await ctx.api.listRuns(threadId)).map((run) => run.id));
      await ctx.sayAndWait('room', content);
      return (await ctx.api.listRuns(threadId)).filter((run) => !before.has(run.id)).map((run) => run.botId);
    };
    ctx.notes.first = await responders('Capy, hand the baton to Tuca. She owns the Ana follow-up.');
    ctx.notes.second = await responders('Tuca, what is the state of the follow-up draft?');
    ctx.notes.third = await responders('Thanks. Anything else before Friday?');
  },
  check(evidence) {
    const capy = evidence.bots.capy?.id;
    const tuca = evidence.bots.tuca?.id;
    const handoffs = evidence.events.filter((event) => event.type === 'handoff' && event.fromBotId === capy && event.toBotId === tuca);
    const second = (evidence.notes.second as string[] | undefined) ?? [];
    const third = (evidence.notes.third as string[] | undefined) ?? [];
    return [
      check('handoff-recorded', 'Capy passed the baton to Tuca (handoff event)', handoffs.length >= 1, `${handoffs.length} handoff event(s)`),
      check('next-message-goes-to-tuca', 'The next plain message (no mention) was answered by Tuca', second.length > 0 && second.every((id) => id === tuca), second.map((id) => keyOf(evidence, id)).join(', ') || 'no responder'),
      check('baton-consumed-once', 'After Tuca answered, the following plain message went back to Capy', third.length > 0 && third[0] === capy, third.map((id) => keyOf(evidence, id)).join(', ') || 'no responder'),
    ];
  },
};
