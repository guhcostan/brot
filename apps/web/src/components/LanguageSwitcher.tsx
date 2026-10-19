import { useId, type ReactElement } from 'react';
import { cx } from '@brot/ui';
import { LOCALES, t, type Locale } from '../i18n';

/** Each language is named in itself, so a reader can find theirs whatever the current locale. */
const NATIVE_NAME: Record<Locale, string> = {
  en: 'English',
  'pt-BR': 'Português (Brasil)',
  es: 'Español',
};

export interface LanguageSwitcherProps {
  locale: Locale;
  onChange: (locale: Locale) => void;
  className?: string;
}

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

export function LanguageSwitcher({ locale, onChange, className }: LanguageSwitcherProps): ReactElement {
  const id = useId();
  return (
    <div className={cx('relative flex items-center', className)}>
      <label htmlFor={id} className="brot-sr-only">
        {t('language.label')}
      </label>
      <GlobeIcon className="pointer-events-none absolute left-2 text-ink-3" />
      <select
        id={id}
        value={locale}
        lang={locale}
        onChange={(event) => {
          if (isLocale(event.target.value)) onChange(event.target.value);
        }}
        className="h-8 w-full cursor-pointer appearance-none rounded-md border border-transparent bg-transparent pr-7 pl-8 text-sm text-ink-2 transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 hover:text-ink"
      >
        {LOCALES.map((option) => (
          <option key={option} value={option} lang={option}>
            {NATIVE_NAME[option]}
          </option>
        ))}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute right-2 text-ink-3" />
    </div>
  );
}

function GlobeIcon({ className }: { className?: string }): ReactElement {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" className={className}>
      <circle cx="10" cy="10" r="7.25" />
      <path d="M2.75 10h14.5M10 2.75c2 2.1 3 4.5 3 7.25s-1 5.15-3 7.25c-2-2.1-3-4.5-3-7.25s1-5.15 3-7.25Z" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }): ReactElement {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="m5.5 8 4.5 4.5L14.5 8" />
    </svg>
  );
}
