/**
 * True inside the macOS desktop app, whose window hides the title bar and insets the traffic lights.
 * Electron's default user agent carries an "Electron/<version>" token and apps/desktop keeps it. This holds
 * for the gateway build and `--dev` alike, unlike the port, which moves with BROT_DESKTOP_PORT and is
 * shared with the browser in dev.
 */
export function isMacDesktopShell(userAgent: string): boolean {
  return /\bElectron\/\d/.test(userAgent) && /\bMac OS X\b|\bMacintosh\b/.test(userAgent);
}

export function currentShell(): 'mac-desktop' | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return isMacDesktopShell(navigator.userAgent) ? 'mac-desktop' : undefined;
}
