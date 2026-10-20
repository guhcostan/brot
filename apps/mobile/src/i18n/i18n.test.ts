import { describe, expect, it } from 'vitest';
import { en } from './en';
import { LOCALES, dictionary, localeForTag, plural, setLocale, t } from './index';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe('i18n', () => {
  it('translates every key with the same placeholders in every locale', () => {
    for (const locale of LOCALES) {
      const strings = dictionary(locale);
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        expect(strings[key], `${locale} ${key}`).toBeTruthy();
        expect(placeholders(strings[key]), `${locale} ${key}`).toEqual(placeholders(en[key]));
      }
    }
  });

  it('keeps twelve months and seven weekdays per locale', () => {
    for (const locale of LOCALES) {
      expect(dictionary(locale)['date.months'].split(',')).toHaveLength(12);
      expect(dictionary(locale)['date.weekdays'].split(',')).toHaveLength(7);
    }
  });

  it('maps device tags to shipped locales', () => {
    expect(localeForTag('pt-PT')).toBe('pt-BR');
    expect(localeForTag('es_MX')).toBe('es');
    expect(localeForTag('en-GB')).toBe('en');
    expect(localeForTag('fr-FR')).toBeUndefined();
  });

  it('fills placeholders, picks plurals and switches language', () => {
    expect(t('thread.sayHi', { name: 'Onça' })).toBe('Say hi to Onça.');
    expect(plural('inbox.roomMembersOne', 'inbox.roomMembersMany', 1)).toBe('1 bot');
    expect(plural('inbox.roomMembersOne', 'inbox.roomMembersMany', 3)).toBe('3 bots');
    setLocale('pt-BR');
    expect(t('computer.needsYou', { name: 'Onça', reason: 'login' })).toBe('Onça precisa de você: login');
    setLocale('en');
  });
});
