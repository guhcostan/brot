import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngineRegistry, createMockEngine } from '@brot/engines';
import type { Approval, CanonicalEvent, Run } from '@brot/protocol';
import { loadConfig } from './config';
import {
  ORPHANED_APPROVAL_REPLY,
  expireOrphanedApprovals,
  type ApprovalExpiryDeps,
} from './harness';
import { startServer, type ServerHandle } from './index';
import { createServices } from './services';
import { call, createTestContext, recordEvents, type TestContext } from './testing';

const at = '2026-10-22T12:00:00.000Z';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
  vi.restoreAllMocks();
});

function fakeApproval(id: string, runId: string): Approval {
  return {
    id,
    runId,
    threadId: 't1',
    botId: 'bot_1',
    kind: 'shell',
    tool: 'shell',
    summary: 'ls',
    args: {},
    status: 'pending',
    createdAt: at,
  };
}

function fakeRun(id: string, status: Run['status']): Run {
  return {
    id,
    threadId: 't1',
    botId: 'bot_1',
    status,
    engine: 'mock',
    startedAt: at,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
  };
}

/** A narrow fake of the deps, so the expiry logic runs without a database. */
function fakeDeps(initial: Approval[], runs: Map<string, Run | undefined>): {
  deps: ApprovalExpiryDeps;
  published: CanonicalEvent[];
  expiredCalls: Array<{ id: string; reply: string | undefined }>;
  expire: () => void;
} {
  const approvals = new Map(initial.map((item) => [item.id, item]));
  const published: CanonicalEvent[] = [];
  const expiredCalls: Array<{ id: string; reply: string | undefined }> = [];
  let refuseNextExpire = false;
  const deps: ApprovalExpiryDeps = {
    approvals: {
      listPending: async () => [...approvals.values()].filter((item) => item.status === 'pending'),
      expire: async (id, reply) => {
        expiredCalls.push({ id, reply });
        if (refuseNextExpire) {
          refuseNextExpire = false;
          return undefined;
        }
        const current = approvals.get(id);
        if (current === undefined || current.status !== 'pending') return undefined;
        const updated: Approval = {
          ...current,
          status: 'expired',
          resolvedAt: at,
          ...(reply === undefined ? {} : { reply }),
        };
        approvals.set(id, updated);
        return updated;
      },
    },
    runs: { get: async (id) => runs.get(id) },
    bus: {
      publish: async (event) => {
        const stored = { ...event, id: `evt_${published.length + 1}`, at } as CanonicalEvent;
        published.push(stored);
        return stored;
      },
    },
  };
  return {
    deps,
    published,
    expiredCalls,
    expire: () => {
      refuseNextExpire = true;
    },
  };
}

describe('expireOrphanedApprovals (fake deps)', () => {
  it('expires pending approvals whose run is missing or no longer active, publishing approval.resolved', async () => {
    const runs = new Map<string, Run | undefined>([
      ['run_waiting', fakeRun('run_waiting', 'waiting_approval')],
      ['run_running', fakeRun('run_running', 'running')],
      ['run_failed', fakeRun('run_failed', 'failed')],
      ['run_completed', fakeRun('run_completed', 'completed')],
      ['run_cancelled', fakeRun('run_cancelled', 'cancelled')],
      ['run_failed', fakeRun('run_failed', 'failed')],
    ]);
    const fake = fakeDeps(
      [
        fakeApproval('a_waiting', 'run_waiting'),
        fakeApproval('a_running', 'run_running'),
        fakeApproval('a_failed', 'run_failed'),
        fakeApproval('a_missing', 'run_missing'),
        fakeApproval('a_completed', 'run_completed'),
        fakeApproval('a_cancelled', 'run_cancelled'),
      ],
      runs,
    );

    expect(await expireOrphanedApprovals(fake.deps)).toBe(4);
    expect(fake.expiredCalls.map((callArgs) => callArgs.id)).toEqual([
      'a_failed',
      'a_missing',
      'a_completed',
      'a_cancelled',
    ]);
    expect(fake.expiredCalls.every((callArgs) => callArgs.reply === ORPHANED_APPROVAL_REPLY)).toBe(true);
    expect(fake.published).toHaveLength(4);
    for (const event of fake.published) {
      expect(event).toMatchObject({
        type: 'approval.resolved',
        threadId: 't1',
        approval: { status: 'expired', reply: ORPHANED_APPROVAL_REPLY },
      });
    }
  });

  it('leaves an active run approval pending, then expires it once the run ends', async () => {
    const runs = new Map<string, Run | undefined>([['run_1', fakeRun('run_1', 'waiting_approval')]]);
    const fake = fakeDeps([fakeApproval('a1', 'run_1')], runs);

    expect(await expireOrphanedApprovals(fake.deps)).toBe(0);
    expect(fake.published).toEqual([]);

    runs.set('run_1', fakeRun('run_1', 'failed'));
    expect(await expireOrphanedApprovals(fake.deps)).toBe(1);
    expect(fake.published).toHaveLength(1);
  });

  it('does nothing when no approval is pending, and skips an approval resolved concurrently', async () => {
    const empty = fakeDeps([], new Map());
    expect(await expireOrphanedApprovals(empty.deps)).toBe(0);
    expect(empty.published).toEqual([]);

    const fake = fakeDeps([fakeApproval('a1', 'run_gone')], new Map());
    fake.expire();
    expect(await expireOrphanedApprovals(fake.deps)).toBe(0);
    expect(fake.published).toEqual([]);
  });

  it('never throws when the repositories fail', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await expireOrphanedApprovals({
      approvals: {
        listPending: async () => {
          throw new Error('database is locked');
        },
        expire: async () => undefined,
      },
      runs: { get: async () => undefined },
      bus: { publish: async (event) => ({ ...event, id: 'evt', at } as CanonicalEvent) },
    });
    expect(result).toBe(0);
    expect(errors.mock.calls.some((args) => String(args[0]).includes('could not expire orphaned approvals'))).toBe(
      true,
    );
  });
});

