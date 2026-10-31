'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { getHomePath, getToken, getUser } from '@/lib/auth';
import { hasSeenWelcome } from '@/lib/welcome';

export default function HomePage() {
  const router = useRouter();

  useEffect(() => {
    const token = getToken();
    const user = getUser();
    if (token && user) {
      router.replace(
        getHomePath(user.roles, {
          groupPrograms: user.groupPrograms,
          trainerStaff: user.trainerStaff,
          trainerClub: user.trainerClub,
        }),
      );
      return;
    }
    if (!hasSeenWelcome()) {
      router.replace('/welcome');
      return;
    }
    router.replace('/login');
  }, [router]);

  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-forma-500 border-t-transparent" />
    </div>
  );
}
