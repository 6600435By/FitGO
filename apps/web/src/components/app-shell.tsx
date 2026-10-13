'use client';

import {
  ArrowLeft,
  ChevronDown,
  Globe,
  LogOut,
  MapPin,
  Phone,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { clearAuth, getUser } from '@/lib/auth';
import {
  locationKey,
  navStackDepth,
  popNavLocation,
  recordNavLocation,
} from '@/lib/nav-history';
import { cn } from '@/lib/utils';
import {
  subscribeWorkoutTimerDockChrome,
  type WorkoutTimerDockChrome,
} from '@/components/personal-training/workout-timer-chrome';

interface NavItem {
  href: string;
  label: string;
  matchSubpaths?: boolean;
  /** Mark active when pathname starts with any of these prefixes. */
  matchPrefixes?: string[];
  badge?: number;
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
  /**
   * Wider layout on md+ (admin / super-admin desks).
   * Mobile stays phone-width; desktop uses full content width.
   */
  wide?: boolean;
  /** Extra controls in the header (e.g. theme toggle). Left of logout. */
  headerActions?: ReactNode;
  /**
   * Optional «Ещё» sheet — off by default. When set, a fifth-style button
   * opens a list of secondary destinations (admin groups).
   */
  moreItems?: NavItem[];
  moreLabel?: string;
  /**
   * Admin compact chrome: low sticky bar, no title/FIO block.
   * Desktop hides bottom nav; optional desktopTopNav / mobileSubNav slots.
   */
  adminChrome?: boolean;
  /**
   * Hide bottom nav on all breakpoints (SPA / GP cabinets with top tabs).
   * When set, desktopTopNav is shown on mobile too.
   */
  hideBottomNav?: boolean;
  /**
   * Two-tier top nav (super-admin / manager): groups in the bar,
   * pages in mobileSubNav on all breakpoints; bottom nav hidden.
   */
  bottomNavMdOnly?: boolean;
  /** Inline section + page links in the sticky bar (md+ only, or always if hideBottomNav / bottomNavMdOnly). */
  desktopTopNav?: ReactNode;
  /**
   * Secondary links under the sticky bar.
   * With bottomNavMdOnly — all breakpoints; otherwise mobile only.
   */
  mobileSubNav?: ReactNode;
  /** When set, FITGO brand is a link (e.g. overview home). */
  brandHref?: string;
}

function navItemActive(pathname: string, item: NavItem): boolean {
  if (item.matchPrefixes?.length) {
    return item.matchPrefixes.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    );
  }
  if (pathname === item.href) return true;
  if (item.matchSubpaths && pathname.startsWith(`${item.href}/`)) return true;
  return false;
}

