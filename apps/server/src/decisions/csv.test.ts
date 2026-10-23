import { describe, expect, it } from 'vitest';
import type { Decision } from '@brot/protocol';
import { DECISIONS_CSV_COLUMNS, decisionsCsv, decisionsCsvFilename } from './csv';

const decision: Decision = {
  id: 'apr_1',
  runId: 'run_1',
  threadId: 't1',
  botId: 'bot_1',
  kind: 'send',
  tool: 'send_email',
  summary: 'Send the invoice',
  decision: 'allow_once',
  decidedAt: '2026-10-22T20:00:00.000Z',
};

describe('decisionsCsv', () => {
  it('starts with a UTF-8 BOM and CRLF records, with the fixed header', () => {
    const csv = decisionsCsv([decision]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
    const records = csv.slice(1).split('\r\n');
    expect(records[0]).toBe(DECISIONS_CSV_COLUMNS.join(','));
    expect(records[0]).toBe('id,run_id,thread_id,bot_id,kind,tool,decision,decided_at,reply');
    expect(records[1]).toBe(
      'apr_1,run_1,t1,bot_1,send,send_email,allow_once,2026-10-22T20:00:00.000Z,',
    );
    expect(records[2]).toBe('');
  });

  it('emits only the header for an empty log', () => {
    expect(decisionsCsv([])).toBe(`\uFEFF${DECISIONS_CSV_COLUMNS.join(',')}\r\n`);
  });

  it('escapes commas, quotes and line breaks per RFC 4180', () => {
    const csv = decisionsCsv([
      {
        ...decision,
        tool: 'send,email',
        reply: 'line one\nline two',
      },
      { ...decision, id: 'apr_2', reply: 'he said "allow"' },
    ]);
    expect(csv).toContain('"send,email"');
    expect(csv).toContain('"line one\nline two"');
    expect(csv).toContain('"he said ""allow"""');
  });

  it('neutralizes formula cells in user-controlled fields', () => {
    const csv = decisionsCsv([
      { ...decision, tool: '=HYPERLINK("http://evil")', reply: '+SUM(A1:A2)' },
      { ...decision, id: 'apr_2', reply: '@import' },
      { ...decision, id: 'apr_3', reply: '-2+3' },
    ]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+SUM(A1:A2)");
    expect(csv).toContain("'@import");
    expect(csv).toContain("'-2+3");
    expect(csv).not.toContain('\r\n=HYPERLINK');
  });

  it('never exports the summary or any approval argument', () => {
    const csv = decisionsCsv([{ ...decision, summary: 'SECRET SUMMARY =cmd', reply: '' }]);
    expect(csv).not.toContain('SECRET SUMMARY');
    expect(csv).not.toContain('cmd');
  });
});

describe('decisionsCsvFilename', () => {
  it('names the file after the resolved bounds', () => {
    expect(decisionsCsvFilename('2026-10-01T00:00:00.000Z', '2026-10-22T00:00:00.000Z')).toBe(
      'brot-decisions-2026-10-01T00:00:00.000Z-2026-10-22T00:00:00.000Z.csv',
    );
  });
});
