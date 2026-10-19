import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../locales/en.json';
import es from '../locales/es.json';
import ptBR from '../locales/pt-BR.json';

const STORAGE_KEY = 'brot.locale';
const english: Record<string, string> = en;
const englishKeys = Object.keys(english).sort();
const shipped: Array<[string, Record<string, string>]> = [
  ['pt-BR', ptBR],
  ['es', es],
];

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();
}

interface BrowserOptions {
  languages?: string[];
  stored?: string;
  storageThrows?: boolean;
}

function stubBrowser({ languages = ['en-US'], stored, storageThrows = false }: BrowserOptions = {}) {
  const store = new Map<string, string>();
  if (stored !== undefined) store.set(STORAGE_KEY, stored);
  const documentElement = { lang: '' };
  vi.stubGlobal('navigator', { languages });
  vi.stubGlobal('document', { documentElement });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => {
      if (storageThrows) throw new Error('storage blocked');
      return store.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (storageThrows) throw new Error('storage blocked');
      store.set(key, value);
    },
  });
  return { store, documentElement };
}

async function loadI18n() {
  vi.resetModules();
  return import('./i18n');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('../locales/es.json');
  vi.resetModules();
});

describe('locale files', () => {
  it('ships en, pt-BR, and es', async () => {
    stubBrowser();
    const { LOCALES } = await loadI18n();
    expect([...LOCALES]).toEqual(['en', 'pt-BR', 'es']);
  });

  it.each(shipped)('%s has exactly the keys of en.json', (_name, dictionary) => {
    expect(Object.keys(dictionary).sort()).toEqual(englishKeys);
  });

  it.each(shipped)('%s keeps the placeholders of every en.json value', (_name, dictionary) => {
    for (const key of englishKeys) {
      expect(placeholders(dictionary[key] ?? ''), key).toEqual(placeholders(english[key] ?? ''));
    }
  });

  it.each(shipped)('%s has no empty values', (_name, dictionary) => {
    for (const key of englishKeys) {
      expect(dictionary[key]?.trim(), key).toBeTruthy();
    }
  });
});

describe('locale detection', () => {
  const cases: Array<[string[], string]> = [
    [['pt-BR'], 'pt-BR'],
    [['pt'], 'pt-BR'],
    [['pt-PT'], 'pt-BR'],
    [['es-MX'], 'es'],
    [['es'], 'es'],
    [['en-GB'], 'en'],
    [['fr-FR', 'de-DE'], 'en'],
    [['fr-FR', 'pt-BR'], 'pt-BR'],
    [['de-DE', 'es-ES', 'pt-BR'], 'es'],
    [['en-US', 'pt-BR'], 'en'],
    [[], 'en'],
  ];

  it.each(cases)('maps browser languages %j to %s', async (languages, expected) => {
    const { documentElement } = stubBrowser({ languages });
    const i18n = await loadI18n();
    expect(i18n.getLocale()).toBe(expected);
    expect(documentElement.lang).toBe(expected);
  });

  it('uses English when navigator is unavailable', async () => {
    stubBrowser();
    vi.stubGlobal('navigator', undefined);
    const i18n = await loadI18n();
    expect(i18n.getLocale()).toBe('en');
  });

  it('prefers a saved choice over the browser language', async () => {
    stubBrowser({ languages: ['pt-BR'], stored: 'es' });
    const i18n = await loadI18n();
    expect(i18n.getLocale()).toBe('es');
  });

  it('ignores a saved value that is not a supported locale', async () => {
    stubBrowser({ languages: ['pt-BR'], stored: 'fr' });
    const i18n = await loadI18n();
    expect(i18n.getLocale()).toBe('pt-BR');
  });

  it('uses the browser language when storage throws', async () => {
    stubBrowser({ languages: ['es-MX'], storageThrows: true });
    const i18n = await loadI18n();
    expect(i18n.getLocale()).toBe('es');
  });
});

describe('setLocale', () => {
  it('switches the language, persists it, and sets the document language', async () => {
    const { store, documentElement } = stubBrowser({ languages: ['en-US'] });
    const i18n = await loadI18n();
    i18n.setLocale('pt-BR');
    expect(i18n.getLocale()).toBe('pt-BR');
    expect(i18n.t('status.waiting')).toBe('Aguardando você');
    expect(documentElement.lang).toBe('pt-BR');
    expect(store.get(STORAGE_KEY)).toBe('pt-BR');
  });

  it('keeps the choice when the app loads again', async () => {
    const { store } = stubBrowser({ languages: ['en-US'] });
    const first = await loadI18n();
    first.setLocale('es');
    expect(store.get(STORAGE_KEY)).toBe('es');
    const second = await loadI18n();
    expect(second.getLocale()).toBe('es');
  });

  it('still switches when storage throws', async () => {
    stubBrowser({ languages: ['en-US'], storageThrows: true });
    const i18n = await loadI18n();
    expect(() => i18n.setLocale('es')).not.toThrow();
    expect(i18n.getLocale()).toBe('es');
  });
});

describe('t', () => {
  it('fills placeholders and leaves unknown ones visible', async () => {
    stubBrowser({ languages: ['en-US'] });
    const i18n = await loadI18n();
    expect(i18n.t('sidebar.empty', { query: 'ana' })).toBe('No bots match "ana"');
    expect(i18n.t('thread.emptyTitle')).toBe('{name} has nothing to do yet');
  });

  it('translates in the current locale and fills placeholders', async () => {
    stubBrowser({ languages: ['es-MX'] });
    const i18n = await loadI18n();
    expect(i18n.t('composer.label', { name: 'Ana' })).toBe('Mensaje para Ana');
  });

  it('falls back to en.json for a key the locale does not have', async () => {
    vi.doMock('../locales/es.json', () => ({ default: { 'app.name': 'brot' } }));
    stubBrowser({ languages: ['es-MX'] });
    const i18n = await loadI18n();
    expect(i18n.getLocale()).toBe('es');
    expect(i18n.t('app.name')).toBe('brot');
    expect(i18n.t('app.tagline')).toBe(english['app.tagline']);
  });
});