describe('expireOrphanedApprovals (real repos and bus)', () => {
  async function seedApproval(status: Run['status']): Promise<{ approval: Approval; run: Run }> {
    const bot = await ctx.services.repos.bots.create({ name: 'Ada', job: 'Ops' });
    const thread = await ctx.services.repos.threads.create(bot.id, { title: 'Ops' });
    const run = await ctx.services.repos.runs.create({ threadId: thread.id, botId: bot.id, engine: 'mock' });
    if (status !== 'running') await ctx.services.repos.runs.update(run.id, { status });
    const approval = await ctx.services.repos.approvals.create({
      runId: run.id,
      threadId: thread.id,
      botId: bot.id,
      kind: 'shell',
      tool: 'shell',
      summary: 'ls',
      args: {},
    });
    return { approval, run };
  }

  it('expires the approval, writes the reply, and publishes approval.resolved', async () => {
    // An interrupted run is failed by recoverInterruptedRuns before the expiry step runs.
    const { approval } = await seedApproval('failed');
    const events = recordEvents(ctx.services.bus);

    expect(
      await expireOrphanedApprovals({
        approvals: ctx.services.repos.approvals,
        runs: ctx.services.repos.runs,
        bus: ctx.services.bus,
      }),
    ).toBe(1);

    const stored = await ctx.services.repos.approvals.get(approval.id);
    expect(stored).toMatchObject({ status: 'expired', reply: ORPHANED_APPROVAL_REPLY });
    expect(stored?.resolvedAt).toBeDefined();
    expect(stored?.decision).toBeUndefined();

    const event = events.list.find((item) => item.type === 'approval.resolved');
    expect(event).toMatchObject({ type: 'approval.resolved', runId: approval.runId, threadId: approval.threadId });
    expect(event?.type === 'approval.resolved' ? event.approval.status : undefined).toBe('expired');
    events.stop();
  });

  it('leaves active-run and already-decided approvals alone', async () => {
    const active = await seedApproval('waiting_approval');
    const decided = await seedApproval('failed');
    await ctx.services.repos.approvals.resolve(decided.approval.id, { decision: 'deny', reply: 'no' });

    expect(
      await expireOrphanedApprovals({
        approvals: ctx.services.repos.approvals,
        runs: ctx.services.repos.runs,
        bus: ctx.services.bus,
      }),
    ).toBe(0);
    expect((await ctx.services.repos.approvals.get(active.approval.id))?.status).toBe('pending');
    expect(await ctx.services.repos.approvals.get(decided.approval.id)).toMatchObject({
      status: 'denied',
      decision: 'deny',
      reply: 'no',
    });
  });

  it('removes expired cards from the pending list and keeps the decision log decision-only', async () => {
    const { approval } = await seedApproval('failed');
    await expireOrphanedApprovals({
      approvals: ctx.services.repos.approvals,
      runs: ctx.services.repos.runs,
      bus: ctx.services.bus,
    });

    const pending = (await (await call(ctx.app, 'GET', '/api/approvals?status=pending')).json()) as Approval[];
    expect(pending).toEqual([]);
    const expired = (await (await call(ctx.app, 'GET', '/api/approvals?status=expired')).json()) as Approval[];
    expect(expired.map((item) => item.id)).toEqual([approval.id]);
    expect(((await (await call(ctx.app, 'GET', '/api/decisions')).json()) as unknown[])).toEqual([]);
  });
});

describe('boot expiry', () => {
  const handles: ServerHandle[] = [];
  const dirs: string[] = [];

  afterEach(async () => {
    for (const handle of handles.splice(0)) await handle.close();
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it('expires approvals whose run an interrupted restart recovered as failed', async () => {
    const home = await mkdtemp(join(tmpdir(), 'brot-approval-boot-'));
    dirs.push(home);
    const config = loadConfig({ BROT_HOME: home });
    const services = await createServices(config, createEngineRegistry([createMockEngine()]));
    const bot = await services.repos.bots.create({ name: 'Ada', job: 'Ops' });
    const thread = await services.repos.threads.create(bot.id, { title: 'Ops' });
    const run = await services.repos.runs.create({ threadId: thread.id, botId: bot.id, engine: 'mock' });
    await services.repos.runs.update(run.id, { status: 'waiting_approval' });
    const approval = await services.repos.approvals.create({
      runId: run.id,
      threadId: thread.id,
      botId: bot.id,
      kind: 'shell',
      tool: 'shell',
      summary: 'ls',
      args: {},
    });
    await services.close();

    const server = await startServer({ home, host: '127.0.0.1', port: 0, webhookPort: 0 });
    handles.push(server);
    const base = `http://127.0.0.1:${server.port}`;

    const expired = (await (await fetch(`${base}/api/approvals?status=expired`)).json()) as Approval[];
    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({
      id: approval.id,
      status: 'expired',
      reply: ORPHANED_APPROVAL_REPLY,
    });
    expect(expired[0]?.resolvedAt).toBeDefined();
    expect(expired[0]?.decision).toBeUndefined();
    expect(await (await fetch(`${base}/api/approvals?status=pending`)).json()).toEqual([]);
    expect(await (await fetch(`${base}/api/decisions`)).json()).toEqual([]);

    const runs = (await (await fetch(`${base}/api/threads/${thread.id}/runs`)).json()) as Run[];
    expect(runs[0]).toMatchObject({ id: run.id, status: 'failed', error: 'server restarted' });
  });
});
