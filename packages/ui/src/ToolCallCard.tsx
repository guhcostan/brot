import type { ReactElement } from 'react';
import { Badge } from './Badge';
import { cx } from './cx';

export type ToolCallStatus = 'running' | 'ok' | 'error';

const STATUS_LABELS: Record<ToolCallStatus, string> = {
  running: 'Running',
  ok: 'Done',
  error: 'Failed',
};

export interface ToolCallCardProps {
  tool: string;
  status: ToolCallStatus;
  /** One line shown next to the tool name, e.g. the command or the file path. */
  summary?: string;
  args?: Record<string, unknown>;
  output?: string;
  defaultOpen?: boolean;
  className?: string;
}

/** A collapsible record of one tool call. Uses native details/summary, so it is keyboard-accessible. */
export function ToolCallCard({
  tool,
  status,
  summary,
  args,
  output,
  defaultOpen = false,
  className,
}: ToolCallCardProps): ReactElement {
  const hasArgs = args !== undefined && Object.keys(args).length > 0;
  return (
    <details className={cx('brot-tool', className)} open={defaultOpen || undefined}>
      <summary aria-label={`${tool}, ${STATUS_LABELS[status]}${summary ? `: ${summary}` : ''}`}>
        <span className="brot-tool__name">{tool}</span>
        <span className="brot-tool__summary">{summary}</span>
        <Badge tone={status === 'error' ? 'live' : undefined}>{STATUS_LABELS[status]}</Badge>
      </summary>
      <div className="brot-tool__body">
        {hasArgs ? <pre className="brot-code">{JSON.stringify(args, null, 2)}</pre> : null}
        {output !== undefined ? <pre className="brot-code">{output || '(no output)'}</pre> : null}
      </div>
    </details>
  );
}
