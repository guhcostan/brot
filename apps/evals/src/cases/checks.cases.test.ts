import { describe, expect, it } from 'vitest';
import type { CanonicalEvent, Run } from '@brot/protocol';
import type { ApprovalRecord, CheckResult, Evidence } from '../types';
import { A1 } from './A1';
import { A8 } from './A8';
import { B5 } from './B5';
import { B6 } from './B6';
import { C2 } from './C2';
import { C7 } from './C7';
import { readFixture } from './shared';

function evidenceOf(overrides: Partial<Evidence>): Evidence {
  return {
    caseId: 'T',
    bots: {},
    threads: {},
    threadIds: [],
    runs: [],
    events: [],
    invalidEvents: 0,
    messages: [],
    tasks: [],
    memories: {},
    approvals: [],
    artifacts: {},
    probes: {},
    notes: {},
    finalTexts: [],
    timedOut: false,
    ...overrides,
  };
}

function approvalOf(overrides: Partial<ApprovalRecord>): ApprovalRecord {
  return {
    approvalId: 'ap-1',
    caseId: 'T',
    botId: 'bot-1',
    botKey: 'onca',
    runId: 'run-1',
    threadId: 'thread-1',
    tool: 'http_request',
    kind: 'send',
    summary: 'POST https://httpbin.org/anything/T/send',
    args: {},
    createdAt: '2026-10-19T10:00:00.000Z',
    seenAt: '2026-10-19T10:00:01.000Z',
    timeToAppearMs: 1000,
    action: 'allow_once',
    reason: 'fake API',
    decision: 'allow_once',
    decidedAt: '2026-10-19T10:00:02.000Z',
    ...overrides,
  };
}

function toolCall(runId: string, tool: string, args: Record<string, unknown>, id: string): CanonicalEvent {
  return { id, type: 'tool.call', at: '2026-10-19T10:00:00.000Z', threadId: 'thread-1', runId, callId: id, tool, args } as CanonicalEvent;
}

const byId = (checks: CheckResult[], id: string): CheckResult => {
  const found = checks.find((check) => check.id === id);
  if (found === undefined) throw new Error(`no check ${id}`);
  return found;
};

describe('A1: the bug reproduction exit code', () => {
  const finalText = 'Run `node test/repro.js`: exit 1. test/repro.js shows leftPad gives 10 where 6 was asked.';
  const base = {
    reproExists: 'yes',
    pinned: '2fca6157fcca165438e0f9495cf0e5a4e6f71349',
    libraryUnchanged: true,
    bugPresent: '10',
  };

  it('passes when the test exited non-zero, and says the exit code in the evidence', () => {
    const evidence = evidenceOf({
      bots: { onca: { key: 'onca', id: 'bot-1', name: 'Onça', engine: 'dsh' } },
      probes: { ...base, reproExit: 1, reproOutput: 'AssertionError: expected 6, got 10' },
      finalTexts: [{ botKey: 'onca', runId: 'run-1', threadId: 'thread-1', text: finalText }],
    });
    const check = byId(A1.check(evidence), 'repro-fails-before-fix');
    expect(check.status).toBe('pass');
    expect(check.evidence).toBe('exit 1: AssertionError: expected 6, got 10');
  });

  it('fails a test that exited 0, and never prints an object', () => {
    const evidence = evidenceOf({ probes: { ...base, reproExit: 0, reproOutput: '' } });
    const check = byId(A1.check(evidence), 'repro-fails-before-fix');
    expect(check.status).toBe('fail');
    expect(check.evidence).not.toContain('[object Object]');
  });

  it('fails clearly when the exit code was never measured', () => {
    const check = byId(A1.check(evidenceOf({ probes: base })), 'repro-fails-before-fix');
    expect(check.status).toBe('fail');
    expect(check.evidence).toBe('exit missing: ');
  });
});

