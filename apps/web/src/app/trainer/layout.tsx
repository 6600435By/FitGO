'use client';

import { UserRole } from '@fitgo/shared-types';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import {
  AdminThemeProvider,
  AdminThemeToggle,
} from '@/components/admin/admin-theme';
import { AppShell } from '@/components/app-shell';
import { DataFreshness } from '@/components/data-freshness';
import { useFeatures } from '@/components/features-provider';
import { StaffMessagesBadge } from '@/components/staff/staff-messages-badge';
import { StaffTopNavLinks } from '@/components/staff/staff-top-nav';
import { StaffTasksInbox } from '@/components/staff-tasks-inbox';
import { api, type AuthUser } from '@/lib/api';
import { getToken, getUser, saveAuth } from '@/lib/auth';

type NavItem = {
  href: string;
  label: string;
  exact?: boolean;
  module?: 'trainer_calendar' | 'trainer_crm' | 'messaging';
};

export default function TrainerLayout({ children }: { children: ReactNode }) {
  const { isEnabled } = useFeatures();
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

  const isGp = Boolean(user?.groupPrograms);
  const isPt = Boolean(user?.trainerStaff || user?.trainerClub);
  // Legacy accounts with no flags: show both surfaces.
  const showGp = isGp || (!isGp && !isPt);
  const showPt = isPt || (!isGp && !isPt);
  const gpCabinet = isGp;

  const navItems = useMemo(() => {
    const items: NavItem[] = [];

    if (gpCabinet) {
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
      if (user?.groupPrograms || user?.trainerStaff) {
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
      items.push({ href: '/trainer/my-sessions', label: 'Контроль записей' });
      if (showPt) {
        items.push({
          href: '/trainer/clients',
          label: 'Клиенты',
          module: 'trainer_crm',
        });
      }
      if (user?.groupPrograms || user?.trainerStaff) {
        items.push({ href: '/trainer/payroll', label: 'Расчёт ЗП' });
      }
      items.push(
        { href: '/trainer/messages', label: 'Сообщения', module: 'messaging' },
        { href: '/trainer/profile', label: 'Профиль' },
      );
    }

    return items.filter((item) => !item.module || isEnabled(item.module));
  }, [
    isEnabled,
    gpCabinet,
    showGp,
    showPt,
    user?.groupPrograms,
    user?.trainerStaff,
  ]);

  if (gpCabinet) {
    return (
      <AuthGuard allowedRoles={[UserRole.TRAINER]}>
        <AdminThemeProvider>
          <AppShell
            title="Кабинет тренера"
            navItems={navItems}
            wide
            adminChrome
            hideBottomNav
            desktopTopNav={<StaffTopNavLinks items={navItems} />}
            headerActions={
              <>
                {isEnabled('messaging') ? (
                  <StaffMessagesBadge href="/trainer/messages" />
                ) : null}
                <AdminThemeToggle />
              </>
            }
          >
            <div className="mb-4">
              <DataFreshness canRefresh={false} />
            </div>
            {children}
          </AppShell>
        </AdminThemeProvider>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard allowedRoles={[UserRole.TRAINER]}>
      <AppShell title="Кабинет тренера" navItems={navItems}>
        <div className="mb-4">
          <DataFreshness canRefresh={false} />
        </div>
        <StaffTasksInbox />
        {children}
      </AppShell>
    </AuthGuard>
  );
}
