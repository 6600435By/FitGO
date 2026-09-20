'use client';

import { UserRole } from '@fitgo/shared-types';
import type { ReactNode } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { AppShell } from '@/components/app-shell';

const NAV = [
  { href: '/specialist/schedule', label: 'Расписание' },
];

export default function SpecialistLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard allowedRoles={[UserRole.SPECIALIST]}>
      <AppShell title="Кабинет специалиста" navItems={NAV}>
        {children}
      </AppShell>
    </AuthGuard>
  );
}
