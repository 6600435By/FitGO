'use client';

import { Suspense } from 'react';
import { AdminMySalesPanel } from '@/components/admin-sales/admin-sales-panels';

export default function AdminMySalesPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-400">Загрузка…</p>}>
      <AdminMySalesPanel />
    </Suspense>
  );
}
