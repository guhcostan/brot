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
    // The runner writes one marker into each workspace itself. The isolation check reads only these, so it does not
    // depend on which file name a model chose: a file a bot wrote under the other bot's name is not a leak.
    const token = Date.now().toString(36);
    const markers = { onca: `marker-onca-${token}.txt`, tuca: `marker-tuca-${token}.txt` };
    ctx.probes.markers = markers;
    await ctx.exec('onca', `echo onca > ${markers.onca}`);
    await ctx.exec('tuca', `echo tuca > ${markers.tuca}`);
    ctx.probes.onca = (await ctx.exec('onca', 'ls -1 /workspace')).stdout;
    ctx.probes.tuca = (await ctx.exec('tuca', 'ls -1 /workspace')).stdout;
  },
  check(evidence) {
    const onca = String(evidence.probes.onca ?? '').split('\n').map((line) => line.trim());
    const tuca = String(evidence.probes.tuca ?? '').split('\n').map((line) => line.trim());
    const markers = evidence.probes.markers as { onca: string; tuca: string } | undefined;
    const ownOnca = onca.includes('owned-by-onca.txt');
    const ownTuca = tuca.includes('owned-by-tuca.txt');
    const isolated =
      markers !== undefined &&
      onca.includes(markers.onca) &&
      !onca.includes(markers.tuca) &&
      tuca.includes(markers.tuca) &&
      !tuca.includes(markers.onca);
    return [
      check('onca-writes-own', 'Onça wrote her file in her own /workspace', ownOnca, onca.join(', ')),
      check('tuca-writes-own', 'Tuca wrote his file in his own /workspace', ownTuca, tuca.join(', ')),
      check('no-cross-write', 'Each computer holds its own marker file and not the other bot’s (runner-written)', isolated, `onca: ${onca.join(', ')} | tuca: ${tuca.join(', ')}`),
      check('separate-computers', 'The two bots have different computers', evidence.bots.onca?.id !== evidence.bots.tuca?.id, 'distinct bot ids'),
    ];
  },
};
