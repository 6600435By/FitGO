'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { DataFreshness } from '@/components/data-freshness';
import { clearAuth, getToken, getUser, requireSpecialist } from '@/lib/auth';

const NAV = [
  { href: '/journal', label: 'Журнал' },
  { href: '/my-sessions', label: 'Мои занятия' },
  { href: '/payroll', label: 'Моя ЗП' },
];

export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    if (pathname === '/login') {
      setReady(true);
      return;
    }
    const token = getToken();
    const user = getUser();
    if (!token || !requireSpecialist(user)) {
      clearAuth();
      router.replace('/login');
      return;
    }
    setName(`${user!.firstName} ${user!.lastName}`.trim());
    setReady(true);
  }, [pathname, router]);

  if (!ready) {
    return (
      <div className="shell items-center justify-center text-sm" style={{ color: 'var(--muted)' }}>
        Загрузка…
      </div>
    );
  }

  if (pathname === '/login') {
    return <>{children}</>;
  }

  return (
    <div className="shell">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-2xl tracking-tight">FitGO SPA</p>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            {name || 'Специалист'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() => {
              clearAuth();
              router.replace('/login');
            }}
          >
            Выйти
          </button>
        </div>
      </header>
      <main className="flex-1 space-y-4">
        <DataFreshness />
        {children}
      </main>
      <nav className="nav-dock">
        <div className="mx-auto flex max-w-3xl gap-1 px-2 py-2">
          {NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex-1 rounded-xl py-3 text-center text-sm font-medium transition"
                style={{
                  background: active ? 'var(--accent)' : 'transparent',
                  color: active ? 'var(--accent-fg)' : 'var(--fg)',
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
