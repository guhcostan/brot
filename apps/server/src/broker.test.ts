import { createDb, createRepos, migrate, type BrotDb, type Repos } from '@brot/db';
import type { Approval, ApprovalKind, CanonicalEvent, Policy, ToolRequest } from '@brot/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBroker, matchesPolicy, verdictFor, type ApprovalScope, type Broker } from './broker';
import { createEventBus } from './bus';

function policy(overrides: Partial<Policy>): Policy {
  return {
    id: 'p',
    botId: 'b',
    tool: 'shell',
    effect: 'allow',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const request = { tool: 'shell', args: { command: 'git push origin main' } };

describe('policy matching', () => {
  it('matches the tool exactly or through the * wildcard', () => {
    expect(matchesPolicy(policy({ tool: 'shell' }), request)).toBe(true);
    expect(matchesPolicy(policy({ tool: 'browser' }), request)).toBe(false);
    expect(matchesPolicy(policy({ tool: '*' }), request)).toBe(true);
  });

  it('matches argPattern against the JSON-encoded args', () => {
    expect(matchesPolicy(policy({ argPattern: 'git push' }), request)).toBe(true);
    expect(matchesPolicy(policy({ argPattern: 'rm -rf' }), request)).toBe(false);
  });

  it('treats an invalid argPattern as no match', () => {
    expect(matchesPolicy(policy({ argPattern: '([' }), request)).toBe(false);
  });
});

describe('verdicts', () => {
  it('asks when no policy matches', () => {
    expect(verdictFor([], request)).toBe('ask');
    expect(verdictFor([policy({ tool: 'browser' })], request)).toBe('ask');
  });

  it('allows on a matching allow policy', () => {
    expect(verdictFor([policy({ effect: 'allow' })], request)).toBe('allow');
  });

  it('lets a matching deny win over a matching allow', () => {
    const policies = [policy({ effect: 'allow' }), policy({ effect: 'deny', argPattern: 'push' })];
    expect(verdictFor(policies, request)).toBe('deny');
  });
});

/** The kinds an `edits` bot may run without asking. */
const EDIT_KINDS: ApprovalKind[] = ['shell', 'file_write', 'other'];
/** The kinds that always need a person, whatever the bot's mode. */
const IRREVERSIBLE_KINDS: ApprovalKind[] = ['send', 'publish', 'delete', 'purchase', 'permission'];

let db: BrotDb;
let repos: Repos;
let broker: Broker;
let events: CanonicalEvent[];
let scope: ApprovalScope;
let runId: string;

beforeEach(async () => {
  db = await createDb(':memory:');
  await migrate(db.db);
  repos = createRepos(db.db);
  events = [];
  const bus = createEventBus(repos.events);
  bus.subscribe((event) => events.push(event));
  broker = createBroker({ repos, bus });
  const bot = await repos.bots.create({ name: 'Ada', job: 'Editor', approvalMode: 'edits' });
  const thread = await repos.threads.create(bot.id);
  const run = await repos.runs.create({ threadId: thread.id, botId: bot.id, engine: 'mock' });
  runId = run.id;
  scope = { botId: bot.id, threadId: thread.id, runId: run.id };
});

afterEach(() => {
  db.client.close();
});

/** A bot in a fresh thread with a running run, for the `ask` mode and read checks. */
async function addBot(mode?: 'ask' | 'edits'): Promise<{ scope: ApprovalScope; runId: string }> {
  const bot = await repos.bots.create({ name: 'Bo', job: 'Helper', ...(mode === undefined ? {} : { approvalMode: mode }) });
  const thread = await repos.threads.create(bot.id);
  const run = await repos.runs.create({ threadId: thread.id, botId: bot.id, engine: 'mock' });
  return { scope: { botId: bot.id, threadId: thread.id, runId: run.id }, runId: run.id };
}

function toolRequest(overrides: Partial<ToolRequest> = {}): ToolRequest {
  return {
    callId: 'call_1',
    tool: 'shell',
    args: { command: 'npm test' },
    kind: 'shell',
    summary: 'Run the tests',
    risk: 'write',
    ...overrides,
  };
}

async function waitForPendingApproval(): Promise<Approval> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [approval] = await repos.approvals.list({ status: 'pending' });
    if (approval !== undefined) return approval;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('timed out waiting for an approval');
}

describe('approval mode', () => {
  it("edits auto-allows write shell, file_write and other without an approval row, event or waiting status", async () => {
    for (const kind of EDIT_KINDS) {
      const decision = await broker.request(scope, toolRequest({ kind, tool: kind }));

      expect(decision).toEqual({ allowed: true });
      expect(await repos.approvals.list()).toHaveLength(0);
      expect(events.some((event) => event.type === 'approval.requested')).toBe(false);
      expect((await repos.runs.get(runId))?.status).toBe('running');
    }
  });

  it('edits still asks for every irreversible kind, and denying restores the run', async () => {
    for (const kind of IRREVERSIBLE_KINDS) {
      const req = toolRequest({ kind, tool: kind, risk: 'irreversible' });
      const decision = broker.request(scope, req);
      const approval = await waitForPendingApproval();

      expect(approval).toMatchObject({ botId: scope.botId, kind, tool: kind, summary: req.summary });
      expect(events.some((event) => event.type === 'approval.requested' && event.approval.id === approval.id)).toBe(true);
      expect((await repos.runs.get(runId))?.status).toBe('waiting_approval');

      await broker.resolve(approval.id, 'deny');
      expect(await decision).toEqual({ allowed: false, reply: 'Denied by the user.' });
      expect((await repos.runs.get(runId))?.status).toBe('running');
    }
  });

  it('edits still asks when an edit kind is declared irreversible', async () => {
    const decision = broker.request(scope, toolRequest({ kind: 'shell', risk: 'irreversible' }));
    const approval = await waitForPendingApproval();
    expect(approval.kind).toBe('shell');

    await broker.resolve(approval.id, 'deny');
    expect(await decision).toEqual({ allowed: false, reply: 'Denied by the user.' });
  });

  it('ask keeps asking for write edits', async () => {
    const asking = await addBot('ask');
    const decision = broker.request(asking.scope, toolRequest());
    const approval = await waitForPendingApproval();
    expect(approval.botId).toBe(asking.scope.botId);
    expect((await repos.runs.get(asking.runId))?.status).toBe('waiting_approval');

    await broker.resolve(approval.id, 'deny');
    expect(await decision).toEqual({ allowed: false, reply: 'Denied by the user.' });
  });

  it('an explicit deny policy still denies in edits mode, without an approval', async () => {
    await repos.policies.create(scope.botId, { tool: 'shell', effect: 'deny' });

    expect(await broker.request(scope, toolRequest())).toEqual({ allowed: false, reply: 'Denied by policy.' });
    expect(await repos.approvals.list()).toHaveLength(0);
    expect(events.some((event) => event.type === 'approval.requested')).toBe(false);
  });

  it('leaves read risk auto-allowed in both modes', async () => {
    const asking = await addBot('ask');
    for (const target of [scope, asking.scope]) {
      const read = toolRequest({ tool: 'http_request', kind: 'other', risk: 'read' });
      expect(await broker.request(target, read)).toEqual({ allowed: true });
    }
    expect(await repos.approvals.list()).toHaveLength(0);
  });

  it('a deny policy beats the read auto-allow in both modes', async () => {
    const asking = await addBot('ask');
    for (const target of [scope, asking.scope]) {
      await repos.policies.create(target.botId, { tool: 'http_request', effect: 'deny' });
      const read = toolRequest({ tool: 'http_request', kind: 'other', risk: 'read' });
      expect(await broker.request(target, read)).toEqual({ allowed: false, reply: 'Denied by policy.' });
    }
  });

  it('asks instead of auto-allowing when the bot row is missing', async () => {
    // The scope names a bot the database does not have. approvals.bot_id is a foreign key, so checks are off for
    // this test to let the ask path record what it would record.
    await db.client.execute('PRAGMA foreign_keys = OFF');
    const ghost: ApprovalScope = { ...scope, botId: 'bot_ghost' };
    const decision = broker.request(ghost, toolRequest());
    const approval = await waitForPendingApproval();

    expect(approval.botId).toBe('bot_ghost');
    await broker.resolve(approval.id, 'deny');
    expect(await decision).toEqual({ allowed: false, reply: 'Denied by the user.' });
  });
});
