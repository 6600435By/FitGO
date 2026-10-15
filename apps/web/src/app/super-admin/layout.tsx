'use client';

import { UserRole } from '@fitgo/shared-types';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import {
  AdminThemeProvider,
  AdminThemeToggle,
} from '@/components/admin/admin-theme';
import { AppShell } from '@/components/app-shell';
import { BackupStatusBanner } from '@/components/admin/backup-status-banner';
import { DataFreshness } from '@/components/data-freshness';
import { PushBridge } from '@/components/push-bridge';
import { StaffMessagesBadge } from '@/components/staff/staff-messages-badge';
import { getUser } from '@/lib/auth';
import { cn } from '@/lib/utils';

type SaGroup = 'club' | 'control' | 'reports' | 'settings';

type SaNavItem = {
  href: string;
  label: string;
  shortLabel?: string;
  group: SaGroup;
  superOnly?: boolean;
};

const GROUPS: { id: SaGroup; label: string; home: string }[] = [
  { id: 'club', label: 'Клуб', home: '/super-admin/analytics' },
  { id: 'control', label: 'Контроль', home: '/super-admin/tasks' },
  { id: 'reports', label: 'Отчёты', home: '/super-admin/sales' },
  { id: 'settings', label: 'Настройки', home: '/super-admin/club-settings' },
];

const ALL_NAV: SaNavItem[] = [
  {
    href: '/super-admin/analytics',
    label: 'Аналитика',
    group: 'club',
  },
  { href: '/super-admin/staff', label: 'Персонал', group: 'club' },
  { href: '/super-admin/schedule', label: 'Расписание', group: 'club' },
  {
    href: '/super-admin/staff-roster',
    label: 'График смен',
    shortLabel: 'График',
    group: 'club',
  },
  { href: '/super-admin/spa', label: 'SPA', group: 'club' },
  { href: '/super-admin/tasks', label: 'Задачи', group: 'control' },
  { href: '/super-admin/messages', label: 'Сообщения', group: 'control' },
  {
    href: '/super-admin/review-queue',
    label: 'Контроль записей',
    shortLabel: 'Записи',
    group: 'control',
  },
  {
    href: '/super-admin/exceptions',
    label: 'Нестыковки',
    group: 'control',
  },
  { href: '/super-admin/sales', label: 'Продажи', group: 'reports' },
  { href: '/super-admin/payroll', label: 'ЗП', group: 'reports' },
  {
    href: '/super-admin/pt-timesheet',
    label: 'Табели ПТ',
    shortLabel: 'Табели',
    group: 'reports',
  },
  {
    href: '/super-admin/debts',
    label: 'Услуги специалистов',
    shortLabel: 'Услуги',
    group: 'reports',
  },
  {
    href: '/super-admin/modules',
    label: 'Модули',
    group: 'settings',
    superOnly: true,
  },
  {
    href: '/super-admin/club-settings',
    label: 'Настройки клуба',
    shortLabel: 'Клуб',
    group: 'settings',
  },
  {
    href: '/super-admin/spa-catalog',
    label: 'Каталог SPA',
    shortLabel: 'Каталог',
    group: 'settings',
  },
  {
    href: '/super-admin/audit',
    label: 'Журнал',
    group: 'settings',
    superOnly: true,
  },
];

function pathInGroup(pathname: string, group: SaGroup, items: SaNavItem[]) {
  return items.some(
    (item) =>
      item.group === group &&
      (pathname === item.href || pathname.startsWith(`${item.href}/`)),
  );
}

function GroupChip({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'shrink-0 rounded-lg px-1.5 py-1 text-[10px] font-medium transition sm:px-2.5 sm:text-xs',
        active
          ? 'bg-fitgo-500/20 text-fitgo-300'
          : 'text-slate-400 hover:text-white',
      )}
    >
      {label}
    </Link>
  );
}

function PageChip({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'shrink-0 rounded-lg px-2 py-1.5 text-center text-[10px] font-medium leading-tight transition sm:px-2.5 sm:text-xs',
        active
          ? 'bg-fitgo-500/20 text-fitgo-300'
          : 'text-slate-400 hover:text-white',
      )}
    >
      <span className="whitespace-nowrap">{label}</span>
    </Link>
  );
}

export default function SuperAdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const user = getUser();
  const isSuper = Boolean(user?.roles.includes(UserRole.SUPER_ADMIN));

  const navItems = useMemo(() => {
    return ALL_NAV.filter((item) => isSuper || !item.superOnly);
  }, [isSuper]);

  const activeGroup: SaGroup = useMemo(() => {
    if (pathname === '/super-admin' || pathname.startsWith('/super-admin/permissions')) {
      return 'club';
    }
    for (const g of GROUPS) {
      if (pathInGroup(pathname, g.id, navItems)) return g.id;
    }
    return 'club';
  }, [pathname, navItems]);

  const groupPages = useMemo(
    () => navItems.filter((item) => item.group === activeGroup),
    [navItems, activeGroup],
  );

  const bottomNavItems = useMemo(
    () => [
      { href: '/super-admin', label: 'Обзор', exact: true as const },
      ...navItems.map((item) => ({
        href: item.href,
        label: item.label,
      })),
    ],
    [navItems],
  );

  const desktopTopNav = (
    <div className="flex w-max min-w-0 items-center gap-0.5 sm:gap-1 md:mx-auto md:max-w-md md:justify-center">
      {GROUPS.map((g) => {
        const visible =
          g.id !== 'settings' ||
          navItems.some((i) => i.group === 'settings');
        if (!visible) return null;
        const home =
          g.id === 'settings' && !isSuper
            ? '/super-admin/club-settings'
            : g.home;
        return (
          <GroupChip
            key={g.id}
            href={home}
            label={g.label}
            active={activeGroup === g.id && pathname !== '/super-admin'}
          />
        );
      })}
    </div>
  );

  const mobileSubNav =
    pathname === '/super-admin' ? null : (
      <div className="-mx-0.5 flex gap-0.5 overflow-x-auto px-0.5 md:justify-center">
        {groupPages.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <PageChip
              key={item.href}
              href={item.href}
              label={item.shortLabel ?? item.label}
              active={active}
            />
          );
        })}
      </div>
    );

  return (
    <AuthGuard allowedRoles={[UserRole.SUPER_ADMIN, UserRole.MANAGER]}>
      <AdminThemeProvider>
        <AppShell
          title="Супер-админ"
          navItems={bottomNavItems}
          wide
          adminChrome
          bottomNavMdOnly
          brandHref="/super-admin"
          desktopTopNav={desktopTopNav}
          mobileSubNav={mobileSubNav}
          headerActions={
            <>
              <StaffMessagesBadge href="/super-admin/messages" />
              <AdminThemeToggle className="hidden md:flex" />
            </>
          }
        >
          <div className="mb-3 space-y-3 sm:mb-4">
            <DataFreshness />
            <BackupStatusBanner />
            <PushBridge />
          </div>
          {children}
        </AppShell>
      </AdminThemeProvider>
    </AuthGuard>
  );
}
