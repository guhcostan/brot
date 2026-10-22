import { describe, expect, it } from 'vitest';
import type { Run } from '@brot/protocol';
import { USAGE_CSV_COLUMNS, usageCsv, usageCsvFilename } from './';

const header = USAGE_CSV_COLUMNS.join(',');

function run(overrides: Partial<Run> = {}): Run {
  const base: Run = {
    id: 'run_1',
    threadId: 't1',
    botId: 'bot_ada',
    status: 'completed',
    engine: 'mock',
    startedAt: '2026-10-01T00:00:00.000Z',
    endedAt: '2026-10-01T00:05:00.000Z',
    tokensIn: 10,
    tokensOut: 5,
    costUsd: 0.25,
  };
  return { ...base, ...overrides };
}

const bots = new Map([
  ['bot_ada', 'Ada'],
  ['bot_grace', 'Grace, "Ops"'],
]);

describe('usageCsv', () => {
  it('starts with a BOM and holds only the header for an empty range', () => {
    expect(usageCsv([], bots)).toBe(`\uFEFF${header}\r\n`);
  });

  it('writes the header and one CRLF-terminated record per run, bot names joined in', () => {
    const csv = usageCsv(
      [
        run(),
        run({ id: 'run_2', botId: 'bot_grace', status: 'failed', model: 'mock-1', endedAt: undefined }),
      ],
      bots,
    );
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);

    const records = csv.slice(1).split('\r\n');
    expect(records.at(-1)).toBe('');
    expect(records).toHaveLength(4);
    expect(records[0]).toBe(
      'id,bot_id,bot_name,thread_id,started_at,ended_at,status,engine,model,tokens_in,tokens_out,cost_usd',
    );
    expect(records[1]).toBe(
      'run_1,bot_ada,Ada,t1,2026-10-01T00:00:00.000Z,2026-10-01T00:05:00.000Z,completed,mock,,10,5,0.25',
    );
    expect(records[2]).toBe(
      'run_2,bot_grace,"Grace, ""Ops""",t1,2026-10-01T00:00:00.000Z,,failed,mock,mock-1,10,5,0.25',
    );
  });

  it('quotes empty names and fields that would break a record, doubling quotes', () => {
    const csv = usageCsv([run({ id: 'run_3', botId: 'bot_unknown', model: 'a"b,c' })], bots);
    expect(csv).toContain('run_3,bot_unknown,,t1,');
    expect(csv).toContain('"a""b,c"');
  });

  it('keeps a name with a line break inside its quoted field instead of splitting the record', () => {
    const csv = usageCsv([run()], new Map([['bot_ada', 'Ada\nLead']]));
    expect(csv).toContain('"Ada\nLead"');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('uses the given order and exact token and cost values', () => {
    const csv = usageCsv(
      [run({ id: 'first', startedAt: '2026-10-01T00:00:00.000Z' }), run({ id: 'second', startedAt: '2026-10-02T00:00:00.000Z' })],
      bots,
    );
    const records = csv.slice(1).split('\r\n');
    expect(records[1]?.startsWith('first,')).toBe(true);
    expect(records[2]?.startsWith('second,')).toBe(true);
    expect(records[1]).toContain(',10,5,0.25');
  });

  it('neutralizes cells a spreadsheet would evaluate as formulas', () => {
    const csv = usageCsv([run()], new Map([['bot_ada', '=HYPERLINK("http://x")']]));
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).not.toContain(',=HYPERLINK');
  });

  it('neutralizes names that start with @, -, +, or a leading tab or whitespace', () => {
    const names = new Map([
      ['bot_ada', '@channel'],
      ['bot_alert', '-1+2'],
      ['bot_plus', '+SUM(A1)'],
      ['bot_indent', ' =1+1'],
      ['bot_tab', '\t=cmd'],
    ]);
    const runs = [...names.keys()].map((botId) => run({ botId }));
    const records = usageCsv(runs, names).slice(1).split('\r\n');
    for (const [index, name] of [...names.values()].entries()) {
      const botName = records[index + 1]?.split(',')[2];
      expect(botName?.startsWith("'")).toBe(true);
      expect(botName?.slice(1)).toBe(name);
    }
  });

  it('leaves an ordinary name and the header row untouched', () => {
    const csv = usageCsv([run()], bots);
    expect(csv.slice(1).split('\r\n')[1]?.split(',')[2]).toBe('Ada');
    expect(csv.startsWith(`\uFEFF${header}`)).toBe(true);
    expect(csv.slice(1).startsWith("'")).toBe(false);
  });
});

describe('usageCsvFilename', () => {
  it('names the download after the resolved bounds', () => {
    expect(usageCsvFilename('2026-09-22T12:00:00.000Z', '2026-10-22T12:00:00.000Z')).toBe(
      'brot-usage-2026-09-22T12:00:00.000Z-2026-10-22T12:00:00.000Z.csv',
    );
  });
});
