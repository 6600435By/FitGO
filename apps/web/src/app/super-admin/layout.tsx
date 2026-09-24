'use client';

import { UserRole } from '@fitgo/shared-types';
import type { ReactNode } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { AppShell } from '@/components/app-shell';

const NAV = [
  { href: '/super-admin', label: 'Обзор' },
  { href: '/super-admin/analytics', label: 'Аналитика' },
  { href: '/super-admin/modules', label: 'Модули' },
  { href: '/super-admin/club-settings', label: 'Настройки клуба' },
  { href: '/super-admin/staff', label: 'Staff' },
  { href: '/super-admin/staff-roster', label: 'График' },
  { href: '/super-admin/tasks', label: 'Задачи' },
  { href: '/super-admin/review-queue', label: 'Контроль записей' },
  { href: '/super-admin/exceptions', label: 'Нестыковки' },
  { href: '/super-admin/pt-timesheet', label: 'Табели ПТ' },
  { href: '/super-admin/payroll', label: 'ЗП' },
  { href: '/super-admin/sales', label: 'Продажи' },
  { href: '/super-admin/debts', label: 'Услуги специалистов' },
  { href: '/super-admin/audit', label: 'Журнал' },
];

export default function SuperAdminLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard allowedRoles={[UserRole.SUPER_ADMIN]}>
      <AppShell title="Супер-админ" navItems={NAV} wide>
        {children}
      </AppShell>
    </AuthGuard>
  );
}
