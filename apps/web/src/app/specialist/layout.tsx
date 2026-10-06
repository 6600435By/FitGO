'use client';

import { UserRole } from '@fitgo/shared-types';
import type { ReactNode } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { AppShell } from '@/components/app-shell';
import { DataFreshness } from '@/components/data-freshness';

const NAV = [
  { href: '/specialist/schedule', label: 'Расписание' },
  { href: '/specialist/my-sessions', label: 'Контроль записей' },
  { href: '/specialist/payroll', label: 'Расчёт ЗП' },
  { href: '/specialist/profile', label: 'Профиль' },
];

export default function SpecialistLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard allowedRoles={[UserRole.SPECIALIST]}>
      <AppShell title="Кабинет специалиста" navItems={NAV} wide>
        <div className="mb-4">
          <DataFreshness canRefresh={false} />
        </div>
        {children}
      </AppShell>
    </AuthGuard>
  );
}
