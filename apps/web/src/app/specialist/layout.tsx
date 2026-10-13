'use client';

import { UserRole } from '@fitgo/shared-types';
import type { ReactNode } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import {
  AdminThemeProvider,
  AdminThemeToggle,
} from '@/components/admin/admin-theme';
import { AppShell } from '@/components/app-shell';
import { DataFreshness } from '@/components/data-freshness';
import { StaffTopNavLinks } from '@/components/staff/staff-top-nav';

const NAV = [
  { href: '/specialist', label: 'Главная', exact: true },
  { href: '/specialist/schedule', label: 'Расписание' },
  { href: '/specialist/my-sessions', label: 'Контроль' },
  { href: '/specialist/payroll', label: 'ЗП' },
  { href: '/specialist/profile', label: 'Профиль' },
];

export default function SpecialistLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard allowedRoles={[UserRole.SPECIALIST]}>
      <AdminThemeProvider>
        <AppShell
          title="Кабинет специалиста"
          navItems={NAV}
          wide
          adminChrome
          hideBottomNav
          desktopTopNav={<StaffTopNavLinks items={NAV} />}
          headerActions={<AdminThemeToggle />}
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