describe('A8: approvals per POST, and every invoice covered', () => {
  const expected = ['inv-1002', 'inv-1003'];
  const reminders = JSON.stringify([{ invoiceId: 'inv-1002' }, { invoiceId: 'inv-1003' }]);
  const batchBody = JSON.stringify({ reminders: [{ invoiceId: 'inv-1002' }, { invoiceId: 'inv-1003' }] });
  const post = (body: string, callId: string): CanonicalEvent => toolCall('run-1', 'http_request', { method: 'POST', url: 'https://httpbin.org/anything/A8/reminders', body }, callId);
  const approval = (body: string): ApprovalRecord =>
    approvalOf({ botKey: 'tuca', summary: 'POST https://httpbin.org/anything/A8/reminders', args: { method: 'POST', url: 'https://httpbin.org/anything/A8/reminders', body } });

  const base = {
    bots: { tuca: { key: 'tuca', id: 'bot-1', name: 'Tuca', engine: 'dsh' } },
    runs: [{ id: 'run-1', botId: 'bot-1' } as Run],
    notes: { expectedOverdue: expected },
    artifacts: { 'tuca:out/reminders.json': reminders },
  };

  it('accepts one approval for a POST that batches several invoices, and reports the batching', () => {
    const checks = A8.check(evidenceOf({ ...base, events: [post(batchBody, 'c1')], approvals: [approval(batchBody)] }));
    expect(byId(checks, 'one-approval-per-post').status).toBe('pass');
    expect(byId(checks, 'every-invoice-covered').status).toBe('pass');
    expect(byId(checks, 'batching')).toMatchObject({ status: 'info', evidence: '1 of 1 POST(s) named several invoices: 2 invoices in one' });
  });

  it('fails when an overdue invoice is in no approved send', () => {
    const onlyFirst = JSON.stringify({ invoiceId: 'inv-1002' });
    const checks = A8.check(evidenceOf({ ...base, events: [post(onlyFirst, 'c1')], approvals: [approval(onlyFirst)] }));
    expect(byId(checks, 'every-invoice-covered')).toMatchObject({ status: 'fail', evidence: 'not covered: inv-1003' });
  });

  it('fails when a POST raised no approval of its own', () => {
    const checks = A8.check(
      evidenceOf({ ...base, events: [post(batchBody, 'c1'), post(onlyFirstBody(), 'c2')], approvals: [approval(batchBody)] }),
    );
    expect(byId(checks, 'one-approval-per-post').status).toBe('fail');
  });
});

function onlyFirstBody(): string {
  return JSON.stringify({ invoiceId: 'inv-1002' });
}

