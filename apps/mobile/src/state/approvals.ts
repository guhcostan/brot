import type { Approval, ApprovalDecision, ApprovalKind } from '@brot/protocol';

import { t } from '../i18n';

/** Same wording as APPROVAL_KIND_LABELS in @brot/ui, whose module is a DOM component and not importable here. */
export function approvalKindLabel(kind: ApprovalKind): string {
  return t(`approval.kind.${kind}`);
}

export function decisionLabel(decision: ApprovalDecision): string {
  return t(`approval.decision.${decision}`);
}

/**
 * Kinds that move money, destroy data, change who can do what, or speak publicly as the user.
 * docs/REMOTE-CONTROL.md requires a biometric check on the phone before allowing these.
 */
const SENSITIVE_KINDS: ReadonlySet<ApprovalKind> = new Set(['purchase', 'permission', 'delete', 'publish']);

/** Denying is always safe, so only an allow on a sensitive kind asks for Face ID or the passcode. */
export function needsBiometric(kind: ApprovalKind, decision: ApprovalDecision): boolean {
  return decision !== 'deny' && SENSITIVE_KINDS.has(kind);
}

/** "Allow always" grants a standing policy; offering it on a sensitive kind makes a one-tap habit of a risky action. */
export function allowsAlways(kind: ApprovalKind): boolean {
  return !SENSITIVE_KINDS.has(kind);
}

/** One-line description of where an approval came from, e.g. "Lua · email.send". */
export function approvalSource(approval: Pick<Approval, 'tool'>, botName: string): string {
  return `${botName} · ${approval.tool}`;
}

/** The args worth showing, without empty values. */
export function visibleArgs(args: Record<string, unknown>): [string, unknown][] {
  return Object.entries(args).filter(([, value]) => value !== undefined && value !== null && value !== '');
}
