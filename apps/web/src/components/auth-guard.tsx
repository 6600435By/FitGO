'use client';

import { UserRole } from '@fitgo/shared-types';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { getHomePath, getToken, getUser } from '@/lib/auth';

interface AuthGuardProps {
  children: ReactNode;
  allowedRoles: UserRole[];
}

export function AuthGuard({ children, allowedRoles }: AuthGuardProps) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = getToken();
    const user = getUser();

    if (!token || !user) {
      router.replace('/login');
      return;
    }

    const hasRole = allowedRoles.some((role) => user.roles.includes(role));
    if (!hasRole) {
      router.replace(getHomePath(user.roles));
      return;
    }

    setReady(true);
  }, [allowedRoles, router]);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
