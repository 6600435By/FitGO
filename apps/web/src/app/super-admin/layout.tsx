'use client';

import { UserRole } from '@fitgo/shared-types';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { AppShell } from '@/components/app-shell';
import { getUser } from '@/lib/auth';

const SUPER_ONLY = new Set(['/super-admin/modules', '/super-admin/audit']);

const ALL_NAV = [
  { href: '/super-admin', label: 'Обзор' },
  { href: '/super-admin/analytics', label: 'Аналитика' },
  { href: '/super-admin/modules', label: 'Модули' },
  { href: '/super-admin/club-settings', label: 'Настройки клуба' },
  { href: '/super-admin/staff', label: 'Staff' },
  { href: '/super-admin/schedule', label: 'Расписание' },
  { href: '/super-admin/staff-roster', label: 'График смен' },
  { href: '/super-admin/tasks', label: 'Задачи' },
  { href: '/super-admin/review-queue', label: 'Контроль записей' },
  { href: '/super-admin/exceptions', label: 'Нестыковки' },
  { href: '/super-admin/pt-timesheet', label: 'Табели ПТ' },
  { href: '/super-admin/payroll', label: 'ЗП' },
  { href: '/super-admin/sales', label: 'Продажи' },
  { href: '/super-admin/debts', label: 'Услуги специалистов' },
  { href: '/super-admin/spa-catalog', label: 'Каталог SPA' },
  { href: '/super-admin/audit', label: 'Журнал' },
];

export default function SuperAdminLayout({ children }: { children: ReactNode }) {
  const navItems = useMemo(() => {
    const user = getUser();
    const isSuper = user?.roles.includes(UserRole.SUPER_ADMIN);
    if (isSuper) return ALL_NAV;
    return ALL_NAV.filter((item) => !SUPER_ONLY.has(item.href));
  }, []);

  return (
    <AuthGuard allowedRoles={[UserRole.SUPER_ADMIN, UserRole.MANAGER]}>
      <AppShell title="Супер-админ" navItems={navItems} wide>
        {children}
      </AppShell>
    </AuthGuard>
  );
}
