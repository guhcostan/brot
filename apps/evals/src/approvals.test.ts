import { describe, expect, it } from 'vitest';
import { BrotApi } from './api';
import { ApprovalDriver, holdPolicy, httpTarget, standardPolicy } from './approvals';
import type { ApprovalView } from './types';

const view = (overrides: Partial<ApprovalView>): ApprovalView => ({
  botId: 'bot-1',
  runId: 'run-1',
  tool: 'http_request',
  kind: 'send',
  summary: 'POST https://api.github.com/repos/x/y/pulls',
  args: {},
  ...overrides,
});

describe('httpTarget', () => {
  it('reads the method and host of an http_request summary', () => {
    expect(httpTarget('POST https://httpbin.org/anything/A8/reminders')).toEqual({
      method: 'POST',
      url: 'https://httpbin.org/anything/A8/reminders',
      host: 'httpbin.org',
    });
  });

  it('returns undefined for shell summaries and malformed URLs', () => {
    expect(httpTarget('bash: ls -la')).toBeUndefined();
    expect(httpTarget('GET not a url')).toBeUndefined();
  });
});

describe('standardPolicy', () => {
  const policy = standardPolicy();

  it('allows reads and Brot-internal tools once', () => {
    expect(policy.decide(view({ summary: 'GET https://render.com/pricing', kind: 'other', tool: 'http_request' })).action).toBe('allow_once');
    expect(policy.decide(view({ tool: 'notify_user', kind: 'other', summary: 'Notify the user: done' })).action).toBe('allow_once');
    expect(policy.decide(view({ tool: 'delegate_task', kind: 'other', summary: 'Delegate' })).action).toBe('allow_once');
  });

  it('denies a POST to a real host, such as opening a pull request', () => {
    const verdict = policy.decide(view({}));
    expect(verdict.action).toBe('deny');
    expect(verdict.reason).toContain('api.github.com');
  });

  it('allows a send to httpbin.org only when the case says so', () => {
    const send = view({ summary: 'POST https://httpbin.org/anything/A6/digest' });
    expect(policy.decide(send).action).toBe('deny');
    expect(standardPolicy({ httpbinSends: true }).decide(send).action).toBe('allow_once');
    expect(standardPolicy({ httpbinSends: true }).decide(view({ summary: 'POST https://x.com/collect' })).action).toBe('deny');
  });

  it('allows computer work and denies shell commands that reach outside', () => {
    expect(policy.decide(view({ tool: 'bash', kind: 'shell', summary: 'bash: node test/repro.js', args: { command: 'node test/repro.js' } })).action).toBe('allow_once');
    expect(policy.decide(view({ tool: 'bash', kind: 'shell', summary: 'bash: git push origin main', args: { command: 'git push origin main' } })).action).toBe('deny');
    expect(policy.decide(view({ tool: 'bash', kind: 'shell', summary: 'bash: curl -X POST https://x.test', args: { command: 'curl -X POST https://x.test' } })).action).toBe('deny');
    expect(policy.decide(view({ tool: 'bash', kind: 'shell', summary: 'bash: curl -fsSL https://render.com/pricing', args: { command: 'curl -fsSL https://render.com/pricing' } })).action).toBe('allow_once');
  });

  it('denies computer work when the case turns it off', () => {
    const strict = standardPolicy({ computerWork: false });
    expect(strict.decide(view({ tool: 'bash', kind: 'shell', summary: 'bash: ls', args: { command: 'ls' } })).action).toBe('deny');
  });

  it('denies publish and purchase kinds that have no HTTP target', () => {
    expect(policy.decide(view({ kind: 'purchase', summary: 'Buy a domain' })).action).toBe('deny');
  });
});

describe('holdPolicy', () => {
  it('leaves everything pending', () => {
    expect(holdPolicy.decide(view({})).action).toBe('hold');
  });
});

/** A fake server: `pending` is the list of approvals, and decisions are recorded in `decisions`. */
function fakeApi(pending: Array<Record<string, unknown>>) {
  const decisions: Array<{ id: string; decision: string; reply?: unknown }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/approvals?status=pending')) {
      return new Response(JSON.stringify(pending), { status: 200 });
    }
    const match = /\/api\/approvals\/([^/]+)$/.exec(url);
    if (match?.[1] && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { decision: string; reply?: unknown };
      decisions.push({ id: match[1], decision: body.decision, ...(body.reply === undefined ? {} : { reply: body.reply }) });
      return new Response(JSON.stringify({ ...pending.find((item) => item.id === match[1]), status: body.decision === 'deny' ? 'denied' : 'allowed' }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { api: new BrotApi('http://brot.test', fetchImpl), decisions };
}

const approval = (id: string, botId: string, summary: string, kind = 'send') => ({
  id,
  runId: 'run-1',
  threadId: 'thread-1',
  botId,
  kind,
  tool: 'http_request',
  summary,
  args: {},
  status: 'pending',
  createdAt: '2026-10-19T10:00:00.000Z',
});

describe('ApprovalDriver', () => {
  it('decides only the watched bots and records each decision', async () => {
    const { api, decisions } = fakeApi([
      approval('a1', 'onca', 'POST https://api.github.com/repos/x/y/pulls'),
      approval('a2', 'other-bot', 'POST https://httpbin.org/anything/x'),
    ]);
    const driver = new ApprovalDriver(api, {
      caseId: 'A2',
      policy: standardPolicy(),
      pollMs: 1,
      botIds: () => ['onca'],
      botKeyOf: (id) => (id === 'onca' ? 'onca' : undefined),
      now: () => new Date('2026-10-19T10:00:02.000Z'),
    });
    await driver.tick();
    expect(decisions).toEqual([{ id: 'a1', decision: 'deny', reply: expect.stringContaining('Denied by the eval runner') }]);
    expect(driver.records).toHaveLength(1);
    expect(driver.records[0]).toMatchObject({
      approvalId: 'a1',
      botKey: 'onca',
      action: 'deny',
      timeToAppearMs: 2000,
      resolvedStatus: 'denied',
    });
  });

  it('allows once when the policy allows, and never asks twice for one approval', async () => {
    const { api, decisions } = fakeApi([approval('a3', 'onca', 'GET https://render.com/pricing', 'other')]);
    const driver = new ApprovalDriver(api, { caseId: 'A4', policy: standardPolicy(), pollMs: 1, botIds: () => ['onca'], botKeyOf: () => 'onca' });
    await driver.tick();
    await driver.tick();
    expect(decisions).toEqual([{ id: 'a3', decision: 'allow_once' }]);
    expect(driver.records[0]?.action).toBe('allow_once');
  });

  it('leaves held approvals pending and sends nothing', async () => {
    const { api, decisions } = fakeApi([approval('a4', 'onca', 'POST https://httpbin.org/anything/C6/send')]);
    const driver = new ApprovalDriver(api, { caseId: 'C6', policy: holdPolicy, pollMs: 1, botIds: () => ['onca'], botKeyOf: () => 'onca' });
    await driver.tick();
    expect(decisions).toEqual([]);
    expect(driver.records[0]?.action).toBe('hold');
  });
});
