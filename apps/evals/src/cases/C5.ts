import { check } from '../checks';
import type { Case } from '../types';
import { botSpec } from './shared';

export const C5: Case = {
  id: 'C5',
  title: 'Memory you can edit: a remembered fact, edited in the Memory tab, is what the bot uses',
  status: 'now',
  async setup(ctx) {
    await ctx.createBot('tamu', botSpec('tamu', 'Assistant with memory', 'You remember facts the user asks you to remember, with the remember tool, and you answer from memory when asked.', []));
  },
  async run(ctx) {
    await ctx.sayAndWait('tamu:dm', 'Remember this for later: the Brot launch codename is HALCON-7. Save it with the remember tool.');
    const botId = ctx.botRef('tamu').id;
    const memory = await ctx.waitFor('the remembered fact', async () =>
      (await ctx.api.listMemories(botId)).find((item) => item.content.includes('HALCON-7')),
    );
    ctx.notes.memoryBefore = { id: memory.id, content: memory.content };
    const edited = await ctx.api.patchMemory(memory.id, 'The Brot launch codename is HALCON-9.');
    ctx.notes.memoryAfter = edited.content;
    const recall = await ctx.api.createThread(botId, 'C5 recall');
    ctx.threads.set('tamu:recall', recall.id);
    await ctx.sayAndWait('tamu:recall', 'What is the Brot launch codename? Reply with the codename only.');
  },
  check(evidence) {
    const before = evidence.notes.memoryBefore as { content: string } | undefined;
    const after = String(evidence.notes.memoryAfter ?? '');
    const answer = evidence.finalTexts.find((entry) => entry.threadId === evidence.threads['tamu:recall'])?.text ?? '';
    const stored = evidence.memories.tamu?.map((item) => item.content).join(' | ') ?? '';
    return [
      check('remembered-with-tool', 'The bot stored the fact as memory (HALCON-7)', before !== undefined && before.content.includes('HALCON-7'), before?.content ?? 'no memory'),
      check('edit-applied', 'The edited memory reads HALCON-9', after.includes('HALCON-9') && !after.includes('HALCON-7'), after || 'not edited'),
      check('edited-value-wins', 'The bot answers HALCON-9, not the old HALCON-7', answer.includes('HALCON-9') && !answer.includes('HALCON-7'), answer.slice(0, 200) || 'no answer'),
      check('memory-visible', 'The memories list shows the edited value', stored.includes('HALCON-9') && !stored.includes('HALCON-7'), stored.slice(0, 200)),
    ];
  },
};
