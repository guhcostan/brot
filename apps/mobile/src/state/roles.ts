import type { DeviceRole } from '@brot/protocol';
import { t } from '../i18n';

export interface Capabilities {
  /** Send messages and start threads. */
  chat: boolean;
  /** Answer approval requests. */
  approve: boolean;
  /** Stop a running bot. */
  cancel: boolean;
  /** Revoke this device on the server when unpairing. */
  revokeSelf: boolean;
  /** Take control of a bot's desktop and send input to it. */
  takeover: boolean;
}

/** Mirrors roleAllows in apps/server/src/auth.ts: viewers read, approvers also answer approvals, full does everything. */
export function capabilitiesFor(role: DeviceRole): Capabilities {
  switch (role) {
    case 'full':
      return { chat: true, approve: true, cancel: true, revokeSelf: true, takeover: true };
    case 'approver':
      return { chat: false, approve: true, cancel: false, revokeSelf: false, takeover: false };
    case 'viewer':
      return { chat: false, approve: false, cancel: false, revokeSelf: false, takeover: false };
  }
}

export function roleLabel(role: DeviceRole): { title: string; detail: string } {
  switch (role) {
    case 'full':
      return { title: t('role.full'), detail: t('role.fullDetail') };
    case 'approver':
      return { title: t('role.approver'), detail: t('role.approverDetail') };
    case 'viewer':
      return { title: t('role.viewer'), detail: t('role.viewerDetail') };
  }
}
