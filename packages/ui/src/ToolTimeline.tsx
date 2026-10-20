import type { ReactElement } from 'react';
import { cx } from './cx';
import { ToolIcon, toolKind, type ToolKind } from './ToolIcon';
import type { ToolCallStatus } from './ToolCallCard';

export interface ToolStep {
  id: string;
  tool: string;
  status: ToolCallStatus;
  /** A readable name for the step, e.g. "Open page". Falls back to the tool name. */
  title?: string;
  /** One line about the arguments, e.g. the URL or command. */
  summary?: string;
  args?: Record<string, unknown>;
  output?: string;
}

export interface ToolTimelineLabels {
  /** Heading for a run of steps, e.g. "3 steps". */
  steps: (count: number) => string;
  status: Record<ToolCallStatus, string>;
  details: string;
  noOutput: string;
}

const DEFAULT_LABELS: ToolTimelineLabels = {
  steps: (count) => (count === 1 ? '1 step' : `${count} steps`),
  status: { running: 'Running', ok: 'Done', error: 'Failed' },
  details: 'Details',
  noOutput: '(no output)',
};

export interface ToolTimelineProps {
  steps: readonly ToolStep[];
  labels?: Partial<ToolTimelineLabels>;
  className?: string;
}

function StatusGlyph({ status }: { status: ToolCallStatus }): ReactElement {
  if (status === 'running') return <span className="brot-steps__spinner" aria-hidden="true" />;
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {status === 'ok' ? <path d="m3.5 8.5 3 3 6-7" /> : <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />}
    </svg>
  );
}

/**
 * A run of tool calls as one collapsible card: the newest step stays visible in the header, and the
 * body is a step timeline on a rail. Native details/summary, so it works from the keyboard.
 */
export function ToolTimeline({ steps, labels: partial, className }: ToolTimelineProps): ReactElement | null {
  const labels = { ...DEFAULT_LABELS, ...partial };
  const last = steps.at(-1);
  if (!last) return null;
  const status: ToolCallStatus = steps.some((step) => step.status === 'running')
    ? 'running'
    : steps.some((step) => step.status === 'error')
      ? 'error'
      : 'ok';
  const kinds = [...new Set(steps.map((step) => toolKind(step.tool)))].slice(-3) as ToolKind[];
  const headline = last.title ?? last.tool;

  return (
    <details className={cx('brot-steps', className)} data-status={status}>
      <summary aria-label={`${labels.steps(steps.length)}, ${labels.status[status]}: ${headline}${last.summary ? ` ${last.summary}` : ''}`}>
        <span className="brot-steps__icons" aria-hidden="true">
          {kinds.map((kind) => (
            <span key={kind} className="brot-steps__icon">
              <ToolIcon kind={kind} size={13} />
            </span>
          ))}
        </span>
        <span className="brot-steps__headline">
          <span key={last.id} className="brot-steps__current">
            <span className="brot-steps__title">{headline}</span>
            {last.summary ? <span className="brot-steps__summary">{last.summary}</span> : null}
          </span>
        </span>
        <span className="brot-steps__count">{labels.steps(steps.length)}</span>
        <span className="brot-steps__state" data-status={status} title={labels.status[status]}>
          <StatusGlyph status={status} />
        </span>
      </summary>
      <ol className="brot-steps__list">
        {steps.map((step) => {
          const hasArgs = step.args !== undefined && Object.keys(step.args).length > 0;
          const hasBody = hasArgs || step.output !== undefined;
          return (
            <li key={step.id} className="brot-step" data-status={step.status}>
              <span className="brot-step__node" aria-hidden="true">
                <ToolIcon kind={toolKind(step.tool)} size={13} />
              </span>
              <div className="brot-step__main">
                <div className="brot-step__line">
                  <span className="brot-step__title">{step.title ?? step.tool}</span>
                  {step.summary ? <span className="brot-step__summary">{step.summary}</span> : null}
                  <span className="brot-step__status" data-status={step.status}>
                    <StatusGlyph status={step.status} />
                    <span className="brot-sr-only">{labels.status[step.status]}</span>
                  </span>
                </div>
                {hasBody ? (
                  <details className="brot-step__details">
                    <summary>
                      {labels.details} · <code>{step.tool}</code>
                    </summary>
                    {hasArgs ? <pre className="brot-code">{JSON.stringify(step.args, null, 2)}</pre> : null}
                    {step.output !== undefined ? <pre className="brot-code">{step.output || labels.noOutput}</pre> : null}
                  </details>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
