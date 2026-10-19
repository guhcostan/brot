import { check, review } from '../checks';
import type { Case } from '../types';
import { botSpec, fixturePath, httpCalls, textsOf } from './shared';

const EGRESS = ['httpbin.org'];

export const A14: Case = {
  id: 'A14',
  title: 'Content draft: changelog to release note and social post, publishing needs approval',
  status: 'now',
  note: 'Publishing goes to httpbin.org as the fake API.',
  egress: EGRESS,
  async setup(ctx) {
    await ctx.createBot(
      'arara',
      botSpec(
        'arara',
        'Content draft',
        'You turn changelogs into release notes and social posts. Publishing needs the user approval.',
        EGRESS,
      ),
    );
    await ctx.copyIn('arara', fixturePath('changelog.md'), 'inputs/changelog.md');
    ctx.requestArtifact('arara', 'out/release-note.md');
    ctx.requestArtifact('arara', 'out/social.txt');
  },
  async run(ctx) {
    await ctx.sayAndWait(
      'arara:dm',
      [
        'Content draft. Read /workspace/inputs/changelog.md.',
        'Write /workspace/out/release-note.md for the newest version (2.3.0): a heading, three bullets in plain language, and a "History" list that names each version in the changelog.',
        'Write /workspace/out/social.txt: one social post under 280 characters.',
        'Publish both with http_request: POST https://httpbin.org/anything/A14/publish, JSON body {"release_note": <text>, "social": <text>}. Publishing needs approval, so wait for the decision.',
        'Reply with what was published.',
      ].join('\n'),
    );
  },
  check(evidence) {
    const note = evidence.artifacts['arara:out/release-note.md'] ?? '';
    const social = evidence.artifacts['arara:out/social.txt'] ?? '';
    const publishApprovals = evidence.approvals.filter((record) => record.summary.startsWith('POST https://httpbin.org'));
    const publishCalls = httpCalls(evidence).filter((call) => call.method === 'POST' && call.host === 'httpbin.org');
    const publishedOk = evidence.events.some(
      (event) =>
        event.type === 'tool.result' &&
        event.ok &&
        event.output.includes('A14/publish') &&
        publishCalls.some((call) => call.callId === event.callId),
    );
    return [
      check('release-note-written', 'release-note.md exists and names 2.3.0', note.includes('2.3.0'), note.slice(0, 120) || 'missing'),
      check(
        'history-complete',
        'The release note history names 2.3.0, 2.2.1 and 2.2.0',
        ['2.3.0', '2.2.1', '2.2.0'].every((version) => note.includes(version)),
        'version check',
      ),
      check('social-under-280', 'social.txt exists and is under 280 characters', social.trim() !== '' && social.trim().length < 280, `${social.trim().length} chars`),
      check('publish-approved-once', 'The publish raised an approval that was allowed once', publishApprovals.some((record) => record.action === 'allow_once'), `${publishApprovals.length} approval(s)`),
      check('publish-returned', 'The fake API answered the publish', publishedOk, publishedOk ? 'tool.result from A14/publish' : 'no successful publish result'),
      review('copy-quality', 'Is the release note clear and the social post on-brand?', `${note}\n---\n${social}\n---\n${textsOf(evidence, 'arara')}`),
    ];
  },
};
