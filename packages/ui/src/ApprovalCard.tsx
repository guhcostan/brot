import { useId, useState, type ReactElement } from 'react';
import type { Approval, ApprovalDecision, ApprovalKind } from '@brot/protocol';
import { Button } from './Button';
import { cx } from './cx';
import { Textarea } from './Field';
import { StatusDot } from './StatusDot';
import { Badge } from './Badge';

export const APPROVAL_KIND_LABELS: Record<ApprovalKind, string> = {
  shell: 'Shell command',
  file_write: 'File write',
  send: 'Send',
  publish: 'Publish',
  delete: 'Delete',
  purchase: 'Purchase',
  permission: 'Permission change',
  other: 'Other action',
};

const DECISION_LABELS: Record<ApprovalDecision, string> = {
  allow_once: 'Allowed once',
  allow_always: 'Allowed always',
  deny: 'Denied',
};

export interface ApprovalCardLabels {
  kinds: Record<ApprovalKind, string>;
  decisions: Record<ApprovalDecision, string>;
  /** Accessible name of the card, given the summary. */
  region: (summary: string) => string;
  /** The status next to the dot while the approval is pending. */
  waiting: string;
  reply: string;
  decide: string;
  allowOnce: string;
  allowAlways: string;
  deny: string;
}

const DEFAULT_LABELS: ApprovalCardLabels = {
  kinds: APPROVAL_KIND_LABELS,
  decisions: DECISION_LABELS,
  region: (summary) => `Approval needed: ${summary}`,
  waiting: 'Waiting for you',
  reply: 'Reply to the bot (optional)',
  decide: 'Decide',
  allowOnce: 'Allow once',
  allowAlways: 'Allow always',
  deny: 'Deny',
};

export interface ApprovalCardProps {
  approval: Pick<Approval, 'tool' | 'summary' | 'kind' | 'status' | 'decision'>;
  /** Called with the chosen decision and the reply text when one was typed. */
  onDecide?: (decision: ApprovalDecision, reply?: string) => void;
  busy?: boolean;
  /** Translated strings. Missing entries fall back to English. */
  labels?: Partial<ApprovalCardLabels>;
  className?: string;
}

/**
 * An inline approval request. --attention marks it as needing the human now.
 * Decisions go through onDecide; the card keeps no approval state of its own.
 */
export function ApprovalCard({ approval, onDecide, busy = false, labels: partial, className }: ApprovalCardProps): ReactElement {
  const labels = { ...DEFAULT_LABELS, ...partial };
  const [reply, setReply] = useState('');
  const pending = approval.status === 'pending';
  const replyId = useId();

  const decide = (decision: ApprovalDecision) => {
    const trimmed = reply.trim();
    onDecide?.(decision, trimmed ? trimmed : undefined);
  };

  return (
    <section
      className={cx('brot-approval', className)}
      data-status={approval.status}
      aria-label={labels.region(approval.summary)}
    >
      <div className="brot-approval__header">
        {pending ? <StatusDot status="waiting" label={labels.waiting} /> : null}
        <Badge>{labels.kinds[approval.kind]}</Badge>
        {!pending && approval.decision ? <Badge>{labels.decisions[approval.decision]}</Badge> : null}
      </div>
      <p className="brot-approval__title">{approval.summary}</p>
      <p className="brot-approval__meta">{approval.tool}</p>
      {pending && onDecide ? (
        <>
          <Textarea
            id={replyId}
            label={labels.reply}
            rows={2}
            value={reply}
            disabled={busy}
            onChange={(event) => setReply(event.target.value)}
          />
          <div className="brot-approval__actions" role="group" aria-label={labels.decide}>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => decide('allow_once')}>
              {labels.allowOnce}
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => decide('allow_always')}>
              {labels.allowAlways}
            </Button>
            <Button variant="danger" size="sm" disabled={busy} onClick={() => decide('deny')}>
              {labels.deny}
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}
