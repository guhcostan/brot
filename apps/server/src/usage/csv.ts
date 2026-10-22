import type { Run } from '@brot/protocol';

/** The CSV header, in order. */
export const USAGE_CSV_COLUMNS = [
  'id',
  'bot_id',
  'bot_name',
  'thread_id',
  'started_at',
  'ended_at',
  'status',
  'engine',
  'model',
  'tokens_in',
  'tokens_out',
  'cost_usd',
] as const;

/** One field per RFC 4180: quoted when it holds a comma, a quote or a line break, with quotes doubled. */
function escapeField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * A cell a spreadsheet would evaluate as a formula: one whose first non-whitespace character is `=`, `+`, `-` or
 * `@`, or that begins with a tab or CR. Excel and Sheets trim leading whitespace before deciding, so the check
 * runs against the whole leading run. A leading apostrophe marks the cell as text; the apostrophe is not shown.
 */
const FORMULA_CELL = /^\s*[=+\-@\t\r]/;

/** Escapes a user-controlled cell, neutralizing formula injection before RFC 4180 quoting. */
function cell(value: string): string {
  return escapeField(FORMULA_CELL.test(value) ? `'${value}` : value);
}

/**
 * The usage export: a UTF-8 BOM first (so Excel opens accents correctly), then one header record and one record
 * per run, each terminated by CRLF. Rows are as supplied, oldest first. The header is fixed and never prefixed.
 */
export function usageCsv(runs: readonly Run[], botNames: ReadonlyMap<string, string>): string {
  const records = [USAGE_CSV_COLUMNS.join(',')];
  for (const run of runs) {
    records.push(
      [
        run.id,
        run.botId,
        botNames.get(run.botId) ?? '',
        run.threadId,
        run.startedAt,
        run.endedAt ?? '',
        run.status,
        run.engine,
        run.model ?? '',
        String(run.tokensIn),
        String(run.tokensOut),
        String(run.costUsd),
      ]
        .map(cell)
        .join(','),
    );
  }
  return `\uFEFF${records.join('\r\n')}\r\n`;
}

/** The download name the export route advertises: `brot-usage-<from>-<to>.csv`, with the resolved ISO bounds. */
export function usageCsvFilename(from: string, to: string): string {
  return `brot-usage-${from}-${to}.csv`;
}
