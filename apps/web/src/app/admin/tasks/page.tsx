'use client';

import type { AdminTaskItem } from '@fitgo/shared-types';
import { AdminTaskStatus } from '@fitgo/shared-types';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

export default function AdminTasksPage() {
  const [tasks, setTasks] = useState<AdminTaskItem[]>([]);
  const [topic, setTopic] = useState<'all' | 'staff_debt' | 'client_debt' | 'membership'>('all');

  const load = () => {
    const token = getToken();
    if (!token) return;
    api.adminMyTasks(token).then(setTasks);
  };

  useEffect(() => {
    load();
  }, []);

  const updateStatus = async (id: string, status: AdminTaskStatus) => {
    const token = getToken();
    if (!token) return;
    await api.adminUpdateTask(token, id, status);
    load();
  };

  const filters = [
    { id: 'all' as const, label: 'Все' },
    { id: 'staff_debt' as const, label: 'Долги сотрудников' },
    { id: 'client_debt' as const, label: 'Долги клиентов' },
    { id: 'membership' as const, label: 'Абонементы' },
  ];
  const visible = tasks.filter((task) => topic === 'all' || task.topic === topic);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Мои задачи</h2>
      <div className="flex flex-wrap gap-2">
        {filters.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTopic(item.id)}
            className={topic === item.id ? 'btn-primary text-xs' : 'btn-secondary text-xs'}
          >
            {item.label}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="text-slate-400">Нет назначенных задач</p>
      ) : (
        <ul className="space-y-3">
          {visible.map((task) => (
            <li key={task.id} className="card">
              <p className="font-medium">{task.title}</p>
              {task.source && task.source !== 'MANUAL' ? (
                <p className="text-xs text-amber-300/90">
                  {task.source === 'STAFF_DEBT'
                    ? 'Автозадача: долг сотрудника'
                    : task.source === 'DEBT_OVERDUE'
                      ? 'Автозадача: долг клиента'
                      : task.source === 'MEMBERSHIP_EXPIRING'
                        ? 'Автозадача: абонемент истекает'
                        : task.source}
                </p>
              ) : null}
              {task.description && <p className="text-sm text-slate-400">{task.description}</p>}
              {task.dueAt && <p className="text-xs text-slate-500">До: {formatDateTime(task.dueAt)}</p>}
              {task.status !== AdminTaskStatus.DONE && (
                <div className="mt-3 flex gap-2">
                  <button onClick={() => updateStatus(task.id, AdminTaskStatus.IN_PROGRESS)} className="btn-secondary text-xs flex-1">В работу</button>
                  <button onClick={() => updateStatus(task.id, AdminTaskStatus.DONE)} className="btn-primary text-xs flex-1">Готово</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
