import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { THEMES, type Theme } from './theme';

export type ThemePreference = 'system' | 'light' | 'dark';

const ThemeContext = createContext<Theme>(THEMES.light);

export function ThemeProvider({ preference, children }: { preference: ThemePreference; children: ReactNode }): ReactElement {
  const scheme = useColorScheme();
  const theme = useMemo(() => {
    if (preference === 'light' || preference === 'dark') return THEMES[preference];
    return scheme === 'dark' ? THEMES.dark : THEMES.light;
  }, [preference, scheme]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
