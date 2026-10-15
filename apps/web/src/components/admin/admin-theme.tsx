'use client';

import { Moon, Sun } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

export type AdminTheme = 'dark' | 'light';

const STORAGE_KEY = 'fitgo_admin_theme';

type AdminThemeContextValue = {
  theme: AdminTheme;
  toggle: () => void;
};

const AdminThemeContext = createContext<AdminThemeContextValue | null>(null);

function readTheme(): AdminTheme {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' ? 'light' : 'dark';
}

export function AdminThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<AdminTheme>('dark');

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: AdminTheme = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);

  return (
    <AdminThemeContext.Provider value={value}>
      <div
        className={cn('admin-app min-h-screen', theme === 'light' && 'admin-theme-light')}
        data-admin-theme={theme}
      >
        {children}
      </div>
    </AdminThemeContext.Provider>
  );
}

export function useAdminTheme() {
  const ctx = useContext(AdminThemeContext);
  if (!ctx) {
    throw new Error('useAdminTheme must be used within AdminThemeProvider');
  }
  return ctx;
}

export function AdminThemeToggle({
  className,
}: {
  /** e.g. `hidden md:flex` — hide in header on mobile when theme lives in club settings */
  className?: string;
}) {
  const { theme, toggle } = useAdminTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        'admin-chrome-btn flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white',
        className,
      )}
      aria-label={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
      title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
    >
      {theme === 'dark' ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </button>
  );
}

/** Inline control for club / cabinet settings pages. */
export function AdminThemeSettingRow() {
  const { theme, toggle } = useAdminTheme();
  const isDark = theme === 'dark';
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="stat-label">Тема кабинета</p>
        <p className="mt-0.5 text-xs text-slate-500">
          {isDark ? 'Сейчас тёмная' : 'Сейчас светлая'}. На телефоне переключатель
          в шапке скрыт — меняйте тему здесь.
        </p>
      </div>
      <button
        type="button"
        onClick={toggle}
        className="admin-chrome-btn flex h-10 shrink-0 items-center gap-2 rounded-lg border border-slate-700 px-3 text-sm text-slate-200 hover:bg-slate-800 hover:text-white"
        aria-label={isDark ? 'Включить светлую тему' : 'Включить тёмную тему'}
      >
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        {isDark ? 'Светлая' : 'Тёмная'}
      </button>
    </div>
  );
}
