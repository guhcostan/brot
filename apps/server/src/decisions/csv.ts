import type { Decision } from '@brot/protocol';

/** The CSV header, in order. The approval's summary and args are audit metadata and never exported. */
export const DECISIONS_CSV_COLUMNS = [
  'id',
  'run_id',
  'thread_id',
  'bot_id',
  'kind',
  'tool',
  'decision',
  'decided_at',
  'reply',
] as const;

/** One field per RFC 4180: quoted when it holds a comma, a quote or a line break, with quotes doubled. */
function escapeField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * A cell a spreadsheet would evaluate as a formula: first non-whitespace character is `=`, `+`, `-` or `@`, or it
 * begins with a tab or CR. The same neutralization the usage export applies: a leading apostrophe marks it text.
 */
const FORMULA_CELL = /^\s*[=+\-@\t\r]/;

/** Escapes a user-controlled cell, neutralizing formula injection before RFC 4180 quoting. */
function cell(value: string): string {
  return escapeField(FORMULA_CELL.test(value) ? `'${value}` : value);
}

/**
 * The decisions export: a UTF-8 BOM first (so Excel opens accents correctly), then one header record and one
 * record per decision, each terminated by CRLF. The header is fixed and never prefixed.
 */
export function decisionsCsv(decisions: readonly Decision[]): string {
  const records = [DECISIONS_CSV_COLUMNS.join(',')];
  for (const decision of decisions) {
    records.push(
      [
        decision.id,
        decision.runId,
        decision.threadId,
        decision.botId,
        decision.kind,
        decision.tool,
        decision.decision,
        decision.decidedAt,
        decision.reply ?? '',
      ]
        .map(cell)
        .join(','),
    );
  }
  return `\uFEFF${records.join('\r\n')}\r\n`;
}

/** The download name the export route advertises: `brot-decisions-<from>-<to>.csv`, with the resolved ISO bounds. */
export function decisionsCsvFilename(from: string, to: string): string {
  return `brot-decisions-${from}-${to}.csv`;
}