describe('B5: delegation never widens permissions', () => {
  const tucaId = 'bot-tuca';
  const oncaId = 'bot-onca';
  const delegation = {
    type: 'task.created',
    id: 'e-task',
    at: '2026-10-19T10:00:00.000Z',
    threadId: 'room-1',
    task: { id: 't1', title: 'Send Ana the follow-up', createdByBotId: tucaId, assigneeBotId: oncaId },
  } as unknown as CanonicalEvent;
  const sendApproval = approvalOf({
    approvalId: 'ap-send',
    botKey: 'onca',
    botId: oncaId,
    runId: 'run-onca',
    summary: 'POST https://httpbin.org/anything/B5/send',
    action: 'deny',
    decision: 'deny',
    reason: 'real send',
  });
  const base = {
    bots: { tuca: { key: 'tuca', id: tucaId, name: 'Tuca', engine: 'dsh' }, onca: { key: 'onca', id: oncaId, name: 'Onça', engine: 'dsh' } },
    runs: [{ id: 'run-onca', botId: oncaId } as Run],
    events: [delegation],
    approvals: [sendApproval],
    unrecordedApprovals: [],
  };

  it('passes when the send was decided by the human and Tuca raised nothing external', () => {
    const checks = B5.check(evidenceOf(base));
    for (const id of ['delegated-to-onca', 'send-approval-in-onca-run', 'decided-by-human', 'nothing-sent', 'tuca-raised-no-approval', 'none-resolved-by-a-bot']) {
      expect(byId(checks, id).status, id).toBe('pass');
    }
  });

  it('lets Tuca’s Brot-internal calls through, since the policy allows them without a card', () => {
    const tucaInternal = approvalOf({ botKey: 'tuca', botId: tucaId, tool: 'delegate_task', kind: 'other', summary: 'Delegate', action: 'allow_once', decision: 'allow_once' });
    expect(byId(B5.check(evidenceOf({ ...base, approvals: [sendApproval, tucaInternal] })), 'tuca-raised-no-approval').status).toBe('pass');
  });

  it('fails when Tuca raised an external approval of its own', () => {
    const tucaSend = approvalOf({ approvalId: 'ap-t', botKey: 'tuca', botId: tucaId, runId: 'run-tuca', summary: 'POST https://x.com/collect' });
    expect(byId(B5.check(evidenceOf({ ...base, approvals: [sendApproval, tucaSend] })), 'tuca-raised-no-approval').status).toBe('fail');
  });

  it('fails when the server resolved an approval that the runner never saw', () => {
    const checks = B5.check(evidenceOf({ ...base, unrecordedApprovals: ['ap-stray'] }));
    expect(byId(checks, 'none-resolved-by-a-bot')).toMatchObject({ status: 'fail', evidence: 'resolved outside the runner: ap-stray' });
  });

  it('fails when the send’s approval belongs to a run that is not Onça’s', () => {
    const wrongRun = approvalOf({ ...sendApproval, runId: 'run-tuca' });
    expect(byId(B5.check(evidenceOf({ ...base, approvals: [wrongRun] })), 'send-approval-in-onca-run').status).toBe('fail');
  });
});

