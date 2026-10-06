'use client';

import { UserRole } from '@fitgo/shared-types';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { AppShell } from '@/components/app-shell';
import { DataFreshness } from '@/components/data-freshness';
import { useFeatures } from '@/components/features-provider';
import { getUser } from '@/lib/auth';

type NavItem = {
  href: string;
  label: string;
  module?: 'trainer_calendar' | 'trainer_crm' | 'messaging';
  when?: 'gp' | 'pt' | 'always';
};

export default function TrainerLayout({ children }: { children: ReactNode }) {
  const { isEnabled } = useFeatures();
  const user = getUser();
  const isGp = Boolean(user?.groupPrograms);
  const isPt = Boolean(user?.trainerStaff || user?.trainerClub);
  // Legacy accounts with no flags: show both surfaces.
  const showGp = isGp || (!isGp && !isPt);
  const showPt = isPt || (!isGp && !isPt);

  const navItems = useMemo(() => {
    const items: NavItem[] = [
      { href: '/trainer', label: 'Обзор', when: 'always' },
    ];
    if (showGp) {
      items.push({
        href: '/trainer/gp-schedule',
        label: showPt ? 'Расписание ГП' : 'Мое расписание',
        when: 'gp',
      });
    }
    if (showPt) {
      items.push({
        href: '/trainer/schedule',
        label: showGp ? 'Расписание ПТ' : 'Мое расписание',
        module: 'trainer_calendar',
        when: 'pt',
      });
    }
    items.push(
      { href: '/trainer/shifts', label: 'Смены', when: 'always' },
      ...(showPt
        ? [{ href: '/trainer/pt-timesheet', label: 'Табель ПТ', when: 'pt' as const }]
        : []),
      ...(showGp
        ? [
            {
              href: '/trainer/group-journal',
              label: 'Журнал групп',
              when: 'gp' as const,
            },
          ]
        : []),
      {
        href: '/trainer/my-sessions',
        label: 'Контроль записей',
        when: 'always',
      },
      ...(showPt
        ? [
            {
              href: '/trainer/clients',
              label: 'Клиенты',
              module: 'trainer_crm' as const,
              when: 'pt' as const,
            },
          ]
        : []),
      ...((user?.groupPrograms || user?.trainerStaff)
        ? [{ href: '/trainer/payroll', label: 'Расчёт ЗП', when: 'always' as const }]
        : []),
      {
        href: '/trainer/messages',
        label: 'Сообщения',
        module: 'messaging',
        when: 'always',
      },
      { href: '/trainer/profile', label: 'Профиль', when: 'always' },
    );

    return items.filter((item) => !item.module || isEnabled(item.module));
  }, [
    isEnabled,
    showGp,
    showPt,
    user?.groupPrograms,
    user?.trainerStaff,
  ]);

  return (
    <AuthGuard allowedRoles={[UserRole.TRAINER]}>
      <AppShell title="Кабинет тренера" navItems={navItems}>
        <div className="mb-4">
          <DataFreshness canRefresh={false} />
        </div>
        {children}
      </AppShell>
    </AuthGuard>
  );
}
