'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

const ALLOWED_WITHOUT_PROFILE = ['/client/profile/complete'];

export function ProfileGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setReady(true);
      return;
    }

    if (ALLOWED_WITHOUT_PROFILE.some((p) => pathname.startsWith(p))) {
      setReady(true);
      return;
    }

    api
      .clientProfile(token)
      .then((profile) => {
        if (!profile.profileCompletedAt) {
          router.replace('/client/profile/complete');
        } else {
          setReady(true);
        }
      })
      .catch(() => setReady(true));
  }, [pathname, router]);

  if (!ready) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
