'use client';

import { Suspense } from 'react';
import { ClubRevenuePanel } from '@/components/admin-sales/club-revenue-panel';

export default function SuperAdminSalesPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Загрузка продаж…</p>}>
      <ClubRevenuePanel />
    </Suspense>
  );
}
