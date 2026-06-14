'use client';

import { UserRole } from '@fitgo/shared-types';
import type { ReactNode } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { AppShell } from '@/components/app-shell';

const NAV = [
  { href: '/super-admin', label: 'Обзор' },
  { href: '/super-admin/analytics', label: 'Аналитика' },
  { href: '/super-admin/staff', label: 'Staff' },
  { href: '/super-admin/tasks', label: 'Задачи' },
  { href: '/super-admin/audit', label: 'Журнал' },
];

export default function SuperAdminLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard allowedRoles={[UserRole.SUPER_ADMIN]}>
      <AppShell title="Супер-админ" navItems={NAV}>
        {children}
      </AppShell>
    </AuthGuard>
  );
}
