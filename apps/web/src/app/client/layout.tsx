'use client';

import { UserRole } from '@fitgo/shared-types';
import type { ReactNode } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { AppShell } from '@/components/app-shell';
import { ClientOnboarding } from '@/components/client-onboarding';

const NAV = [
  { href: '/client', label: 'Главная' },
  { href: '/client/schedule', label: 'Расписание' },
  { href: '/client/bookings', label: 'Записи' },
  { href: '/client/card', label: 'Карта' },
];

export default function ClientLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard allowedRoles={[UserRole.CLIENT]}>
      <AppShell title="Мой клуб" navItems={NAV}>
        <ClientOnboarding />
        {children}
      </AppShell>
    </AuthGuard>
  );
}
