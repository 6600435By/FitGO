'use client';

import { UserRole } from '@fitgo/shared-types';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { AppShell } from '@/components/app-shell';
import { useFeatures } from '@/components/features-provider';

const ALL_NAV: Array<{
  href: string;
  label: string;
  module?: 'trainer_calendar' | 'trainer_crm' | 'messaging';
}> = [
  { href: '/trainer', label: 'Обзор' },
  { href: '/trainer/schedule', label: 'Расписание', module: 'trainer_calendar' },
  { href: '/trainer/clients', label: 'Клиенты', module: 'trainer_crm' },
  { href: '/trainer/messages', label: 'Сообщения', module: 'messaging' },
];

export default function TrainerLayout({ children }: { children: ReactNode }) {
  const { isEnabled } = useFeatures();
  const navItems = useMemo(
    () => ALL_NAV.filter((item) => !item.module || isEnabled(item.module)),
    [isEnabled],
  );

  return (
    <AuthGuard allowedRoles={[UserRole.TRAINER]}>
      <AppShell title="Кабинет тренера" navItems={navItems}>
        {children}
      </AppShell>
    </AuthGuard>
  );
}
