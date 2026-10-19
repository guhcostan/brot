import type { DeviceRole } from '@brot/protocol';

export interface Capabilities {
  /** Send messages and start threads. */
  chat: boolean;
  /** Answer approval requests. */
  approve: boolean;
  /** Stop a running bot. */
  cancel: boolean;
  /** Revoke this device on the server when unpairing. */
  revokeSelf: boolean;
}

/** Mirrors roleAllows in apps/server/src/auth.ts: viewers read, approvers also answer approvals, full does everything. */
export function capabilitiesFor(role: DeviceRole): Capabilities {
  switch (role) {
    case 'full':
      return { chat: true, approve: true, cancel: true, revokeSelf: true };
    case 'approver':
      return { chat: false, approve: true, cancel: false, revokeSelf: false };
    case 'viewer':
      return { chat: false, approve: false, cancel: false, revokeSelf: false };
  }
}

export const ROLE_LABELS: Record<DeviceRole, { title: string; detail: string }> = {
  full: { title: 'Full', detail: 'Chat, approve actions and stop runs.' },
  approver: { title: 'Approver', detail: 'Read threads and answer approvals.' },
  viewer: { title: 'Viewer', detail: 'Read only.' },
};
