'use client';

import { UserRole } from '@fitgo/shared-types';
import type { ReactNode } from 'react';
import { AuthGuard } from '@/components/auth-guard';
import { ClientShell } from '@/components/client/client-shell';
import { ClientOnboarding } from '@/components/client-onboarding';
import { PwaInstallTip } from '@/components/client/pwa-install-tip';
import { ProfileGate } from '@/components/profile-gate';
import { PushBridge } from '@/components/push-bridge';

export default function ClientLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard allowedRoles={[UserRole.CLIENT]}>
      <ClientShell>
        <ClientOnboarding />
        <PwaInstallTip />
        <div className="mb-3">
          <PushBridge />
        </div>
        <ProfileGate>{children}</ProfileGate>
      </ClientShell>
    </AuthGuard>
  );
}
