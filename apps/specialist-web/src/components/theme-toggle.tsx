'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

function readTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem('fitgo_spec_theme');
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    const t = readTheme();
    setTheme(t);
    document.documentElement.classList.toggle('dark', t === 'dark');
  }, []);

  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('fitgo_spec_theme', next);
    document.documentElement.classList.toggle('dark', next === 'dark');
  };

  return (
    <button type="button" className="btn-ghost text-xs" onClick={toggle}>
      {theme === 'dark' ? 'Светлая' : 'Тёмная'}
    </button>
  );
}
