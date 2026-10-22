import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  UsageSummary as UsageSummarySchema,
  type Bot,
  type Run,
  type RunStatus,
  type UsageSummary,
} from '@brot/protocol';
import { createApp } from '../app';
import { call, createTestContext, type TestContext } from '../testing';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

const from = '2026-10-01T00:00:00.000Z';
const to = '2026-10-03T00:00:00.000Z';
const query = `from=${from}&to=${to}`;
const csvHeader =
  'id,bot_id,bot_name,thread_id,started_at,ended_at,status,engine,model,tokens_in,tokens_out,cost_usd';

async function createBot(name: string): Promise<Bot> {
  return ctx.services.repos.bots.create({ name, job: 'Operations' });
}

interface SeedRunInput {
  startedAt: string;
  status?: RunStatus;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  model?: string;
  /** `null` leaves the run open, as a running one is. Defaults to the start time. */
  endedAt?: string | null;
}

async function seedRun(bot: Bot, input: SeedRunInput): Promise<Run> {
  const thread = await ctx.services.repos.threads.create(bot.id, { title: 'Chat' });
  const run = await ctx.services.repos.runs.create({
    threadId: thread.id,
    botId: bot.id,
    engine: 'mock',
    ...(input.model === undefined ? {} : { model: input.model }),
  });
  await ctx.services.db.client.execute({
    sql: 'UPDATE runs SET started_at = ?, status = ?, tokens_in = ?, tokens_out = ?, cost_usd = ?, ended_at = ? WHERE id = ?',
    args: [
      input.startedAt,
      input.status ?? 'completed',
      input.tokensIn ?? 0,
      input.tokensOut ?? 0,
      input.costUsd ?? 0,
      input.endedAt === undefined ? input.startedAt : input.endedAt,
      run.id,
    ],
  });
  const seeded = await ctx.services.repos.runs.get(run.id);
  if (seeded === undefined) throw new Error('the seeded run disappeared');
  return seeded;
}

/** An app whose usage default range resolves against a fixed clock. */
function fixedApp(nowIso: string) {
  return createApp({
    ...ctx.services,
    config: { host: '127.0.0.1', port: 8799, mode: 'server' },
    trustLoopback: true,
    now: () => new Date(nowIso),
  });
}

/** Reads a CSV response with its BOM intact: `Response.text()` decodes UTF-8 and drops the BOM. */
async function csvBody(res: Response): Promise<string> {
  const bytes = new Uint8Array(await res.arrayBuffer());
  expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
}

async function summaryOf(app: ReturnType<typeof createApp>, path: string): Promise<UsageSummary> {
  const res = await call(app, 'GET', path);
  expect(res.status).toBe(200);
  const summary = (await res.json()) as UsageSummary;
  expect(UsageSummarySchema.parse(summary)).toEqual(summary);
  return summary;
}

