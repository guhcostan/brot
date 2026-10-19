import { check, review } from '../checks';
import type { Case } from '../types';
import { botSpec, distinctMatches, httpCalls, isoDateDaysAgo, textsOf } from './shared';

const EGRESS = ['api.github.com'];

export const A5: Case = {
  id: 'A5',
  title: 'last30days: developer complaints about a library, summarized with links',
  status: 'now',
  egress: EGRESS,
  async setup(ctx) {
    await ctx.createBot(
      'tamu',
      botSpec(
        'tamu',
        'Developer complaints digest',
        'You collect developer complaints from public issue trackers and summarize recurring themes with links. You quote issues, you never invent them.',
        EGRESS,
      ),
    );
  },
  async run(ctx) {
    const since = isoDateDaysAgo(30);
    await ctx.sayAndWait(
      'tamu:dm',
      [
        `Look at the open issues of colinhacks/zod created since ${since}.`,
        `Use http_request GET only: https://api.github.com/repos/colinhacks/zod/issues?state=open&since=${since}T00:00:00Z&per_page=50 (skip pull requests).`,
        'Summarize the top 3 to 5 recurring developer complaints. Each theme must cite the issue URLs (html_url) it comes from. Under 350 words.',
      ].join('\n'),
    );
  },
  check(evidence) {
    const text = textsOf(evidence, 'tamu');
    const issueLinks = distinctMatches(text, /https:\/\/github\.com\/colinhacks\/zod\/issues\/\d+/);
    const calls = httpCalls(evidence);
    const hosts = new Set(calls.map((call) => call.host));
    return [
      check('issue-links', 'At least three distinct issue links from colinhacks/zod', issueLinks.length >= 3, issueLinks.join(' ')),
      check(
        'only-github-api',
        'The only host the bot called is api.github.com',
        hosts.size > 0 && [...hosts].every((host) => host === 'api.github.com'),
        [...hosts].join(', ') || 'no http calls',
      ),
      review('themes', 'Are the themes real and supported by the linked issues?', text),
    ];
  },
};
