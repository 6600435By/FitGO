'use client';

import {
  CalendarDays,
  CreditCard,
  Home,
  Ticket,
  UserRound,
  Bell,
  ArrowLeft,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { motion } from 'motion/react';
import { FormaWordmark } from '@/components/forma/wordmark';
import { Avatar } from '@/components/forma/avatar';
import { useFeatures } from '@/components/features-provider';
import { useClubTheme } from '@/components/club-theme-provider';
import { api, type AuthUser } from '@/lib/api';
import { getToken, getUser, patchStoredUser } from '@/lib/auth';
import {
  locationKey,
  navStackDepth,
  popNavLocation,
  recordNavLocation,
} from '@/lib/nav-history';
import { cn } from '@/lib/utils';

interface DockItem {
  href: string;
  label: string;
  icon: typeof Home;
  matchSubpaths?: boolean;
  module?:
    | 'group_classes'
    | 'spa_booking'
    | 'engagement'
    | 'messaging'
    | 'club_card';
  /** Raised center pass button */
  center?: boolean;
}

const DOCK: DockItem[] = [
  { href: '/client', label: 'Главная', icon: Home },
  {
    href: '/client/schedule',
    label: 'Расписание',
    icon: CalendarDays,
    matchSubpaths: true,
    module: 'group_classes',
  },
  {
    href: '/client/card',
    label: 'Пропуск',
    icon: CreditCard,
    center: true,
    module: 'club_card',
  },
  {
    href: '/client/bookings',
    label: 'Записи',
    icon: Ticket,
    module: 'group_classes',
  },
  { href: '/client/profile', label: 'Профиль', icon: UserRound },
];

function navActive(pathname: string, item: DockItem) {
  if (pathname === item.href) return true;
  if (item.matchSubpaths && pathname.startsWith(`${item.href}/`)) return true;
  // bookings + booking-history
  if (item.href === '/client/bookings') {
    return (
      pathname.startsWith('/client/bookings') ||
      pathname.startsWith('/client/booking-history')
    );
  }
  return false;
}

export function ClientShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isEnabled } = useFeatures();
  const theme = useClubTheme();
  const [user, setUser] = useState<AuthUser | null>(() => getUser());
  const [unread, setUnread] = useState(0);
  const [canGoBack, setCanGoBack] = useState(false);

  const immersiveCard = pathname === '/client/card';
  const messagingOn = isEnabled('messaging');

  const dockItems = useMemo(
    () =>
      DOCK.filter((item) => {
        if (item.center && !isEnabled('club_card')) return false;
        if (item.module === 'group_classes') {
          // Keep schedule/bookings if either group or spa is on
          return (
            isEnabled('group_classes') ||
            isEnabled('spa_booking') ||
            item.href === '/client'
          );
        }
        if (item.module && !isEnabled(item.module)) return false;
        return true;
      }),
    [isEnabled],
  );

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api
      .me(token)
      .then((me) => {
        const next = patchStoredUser({
          firstName: me.firstName,
          lastName: me.lastName,
          phone: me.phone,
          email: me.email,
          roles: me.roles,
          club: me.club,
          clubId: me.clubId,
        });
        if (next) setUser(next);
      })
      .catch(() => undefined);

    if (messagingOn) {
      api
        .chatUnreadCount(token)
        .then((data) => setUnread(data.chat))
        .catch(() => {});
    }
  }, [messagingOn]);

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

  const displayName = user
    ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'Клиент'
    : 'Клиент';

  return (
      <div
        className={cn(
          'mx-auto min-h-dvh w-full max-w-lg phone-land:max-w-none',
          immersiveCard ? 'pb-28' : 'pb-[calc(5.5rem+env(safe-area-inset-bottom))]',
        )}
      >
        {!immersiveCard ? (
          <header
            className={cn(
              'sticky top-0 z-30 border-b border-white/[0.06] bg-ink/90 backdrop-blur-xl',
              'pt-[env(safe-area-inset-top,0px)]',
              'pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))]',
            )}
          >
            <div className="flex h-14 items-center gap-2">
              {canGoBack ? (
                <button
                  type="button"
                  onClick={goBack}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/10 text-zinc-300 touch-manipulation hover:bg-white/[0.06] hover:text-white"
                  aria-label="Назад"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
              ) : null}

              <Link href="/client" className="min-w-0 touch-manipulation">
                <FormaWordmark size="sm" />
              </Link>

              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                {messagingOn ? (
                  <Link
                    href="/client/notifications"
                    className="relative flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 text-zinc-300 touch-manipulation hover:bg-white/[0.06] hover:text-white"
                    aria-label="Сообщения"
                  >
                    <Bell className="h-5 w-5" />
                    {unread > 0 ? (
                      <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-forma-500 px-1 font-display text-[10px] font-bold text-ink">
                        {unread > 99 ? '99+' : unread}
                      </span>
                    ) : null}
                  </Link>
                ) : null}
                <Link
                  href="/client/profile"
                  className="touch-manipulation"
                  aria-label="Профиль"
                >
                  <Avatar name={displayName} size="sm" className="rounded-2xl" />
                </Link>
              </div>
            </div>
            {theme?.clubName && theme.clubName !== 'Forma' ? (
              <p className="-mt-1 pb-2 text-[11px] text-zinc-500">
                {theme.clubName}
              </p>
            ) : null}
          </header>
        ) : null}

        <main
          className={cn(
            immersiveCard ? 'px-0 py-0' : 'px-4 py-5 md:px-5',
            'pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))]',
            immersiveCard && 'pl-0 pr-0',
          )}
        >
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
          >
            {children}
          </motion.div>
        </main>

        <nav
          className={cn(
            'fixed bottom-0 left-0 right-0 z-40',
            'pb-[env(safe-area-inset-bottom)]',
            'pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)]',
          )}
          aria-label="Основная навигация"
        >
          <div className="mx-auto w-full max-w-lg px-3 pb-2 phone-land:max-w-none">
            <div className="relative flex items-end justify-between gap-1 rounded-[1.75rem] border border-white/10 bg-ink-elevated/95 px-2 pb-2 pt-2 shadow-dock backdrop-blur-xl">
              {dockItems.map((item) => {
                const active = navActive(pathname, item);
                const Icon = item.icon;

                if (item.center) {
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="relative -mt-7 flex flex-1 flex-col items-center touch-manipulation"
                      aria-label={item.label}
                      aria-current={active ? 'page' : undefined}
                    >
                      <span
                        className={cn(
                          'flex h-14 w-14 items-center justify-center rounded-2xl bg-forma-500 text-ink shadow-forma-glow transition active:scale-95',
                          active && 'ring-2 ring-white/30 ring-offset-2 ring-offset-ink',
                        )}
                      >
                        <Icon className="h-6 w-6" strokeWidth={2.25} />
                      </span>
                      <span className="mt-1 text-[10px] font-semibold text-forma-400">
                        {item.label}
                      </span>
                    </Link>
                  );
                }

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'relative flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 py-1.5 text-center touch-manipulation transition',
                      active ? 'text-forma-400' : 'text-zinc-500 hover:text-zinc-300',
                    )}
                    aria-current={active ? 'page' : undefined}
                  >
                    {active ? (
                      <motion.span
                        layoutId="dock-active"
                        className="absolute inset-x-2 inset-y-1 -z-10 rounded-2xl bg-forma-500/10"
                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                      />
                    ) : null}
                    <Icon className="h-5 w-5" strokeWidth={active ? 2.25 : 2} />
                    <span className="text-[10px] font-medium leading-tight">
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </nav>
      </div>
  );
}
