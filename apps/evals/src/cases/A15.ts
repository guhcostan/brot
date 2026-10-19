import { check, review } from '../checks';
import type { Case } from '../types';
import { botSpec, distinctMatches, httpCalls, textsOf } from './shared';

const EGRESS = ['en.wikipedia.org', 'news.ycombinator.com', 'hn.algolia.com'];

export const A15: Case = {
  id: 'A15',
  title: 'Product idea stress test: evidence for and against, cheapest next experiment',
  status: 'now',
  egress: EGRESS,
  async setup(ctx) {
    await ctx.createBot(
      'tamu',
      botSpec(
        'tamu',
        'Product idea stress test',
        'You stress-test product ideas. You look for evidence on both sides and propose the cheapest experiment that could change the decision.',
        EGRESS,
      ),
    );
  },
  async run(ctx) {
    await ctx.sayAndWait(
      'tamu:dm',
      [
        'Idea: a CLI that turns a git diff into a draft changelog entry. Target customer: solo open-source maintainers.',
        'Find evidence for and against, using http_request GET only, on these hosts: en.wikipedia.org, news.ycombinator.com, hn.algolia.com.',
        'Answer with three sections: For, Against, Cheapest next experiment (one experiment, one week, one success metric). Include at least two links.',
      ].join('\n'),
    );
  },
  check(evidence) {
    const text = textsOf(evidence, 'tamu');
    const links = distinctMatches(text, /https:\/\/[^\s)\]>"']+/);
    const hosts = new Set(httpCalls(evidence).map((call) => call.host));
    return [
      check('three-sections', 'Has For, Against and Cheapest next experiment sections', ['For', 'Against', 'Cheapest next experiment'].every((heading) => text.includes(heading)), text.slice(0, 160)),
      check('links', 'At least two links', links.length >= 2, `${links.length} links`),
      check('only-allowed-hosts', 'Calls only went to the allowed hosts', hosts.size > 0 && [...hosts].every((host) => EGRESS.includes(host)), [...hosts].join(', ') || 'no calls'),
      review('evidence-quality', 'Is the evidence real and the experiment cheap and decisive?', text),
    ];
  },
};
