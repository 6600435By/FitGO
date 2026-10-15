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
import { useFeatures } from '@/components/features-provider';
import { PushBridge } from '@/components/push-bridge';
import { StaffMessagesBadge } from '@/components/staff/staff-messages-badge';
import { StaffTopNavLinks } from '@/components/staff/staff-top-nav';

const PRIMARY_NAV = [
  { href: '/specialist', label: 'Главная', exact: true },
  { href: '/specialist/schedule', label: 'Расписание' },
  { href: '/specialist/my-sessions', label: 'Контроль' },
];

const MORE_NAV = [
  { href: '/specialist/payroll', label: 'ЗП' },
  { href: '/specialist/profile', label: 'Профиль' },
];

export default function SpecialistLayout({ children }: { children: ReactNode }) {
  const { isEnabled } = useFeatures();
  const messaging = isEnabled('messaging');

  const primaryNav = messaging
    ? [...PRIMARY_NAV, { href: '/specialist/messages', label: 'Сообщения' }]
    : PRIMARY_NAV;

  const desktopNav = [
    ...PRIMARY_NAV,
    ...(messaging
      ? [{ href: '/specialist/messages', label: 'Сообщения' }]
      : []),
    ...MORE_NAV,
  ];

  return (
    <AuthGuard allowedRoles={[UserRole.SPECIALIST]}>
      <AdminThemeProvider>
        <AppShell
          title="Кабинет специалиста"
          navItems={primaryNav}
          moreItems={MORE_NAV}
          wide
          adminChrome
          desktopTopNav={<StaffTopNavLinks items={desktopNav} />}
          headerActions={
            <>
              {messaging ? (
                <StaffMessagesBadge href="/specialist/messages" />
              ) : null}
              <AdminThemeToggle />
            </>
          }
        >
          <div className="mb-4 space-y-3">
            <DataFreshness canRefresh={false} />
            <PushBridge />
          </div>
          {children}
        </AppShell>
      </AdminThemeProvider>
    </AuthGuard>
  );
}
