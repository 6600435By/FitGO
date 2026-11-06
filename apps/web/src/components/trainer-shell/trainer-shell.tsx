'use client';

import {
  Avatar,
  CommandSheet,
  FormaWordmark,
  useCommandPaletteHotkey,
  type CommandItem,
  cn,
} from '@fitgo/forma-ui';
import { Bell, MessageSquare, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { AppPresenceBridge } from '@/components/app-presence-bridge';
import { DataFreshness } from '@/components/data-freshness';
import { useFeatures } from '@/components/features-provider';
import { PushBridge } from '@/components/push-bridge';
import { api, type AuthUser } from '@/lib/api';
import { getToken, getUser, saveAuth } from '@/lib/auth';
import {
  buildTrainerV2Nav,
  navItemActive,
  type TrainerNavItem,
} from './trainer-nav';
import { QuickActionsSheet } from './quick-actions-sheet';
import { TrainerPwaInstallTip } from './pwa-install-tip';

type Breakpoint = 'phone' | 'tablet' | 'desktop';

function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>('phone');
  useEffect(() => {
    const sync = () => {
      const w = window.innerWidth;
      if (w >= 1280) setBp('desktop');
      else if (w >= 768) setBp('tablet');
      else setBp('phone');
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);
  return bp;
}

export function TrainerShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isEnabled } = useFeatures();
  const bp = useBreakpoint();
  const [user, setUser] = useState<AuthUser | null>(() => getUser());
  const [unread, setUnread] = useState(0);
  const [quickOpen, setQuickOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);

  const immersive =
    pathname.startsWith('/trainer/live/') ||
    pathname.startsWith('/trainer/welcome');

  const { mode, dock, more, all } = useMemo(
    () => buildTrainerV2Nav(user, (k) => isEnabled(k as never)),
    [user, isEnabled],
  );

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let cancelled = false;
    api
      .me(token)
      .then((fresh) => {
        if (cancelled) return;
        setUser(fresh);
        saveAuth(token, fresh);
      })
      .catch(() => undefined);

    if (isEnabled('messaging')) {
      api
        .chatUnreadCount(token)
        .then((data) => {
          if (!cancelled) setUnread(data.chat ?? 0);
        })
        .catch(() => undefined);
    }

    return () => {
      cancelled = true;
    };
  }, [isEnabled]);

  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = '/trainer-manifest.json';
    document.head.appendChild(link);
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = '#0B0B0C';
    document.head.appendChild(meta);
    return () => {
      link.remove();
      meta.remove();
    };
  }, []);

  const openQuick = useCallback(() => setQuickOpen(true), []);
  const openCmd = useCallback(() => setCmdOpen(true), []);
  useCommandPaletteHotkey(openCmd, !immersive && bp !== 'phone');

  useEffect(() => {
    if (immersive || bp === 'phone') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable)
          return;
        e.preventDefault();
        if (mode.showPt) router.push('/trainer/schedule');
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        setCmdOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [immersive, bp, mode.showPt, router]);

  const displayName = user
    ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'Тренер'
    : 'Тренер';

  const clubLine = useMemo(() => {
    const c = user?.club;
    if (!c) return 'Forma';
    const bits = [c.name || 'Forma', c.phone, c.address].filter(Boolean);
    return bits.join(' · ');
  }, [user?.club]);

  const commandItems: CommandItem[] = useMemo(() => {
    const items: CommandItem[] = all.map((item) => ({
      id: item.href,
      label: item.label,
      group: 'Навигация',
      onSelect: () => router.push(item.href),
    }));
    if (mode.showPt) {
      items.unshift({
        id: 'new-pt',
        label: 'Записать на ПТ',
        hint: 'N',
        group: 'Действия',
        onSelect: () => router.push('/trainer/schedule'),
      });
      items.unshift({
        id: 'find-client',
        label: 'Найти клиента',
        group: 'Действия',
        onSelect: () => router.push('/trainer/clients'),
      });
    }
    items.push({
      id: 'quick',
      label: 'Быстрые действия',
      group: 'Действия',
      onSelect: () => setQuickOpen(true),
    });
    return items;
  }, [all, mode.showPt, router]);

  const onDockClick = (item: TrainerNavItem, e: MouseEvent) => {
    if (item.center) {
      e.preventDefault();
      openQuick();
    }
  };

  if (immersive) {
    return (
      <div className="forma-theme min-h-dvh bg-ink text-zinc-100">
        {children}
      </div>
    );
  }

  const navMode = bp === 'desktop' ? 'sidebar' : bp === 'tablet' ? 'rail' : 'dock';
  const showSidebarMore = navMode === 'sidebar';

  return (
    <div className="forma-theme min-h-dvh bg-ink font-sans text-zinc-100">
      <div
        className={cn(
          'mx-auto flex min-h-dvh w-full',
          navMode === 'dock' && 'max-w-lg flex-col phone-land:max-w-none',
          navMode !== 'dock' && 'max-w-[1440px]',
        )}
      >
        {navMode !== 'dock' ? (
          <aside
            className={cn(
              'sticky top-0 flex h-dvh shrink-0 flex-col border-r border-white/[0.06] bg-ink-elevated/80 backdrop-blur-xl',
              navMode === 'rail' ? 'w-[72px] items-center px-2 py-4' : 'w-60 px-3 py-4',
            )}
          >
            <Link href="/trainer" className="mb-6 px-1 touch-manipulation">
              {navMode === 'rail' ? (
                <span className="font-display text-sm font-bold text-forma-400">
                  FC
                </span>
              ) : (
                <FormaWordmark size="sm" variant="coach" />
              )}
            </Link>
            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
              {(showSidebarMore ? all : dock.filter((d) => !d.center)).map(
                (item) => {
                  const active = navItemActive(pathname, item);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={item.label}
                      className={cn(
                        'flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium touch-manipulation transition',
                        navMode === 'rail' && 'justify-center px-0',
                        active
                          ? 'bg-forma-500/15 text-forma-400'
                          : 'text-zinc-400 hover:bg-white/[0.04] hover:text-white',
                      )}
                      aria-current={active ? 'page' : undefined}
                    >
                      <Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.25 : 2} />
                      {navMode === 'sidebar' ? <span>{item.label}</span> : null}
                    </Link>
                  );
                },
              )}
              {navMode === 'rail' ? (
                <button
                  type="button"
                  onClick={openQuick}
                  className="mt-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-forma-500 text-ink shadow-forma-glow touch-manipulation"
                  aria-label="Быстрые действия"
                >
                  <span className="text-2xl leading-none">+</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={openQuick}
                  className="mt-3 flex items-center justify-center gap-2 rounded-2xl bg-forma-500 px-3 py-2.5 text-sm font-semibold text-ink touch-manipulation"
                >
                  Быстрые действия
                </button>
              )}
            </nav>
            {navMode === 'sidebar' ? (
              <p className="mt-auto px-2 pt-4 text-[11px] leading-snug text-zinc-600">
                {clubLine}
              </p>
            ) : null}
          </aside>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header
            className={cn(
              'sticky top-0 z-30 border-b border-white/[0.06] bg-ink/90 backdrop-blur-xl',
              'pt-[env(safe-area-inset-top,0px)]',
              'pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))]',
            )}
          >
            <div className="flex h-14 items-center gap-2">
              {navMode === 'dock' ? (
                <Link href="/trainer" className="min-w-0 touch-manipulation">
                  <FormaWordmark size="sm" variant="coach" />
                </Link>
              ) : (
                <div className="min-w-0">
                  <p className="truncate font-display text-sm font-semibold text-white">
                    Привет, {user?.firstName || 'тренер'}
                  </p>
                  <p className="truncate text-[11px] text-zinc-500">{clubLine}</p>
                </div>
              )}

              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                {bp !== 'phone' ? (
                  <button
                    type="button"
                    onClick={openCmd}
                    className="hidden h-10 items-center gap-2 rounded-2xl border border-white/10 px-3 text-sm text-zinc-400 touch-manipulation hover:bg-white/[0.06] hover:text-white tablet:flex"
                  >
                    <Search className="h-4 w-4" />
                    <span>Поиск</span>
                    <kbd className="rounded border border-white/10 px-1.5 text-[10px] text-zinc-500">
                      ⌘K
                    </kbd>
                  </button>
                ) : null}
                {mode.showPt && bp !== 'phone' ? (
                  <button
                    type="button"
                    onClick={() => router.push('/trainer/schedule')}
                    className="hidden rounded-2xl bg-forma-500 px-3 py-2 text-sm font-semibold text-ink touch-manipulation desktop:inline-flex"
                  >
                    Записать на ПТ
                  </button>
                ) : null}
                {isEnabled('messaging') ? (
                  <Link
                    href="/trainer/messages"
                    className="relative flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 text-zinc-300 touch-manipulation hover:bg-white/[0.06] hover:text-white"
                    aria-label="Сообщения"
                  >
                    <MessageSquare className="h-5 w-5" />
                    {unread > 0 ? (
                      <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-forma-500 px-1 font-display text-[10px] font-bold text-ink">
                        {unread > 99 ? '99+' : unread}
                      </span>
                    ) : null}
                  </Link>
                ) : null}
                <Link
                  href="/trainer/messages"
                  className="relative flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 text-zinc-300 touch-manipulation hover:bg-white/[0.06]"
                  aria-label="Уведомления"
                >
                  <Bell className="h-5 w-5" />
                </Link>
                <Link href="/trainer/profile" aria-label="Профиль">
                  <Avatar name={displayName} size="sm" className="rounded-2xl" />
                </Link>
              </div>
            </div>
            {navMode === 'dock' ? (
              <p className="-mt-1 truncate pb-2 text-[11px] text-zinc-500">
                {clubLine}
              </p>
            ) : null}
          </header>

          <main
            className={cn(
              'flex-1 px-4 py-5 md:px-6',
              'pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))]',
              navMode === 'dock' &&
                'pb-[calc(5.5rem+env(safe-area-inset-bottom))]',
            )}
          >
            <div className="mb-4 space-y-3">
              <TrainerPwaInstallTip />
              <DataFreshness canRefresh={false} />
              <PushBridge />
              <AppPresenceBridge />
            </div>
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              {children}
            </motion.div>
          </main>
        </div>
      </div>

      {navMode === 'dock' ? (
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
              {dock.map((item) => {
                const active = navItemActive(pathname, item);
                const Icon = item.icon;
                if (item.center) {
                  return (
                    <button
                      key={item.href}
                      type="button"
                      onClick={openQuick}
                      className="relative -mt-7 flex flex-1 flex-col items-center touch-manipulation"
                      aria-label={item.label}
                    >
                      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-forma-500 text-ink shadow-forma-glow transition active:scale-95">
                        <Icon className="h-6 w-6" strokeWidth={2.25} />
                      </span>
                      <span className="mt-1 text-[10px] font-semibold text-forma-400">
                        {item.label}
                      </span>
                    </button>
                  );
                }
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={(e) => onDockClick(item, e)}
                    className={cn(
                      'relative flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 py-1.5 text-center touch-manipulation transition',
                      active ? 'text-forma-400' : 'text-zinc-500 hover:text-zinc-300',
                    )}
                    aria-current={active ? 'page' : undefined}
                  >
                    {active ? (
                      <motion.span
                        layoutId="trainer-dock-active"
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
      ) : null}

      <QuickActionsSheet
        open={quickOpen}
        onOpenChange={setQuickOpen}
        mode={mode}
      />
      <CommandSheet
        open={cmdOpen}
        onOpenChange={setCmdOpen}
        items={commandItems}
      />
    </div>
  );
}
