'use client';

import { UserRole } from '@fitgo/shared-types';
import type { ReactNode } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { AppShell } from '@/components/app-shell';

const NAV = [
  { href: '/admin', label: 'Дашборд' },
  { href: '/admin/notifications', label: 'Сообщения' },
  { href: '/admin/at-risk', label: 'Риск' },
  { href: '/admin/funnel', label: 'Воронка' },
  { href: '/admin/reports', label: 'Отчёты' },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard allowedRoles={[UserRole.ADMIN]}>
      <AppShell title="Панель администратора" navItems={NAV}>
        {children}
      </AppShell>
    </AuthGuard>
  );
}
