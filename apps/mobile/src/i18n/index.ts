import { en, type MessageKey } from './en';
import { es } from './es';
import { ptBR } from './pt-BR';

export type { MessageKey } from './en';

export const LOCALES = ['en', 'pt-BR', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', 'pt-BR': 'Português (Brasil)', es: 'Español' };

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { en, 'pt-BR': ptBR, es };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Maps a BCP 47 tag ("pt-PT", "es-MX", "en-US") to the closest shipped locale. */
export function localeForTag(tag: string | undefined): Locale | undefined {
  const primary = tag?.split(/[-_]/)[0]?.toLowerCase();
  if (primary === 'pt') return 'pt-BR';
  if (primary === 'es') return 'es';
  if (primary === 'en') return 'en';
  return undefined;
}

export function deviceLocale(): Locale {
  try {
    return localeForTag(Intl.DateTimeFormat().resolvedOptions().locale) ?? 'en';
  } catch {
    return 'en';
  }
}

let current: Locale = deviceLocale();
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

/** Switches the language for later t() calls and notifies subscribers so the app re-renders. */
export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  for (const listener of [...listeners]) listener();
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export type Vars = Record<string, string | number>;

/** Looks up a key in the current locale, falls back to English, and fills {placeholders}. */
export function t(key: MessageKey, vars: Vars = {}): string {
  const template = DICTIONARIES[current][key] ?? en[key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (vars[name] === undefined ? match : String(vars[name])));
}

/** `key` for a count of one, `key` + "Many" otherwise. Both keys take {count}. */
export function plural(one: MessageKey, many: MessageKey, count: number, vars: Vars = {}): string {
  return t(count === 1 ? one : many, { count, ...vars });
}

export function dictionary(locale: Locale): Record<MessageKey, string> {
  return DICTIONARIES[locale];
}
