/**
 * The browser's desktop notifications, feature-detected at call time so importing this module is safe
 * during SSR and in tests. Nothing here prompts the browser: permission is requested only from the
 * Settings button (the person asking for it), never on load.
 */

export type DesktopNotificationState = 'unsupported' | 'default' | 'granted' | 'denied';

/** How much of a notification's body the system banner carries. */
export const NOTIFICATION_BODY_MAX = 200;

export function desktopNotificationsSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.Notification === 'function';
}

export function desktopNotificationState(): DesktopNotificationState {
  if (!desktopNotificationsSupported()) return 'unsupported';
  const permission = window.Notification.permission;
  if (permission === 'granted' || permission === 'denied') return permission;
  return 'default';
}

/** Asks the browser for permission. Only call this from an explicit click. */
export async function requestDesktopNotifications(): Promise<DesktopNotificationState> {
  if (!desktopNotificationsSupported()) return 'unsupported';
  try {
    const permission = await window.Notification.requestPermission();
    if (permission === 'granted' || permission === 'denied') return permission;
    return 'default';
  } catch {
    return desktopNotificationState();
  }
}

/** True only when a banner would be helpful: permission granted and the window is not being watched. */
export function canShowInBackground(): boolean {
  if (desktopNotificationState() !== 'granted') return false;
  if (typeof document === 'undefined') return false;
  if (typeof document.hasFocus === 'function' && !document.hasFocus()) return true;
  return document.visibilityState === 'hidden';
}

/** A banner-sized one-liner from a notification body. */
export function notificationPreview(body: string, max = NOTIFICATION_BODY_MAX): string {
  const single = body.replace(/\s+/g, ' ').trim();
  if (single.length <= max) return single;
  const cut = single.slice(0, Math.max(0, max - 1));
  const last = cut.charCodeAt(cut.length - 1);
  // Never split a surrogate pair when cutting.
  const safe = last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
  return `${safe.trimEnd()}…`;
}

export interface DesktopNotificationInput {
  title: string;
  body: string;
  /** A stable tag, so repeat calls for the same record replace rather than stack banners. */
  tag?: string;
  /** Clicking the banner brings the window forward and runs this. */
  onClick?: () => void;
}

/** Shows one banner. Returns false when it would not be useful or the API is unavailable. */
export function showDesktopNotification({ title, body, tag, onClick }: DesktopNotificationInput): boolean {
  if (!canShowInBackground()) return false;
  try {
    const notification = new window.Notification(title, {
      body: notificationPreview(body),
      ...(tag === undefined ? {} : { tag }),
    });
    notification.onclick = () => {
      window.focus();
      onClick?.();
      notification.close();
    };
    return true;
  } catch {
    // Some desktop shells throw even after permission is granted; a missing banner is not fatal.
    return false;
  }
}
