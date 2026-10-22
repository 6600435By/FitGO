'use client';

import { Suspense } from 'react';
import { SelfPayrollView } from '@/components/payroll/self-payroll-view';

export default function SpecialistPayrollPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Загрузка ЗП…</p>}>
      <SelfPayrollView role="specialist" />
    </Suspense>
  );
}
