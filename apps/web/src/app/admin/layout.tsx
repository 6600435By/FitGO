'use client';

import { AdminPermission, UserRole } from '@fitgo/shared-types';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { AppShell } from '@/components/app-shell';
import { useFeatures } from '@/components/features-provider';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

const ALL_NAV: Array<{
  href: string;
  label: string;
  permission?: AdminPermission;
  module?: 'messaging' | 'club_admin';
}> = [
  { href: '/admin', label: 'Дашборд', permission: AdminPermission.DASHBOARD_VIEW },
  {
    href: '/admin/pending-crm',
    label: 'Без 1С',
    permission: AdminPermission.CLIENTS_VIEW,
  },
  {
    href: '/admin/notifications',
    label: 'Сообщения',
    permission: AdminPermission.NOTIFICATIONS_SEND,
    module: 'messaging',
  },
  { href: '/admin/at-risk', label: 'Риск', permission: AdminPermission.AT_RISK_VIEW },
  { href: '/admin/funnel', label: 'Воронка', permission: AdminPermission.FUNNEL_VIEW },
  { href: '/admin/reports', label: 'Отчёты', permission: AdminPermission.REPORTS_VIEW },
  { href: '/admin/tasks', label: 'Задачи' },
  {
    href: '/admin/settings',
    label: 'Клуб',
    permission: AdminPermission.SETTINGS_BRANDING,
  },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const { isEnabled } = useFeatures();
  const [navItems, setNavItems] = useState(ALL_NAV);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api
      .adminPermissions(token)
      .then(({ permissions }) => {
        setNavItems(
          ALL_NAV.filter((item) => {
            if (item.module && !isEnabled(item.module)) return false;
            if (item.permission && !permissions.includes(item.permission)) {
              return false;
            }
            return true;
          }),
        );
      })
      .catch(() => setNavItems([{ href: '/admin/tasks', label: 'Задачи' }]));
  }, [isEnabled]);

  return (
    <AuthGuard allowedRoles={[UserRole.ADMIN]}>
      <AppShell title="Панель администратора" navItems={navItems}>
        {children}
      </AppShell>
    </AuthGuard>
  );
}
