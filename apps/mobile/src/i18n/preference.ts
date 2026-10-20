import type { SecretStorage } from '../session/session';
import { deviceLocale, isLocale, setLocale, type Locale } from './index';

export const LOCALE_KEY = 'brot.locale.v1';

/** The language the person picked, or `system` to follow the phone. */
export type LocalePreference = Locale | 'system';

export async function loadLocalePreference(storage: SecretStorage): Promise<LocalePreference> {
  try {
    const stored = await storage.getItem(LOCALE_KEY);
    return isLocale(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function applyLocalePreference(preference: LocalePreference): void {
  setLocale(preference === 'system' ? deviceLocale() : preference);
}

export async function saveLocalePreference(storage: SecretStorage, preference: LocalePreference): Promise<void> {
  applyLocalePreference(preference);
  if (preference === 'system') await storage.deleteItem(LOCALE_KEY);
  else await storage.setItem(LOCALE_KEY, preference);
}
