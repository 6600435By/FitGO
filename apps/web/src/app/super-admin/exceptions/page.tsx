'use client';

import { Suspense } from 'react';
import { DiscrepanciesWorkspace } from '@/components/discrepancies/discrepancies-workspace';

export default function SuperAdminExceptionsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Загрузка…</p>}>
      <DiscrepanciesWorkspace />
    </Suspense>
  );
}
