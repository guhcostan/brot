import { check, info } from '../checks';
import type { Case } from '../types';
import { botSpec, containsAny, httpCalls, LEFT_PAD, textsOf } from './shared';

const EGRESS = ['github.com', '*.githubusercontent.com', 'registry.npmjs.org'];

export const A1: Case = {
  id: 'A1',
  title: 'Bug reproduction: failing test for a reported bug in a public repo',
  status: 'now',
  egress: EGRESS,
  async setup(ctx) {
    await ctx.createBot(
      'onca',
      botSpec(
        'onca',
        'Bug reproduction',
        'You reproduce bugs in public repositories. You write a failing test first and you never change the library code while reproducing.',
        EGRESS,
      ),
    );
  },
  async run(ctx) {
    await ctx.sayAndWait(
      'onca:dm',
      [
        'Reproduce a bug in a public repo. Work under /workspace/work.',
        `1. Clone ${LEFT_PAD.url} into /workspace/work/left-pad and check out commit ${LEFT_PAD.sha}.`,
        `2. Reporter's issue: "leftPad('ab', 6, 'xy') returns a string of the wrong length. I asked for 6 characters and got more."`,
        '3. Write /workspace/work/left-pad/test/repro.js with node:assert and require("../index.js"). It must exit non-zero while the bug exists. Do not change index.js.',
        '4. Run it with `node test/repro.js` and show the exact command, the output and the exit code.',
        '5. Reply with the exact steps to reproduce, the observed and expected results, and the path of the test file.',
      ].join('\n'),
    );
    const repro = await ctx.exec('onca', 'cd work/left-pad && node test/repro.js');
    ctx.probes.reproExit = repro.code;
    ctx.probes.reproOutput = `${repro.stdout}${repro.stderr}`.trim().slice(-400);
    ctx.probes.reproExists = (await ctx.exec('onca', 'test -f work/left-pad/test/repro.js && echo yes || echo no')).stdout.trim();
    ctx.probes.pinned = (await ctx.exec('onca', 'cd work/left-pad && git rev-parse HEAD')).stdout.trim();
    ctx.probes.libraryUnchanged = (await ctx.exec('onca', 'cd work/left-pad && git status --porcelain -- index.js')).stdout.trim() === '';
    ctx.probes.bugPresent = (
      await ctx.exec('onca', `cd work/left-pad && node -e "console.log(require('./index.js')('ab', 6, 'xy').length)"`)
    ).stdout.trim();
  },
  check(evidence) {
    const probe = (key: string): string => String(evidence.probes[key] ?? '');
    const reproExit = evidence.probes.reproExit;
    const finalText = textsOf(evidence, 'onca');
    const blocked = evidence.events.filter((event) => event.type === 'network.blocked' && event.botId === evidence.bots.onca?.id);
    return [
      check('repro-file', 'Test file exists at test/repro.js', probe('reproExists') === 'yes', probe('reproExists')),
      check(
        'repro-fails-before-fix',
        'The test fails while the bug exists (non-zero exit)',
        typeof reproExit === 'number' && reproExit !== 0,
        `exit ${reproExit === undefined ? 'missing' : String(reproExit)}: ${probe('reproOutput')}`,
      ),
      check(
        'bug-reproduces-at-pinned-commit',
        `The bug is present at ${LEFT_PAD.sha.slice(0, 8)}: ${LEFT_PAD.reproducer} is 10`,
        probe('bugPresent') === '10',
        `independent run: ${probe('bugPresent')}`,
      ),
      check('pinned-commit', 'The clone is at the pinned commit', probe('pinned') === LEFT_PAD.sha, probe('pinned')),
      check('library-untouched', 'index.js was not changed while reproducing', probe('libraryUnchanged') === 'true', probe('libraryUnchanged')),
      check(
        'report-names-test-and-numbers',
        'The reply names the test file and both lengths',
        containsAny(finalText, ['test/repro']) && finalText.includes('10') && finalText.includes('6'),
        finalText.slice(0, 300),
      ),
      check('no-blocked-egress', 'The computer tried no host outside its egress', blocked.length === 0, `${blocked.length} network.blocked`),
      info('http-calls', 'http_request calls made', String(httpCalls(evidence).length)),
    ];
  },
};
