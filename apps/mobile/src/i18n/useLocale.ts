import { useSyncExternalStore } from 'react';
import { getLocale, subscribeLocale, type Locale } from './index';

/** The current locale; components that call it re-render when the language changes. */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}
