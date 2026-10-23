import type { ApprovalStatus } from '@brot/protocol';
import type { BadgeTone } from '@brot/ui';
import { Badge, cx } from '@brot/ui';
import type { ReactElement } from 'react';
import { t, type TranslationKey } from '../i18n';

/**
 * Every approval status, including `expired`: a run interrupted by a restart. It has a resolvedAt but no
 * decision, it leaves every pending list, and it is never part of the decision log.
 */

/** Every status has a label; the map is exhaustive so a new protocol member fails to compile here. */
export const APPROVAL_STATUS_KEY: Record<ApprovalStatus, TranslationKey> = {
  pending: 'approval.status.pending',
  allowed: 'approval.status.allowed',
  denied: 'approval.status.denied',
  expired: 'approval.status.expired',
};

/** Denied keeps the attention tone; expired is deliberately muted so it never reads as a deny. */
export const APPROVAL_STATUS_TONE: Record<ApprovalStatus, BadgeTone> = {
  pending: 'neutral',
  allowed: 'neutral',
  denied: 'attention',
  expired: 'neutral',
};

/** A status badge for an approval; expired reads as muted instead of the denied attention tone. */
export function ApprovalStatusBadge({ status, className }: { status: ApprovalStatus; className?: string }): ReactElement {
  return (
    <Badge tone={APPROVAL_STATUS_TONE[status]} className={cx(status === 'expired' && 'text-ink-3', className)}>
      {t(APPROVAL_STATUS_KEY[status])}
    </Badge>
  );
}
