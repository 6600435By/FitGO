'use client';

import {
  AdminPermission,
  UserRole,
  type ProductModuleKey,
} from '@fitgo/shared-types';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import {
  AdminThemeProvider,
  AdminThemeToggle,
} from '@/components/admin/admin-theme';
import { AdminQuickLinks } from '@/components/admin/admin-quick-links';
import { AppShell } from '@/components/app-shell';
import { DataFreshness } from '@/components/data-freshness';
import { useFeatures } from '@/components/features-provider';
import { AppPresenceBridge } from '@/components/app-presence-bridge';
import { PushBridge } from '@/components/push-bridge';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { cn } from '@/lib/utils';

/** Variant B «Секции»: top section chips, bottom = pages of open section. */
type AdminSection = 'today' | 'floor' | 'money' | 'clients';

type AdminNavDef = {
  href: string;
  label: string;
  permission?: AdminPermission;
  anyOf?: AdminPermission[];
  modules?: ProductModuleKey[];
  hidden?: boolean;
  section: AdminSection;
  matchPrefixes?: string[];
};

const SECTIONS: { id: AdminSection; label: string; home: string }[] = [
  { id: 'today', label: 'Сегодня', home: '/admin' },
  { id: 'floor', label: 'Зал', home: '/admin/booking-control' },
  { id: 'money', label: 'Деньги', home: '/admin/sales' },
  { id: 'clients', label: 'Клиенты', home: '/admin/at-risk' },
];

const ALL_NAV: AdminNavDef[] = [
  {
    href: '/admin',
    label: 'Дашборд',
    permission: AdminPermission.DASHBOARD_VIEW,
    modules: ['club_admin'],
    section: 'today',
  },
  {
    href: '/admin/tasks',
    label: 'Задачи',
    modules: ['club_admin'],
    section: 'today',
  },
  {
    href: '/admin/booking-control',
    label: 'Записи',
    permission: AdminPermission.CLIENTS_VIEW,
    modules: ['club_admin'],
    section: 'floor',
  },
  {
    href: '/admin/schedule',
    label: 'Расписание',
    permission: AdminPermission.CLIENTS_VIEW,
    modules: ['club_admin', 'group_classes'],
    section: 'floor',
  },
  {
    href: '/admin/spa',
    label: 'SPA',
    permission: AdminPermission.CLIENTS_VIEW,
    modules: ['club_admin', 'spa_booking'],
    section: 'floor',
  },
  {
    href: '/admin/staff-roster',
    label: 'График смен',
    permission: AdminPermission.CLIENTS_VIEW,
    modules: ['club_admin'],
    section: 'floor',
  },
  {
    href: '/admin/pt-timesheet',
    label: 'Табели ПТ',
    permission: AdminPermission.CLIENTS_VIEW,
    modules: ['club_admin', 'pt_sheet'],
    section: 'floor',
  },
  {
    href: '/admin/sales',
    label: 'Продажи',
    modules: ['club_admin'],
    section: 'money',
  },
  {
    href: '/admin/payroll',
    label: 'Расчёт ЗП',
    modules: ['club_admin'],
    section: 'money',
  },
  {
    href: '/admin/reports',
    label: 'Отчёты',
    permission: AdminPermission.REPORTS_VIEW,
    modules: ['club_admin'],
    section: 'money',
  },
  {
    href: '/admin/at-risk',
    label: 'Риск',
    permission: AdminPermission.AT_RISK_VIEW,
    anyOf: [AdminPermission.CLIENTS_VIEW],
    modules: ['club_admin'],
    section: 'clients',
  },
  {
    href: '/admin/funnel',
    label: 'Воронка',
    permission: AdminPermission.FUNNEL_VIEW,
    modules: ['club_admin'],
    section: 'clients',
  },
  {
    href: '/admin/pending-crm',
    label: 'Без 1С',
    permission: AdminPermission.CLIENTS_VIEW,
    modules: ['club_admin'],
    section: 'clients',
  },
  {
    href: '/admin/notifications',
    label: 'Сообщения',
    permission: AdminPermission.NOTIFICATIONS_SEND,
    modules: ['club_admin', 'messaging'],
    section: 'clients',
  },
  {
    href: '/admin/exceptions',
    label: 'Нестыковки',
    permission: AdminPermission.CLIENTS_VIEW,
    modules: ['club_admin'],
    hidden: true,
    section: 'clients',
  },
];

function allowed(
  item: AdminNavDef,
  permissions: AdminPermission[],
  isEnabled: (m: ProductModuleKey) => boolean,
) {
  if (item.hidden) return false;
  if (item.modules?.some((m) => !isEnabled(m))) return false;
  if (item.permission && !permissions.includes(item.permission)) {
    if (!item.anyOf?.some((p) => permissions.includes(p))) return false;
  }
  return true;
}

