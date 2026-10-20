export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

const STORAGE_KEY = 'brot.theme';

function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

export function getTheme(): Theme {
  try {
    const stored: unknown = localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

/** `system` removes data-theme so tokens.css follows prefers-color-scheme. */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function setTheme(theme: Theme): void {
  try {
    if (theme === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage is blocked: the choice holds until the page reloads.
  }
  applyTheme(theme);
}
