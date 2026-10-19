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

export interface ApprovalCardProps {
  approval: Pick<Approval, 'tool' | 'summary' | 'kind' | 'status' | 'decision'>;
  /** Called with the chosen decision and the reply text when one was typed. */
  onDecide?: (decision: ApprovalDecision, reply?: string) => void;
  busy?: boolean;
  className?: string;
}

/**
 * An inline approval request. --attention marks it as needing the human now.
 * Decisions go through onDecide; the card keeps no approval state of its own.
 */
export function ApprovalCard({ approval, onDecide, busy = false, className }: ApprovalCardProps): ReactElement {
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
      aria-label={`Approval needed: ${approval.summary}`}
    >
      <div className="brot-approval__header">
        {pending ? <StatusDot status="waiting" /> : null}
        <Badge>{APPROVAL_KIND_LABELS[approval.kind]}</Badge>
        {!pending && approval.decision ? <Badge>{DECISION_LABELS[approval.decision]}</Badge> : null}
      </div>
      <p className="brot-approval__title">{approval.summary}</p>
      <p className="brot-approval__meta">{approval.tool}</p>
      {pending && onDecide ? (
        <>
          <Textarea
            id={replyId}
            label="Reply to the bot (optional)"
            rows={2}
            value={reply}
            disabled={busy}
            onChange={(event) => setReply(event.target.value)}
          />
          <div className="brot-approval__actions" role="group" aria-label="Decide">
            <Button variant="primary" size="sm" disabled={busy} onClick={() => decide('allow_once')}>
              Allow once
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => decide('allow_always')}>
              Allow always
            </Button>
            <Button variant="danger" size="sm" disabled={busy} onClick={() => decide('deny')}>
              Deny
            </Button>
          </div>
        </>
      ) : null}
    </section>
  );
}
