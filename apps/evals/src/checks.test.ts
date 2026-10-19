import { describe, expect, it } from 'vitest';
import { check, gap, looksGerman, parseSimpleCsv, review, shotNumbers, spokenWordCount } from './checks';
import { distinctMatches, isoDateDaysAgo, isTool, httpCalls, containsAny } from './cases/shared';
import { stableStringify, truncate } from './util';
import type { Evidence } from './types';

describe('check constructors', () => {
  it('turns a boolean into pass or fail and keeps the evidence', () => {
    expect(check('a', 'A', true, 'ok')).toEqual({ id: 'a', label: 'A', status: 'pass', evidence: 'ok' });
    expect(check('a', 'A', false, 'bad').status).toBe('fail');
  });

  it('marks subjective output for review and records gaps without failing', () => {
    expect(review('q', 'Q', 'text').status).toBe('review');
    expect(gap('g', 'G', 'missing meter')).toMatchObject({ status: 'info', evidence: 'gap: missing meter' });
  });

  it('truncates long evidence', () => {
    const long = check('a', 'A', true, 'x'.repeat(2000));
    expect(long.evidence.length).toBeLessThan(900);
    expect(long.evidence).toContain('more characters');
  });
});

describe('text helpers', () => {
  it('parses a simple CSV with a header and skips blank lines', () => {
    expect(parseSimpleCsv('account_id,score\nacc-01,80\n\nacc-02,40\n')).toEqual([
      { account_id: 'acc-01', score: '80' },
      { account_id: 'acc-02', score: '40' },
    ]);
  });

  it('finds distinct matches and checks phrases ignoring case', () => {
    expect(distinctMatches('see ev-1 and ev-2 and ev-1', /ev-\d+/)).toEqual(['ev-1', 'ev-2']);
    expect(containsAny('nothing here', ['login', 'sign in'])).toBe(false);
  });

  it('recognises a tool however the engine prefixed it', () => {
    expect(isTool('http_request', 'http_request')).toBe(true);
    expect(isTool('http_request', 'brot.http_request')).toBe(true);
    expect(isTool('http_request', 'brot__http_request')).toBe(true);
    expect(isTool('notify_user', 'remember')).toBe(false);
  });

  it('computes an ISO day N days back', () => {
    expect(isoDateDaysAgo(30, new Date('2026-10-19T12:00:00.000Z'))).toBe('2026-09-19');
  });

  it('pulls HTTP calls out of the evidence with their bot key', () => {
    const evidence = {
      bots: { onca: { key: 'onca', id: 'bot-1', name: 'Onça', engine: 'dsh' } },
      runs: [{ id: 'run-1', botId: 'bot-1' }],
      events: [
        { id: 'e1', type: 'tool.call', at: '2026-10-19T10:00:00.000Z', threadId: 't', runId: 'run-1', callId: 'c1', tool: 'brot.http_request', args: { method: 'post', url: 'https://httpbin.org/anything/x', headers: { Authorization: 'secret://github-token' } } },
      ],
    } as unknown as Evidence;
    expect(httpCalls(evidence)).toEqual([
      expect.objectContaining({ botKey: 'onca', method: 'POST', host: 'httpbin.org', headers: ['Authorization'] }),
    ]);
  });
});

describe('util', () => {
  it('sorts object keys so equal arguments compare equal', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [3] } })).toBe(stableStringify({ a: { c: [3], d: 2 }, b: 1 }));
  });

  it('keeps short text as it is', () => {
    expect(truncate('short', 10)).toBe('short');
  });
});

describe('B7 text helpers', () => {
  const german = 'Hast du schon gesehen, was die Erdbeere heute macht? Sie ist nicht mehr schüchtern, und das ist auch gut so. Wir zeigen dir den Trend, dass sie mit dem Team tanzt.';
  const english = 'Have you seen what the strawberry is doing today? It is not shy anymore, and you should see it with the team.';

  it('tells German from English with a stopword heuristic', () => {
    expect(looksGerman(german)).toBe(true);
    expect(looksGerman(english)).toBe(false);
    expect(looksGerman('')).toBe(false);
  });

  it('finds shot numbers in headings and lines, in order', () => {
    expect(shotNumbers('## Shot 1: Intro\nText\n**Shot 2** Zoom\nSzene 3: Ende')).toEqual([1, 2, 3]);
    expect(shotNumbers('no shots here')).toEqual([]);
  });

  it('counts spoken words and leaves out shot headings and stage notes', () => {
    const script = '# Episode 7\nShot 1: Intro\n[Erdbeere winkt] Hallo zusammen, heute geht es um Erdbeeren!\nOn-screen: Trend der Woche\nShot 2: Ende\nBis bald.';
    expect(spokenWordCount(script)).toBe(9);
  });
});
