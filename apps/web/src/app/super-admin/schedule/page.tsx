'use client';

import { Suspense } from 'react';
import { ClubSchedulePage } from '@/components/club-schedule/club-schedule-page';

export default function SuperAdminSchedulePage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Загрузка…</p>}>
      <ClubSchedulePage apiBase="super-admin" />
    </Suspense>
  );
}
