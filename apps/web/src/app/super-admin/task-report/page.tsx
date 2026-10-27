'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function RedirectInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    q.set('tab', 'stats');
    router.replace(`/super-admin/tasks?${q.toString()}`);
  }, [router, searchParams]);
  return <p className="text-slate-400">Переход к статистике задач…</p>;
}

export default function SuperAdminTaskReportRedirectPage() {
  return (
    <Suspense fallback={<p className="text-slate-400">Загрузка…</p>}>
      <RedirectInner />
    </Suspense>
  );
}
