import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Approval, Decision } from '@brot/protocol';
import { call, createTestContext, type TestContext } from '../testing';

let ctx: TestContext;
let bot: { id: string };
let thread: { id: string };
let run: { id: string };

beforeEach(async () => {
  ctx = await createTestContext({ computers: {} });
  const { repos } = ctx.services;
  const created = await repos.bots.create({ name: 'Ada', job: 'Researcher', engine: 'mock' });
  bot = created;
  thread = await repos.threads.create(created.id, { title: 'Chat' });
  run = await repos.runs.create({ threadId: thread.id, botId: created.id, engine: 'mock' });
});

afterEach(async () => {
  await ctx.close();
});

/** Reads a CSV response with its BOM intact: `Response.text()` decodes UTF-8 and drops the BOM. */
async function csvBody(res: Response): Promise<string> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
}

async function seedDecision(
  options: {
    botId?: string;
    threadId?: string;
    runId?: string;
    decision?: 'allow_once' | 'allow_always' | 'deny';
    tool?: string;
    summary?: string;
    args?: Record<string, unknown>;
    reply?: string;
    resolvedAt?: string;
  } = {},
): Promise<Approval> {
  const approval = await ctx.services.repos.approvals.create({
    runId: options.runId ?? run.id,
    threadId: options.threadId ?? thread.id,
    botId: options.botId ?? bot.id,
    kind: 'send',
    tool: options.tool ?? 'send_email',
    summary: options.summary ?? 'Send the invoice',
    args: options.args ?? { to: 'ada@example.com' },
  });
  await ctx.services.repos.approvals.resolve(approval.id, {
    decision: options.decision ?? 'allow_once',
    ...(options.reply === undefined ? {} : { reply: options.reply }),
  });
  if (options.resolvedAt !== undefined) {
    await ctx.services.db.client.execute({
      sql: 'UPDATE approvals SET resolved_at = ? WHERE id = ?',
      args: [options.resolvedAt, approval.id],
    });
  }
  return (await ctx.services.repos.approvals.get(approval.id))!;
}

describe('GET /api/decisions', () => {
  it('lists resolved decisions newest first, with the audit fields and without args', async () => {
    const older = await seedDecision({ resolvedAt: '2026-10-20T10:00:00.000Z' });
    const newer = await seedDecision({
      resolvedAt: '2026-10-20T11:00:00.000Z',
      decision: 'deny',
      reply: 'Not this one',
    });

    const res = await call(ctx.app, 'GET', '/api/decisions');
    expect(res.status).toBe(200);
    const decisions = (await res.json()) as Decision[];
    expect(decisions.map((item) => item.id)).toEqual([newer.id, older.id]);
    expect(decisions[0]).toEqual({
      id: newer.id,
      runId: run.id,
      threadId: thread.id,
      botId: bot.id,
      kind: 'send',
      tool: 'send_email',
      summary: 'Send the invoice',
      decision: 'deny',
      reply: 'Not this one',
      decidedAt: '2026-10-20T11:00:00.000Z',
    });
    expect(decisions[0]).not.toHaveProperty('args');
    expect(decisions[1]?.reply).toBeUndefined();
  });

  it('excludes decisions outside the default 30-day window, and includes explicit ranges', async () => {
    const old = await seedDecision({ resolvedAt: '2020-01-01T00:00:00.000Z' });
    expect(((await (await call(ctx.app, 'GET', '/api/decisions')).json()) as Decision[]).some((d) => d.id === old.id)).toBe(
      false,
    );
    const ranged = (await (
      await call(ctx.app, 'GET', '/api/decisions?from=2019-12-31T00:00:00.000Z&to=2020-01-02T00:00:00.000Z')
    ).json()) as Decision[];
    expect(ranged.map((item) => item.id)).toEqual([old.id]);
  });

  it('filters by decision, bot and limit', async () => {
    const denied = await seedDecision({ decision: 'deny', resolvedAt: '2026-10-20T10:00:00.000Z' });
    await seedDecision({ resolvedAt: '2026-10-20T11:00:00.000Z' });
    await seedDecision({ resolvedAt: '2026-10-20T12:00:00.000Z' });

    const onlyDenied = (await (await call(ctx.app, 'GET', '/api/decisions?decision=deny')).json()) as Decision[];
    expect(onlyDenied.map((item) => item.id)).toEqual([denied.id]);

    const limited = (await (await call(ctx.app, 'GET', '/api/decisions?limit=2')).json()) as Decision[];
    expect(limited).toHaveLength(2);

    const other = await ctx.services.repos.bots.create({ name: 'Bo', job: 'x', engine: 'mock' });
    const otherThread = await ctx.services.repos.threads.create(other.id);
    const otherRun = await ctx.services.repos.runs.create({ threadId: otherThread.id, botId: other.id, engine: 'mock' });
    const foreign = await seedDecision({
      botId: other.id,
      threadId: otherThread.id,
      runId: otherRun.id,
      resolvedAt: '2026-10-20T13:00:00.000Z',
    });
    const forBot = (await (
      await call(ctx.app, 'GET', `/api/decisions?botId=${other.id}`)
    ).json()) as Decision[];
    expect(forBot.map((item) => item.id)).toEqual([foreign.id]);
  });

  it('answers 400 for invalid dates, ranges, decision, limit and bot', async () => {
    for (const query of [
      'from=yesterday',
      'decision=maybe',
      'limit=0',
      'limit=201',
      'limit=abc',
      'from=2026-10-20T00:00:00.000Z&to=2026-10-19T00:00:00.000Z',
    ]) {
      expect((await call(ctx.app, 'GET', `/api/decisions?${query}`)).status).toBe(400);
    }

    const unknownBot = await call(ctx.app, 'GET', '/api/decisions?botId=nope');
    expect(unknownBot.status).toBe(400);
    const issues = ((await unknownBot.json()) as { issues: { path: string[]; message: string }[] }).issues;
    expect(issues[0]?.path).toEqual(['botId']);
    expect(issues[0]?.message).toMatch(/unknown bot nope/);
  });

  it('requires device auth from a remote caller', async () => {
    expect((await ctx.remote.request('/api/decisions')).status).toBe(401);
  });
});

