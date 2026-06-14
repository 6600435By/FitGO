'use client';

import { UserRole } from '@fitgo/shared-types';
import type { ReactNode } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { AppShell } from '@/components/app-shell';
import { ClientOnboarding } from '@/components/client-onboarding';
import { ProfileGate } from '@/components/profile-gate';

const NAV = [
  { href: '/client', label: 'Главная' },
  { href: '/client/schedule', label: 'Расписание', matchSubpaths: true },
  { href: '/client/bookings', label: 'Записи' },
  { href: '/client/engagement', label: 'Достижения' },
  { href: '/client/notifications', label: 'Сообщения' },
  { href: '/client/profile', label: 'Профиль' },
];

export default function ClientLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard allowedRoles={[UserRole.CLIENT]}>
      <AppShell title="Мой клуб" navItems={NAV}>
        <ClientOnboarding />
        <ProfileGate>{children}</ProfileGate>
      </AppShell>
    </AuthGuard>
  );
}
