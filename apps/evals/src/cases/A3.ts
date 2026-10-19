import { check, review } from '../checks';
import type { Case } from '../types';
import { botSpec, distinctMatches, textsOf } from './shared';

const EGRESS = ['nodejs.org', 'github.com', 'stackoverflow.com'];

export const A3: Case = {
  id: 'A3',
  title: 'Researchy: one bounded technical question, documented vs community vs assumed',
  status: 'now',
  egress: EGRESS,
  async setup(ctx) {
    await ctx.createBot(
      'tamu',
      botSpec(
        'tamu',
        'Researchy: checks technical claims',
        'You answer one technical question at a time. You separate what the documentation says from what the community reports and from what you assume, and you link every source.',
        EGRESS,
      ),
    );
  },
  async run(ctx) {
    await ctx.sayAndWait(
      'tamu:dm',
      [
        "Question: does Node.js fs.rm(path, { recursive: true }) throw when the path does not exist? Does { force: true } change that?",
        'Fetch sources with http_request GET only, from nodejs.org, github.com and stackoverflow.com.',
        'Answer under 300 words with three labelled sections:',
        'Documented: what the Node.js docs say, with the link.',
        'Community: what issues or Q&A report, with links.',
        'Assumptions: what you could not verify.',
      ].join('\n'),
    );
  },
  check(evidence) {
    const text = textsOf(evidence, 'tamu');
    const links = distinctMatches(text, /https:\/\/[^\s)\]>"']+/);
    const sections = ['Documented', 'Community', 'Assumptions'].every((heading) => text.includes(heading));
    const hosts = new Set(links.map((link) => new URL(link).hostname));
    const allowed = hosts.size > 0 && [...hosts].every((host) => EGRESS.some((allow) => host === allow || host.endsWith(`.${allow}`)));
    return [
      check('three-sections', 'Answer has Documented, Community and Assumptions sections', sections, text.slice(0, 200)),
      check('links-present', 'At least two distinct links', links.length >= 2, links.join(' ')),
      check('links-within-egress', 'Every link is on an allowed docs or community host', allowed, [...hosts].join(', ')),
      review('answer-quality', 'Is the documented answer correct, and are the community claims real?', text),
    ];
  },
};
