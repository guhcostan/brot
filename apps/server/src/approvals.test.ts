import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Approval, Bot, Policy, Run, Thread } from '@brot/protocol';
import { call, createTestContext, recordEvents, waitUntil, type TestContext } from './testing';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

async function setup(): Promise<{ bot: Bot; thread: Thread }> {
  const bot = (await (await call(ctx.app, 'POST', '/api/bots', { name: 'Ada', job: 'Ops' })).json()) as Bot;
  const thread = (await (
    await call(ctx.app, 'POST', `/api/bots/${bot.id}/threads`, { title: 'Ops' })
  ).json()) as Thread;
  return { bot, thread };
}

async function send(threadId: string, content: string): Promise<string> {
  const res = await call(ctx.app, 'POST', `/api/threads/${threadId}/messages`, { content });
  return ((await res.json()) as { runId: string }).runId;
}

describe('tool approval flow', () => {
  it('suspends the run until an allow_once decision completes it', async () => {
    const { thread } = await setup();
    const events = recordEvents(ctx.services.bus, thread.id);
    const runId = await send(thread.id, '/tool shell ls -la');

    const requested = await waitUntil(() => {
      const event = events.list.find((item) => item.type === 'approval.requested');
      return event?.type === 'approval.requested' ? event.approval : undefined;
    });
    expect(requested).toMatchObject({ status: 'pending', tool: 'shell', kind: 'shell', summary: 'ls -la' });

    const waiting = (await (await call(ctx.app, 'GET', `/api/threads/${thread.id}/runs`)).json()) as Run[];
    expect(waiting[0]?.status).toBe('waiting_approval');

    const pending = (await (await call(ctx.app, 'GET', '/api/approvals?status=pending')).json()) as Approval[];
    expect(pending.map((approval) => approval.id)).toEqual([requested.id]);

    const resolved = await call(ctx.app, 'POST', `/api/approvals/${requested.id}`, { decision: 'allow_once' });
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toMatchObject({ status: 'allowed', decision: 'allow_once' });

    await waitUntil(() => events.list.find((event) => event.type === 'run.completed' && event.runId === runId));
    const result = events.list.find((event) => event.type === 'tool.result');
    expect(result).toMatchObject({ type: 'tool.result', ok: true });

    const runs = (await (await call(ctx.app, 'GET', `/api/threads/${thread.id}/runs`)).json()) as Run[];
    expect(runs[0]?.status).toBe('completed');
    const policies = (await (await call(ctx.app, 'GET', '/api/bots/' + thread.botId + '/policies')).json()) as Policy[];
    expect(policies).toEqual([]);
    events.stop();
  });

  it('denies the tool and reports tool.result with ok false', async () => {
    const { thread } = await setup();
    const events = recordEvents(ctx.services.bus, thread.id);
    const runId = await send(thread.id, '/tool shell rm -rf build');

    const requested = await waitUntil(() => {
      const event = events.list.find((item) => item.type === 'approval.requested');
      return event?.type === 'approval.requested' ? event.approval : undefined;
    });
    await call(ctx.app, 'POST', `/api/approvals/${requested.id}`, { decision: 'deny', reply: 'not today' });

    await waitUntil(() => events.list.find((event) => event.type === 'run.completed' && event.runId === runId));
    expect(events.list.find((event) => event.type === 'tool.result')).toMatchObject({
      type: 'tool.result',
      ok: false,
      output: 'denied by user: not today',
    });
    events.stop();
  });

  it('allow_always creates an allow policy so the next identical tool is not asked again', async () => {
    const { bot, thread } = await setup();
    const events = recordEvents(ctx.services.bus, thread.id);

    await send(thread.id, '/tool shell ls');
    const first = await waitUntil(() => {
      const event = events.list.find((item) => item.type === 'approval.requested');
      return event?.type === 'approval.requested' ? event.approval : undefined;
    });
    await call(ctx.app, 'POST', `/api/approvals/${first.id}`, { decision: 'allow_always' });
    await waitUntil(() => events.list.find((event) => event.type === 'run.completed' && event.runId === first.runId));

    const policies = (await (await call(ctx.app, 'GET', `/api/bots/${bot.id}/policies`)).json()) as Policy[];
    expect(policies).toEqual([expect.objectContaining({ tool: 'shell', effect: 'allow' })]);

    const secondRun = await send(thread.id, '/tool shell ls');
    await waitUntil(() => events.list.find((event) => event.type === 'run.completed' && event.runId === secondRun));
    const approvalsRequested = events.list.filter((event) => event.type === 'approval.requested');
    expect(approvalsRequested).toHaveLength(1);
    expect(events.list.filter((event) => event.type === 'tool.result' && event.ok)).toHaveLength(2);
    events.stop();
  });

  it('cancelling a run that waits on approval denies the approval and ends the run', async () => {
    const { thread } = await setup();
    const events = recordEvents(ctx.services.bus, thread.id);
    const runId = await send(thread.id, '/tool shell ls');
    const requested = await waitUntil(() => {
      const event = events.list.find((item) => item.type === 'approval.requested');
      return event?.type === 'approval.requested' ? event.approval : undefined;
    });

    const cancelled = await call(ctx.app, 'POST', `/api/runs/${runId}/cancel`);
    expect(await cancelled.json()).toMatchObject({ status: 'cancelled' });

    const approval = (await ctx.services.repos.approvals.get(requested.id)) as Approval;
    expect(approval).toMatchObject({ status: 'denied', reply: 'Run cancelled.' });
    await waitUntil(() => events.list.find((event) => event.type === 'run.failed' && event.runId === runId));
    expect(events.list.some((event) => event.type === 'tool.result')).toBe(false);
    events.stop();
  });

  it('applies deny policies without asking', async () => {
    const { bot, thread } = await setup();
    const events = recordEvents(ctx.services.bus, thread.id);
    const created = await call(ctx.app, 'POST', `/api/bots/${bot.id}/policies`, {
      tool: 'shell',
      argPattern: 'rm -rf',
      effect: 'deny',
    });
    expect(created.status).toBe(201);

    const runId = await send(thread.id, '/tool shell rm -rf /');
    await waitUntil(() => events.list.find((event) => event.type === 'run.completed' && event.runId === runId));
    expect(events.list.some((event) => event.type === 'approval.requested')).toBe(false);
    expect(events.list.find((event) => event.type === 'tool.result')).toMatchObject({ ok: false });
    events.stop();
  });

  it('keeps the first decision when an approval is resolved twice', async () => {
    const { thread } = await setup();
    const events = recordEvents(ctx.services.bus, thread.id);
    await send(thread.id, '/tool shell whoami');
    const requested = await waitUntil(() => {
      const event = events.list.find((item) => item.type === 'approval.requested');
      return event?.type === 'approval.requested' ? event.approval : undefined;
    });

    await call(ctx.app, 'POST', `/api/approvals/${requested.id}`, { decision: 'allow_once' });
    const again = await call(ctx.app, 'POST', `/api/approvals/${requested.id}`, { decision: 'deny' });
    expect(await again.json()).toMatchObject({ status: 'allowed', decision: 'allow_once' });
    events.stop();
  });

  it('validates policy patterns, approval bodies and status filters', async () => {
    const { bot } = await setup();
    const badPattern = await call(ctx.app, 'POST', `/api/bots/${bot.id}/policies`, {
      tool: 'shell',
      argPattern: '([unclosed',
      effect: 'allow',
    });
    expect(badPattern.status).toBe(400);

    expect((await call(ctx.app, 'POST', '/api/approvals/missing', { decision: 'allow_once' })).status).toBe(404);
    expect((await call(ctx.app, 'POST', '/api/approvals/missing', { decision: 'maybe' })).status).toBe(400);
    expect((await call(ctx.app, 'GET', '/api/approvals?status=bogus')).status).toBe(400);
  });
});