function pathMatches(pathname: string, item: AdminNavDef): boolean {
  if (item.matchPrefixes?.length) {
    return item.matchPrefixes.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`),
    );
  }
  if (item.href === '/admin') return pathname === '/admin';
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function sectionHome(section: AdminSection, visible: AdminNavDef[]): string {
  const first = visible.find((item) => item.section === section);
  return first?.href ?? SECTIONS.find((s) => s.id === section)?.home ?? '/admin';
}

function SectionChip({
  href,
  label,
  active,
  compact,
}: {
  href: string;
  label: string;
  active: boolean;
  compact?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'shrink-0 rounded-lg font-medium transition',
        compact ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
        active
          ? 'bg-fitgo-500 text-white'
          : 'border border-slate-700 bg-slate-900/80 text-slate-200 hover:border-slate-600 hover:text-white',
      )}
    >
      {label}
    </Link>
  );
}

function PageLink({
  href,
  label,
  active,
  badge,
}: {
  href: string;
  label: string;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'relative shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium transition',
        active
          ? 'bg-fitgo-500/20 text-fitgo-300'
          : 'text-slate-400 hover:text-white',
      )}
    >
      {label}
      {badge != null && badge > 0 ? (
        <span className="ml-1 inline-flex min-w-[1.1rem] justify-center rounded-full bg-fitgo-500 px-1 text-[9px] font-semibold leading-4 text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </Link>
  );
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { isEnabled, loading: featuresLoading } = useFeatures();
  const [visible, setVisible] = useState<AdminNavDef[]>([]);
  const [taskBadge, setTaskBadge] = useState(0);

  useEffect(() => {
    if (featuresLoading) return;
    const token = getToken();
    if (!token) {
      setVisible([]);
      return;
    }
    api
      .adminPermissions(token)
      .then(({ permissions }) => {
        setVisible(
          ALL_NAV.filter((item) => allowed(item, permissions, isEnabled)),
        );
      })
      .catch(() =>
        setVisible(
          ALL_NAV.filter(
            (item) =>
              item.href === '/admin/tasks' && allowed(item, [], isEnabled),
          ),
        ),
      );

    api
      .adminDashboard(token)
      .then((dash) => {
        setTaskBadge(dash.stats.tasks?.total ?? 0);
      })
      .catch(() => setTaskBadge(0));
  }, [isEnabled, featuresLoading]);

  const activeSection = useMemo((): AdminSection => {
    const hit = visible.find((item) => pathMatches(pathname, item));
    return hit?.section ?? 'today';
  }, [pathname, visible]);

  const sectionTabs = useMemo(
    () =>
      SECTIONS.filter((s) =>
        visible.some((item) => item.section === s.id),
      ).map((s) => ({
        ...s,
        href: sectionHome(s.id, visible),
      })),
    [visible],
  );

  const sectionNav = useMemo(
    () =>
      visible
        .filter((item) => item.section === activeSection)
        .map((item) => ({
          href: item.href,
          label: item.label,
          matchPrefixes: item.matchPrefixes,
          badge: item.href === '/admin/tasks' ? taskBadge : undefined,
        })),
    [visible, activeSection, taskBadge],
  );

  const desktopTopNav = (
    <>
      {sectionTabs.map((tab) => (
        <SectionChip
          key={tab.id}
          href={tab.href}
          label={tab.label}
          active={tab.id === activeSection}
          compact
        />
      ))}
      {sectionTabs.length > 0 && sectionNav.length > 0 ? (
        <span className="mx-1 h-4 w-px shrink-0 bg-slate-700" aria-hidden />
      ) : null}
      {sectionNav.map((item) => {
        const active =
          item.href === '/admin'
            ? pathname === '/admin'
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <PageLink
            key={item.href}
            href={item.href}
            label={item.label}
            active={active}
            badge={item.badge}
          />
        );
      })}
    </>
  );

  const mobileSubNav =
    sectionTabs.length > 0 ? (
      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {sectionTabs.map((tab) => (
          <SectionChip
            key={tab.id}
            href={tab.href}
            label={tab.label}
            active={tab.id === activeSection}
            compact
          />
        ))}
      </div>
    ) : null;

  return (
    <AuthGuard allowedRoles={[UserRole.ADMIN]}>
      <AdminThemeProvider>
        <AppShell
          title="Панель администратора"
          navItems={sectionNav}
          headerActions={
            <>
              <AdminQuickLinks taskCount={taskBadge} />
              <AdminThemeToggle className="hidden md:flex" />
            </>
          }
          wide
          adminChrome
          desktopTopNav={desktopTopNav}
          mobileSubNav={mobileSubNav}
        >
          <div className="mb-4 space-y-3">
            <DataFreshness />
            <PushBridge />
            <AppPresenceBridge />
          </div>
          {children}
        </AppShell>
      </AdminThemeProvider>
    </AuthGuard>
  );
}
