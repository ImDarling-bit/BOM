import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';

import { useApp } from '../context/AppContext';
import { buildTheme, type Colors, type Theme } from './index';

const ThemeContext = createContext<Theme>(buildTheme('dark', 'default', null));

/** Suit le thème clair/sombre du téléphone et l'accent choisi dans les réglages. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const { settings } = useApp();
  const scheme = system === 'light' ? 'light' : 'dark';
  const theme = useMemo(
    () => buildTheme(scheme, settings.themeId, settings.customAccent),
    [scheme, settings.themeId, settings.customAccent]
  );
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

/**
 * Styles qui dépendent du thème. `factory` doit être définie hors du composant
 * (fonction stable) : les styles ne sont recalculés qu'au changement de thème.
 */
export function useStyles<T>(factory: (c: Colors) => T): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [factory, colors]);
}
