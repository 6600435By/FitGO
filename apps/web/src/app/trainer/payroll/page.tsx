'use client';

import { Skeleton } from '@fitgo/forma-ui';
import { Suspense } from 'react';
import { SelfPayrollView } from '@/components/payroll/self-payroll-view';
import { useTrainerUiV2 } from '@/components/trainer-shell/trainer-ui-v2';

export default function TrainerPayrollPage() {
  const forma = useTrainerUiV2();
  return (
    <Suspense
      fallback={
        forma ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-48 w-full rounded-3xl" />
          </div>
        ) : (
          <p className="text-sm text-slate-400">Загрузка ЗП…</p>
        )
      }
    >
      <SelfPayrollView role="trainer" formaSkin={forma} />
    </Suspense>
  );
}
