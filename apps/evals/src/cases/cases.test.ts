import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { fixturePath, outputOf, readFixtureJson } from './shared';

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
