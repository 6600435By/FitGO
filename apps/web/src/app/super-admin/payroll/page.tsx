'use client';

import { Suspense } from 'react';
import { PayrollWorkspace } from '@/components/payroll/payroll-workspace';

export default function SuperAdminPayrollPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Загрузка ЗП…</p>}>
      <PayrollWorkspace mode="super" />
    </Suspense>
  );
}
