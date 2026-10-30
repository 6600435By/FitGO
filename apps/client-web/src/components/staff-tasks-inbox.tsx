'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

type StaffTask = Awaited<ReturnType<typeof api.staffTasksMine>>[number];

/** Open tasks from the manager / «Нестыковки» for trainers and specialists. */
export function StaffTasksInbox() {
  const [tasks, setTasks] = useState<StaffTask[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');

  const load = useCallback(() => {
    const token = getToken();
    if (!token) return;
    api
      .staffTasksMine(token)
      .then(setTasks)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const done = async (id: string) => {
    const token = getToken();
    if (!token) return;
    setBusyId(id);
    try {
      await api.staffTaskDone(token, id, drafts[id]?.trim() || undefined);
      load();
    } finally {
      setBusyId('');
    }
  };

  if (!tasks.length) return null;

  return (
    <div className="card mb-4 space-y-3">
      <p className="font-semibold">Задачи ({tasks.length})</p>
      <ul className="space-y-3">
        {tasks.map((t) => (
          <li
            key={t.id}
            className="space-y-2 border-t border-slate-700/50 pt-3 first:border-0 first:pt-0"
          >
            <p className="font-medium">{t.title}</p>
            {t.description ? (
              <p className="whitespace-pre-line text-sm text-slate-400">
                {t.description}
              </p>
            ) : null}
            <p className="text-xs text-slate-500">
              {t.createdBy && !t.auto ? `От: ${t.createdBy}` : 'Автоматически'}
              {t.dueAt ? ` · до ${formatDateTime(t.dueAt)}` : ''}
            </p>
            <div className="flex gap-2">
              <input
                className="input flex-1 text-sm"
                placeholder="Комментарий (необязательно)"
                value={drafts[t.id] ?? ''}
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, [t.id]: e.target.value }))
                }
              />
              <button
                type="button"
                className="btn-primary text-xs"
                disabled={busyId === t.id}
                onClick={() => void done(t.id)}
              >
                Выполнена
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
