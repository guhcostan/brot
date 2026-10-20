import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { standardPolicy } from '../approvals';
import type { ApprovalView, CheckResult, Evidence } from '../types';
import { A6 } from './A6';
import { A8 } from './A8';
import { A14 } from './A14';
import { B5, outsideEffectsOf } from './B5';
import { B6 } from './B6';
import { fixturePath, outputOf, readFixtureJson } from './shared';

function sendTo(host: string, kind: ApprovalView['kind'] = 'send'): ApprovalView {
  return { botId: 'bot', runId: 'run', tool: 'http_request', kind, summary: `POST https://${host}/anything/x`, args: {} };
}

describe('sim cases send to the fake API', () => {
  it.each([
    ['A6', A6],
    ['A8', A8],
    ['A14', A14],
  ])('%s lets a POST to httpbin.org through once, and still denies other hosts', (_id, caseDef) => {
    expect(caseDef.approvals?.decide(sendTo('httpbin.org'))?.action).toBe('allow_once');
    expect(caseDef.approvals?.decide(sendTo('api.example.com'))?.action).toBe('deny');
  });

  it('keeps B5 strict: its send to httpbin.org is treated as a real send and denied by the default policy', () => {
    const policy = B5.approvals ?? standardPolicy();
    expect(policy.decide(sendTo('httpbin.org'))?.action).toBe('deny');
  });
});

describe('B5 outside effects', () => {
  it('does not count team and task tools, and counts a send', () => {
    const approvals = [
      { botKey: 'tuca', kind: 'other', tool: 'list_team' },
      { botKey: 'tuca', kind: 'other', tool: 'delegate_task' },
      { botKey: 'tuca', kind: 'send', tool: 'http_request' },
      { botKey: 'onca', kind: 'send', tool: 'http_request' },
    ];
    expect(outsideEffectsOf(approvals, 'tuca').map((record) => record.tool)).toEqual(['http_request']);
  });
});

describe('A1 probe', () => {
  it('keeps the exit code, printed to stdout, together with the assertion from stderr', () => {
    const text = outputOf({ stdout: 'EXIT=1\n', stderr: 'AssertionError: expected 6 got 10\n' });
    expect(text).toMatch(/EXIT=[1-9]/);
    expect(text).toContain('expected 6 got 10');
    expect(outputOf({ stdout: 'EXIT=0\n', stderr: '' })).toBe('EXIT=0\n');
  });
});

describe('B1 fixture', () => {
  it('drops every row when the export starts with a byte-order mark, which is the bug Onça is asked to fix', () => {
    const parse = createRequire(import.meta.url)(fixturePath('b1/invoice-export.cjs')) as (text: string) => unknown[];
    expect(parse('invoice_id,amount\nINV-1,120\n')).toHaveLength(1);
    expect(parse('﻿invoice_id,amount\nINV-1,120\n')).toHaveLength(0);
  });
});

describe('A9 fixture', () => {
  it('makes the expected P-2 exception a real breach: the meal is over 60 USD per person', () => {
    const key = readFixtureJson<{ expectedExceptions: Record<string, string> }>('ledger.key.json');
    expect(key.expectedExceptions['R-03']).toBe('P-2');

    const receipt = readFileSync(fixturePath('receipts/R-03.txt'), 'utf8');
    const diners: Record<string, number> = { one: 1, two: 2 };
    const who = /Items: Dinner for (\w+)/.exec(receipt)?.[1] ?? '';
    const total = Number(/Total: ([\d.]+) USD/.exec(receipt)?.[1]);
    expect(diners[who]).toBeDefined();
    expect(total / (diners[who] ?? 1)).toBeGreaterThan(60);
  });
});

describe('B6 isolation check', () => {
  const markers = { onca: 'marker-onca-1.txt', tuca: 'marker-tuca-1.txt' };
  const evidenceWith = (probes: Record<string, unknown>): Evidence => ({ bots: {}, probes }) as unknown as Evidence;
  const statusOf = (results: CheckResult[], id: string): string | undefined => results.find((result) => result.id === id)?.status;

  it('passes isolation when each computer holds only its own marker, even when Tuca named his file after Onça', () => {
    const results = B6.check(
      evidenceWith({
        markers,
        onca: ['owned-by-onca.txt', markers.onca].join('\n'),
        tuca: ['owned-by-onca.txt', markers.tuca].join('\n'),
      }),
    );
    expect(statusOf(results, 'no-cross-write')).toBe('pass');
    expect(statusOf(results, 'tuca-writes-own')).toBe('fail');
  });

  it('fails isolation when one bot’s marker shows up in the other computer', () => {
    const results = B6.check(evidenceWith({ markers, onca: markers.onca, tuca: [markers.tuca, markers.onca].join('\n') }));
    expect(statusOf(results, 'no-cross-write')).toBe('fail');
  });
});
