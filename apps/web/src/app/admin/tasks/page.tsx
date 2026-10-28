'use client';

import { Suspense } from 'react';
import { TaskInbox } from '@/components/admin/tasks/task-inbox';

export default function AdminTasksPage() {
  return (
    <Suspense fallback={<p className="text-slate-400">Загрузка…</p>}>
      <TaskInbox />
    </Suspense>
  );
}
