'use client';

import { useEffect } from 'react';

const CLIENT_WEB =
  process.env.NEXT_PUBLIC_CLIENT_WEB_URL?.replace(/\/$/, '') ||
  'https://lk.ffs.by';

/** Staff app hosts /client for legacy bookmarks — send clients to lk.ffs.by. */
export function ClientChannelRedirect() {
  useEffect(() => {
    const path =
      typeof window !== 'undefined'
        ? `${window.location.pathname}${window.location.search}${window.location.hash}`
        : '/client';
    const target = `${CLIENT_WEB}${path.startsWith('/client') ? path : '/client'}`;
    window.location.replace(target);
  }, []);

  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-400">
      Открываем личный кабинет…
    </div>
  );
}