describe('GET /api/usage', () => {
  it('sums totals and groups by UTC day', async () => {
    const ada = await createBot('Ada');
    const grace = await createBot('Grace');
    await seedRun(ada, {
      startedAt: '2026-10-01T23:30:00.000Z',
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.1,
      endedAt: '2026-10-01T23:31:00.000Z',
    });
    await seedRun(ada, { startedAt: '2026-10-02T00:30:00.000Z', status: 'failed', tokensIn: 20, tokensOut: 10, costUsd: 0.2 });
    await seedRun(ada, {
      startedAt: '2026-10-02T12:00:00.000Z',
      status: 'running',
      tokensIn: 5,
      tokensOut: 1,
      costUsd: 0.05,
      endedAt: null,
    });
    await seedRun(grace, { startedAt: '2026-10-02T23:59:59.000Z', status: 'cancelled', tokensIn: 1, tokensOut: 1, costUsd: 0.01 });

    const summary = await summaryOf(ctx.app, `/api/usage?${query}`);
    expect(summary).toMatchObject({ from, to });
    expect(summary.totals).toMatchObject({ runs: 4, completed: 1, failed: 1, cancelled: 1, tokensIn: 36, tokensOut: 17 });
    expect(summary.totals.costUsd).toBeCloseTo(0.36, 10);
    expect(summary.groups.map((group) => group.key)).toEqual(['2026-10-01', '2026-10-02']);
    expect(summary.groups[0]).toMatchObject({
      key: '2026-10-01',
      totals: { runs: 1, completed: 1, failed: 0, cancelled: 0, tokensIn: 10, tokensOut: 5 },
    });
    expect(summary.groups[0]?.label).toBeUndefined();
    expect(summary.groups[1]).toMatchObject({
      key: '2026-10-02',
      totals: { runs: 3, completed: 0, failed: 1, cancelled: 1, tokensIn: 26, tokensOut: 12 },
    });
  });

  it('groups by bot with names, and filters to one bot', async () => {
    const ada = await createBot('Ada');
    const grace = await createBot('Grace');
    await seedRun(ada, { startedAt: '2026-10-01T10:00:00.000Z', tokensIn: 10, tokensOut: 1 });
    await seedRun(ada, { startedAt: '2026-10-02T10:00:00.000Z', status: 'failed', tokensIn: 5, tokensOut: 1 });
    await seedRun(grace, { startedAt: '2026-10-02T11:00:00.000Z', tokensIn: 2, tokensOut: 2 });

    const grouped = await summaryOf(ctx.app, `/api/usage?${query}&group=bot`);
    expect(grouped.groups.map((group) => group.key)).toEqual([ada.id, grace.id].sort());
    expect(grouped.groups.find((group) => group.key === ada.id)).toMatchObject({
      label: 'Ada',
      totals: { runs: 2, completed: 1, failed: 1, tokensIn: 15, tokensOut: 2 },
    });
    expect(grouped.groups.find((group) => group.key === grace.id)?.label).toBe('Grace');

    const filtered = await summaryOf(ctx.app, `/api/usage?${query}&group=bot&botId=${ada.id}`);
    expect(filtered.totals).toMatchObject({ runs: 2, completed: 1, failed: 1, tokensIn: 15, tokensOut: 2 });
    expect(filtered.groups.map((group) => group.key)).toEqual([ada.id]);
  });

  it('filters and names an archived bot’s runs', async () => {
    const retired = await createBot('Retired');
    await seedRun(retired, { startedAt: '2026-10-01T10:00:00.000Z' });
    await ctx.services.repos.bots.update(retired.id, { archived: true });

    const summary = await summaryOf(ctx.app, `/api/usage?${query}&botId=${retired.id}&group=bot`);
    expect(summary.totals.runs).toBe(1);
    expect(summary.groups.map((group) => group.key)).toEqual([retired.id]);
    expect(summary.groups[0]?.label).toBe('Retired');
  });

  it('defaults to the last 30 days when the range is omitted, and treats to as exclusive', async () => {
    const bot = await createBot('Ada');
    const fixedNow = '2026-10-22T12:00:00.000Z';
    const app = fixedApp(fixedNow);
    await seedRun(bot, { startedAt: '2026-09-22T12:00:00.000Z' });
    await seedRun(bot, { startedAt: '2026-09-22T11:59:59.999Z' });
    await seedRun(bot, { startedAt: '2026-10-22T11:59:59.999Z' });
    await seedRun(bot, { startedAt: fixedNow });

    const summary = await summaryOf(app, '/api/usage');
    expect(summary).toMatchObject({ from: '2026-09-22T12:00:00.000Z', to: fixedNow });
    expect(summary.totals.runs).toBe(2);

    const explicitTo = await summaryOf(app, '/api/usage?to=2026-10-01T00:00:00Z');
    expect(explicitTo).toMatchObject({ from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' });
    expect(explicitTo.totals.runs).toBe(2);

    const explicitFrom = await summaryOf(app, '/api/usage?from=2026-10-01T00:00:00.000Z');
    expect(explicitFrom).toMatchObject({ from: '2026-10-01T00:00:00.000Z', to: fixedNow });
    expect(explicitFrom.totals.runs).toBe(1);
  });

  it('rejects an invalid date, an inverted range, an unknown grouping, and an unknown bot with 400', async () => {
    async function issuesAt(path: string): Promise<{ path: string[] }[]> {
      const res = await call(ctx.app, 'GET', path);
      expect(res.status).toBe(400);
      return ((await res.json()) as { issues: { path: string[] }[] }).issues;
    }

    expect((await issuesAt('/api/usage?from=yesterday'))[0]?.path).toEqual(['from']);
    expect(
      (await issuesAt('/api/usage?from=2026-10-03T00:00:00.000Z&to=2026-10-02T00:00:00.000Z'))[0]?.path,
    ).toEqual(['from']);
    expect((await issuesAt('/api/usage?group=week'))[0]?.path).toEqual(['group']);
    expect((await issuesAt('/api/usage?botId=bot_nowhere'))[0]?.path).toEqual(['botId']);
    expect((await issuesAt('/api/usage/export.csv?from=2026-10-01'))[0]?.path).toEqual(['from']);
  });
});

describe('GET /api/usage/export.csv', () => {
  it('exports the runs as CSV with a BOM, CRLF records, and a download name', async () => {
    const ada = await createBot('Ada, "Ops"');
    const seeded = await seedRun(ada, {
      startedAt: '2026-10-01T10:00:00.000Z',
      tokensIn: 10,
      tokensOut: 5,
      costUsd: 0.25,
      model: 'mock,1',
      endedAt: '2026-10-01T10:05:00.000Z',
    });

    const res = await call(ctx.app, 'GET', `/api/usage/export.csv?${query}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="brot-usage-${from}-${to}.csv"`);

    const body = await csvBody(res);
    expect(body.startsWith('\uFEFF')).toBe(true);
    const records = body.slice(1).split('\r\n');
    expect(records.at(-1)).toBe('');
    expect(records[0]).toBe(csvHeader);
    expect(records).toHaveLength(3);
    expect(records[1]).toContain(`${seeded.id},${ada.id},"Ada, ""Ops""",${seeded.threadId},2026-10-01T10:00:00.000Z`);
    expect(records[1]).toContain('"mock,1"');
    expect(records[1]?.endsWith(',10,5,0.25')).toBe(true);
  });

  it('writes only the header for an empty range, and filters by bot', async () => {
    const ada = await createBot('Ada');
    const grace = await createBot('Grace');
    await seedRun(ada, { startedAt: '2026-10-01T10:00:00.000Z' });
    await seedRun(grace, { startedAt: '2026-10-01T11:00:00.000Z' });

    const empty = await call(
      ctx.app,
      'GET',
      '/api/usage/export.csv?from=2020-01-01T00:00:00.000Z&to=2020-01-02T00:00:00.000Z',
    );
    expect(empty.status).toBe(200);
    expect(await csvBody(empty)).toBe(`\uFEFF${csvHeader}\r\n`);

    const filtered = await call(ctx.app, 'GET', `/api/usage/export.csv?${query}&botId=${ada.id}`);
    const records = (await csvBody(filtered)).slice(1).split('\r\n');
    expect(records).toHaveLength(3);
    expect(records[1]).toContain(`,${ada.id},Ada,`);
    expect(records[1]).not.toContain(grace.id);
  });
});