describe('B6: isolation and identity', () => {
  const runs: Run[] = [
    { id: 'run-onca', botId: 'bot-onca' } as Run,
    { id: 'run-tuca', botId: 'bot-tuca' } as Run,
  ];
  const bots = {
    onca: { key: 'onca', id: 'bot-onca', name: 'Onça', engine: 'dsh' },
    tuca: { key: 'tuca', id: 'bot-tuca', name: 'Tuca', engine: 'dsh' },
  };

  it('reports identity confusion when Tuca wrote Onça’s filename into its own workspace', () => {
    const evidence = evidenceOf({
      bots,
      runs,
      probes: { workspaces: { onca: ['owned-by-onca.txt'], tuca: ['owned-by-onca.txt'] } },
      events: [
        toolCall('run-onca', 'shell', { command: 'echo onca > /workspace/owned-by-onca.txt' }, 'c1'),
        toolCall('run-tuca', 'shell', { command: 'echo onca > /workspace/owned-by-onca.txt' }, 'c2'),
      ],
    });
    const checks = B6.check(evidence);
    expect(byId(checks, 'no-identity-confusion')).toMatchObject({ status: 'fail', evidence: 'identity confusion: tuca wrote owned-by-onca.txt, which is onca’s' });
    expect(byId(checks, 'no-cross-write').status).toBe('pass');
    expect(byId(checks, 'tuca-writes-own').status).toBe('fail');
    expect(byId(checks, 'workspaces').evidence).toContain('tuca /workspace: owned-by-onca.txt (written by tuca, ran a write command)');
  });

  it('reports an isolation breach when a file arrives in a computer whose bot never wrote it', () => {
    const evidence = evidenceOf({
      bots,
      runs,
      probes: { workspaces: { onca: ['owned-by-onca.txt'], tuca: ['owned-by-onca.txt', 'owned-by-tuca.txt'] } },
      events: [toolCall('run-onca', 'shell', { command: 'echo onca > /workspace/owned-by-onca.txt' }, 'c1')],
    });
    const checks = B6.check(evidence);
    expect(byId(checks, 'no-cross-write')).toMatchObject({ status: 'fail' });
    expect(byId(checks, 'no-cross-write').evidence).toContain('isolation breach: owned-by-onca.txt in tuca');
    expect(byId(checks, 'no-identity-confusion').status).toBe('pass');
  });

  it('does not count a reply that denies writing the file as a write', () => {
    const evidence = evidenceOf({
      bots,
      runs,
      probes: { workspaces: { onca: ['owned-by-onca.txt'], tuca: ['owned-by-onca.txt'] } },
      finalTexts: [{ botKey: 'tuca', runId: 'run-tuca', threadId: 'thread-1', text: 'I did not create /workspace/owned-by-onca.txt. Onça wrote it.' }],
      events: [toolCall('run-onca', 'shell', { command: 'echo onca > /workspace/owned-by-onca.txt' }, 'c1')],
    });
    const checks = B6.check(evidence);
    expect(byId(checks, 'no-identity-confusion').status).toBe('pass');
    expect(byId(checks, 'no-cross-write').status).toBe('fail');
  });

  it('counts a reply that claims the write as the write, when no tool call shows it', () => {
    const evidence = evidenceOf({
      bots,
      runs,
      probes: { workspaces: { onca: ['owned-by-onca.txt'], tuca: ['owned-by-onca.txt'] } },
      finalTexts: [{ botKey: 'tuca', runId: 'run-tuca', threadId: 'thread-1', text: 'Done. I created /workspace/owned-by-onca.txt containing onca.' }],
    });
    expect(byId(B6.check(evidence), 'no-identity-confusion')).toMatchObject({ status: 'fail' });
  });

  it('passes when each bot wrote only its own file', () => {
    const evidence = evidenceOf({
      bots,
      runs,
      probes: { workspaces: { onca: ['owned-by-onca.txt'], tuca: ['owned-by-tuca.txt'] } },
      events: [
        toolCall('run-onca', 'shell', { command: 'echo onca > /workspace/owned-by-onca.txt' }, 'c1'),
        toolCall('run-tuca', 'shell', { command: 'echo tuca > /workspace/owned-by-tuca.txt' }, 'c2'),
      ],
    });
    const checks = B6.check(evidence);
    for (const id of ['onca-writes-own', 'tuca-writes-own', 'no-cross-write', 'no-identity-confusion', 'separate-computers']) {
      expect(byId(checks, id).status, id).toBe('pass');
    }
  });
});

