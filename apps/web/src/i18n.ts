import en from '../locales/en.json';
import es from '../locales/es.json';
import ptBR from '../locales/pt-BR.json';

export const LOCALES = ['en', 'pt-BR', 'es'] as const;
export type Locale = (typeof LOCALES)[number];
export type TranslationKey = keyof typeof en;

type Dictionary = Partial<Record<TranslationKey, string>>;

const DICTIONARIES: Record<Locale, Dictionary> = { en, 'pt-BR': ptBR, es };

const STORAGE_KEY = 'brot.locale';

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

function readStoredLocale(): Locale | undefined {
  try {
    const stored: unknown = localStorage.getItem(STORAGE_KEY);
    return isLocale(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}

function localeForLanguage(tag: string): Locale | undefined {
  const primary = tag.split('-')[0]?.toLowerCase();
  if (primary === 'pt') return 'pt-BR';
  if (primary === 'es') return 'es';
  if (primary === 'en') return 'en';
  return undefined;
}

function detectLocale(): Locale {
  const stored = readStoredLocale();
  if (stored) return stored;
  const languages = typeof navigator === 'undefined' ? [] : navigator.languages;
  for (const tag of languages) {
    const locale = localeForLanguage(tag);
    if (locale) return locale;
  }
  return 'en';
}

function applyDocumentLang(locale: Locale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

let current: Locale = detectLocale();
applyDocumentLang(current);

export function getLocale(): Locale {
  return current;
}

/**
 * Switches the language for later t() calls, remembers the choice, and sets the document language.
 * It re-renders nothing, so reload the page to apply the change everywhere.
 */
export function setLocale(locale: Locale): void {
  current = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // Storage is blocked or full: the choice holds only until the page reloads.
  }
  applyDocumentLang(locale);
}

/** Looks up a key in the current locale, falls back to locales/en.json, and fills {placeholders}. */
export function t(key: TranslationKey, vars: Record<string, string> = {}): string {
  const template = DICTIONARIES[current][key] ?? en[key];
  return template.replace(/\{(\w+)\}/g, (match, name: string) => vars[name] ?? match);
}
