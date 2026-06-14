'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

const ALLOWED_WITHOUT_PROFILE = ['/client/profile/complete'];

export function ProfileGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  const checkProfile = useCallback(() => {
    const token = getToken();
    if (!token) {
      setReady(true);
      return;
    }

    if (ALLOWED_WITHOUT_PROFILE.some((p) => pathname.startsWith(p))) {
      setReady(true);
      return;
    }

    setError('');
    api
      .clientProfile(token)
      .then((profile) => {
        if (!profile.profileCompletedAt) {
          router.replace('/client/profile/complete');
        } else {
          setReady(true);
        }
      })
      .catch((err) => {
        setReady(false);
        setError(
          err instanceof Error
            ? err.message
            : 'Не удалось проверить профиль',
        );
      });
  }, [pathname, router]);

  useEffect(() => {
    checkProfile();
  }, [checkProfile]);

  if (error) {
    return (
      <div className="card space-y-3 text-center">
        <p className="text-red-400">{error}</p>
        <button type="button" onClick={checkProfile} className="btn-secondary">
          Повторить
        </button>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
