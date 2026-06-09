'use client';

import { UserRole } from '@fitgo/shared-types';
import type { ReactNode } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { AppShell } from '@/components/app-shell';

const NAV = [
  { href: '/trainer', label: 'Обзор' },
  { href: '/trainer/schedule', label: 'Расписание' },
  { href: '/trainer/clients', label: 'Клиенты' },
];

export default function TrainerLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard allowedRoles={[UserRole.TRAINER]}>
      <AppShell title="Кабинет тренера" navItems={NAV}>
        {children}
      </AppShell>
    </AuthGuard>
  );
}
