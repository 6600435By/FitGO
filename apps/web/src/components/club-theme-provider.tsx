'use client';

import type { ClubTheme } from '@fitgo/shared-types';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

const ThemeContext = createContext<ClubTheme | null>(null);

export function useClubTheme() {
  return useContext(ThemeContext);
}

export function ClubThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ClubTheme | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api.clubTheme(token).then(setTheme).catch(() => {});
  }, []);

  useEffect(() => {
    if (theme?.primaryColor) {
      document.documentElement.style.setProperty('--fitgo-primary', theme.primaryColor);
    }
  }, [theme]);

  return (
    <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
  );
}
