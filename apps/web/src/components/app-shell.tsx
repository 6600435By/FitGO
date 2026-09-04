'use client';

import { ChevronDown, Globe, LogOut, MapPin, Phone, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { clearAuth, getUser } from '@/lib/auth';
import { cn } from '@/lib/utils';
import {
  subscribeWorkoutTimerDockChrome,
  type WorkoutTimerDockChrome,
} from '@/components/personal-training/workout-timer-chrome';

interface NavItem {
  href: string;
  label: string;
  matchSubpaths?: boolean;
}

export interface HeaderClubInfo {
  name: string;
  address?: string;
  phone?: string;
  website?: string;
}

interface AppShellProps {
  children: ReactNode;
  title: string;
  navItems: NavItem[];
  /** When set, header title is clickable and opens club contacts. */
  headerClub?: HeaderClubInfo | null;
}

export function AppShell({
  children,
  title,
  navItems,
  headerClub,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const user = getUser();
  const [timerChrome, setTimerChrome] = useState<WorkoutTimerDockChrome | null>(
    null,
  );
  const [clubOpen, setClubOpen] = useState(false);

  useEffect(
    () =>
      subscribeWorkoutTimerDockChrome((detail) => {
        setTimerChrome(detail.active ? detail : null);
      }),
    [],
  );

  const hideHeader =
    timerChrome?.overlayOpen || (timerChrome?.active && timerChrome.atTop);

  const logout = () => {
    clearAuth();
    router.push('/login');
  };

  const websiteHref = headerClub?.website
    ? headerClub.website.startsWith('http')
      ? headerClub.website
      : `https://${headerClub.website}`
    : undefined;
  const websiteLabel = headerClub?.website
    ?.replace(/^https?:\/\//, '')
    .replace(/\/$/, '');

  return (
    <div className="mx-auto min-h-screen max-w-lg pb-24 [--app-header-h:5.5rem]">
      <header
        className={cn(
          'sticky top-0 z-10 min-h-[var(--app-header-h)] border-b border-slate-800 bg-slate-950/90 px-4 py-4 backdrop-blur',
          hideHeader && 'pointer-events-none invisible',
        )}
      >
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-fitgo-400">FITGO</p>
            {headerClub ? (
              <button
                type="button"
                onClick={() => setClubOpen(true)}
                className="group flex max-w-full items-center gap-1 text-left"
                aria-haspopup="dialog"
                aria-expanded={clubOpen}
              >
                <h1 className="truncate text-lg font-semibold group-hover:text-fitgo-300">
                  {headerClub.name}
                </h1>
                <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-fitgo-300" />
              </button>
            ) : (
              <h1 className="text-lg font-semibold">{title}</h1>
            )}
            {user && (
              <p className="text-sm text-slate-400">
                {user.firstName} {user.lastName}
              </p>
            )}
          </div>
          <button
            type="button"
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

      {clubOpen && headerClub && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="presentation"
          onClick={() => setClubOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="club-info-title"
            className="card w-full max-w-lg space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-slate-400">Клуб</p>
                <h2 id="club-info-title" className="text-xl font-semibold">
                  {headerClub.name}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setClubOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Закрыть"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <ul className="space-y-3 text-sm">
              {headerClub.address && (
                <li className="flex gap-3">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-fitgo-400" />
                  <span className="text-slate-300">{headerClub.address}</span>
                </li>
              )}
              {headerClub.phone && (
                <li className="flex gap-3">
                  <Phone className="mt-0.5 h-4 w-4 shrink-0 text-fitgo-400" />
                  <a
                    href={`tel:${headerClub.phone.replace(/\s/g, '')}`}
                    className="text-fitgo-300 hover:underline"
                  >
                    {headerClub.phone}
                  </a>
                </li>
              )}
              {websiteHref && (
                <li className="flex gap-3">
                  <Globe className="mt-0.5 h-4 w-4 shrink-0 text-fitgo-400" />
                  <a
                    href={websiteHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-fitgo-300 hover:underline"
                  >
                    {websiteLabel ?? websiteHref}
                  </a>
                </li>
              )}
            </ul>

            <button
              type="button"
              className="btn-secondary w-full"
              onClick={() => {
                setClubOpen(false);
                router.push('/client?switchClub=1');
              }}
            >
              Сменить клуб
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
