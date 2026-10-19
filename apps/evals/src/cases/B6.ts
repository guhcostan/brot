import { check } from '../checks';
import type { Case } from '../types';
import { ANIMAL, botSpec } from './shared';

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
      `@${ANIMAL.onca.name} create /workspace/owned-by-onca.txt containing the word onca. @${ANIMAL.tuca.name} create /workspace/owned-by-tuca.txt containing the word tuca. Write only in your own workspace.`,
      ['onca', 'tuca'],
    );
    ctx.probes.onca = (await ctx.exec('onca', 'ls -1 /workspace')).stdout;
    ctx.probes.tuca = (await ctx.exec('tuca', 'ls -1 /workspace')).stdout;
  },
  check(evidence) {
    const onca = String(evidence.probes.onca ?? '').split('\n').map((line) => line.trim());
    const tuca = String(evidence.probes.tuca ?? '').split('\n').map((line) => line.trim());
    const ownOnca = onca.includes('owned-by-onca.txt');
    const ownTuca = tuca.includes('owned-by-tuca.txt');
    return [
      check('onca-writes-own', 'Onça wrote her file in her own /workspace', ownOnca, onca.join(', ')),
      check('tuca-writes-own', 'Tuca wrote his file in his own /workspace', ownTuca, tuca.join(', ')),
      check('no-cross-write', 'Neither computer sees the other bot’s file', !onca.includes('owned-by-tuca.txt') && !tuca.includes('owned-by-onca.txt'), 'listing check'),
      check('separate-computers', 'The two bots have different computers', evidence.bots.onca?.id !== evidence.bots.tuca?.id, 'distinct bot ids'),
    ];
  },
};
