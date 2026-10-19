import en from '../locales/en.json';

export type TranslationKey = keyof typeof en;

/** Looks up a key in locales/en.json and fills {placeholders}. Other locales slot in beside en.json. */
export function t(key: TranslationKey, vars: Record<string, string> = {}): string {
  return en[key].replace(/\{(\w+)\}/g, (match, name: string) => vars[name] ?? match);
}