describe('GET /api/decisions/export.csv', () => {
  it('downloads a BOM + CRLF CSV with the fixed header and escaped, neutralized cells', async () => {
    const formula = await seedDecision({
      decision: 'deny',
      tool: '=HYPERLINK("http://evil")',
      reply: '+SUM(A1)',
      summary: 'SECRET SUMMARY should not be exported',
      args: { token: 'ARG-SECRET' },
      resolvedAt: '2026-10-20T10:00:00.000Z',
    });

    const res = await call(
      ctx.app,
      'GET',
      '/api/decisions/export.csv?from=2026-10-01T00:00:00.000Z&to=2026-10-22T00:00:00.000Z',
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    const disposition = res.headers.get('content-disposition') ?? '';
    expect(disposition).toMatch(/^attachment; filename="brot-decisions-2026-10-01T00:00:00\.000Z-2026-10-22T00:00:00\.000Z\.csv"$/);

    const text = await csvBody(res);
    expect(text.startsWith('\uFEFF')).toBe(true);
    expect(text).toContain('\r\n');
    const records = text.slice(1).split('\r\n');
    expect(records[0]).toBe('id,run_id,thread_id,bot_id,kind,tool,decision,decided_at,reply');
    expect(records).toHaveLength(3);
    expect(records[1]).toContain(formula.id);
    expect(records[1]).toContain("'=HYPERLINK");
    expect(records[1]).toContain("'+SUM(A1)");
    expect(text).not.toContain('SECRET SUMMARY');
    expect(text).not.toContain('ARG-SECRET');
  });

  it('writes only the header for an empty range', async () => {
    const res = await call(
      ctx.app,
      'GET',
      '/api/decisions/export.csv?from=2020-01-01T00:00:00.000Z&to=2020-01-02T00:00:00.000Z',
    );
    expect(res.status).toBe(200);
    expect(await csvBody(res)).toBe('\uFEFFid,run_id,thread_id,bot_id,kind,tool,decision,decided_at,reply\r\n');
  });

  it('answers 400 for an invalid query and 401 for a remote caller', async () => {
    expect((await call(ctx.app, 'GET', '/api/decisions/export.csv?limit=0')).status).toBe(400);
    expect((await ctx.remote.request('/api/decisions/export.csv')).status).toBe(401);
  });
});