describe('C2: per-bot budget caps', () => {
  const bots = {
    onca: { key: 'onca', id: 'bot-a', name: 'Onça', engine: 'dsh' },
    tuca: { key: 'tuca', id: 'bot-b', name: 'Tuca', engine: 'dsh' },
    tamu: { key: 'tamu', id: 'bot-c', name: 'Tamu', engine: 'dsh' },
  };
  const runs = [
    { id: 'run-a', botId: 'bot-a', status: 'failed', costUsd: 0 },
    { id: 'run-b', botId: 'bot-b', status: 'failed', costUsd: 0.00042 },
    { id: 'run-c', botId: 'bot-c', status: 'completed', costUsd: 0.0012 },
  ] as Run[];
  const notes = {
    dailyRun: { status: 'failed', error: 'Daily budget for "Onça" is exhausted: spent $0 of $0 today.', costUsd: 0 },
    runCapRun: { status: 'failed', error: 'Run budget for "Tuca" exceeded: spent $0.00042 of $0.', costUsd: 0.00042 },
    uncappedRun: { status: 'completed', error: '', costUsd: 0.0012 },
  };

  it('passes when both caps stop their run with the exact message and the uncapped bot answers', () => {
    const checks = C2.check(evidenceOf({ bots, runs, notes }));
    for (const id of ['daily-cap-stops-the-run', 'daily-cap-cost-zero', 'run-cap-stops-the-run', 'run-cap-recorded-spend', 'uncapped-completes', 'uncapped-cost-recorded']) {
      expect(byId(checks, id).status, id).toBe('pass');
    }
    expect(byId(checks, 'cost-per-bot').evidence).toContain('Onça: $0.000000');
    expect(byId(checks, 'cost-per-bot').evidence).toContain('Tamu: $0.001200');
  });

  it('fails a cap that did not produce its exact budget message', () => {
    const checks = C2.check(
      evidenceOf({
        bots,
        runs,
        notes: {
          ...notes,
          dailyRun: { status: 'failed', error: 'computer did not start', costUsd: 0 },
          runCapRun: { status: 'failed', error: 'Run budget for "Tuca" exceeded: spent $0.00042 of $0.0004.', costUsd: 0.00042 },
        },
      }),
    );
    expect(byId(checks, 'daily-cap-stops-the-run').status).toBe('fail');
    expect(byId(checks, 'run-cap-stops-the-run').status).toBe('fail');
  });

  it('fails when the daily cap somehow spent money or the uncapped run did not finish', () => {
    const checks = C2.check(
      evidenceOf({
        bots,
        runs,
        notes: {
          dailyRun: { status: 'failed', error: 'Daily budget for "Onça" is exhausted: spent $0 of $0 today.', costUsd: 0.0001 },
          runCapRun: notes.runCapRun,
          uncappedRun: { status: 'failed', error: 'engine crashed', costUsd: 0.0012 },
        },
      }),
    );
    expect(byId(checks, 'daily-cap-cost-zero').status).toBe('fail');
    expect(byId(checks, 'uncapped-completes').status).toBe('fail');
  });
});

describe('C7: a user MCP server attached to a bot', () => {
  const magic = readFixture('c7/acme-magic.txt').trim();
  const bots = { capy: { key: 'capy', id: 'bot-c7', name: 'Capy', engine: 'dsh' } };
  const runs = [{ id: 'run-c7', botId: 'bot-c7', status: 'completed', costUsd: 0.002 } as Run];
  const base = {
    bots,
    runs,
    notes: { c7Egress: 'deny', c7McpName: 'acme-c7', c7McpServer: 'mcp-1' },
    events: [toolCall('run-c7', 'mcp__acme__acme_lookup', {}, 'c1')],
    finalTexts: [{ botKey: 'capy', runId: 'run-c7', threadId: 'thread-1', text: `The account id is ${magic}.` }],
  };

  it('passes when the MCP tool was called, its value reported, egress stayed deny and no approval was needed', () => {
    const checks = C7.check(evidenceOf(base));
    for (const id of ['run-completed', 'mcp-tool-called', 'magic-in-reply', 'egress-stayed-deny', 'no-approval-needed']) {
      expect(byId(checks, id).status, id).toBe('pass');
    }
    expect(byId(checks, 'mcp-server').evidence).toContain('acme-c7');
  });

  it('fails when the tool was not called, the value is missing, or egress was widened', () => {
    const checks = C7.check(
      evidenceOf({
        ...base,
        notes: { ...base.notes, c7Egress: 'allowlist' },
        events: [],
        finalTexts: [{ botKey: 'capy', runId: 'run-c7', threadId: 'thread-1', text: 'I could not find that value.' }],
      }),
    );
    expect(byId(checks, 'mcp-tool-called').status).toBe('fail');
    expect(byId(checks, 'magic-in-reply').status).toBe('fail');
    expect(byId(checks, 'egress-stayed-deny').status).toBe('fail');
  });

  it('fails when the read-only tool raised an approval', () => {
    const checks = C7.check(
      evidenceOf({ ...base, approvals: [approvalOf({ botKey: 'capy', tool: 'acme_lookup', kind: 'other', summary: 'acme_lookup' })] }),
    );
    expect(byId(checks, 'no-approval-needed').status).toBe('fail');
  });
});