export function AppShell({
  children,
  title,
  navItems,
  headerClub,
  wide = false,
  headerActions,
  moreItems,
  moreLabel = 'Ещё',
  adminChrome = false,
  hideBottomNav = false,
  bottomNavMdOnly = false,
  desktopTopNav,
  mobileSubNav,
  brandHref,
}: AppShellProps) {
  const topNavAlways = hideBottomNav || bottomNavMdOnly;
  const pathname = usePathname();
  const router = useRouter();
  const user = getUser();
  const [timerChrome, setTimerChrome] = useState<WorkoutTimerDockChrome | null>(
    null,
  );
  const [clubOpen, setClubOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const immersiveCard = pathname === '/client/card';
  const primaryActive = navItems.some((item) => navItemActive(pathname, item));
  const moreActive =
    !primaryActive &&
    !!moreItems?.some((item) => navItemActive(pathname, item));

  useEffect(
    () =>
      subscribeWorkoutTimerDockChrome((detail) => {
        setTimerChrome(detail.active ? detail : null);
      }),
    [],
  );

  useEffect(() => {
    const sync = () => {
      const key = locationKey(
        window.location.pathname,
        window.location.search,
      );
      recordNavLocation(key);
      setCanGoBack(navStackDepth() > 1);
    };
    sync();

    window.addEventListener('popstate', sync);
    const hist = window.history;
    const origPush = hist.pushState.bind(hist);
    const origReplace = hist.replaceState.bind(hist);
    hist.pushState = (...args: Parameters<History['pushState']>) => {
      origPush(...args);
      sync();
    };
    hist.replaceState = (...args: Parameters<History['replaceState']>) => {
      origReplace(...args);
      sync();
    };
    return () => {
      window.removeEventListener('popstate', sync);
      hist.pushState = origPush;
      hist.replaceState = origReplace;
    };
  }, []);

  useEffect(() => {
    const key = locationKey(pathname, window.location.search);
    recordNavLocation(key);
    setCanGoBack(navStackDepth() > 1);
  }, [pathname]);

  const goBack = () => {
    const prev = popNavLocation();
    setCanGoBack(navStackDepth() > 1);
    if (prev) {
      router.replace(prev);
      return;
    }
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    }
  };

  const hideHeader =
    immersiveCard ||
    timerChrome?.overlayOpen ||
    (timerChrome?.active && timerChrome.atTop);

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

  const shellWidth = wide
    ? 'mx-auto min-h-screen w-full max-w-lg md:max-w-none'
    : 'mx-auto min-h-screen max-w-lg';
  const navWidth = wide
    ? 'mx-auto w-full max-w-lg md:max-w-none'
    : 'mx-auto max-w-lg';

  const headerH = adminChrome
    ? '[--app-header-h:2.5rem]'
    : '[--app-header-h:5.5rem]';

  return (
    <div
      className={cn(
        shellWidth,
        headerH,
        immersiveCard
          ? 'pb-20'
          : hideBottomNav
            ? 'pb-6'
            : bottomNavMdOnly
              ? 'pb-6'
              : adminChrome
                ? 'pb-24 md:pb-6'
                : 'pb-24',
      )}
    >
      {adminChrome ? (
        <header
          className={cn(
            'admin-chrome admin-chrome-bar sticky top-0 z-30 border-b border-slate-800 bg-slate-950/95 backdrop-blur',
            hideHeader && 'pointer-events-none invisible absolute',
          )}
        >
          <div className="flex h-10 items-center gap-2 px-3 md:px-4">
            {canGoBack ? (
              <button
                type="button"
                onClick={goBack}
                className="admin-chrome-btn flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
                aria-label="Назад"
                title="Назад"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            ) : null}
            {brandHref ? (
              <Link
                href={brandHref}
                className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-fitgo-400 hover:text-fitgo-300"
              >
                FITGO
              </Link>
            ) : (
              <p className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-fitgo-400">
                FITGO
              </p>
            )}
            {desktopTopNav ? (
              <div
                className={cn(
                  'min-w-0 flex-1 items-center justify-center gap-1',
                  topNavAlways ? 'flex' : 'hidden md:flex',
                  !bottomNavMdOnly && 'overflow-x-auto md:justify-start',
                )}
              >
                {desktopTopNav}
              </div>
            ) : (
              <div className="min-w-0 flex-1" />
            )}
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {headerActions}
              <button
                type="button"
                onClick={logout}
                className="admin-chrome-btn flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Выйти"
                title="Выйти"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
          {mobileSubNav && (!hideBottomNav || bottomNavMdOnly) ? (
            <div
              className={cn(
                'border-t border-slate-800/80 px-2 py-1.5',
                !bottomNavMdOnly && 'md:hidden',
              )}
            >
              {mobileSubNav}
            </div>
          ) : null}
        </header>
      ) : (
        <header
          className={cn(
            'admin-chrome sticky top-0 z-10 min-h-[var(--app-header-h)] border-b border-slate-800 bg-slate-950/90 px-4 py-4 backdrop-blur md:px-6',
            hideHeader && 'pointer-events-none invisible absolute',
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2">
              {canGoBack && (
                <button
                  type="button"
                  onClick={goBack}
                  className="admin-chrome-btn mt-0.5 shrink-0 rounded-xl border border-slate-700 p-2 text-slate-300 hover:bg-slate-800 hover:text-white"
                  aria-label="Назад"
                  title="Назад"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
              )}
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-fitgo-400">
                  FITGO
                </p>
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
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {headerActions}
              <button
                type="button"
                onClick={logout}
                className="admin-chrome-btn shrink-0 rounded-xl border border-slate-700 p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Выйти"
              >
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          </div>
        </header>
      )}

      <main
        className={cn(
          immersiveCard
            ? 'px-3 py-3'
            : adminChrome
              ? 'px-4 py-4 md:px-6'
              : 'px-4 py-6 md:px-6',
        )}
      >
        {children}
      </main>

      <nav
        className={cn(
          'admin-chrome fixed bottom-0 left-0 right-0 border-t border-slate-800 bg-slate-950/95 backdrop-blur',
          'pb-[env(safe-area-inset-bottom)]',
          hideBottomNav && 'hidden',
          bottomNavMdOnly && 'hidden',
          !hideBottomNav && !bottomNavMdOnly && adminChrome && 'md:hidden',
        )}
      >
        <div
          className={cn(
            navWidth,
            'flex items-stretch gap-0.5 px-1.5 pt-1.5 pb-1.5 md:justify-start md:gap-1 md:overflow-x-auto md:px-2',
          )}
        >
          {navItems.map((item) => {
            const active = navItemActive(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'relative flex min-h-12 min-w-0 flex-1 items-center justify-center rounded-xl px-1 py-2 text-center text-[11px] font-medium leading-tight transition md:min-h-0 md:flex-none md:shrink-0 md:px-3 md:text-sm',
                  active
                    ? 'bg-fitgo-500/20 text-fitgo-300'
                    : 'text-slate-400 hover:text-white',
                )}
              >
                <span className="line-clamp-2">{item.label}</span>
                {item.badge != null && item.badge > 0 ? (
                  <span className="absolute right-0.5 top-0.5 inline-flex min-w-[1.1rem] justify-center rounded-full bg-fitgo-500 px-1 text-[9px] font-semibold leading-4 text-white">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
          {moreItems?.map((item) => {
            const active = navItemActive(pathname, item);
            return (
              <Link
                key={`desk-${item.href}`}
                href={item.href}
                className={cn(
                  'relative hidden shrink-0 rounded-xl px-3 py-2 text-center text-sm transition md:inline-flex md:items-center',
                  active
                    ? 'bg-fitgo-500/20 text-fitgo-300'
                    : 'text-slate-400 hover:text-white',
                )}
              >
                {item.label}
                {item.badge != null && item.badge > 0 ? (
                  <span className="ml-1 inline-flex min-w-[1.25rem] justify-center rounded-full bg-fitgo-500 px-1 text-[10px] font-semibold leading-5 text-white">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
          {moreItems && moreItems.length > 0 ? (
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className={cn(
                'flex min-h-12 min-w-0 flex-1 items-center justify-center rounded-xl px-1 py-2 text-center text-[11px] font-medium leading-tight transition md:hidden',
                moreActive
                  ? 'bg-fitgo-500/20 text-fitgo-300'
                  : 'text-slate-400 hover:text-white',
              )}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
            >
              {moreLabel}
            </button>
          ) : null}
        </div>
      </nav>

      {moreOpen && moreItems && moreItems.length > 0 ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="presentation"
          onClick={() => setMoreOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-more-nav-title"
            className="card w-full max-w-lg space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 id="app-more-nav-title" className="text-lg font-semibold">
                {moreLabel}
              </h2>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="admin-chrome-btn rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Закрыть"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <ul className="divide-y divide-slate-800 overflow-hidden rounded-xl border border-slate-800">
              {moreItems.map((item) => {
                const active = navItemActive(pathname, item);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={() => setMoreOpen(false)}
                      className={cn(
                        'flex min-h-11 items-center justify-between px-3 py-3 text-sm transition hover:bg-slate-800/60',
                        active ? 'text-fitgo-300' : 'text-slate-200',
                      )}
                    >
                      <span>{item.label}</span>
                      {item.badge != null && item.badge > 0 ? (
                        <span className="rounded-full bg-fitgo-500 px-2 text-[10px] font-semibold leading-5 text-white">
                          {item.badge > 99 ? '99+' : item.badge}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}

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
