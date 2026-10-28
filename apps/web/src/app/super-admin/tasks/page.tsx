'use client';

import { Suspense } from 'react';
import { ManagerTaskBoard } from '@/components/super-admin/manager-task-board';

export default function SuperAdminTasksPage() {
  return (
    <Suspense fallback={<p className="text-slate-400">Загрузка…</p>}>
      <ManagerTaskBoard />
    </Suspense>
  );
}
