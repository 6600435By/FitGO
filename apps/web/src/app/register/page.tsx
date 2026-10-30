'use client';

import { useEffect } from 'react';

const CLIENT_WEB =
  process.env.NEXT_PUBLIC_CLIENT_WEB_URL?.replace(/\/$/, '') ||
  'https://lk.ffs.by';

/** Client registration lives on lk.ffs.by */
export default function RegisterRedirectPage() {
  useEffect(() => {
    window.location.replace(`${CLIENT_WEB}/register`);
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-slate-400">
      Переход к регистрации клиентов…
    </div>
  );
}
