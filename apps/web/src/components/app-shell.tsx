'use client';

import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { clearAuth, getUser } from '@/lib/auth';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  matchSubpaths?: boolean;
}

interface AppShellProps {
  children: ReactNode;
  title: string;
  navItems: NavItem[];
}

export function AppShell({ children, title, navItems }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const user = getUser();

  const logout = () => {
    clearAuth();
    router.push('/login');
  };

  return (
    <div className="mx-auto min-h-screen max-w-lg pb-24">
      <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/90 px-4 py-4 backdrop-blur">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-fitgo-400">FITGO</p>
            <h1 className="text-lg font-semibold">{title}</h1>
            {user && (
              <p className="text-sm text-slate-400">
                {user.firstName} {user.lastName}
              </p>
            )}
          </div>
          <button
            onClick={logout}
            className="rounded-xl border border-slate-700 p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Выйти"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>

      <main className="px-4 py-6">{children}</main>

      <nav className="fixed bottom-0 left-0 right-0 border-t border-slate-800 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-lg justify-around px-2 py-2">
          {navItems.map((item) => {
            const active =
              pathname === item.href ||
              (item.matchSubpaths && pathname.startsWith(`${item.href}/`));
            return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'rounded-xl px-3 py-2 text-center text-sm transition',
                active
                  ? 'bg-fitgo-500/20 text-fitgo-300'
                  : 'text-slate-400 hover:text-white',
              )}
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
