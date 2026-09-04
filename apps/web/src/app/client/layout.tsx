'use client';

import { UserRole } from '@fitgo/shared-types';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { AppShell } from '@/components/app-shell';
import { ClientOnboarding } from '@/components/client-onboarding';
import { useFeatures } from '@/components/features-provider';
import { ProfileGate } from '@/components/profile-gate';
import { useClubTheme } from '@/components/club-theme-provider';

const ALL_NAV: Array<{
  href: string;
  label: string;
  matchSubpaths?: boolean;
  module?:
    | 'group_classes'
    | 'engagement'
    | 'messaging'
    | 'club_card';
}> = [
  { href: '/client', label: 'Главная' },
  {
    href: '/client/schedule',
    label: 'Расписание',
    matchSubpaths: true,
    module: 'group_classes',
  },
  { href: '/client/bookings', label: 'Записи', module: 'group_classes' },
  { href: '/client/visits', label: 'Визиты', module: 'club_card' },
  { href: '/client/engagement', label: 'Достижения', module: 'engagement' },
  { href: '/client/notifications', label: 'Сообщения', module: 'messaging' },
  { href: '/client/profile', label: 'Профиль' },
];

export default function ClientLayout({ children }: { children: ReactNode }) {
  const { isEnabled } = useFeatures();
  const theme = useClubTheme();
  const navItems = useMemo(
    () => ALL_NAV.filter((item) => !item.module || isEnabled(item.module)),
    [isEnabled],
  );

  return (
    <AuthGuard allowedRoles={[UserRole.CLIENT]}>
      <AppShell
        title={theme?.clubName ?? 'Мой клуб'}
        headerClub={
          theme?.clubName
            ? {
                name: theme.clubName,
                address: theme.address,
                phone: theme.phone,
                website: theme.website ?? 'https://ffs.by',
              }
            : null
        }
        navItems={navItems}
      >
        <ClientOnboarding />
        <ProfileGate>{children}</ProfileGate>
      </AppShell>
    </AuthGuard>
  );
}
