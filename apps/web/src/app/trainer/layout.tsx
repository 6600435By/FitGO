'use client';

import { UserRole } from '@fitgo/shared-types';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AuthGuard } from '@/components/auth-guard';
import {
  AdminThemeProvider,
  AdminThemeToggle,
} from '@/components/admin/admin-theme';
import { AppShell } from '@/components/app-shell';
import { DataFreshness } from '@/components/data-freshness';
import { useFeatures } from '@/components/features-provider';
import { AppPresenceBridge } from '@/components/app-presence-bridge';
import { PushBridge } from '@/components/push-bridge';
import { StaffMessagesBadge } from '@/components/staff/staff-messages-badge';
import { StaffTopNavLinks } from '@/components/staff/staff-top-nav';
import { StaffTasksInbox } from '@/components/staff-tasks-inbox';
import { api, type AuthUser } from '@/lib/api';
import { getToken, getUser, saveAuth } from '@/lib/auth';
import {
  isTrainerPtOnlyPath,
  trainerCabinetMode,
} from '@/lib/trainer-cabinet';

type NavItem = {
  href: string;
  label: string;
  exact?: boolean;
  module?: 'trainer_calendar' | 'trainer_crm' | 'messaging';
};

const MOBILE_PRIMARY_MAX = 4;

function splitMobileNav(items: NavItem[]): {
  primary: NavItem[];
  more: NavItem[];
} {
  if (items.length <= MOBILE_PRIMARY_MAX) {
    return { primary: items, more: [] };
  }
  // Prefer: home, main schedule, control, messages in the bar when present.
  const preferred = [
    '/trainer',
    '/trainer/gp-schedule',
    '/trainer/my-sessions',
    '/trainer/messages',
    '/trainer/schedule',
  ];
  const primary: NavItem[] = [];
  const rest: NavItem[] = [];
  for (const href of preferred) {
    const hit = items.find((i) => i.href === href);
    if (hit && primary.length < MOBILE_PRIMARY_MAX && !primary.includes(hit)) {
      primary.push(hit);
    }
  }
  for (const item of items) {
    if (!primary.includes(item)) rest.push(item);
  }
  while (primary.length < MOBILE_PRIMARY_MAX && rest.length > 0) {
    primary.push(rest.shift()!);
  }
  return { primary, more: rest };
}

export default function TrainerLayout({ children }: { children: ReactNode }) {
  const { isEnabled } = useFeatures();
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(() => getUser());

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
    return () => {
      cancelled = true;
    };
  }, []);

  const cabinet = useMemo(() => trainerCabinetMode(user), [user]);
  const { groupCabinet, showGp, showPt, showPayroll } = cabinet;

  useEffect(() => {
    if (!user) return;
    if (groupCabinet && !showPt && isTrainerPtOnlyPath(pathname)) {
      router.replace('/trainer');
    }
  }, [user, groupCabinet, showPt, pathname, router]);

  const allNavItems = useMemo(() => {
    const items: NavItem[] = [];

    if (groupCabinet) {
      items.push(
        { href: '/trainer', label: 'Главная', exact: true },
        { href: '/trainer/gp-schedule', label: 'Расписание' },
        { href: '/trainer/my-sessions', label: 'Контроль' },
      );
      if (showPt) {
        items.push(
          {
            href: '/trainer/schedule',
            label: 'Расписание ПТ',
            module: 'trainer_calendar',
          },
          { href: '/trainer/pt-timesheet', label: 'Табель ПТ' },
          {
            href: '/trainer/clients',
            label: 'Клиенты',
            module: 'trainer_crm',
          },
        );
      }
      if (showPayroll) {
        items.push({ href: '/trainer/payroll', label: 'ЗП' });
      }
      items.push(
        { href: '/trainer/messages', label: 'Сообщения', module: 'messaging' },
        { href: '/trainer/profile', label: 'Профиль' },
      );
    } else {
      // PT-only / legacy (no flags): previous surface.
      items.push({ href: '/trainer', label: 'Обзор', exact: true });
      if (showGp) {
        items.push({
          href: '/trainer/gp-schedule',
          label: showPt ? 'Расписание ГП' : 'Мое расписание',
        });
      }
      if (showPt) {
        items.push({
          href: '/trainer/schedule',
          label: showGp ? 'Расписание ПТ' : 'Мое расписание',
          module: 'trainer_calendar',
        });
      }
      items.push({ href: '/trainer/shifts', label: 'Смены' });
      if (showPt) {
        items.push({ href: '/trainer/pt-timesheet', label: 'Табель ПТ' });
      }
      if (showGp) {
        items.push({ href: '/trainer/group-journal', label: 'Журнал групп' });
      }
      items.push({ href: '/trainer/my-sessions', label: 'Контроль' });
      if (showPt) {
        items.push({
          href: '/trainer/clients',
          label: 'Клиенты',
          module: 'trainer_crm',
        });
      }
      if (showPayroll) {
        items.push({ href: '/trainer/payroll', label: 'ЗП' });
      }
      items.push(
        { href: '/trainer/messages', label: 'Сообщения', module: 'messaging' },
        { href: '/trainer/profile', label: 'Профиль' },
      );
    }

    return items.filter((item) => !item.module || isEnabled(item.module));
  }, [isEnabled, groupCabinet, showGp, showPt, showPayroll]);

  const { primary, more } = useMemo(
    () => splitMobileNav(allNavItems),
    [allNavItems],
  );

  if (groupCabinet) {
    return (
      <AuthGuard allowedRoles={[UserRole.TRAINER]}>
        <AdminThemeProvider>
          <AppShell
            title="Кабинет тренера"
            navItems={primary}
            moreItems={more.length > 0 ? more : undefined}
            wide
            adminChrome
            desktopTopNav={<StaffTopNavLinks items={allNavItems} />}
            headerActions={
              <>
                {isEnabled('messaging') ? (
                  <StaffMessagesBadge href="/trainer/messages" />
                ) : null}
                <AdminThemeToggle />
              </>
            }
          >
            <div className="mb-4 space-y-3">
              <DataFreshness canRefresh={false} />
              <PushBridge />
              <AppPresenceBridge />
            </div>
            {children}
          </AppShell>
        </AdminThemeProvider>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard allowedRoles={[UserRole.TRAINER]}>
      <AppShell
        title="Кабинет тренера"
        navItems={primary}
        moreItems={more.length > 0 ? more : undefined}
      >
        <div className="mb-4 space-y-3">
          <DataFreshness canRefresh={false} />
          <PushBridge />
          <AppPresenceBridge />
        </div>
        <StaffTasksInbox />
        {children}
      </AppShell>
    </AuthGuard>
  );
}
