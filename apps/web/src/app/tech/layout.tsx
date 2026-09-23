'use client';

import { UserRole } from '@fitgo/shared-types';
import { AuthGuard } from '@/components/auth-guard';

export default function TechLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuthGuard allowedRoles={[UserRole.TECH]}>{children}</AuthGuard>;
}
