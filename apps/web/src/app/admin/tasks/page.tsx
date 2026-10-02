'use client';

import type {
  AdminTaskItem,
  GroupApprovalPendingTask,
} from '@fitgo/shared-types';
import { AdminTaskStatus } from '@fitgo/shared-types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

export default function AdminTasksPage() {
  const [tasks, setTasks] = useState<AdminTaskItem[]>([]);
  const [gpPending, setGpPending] = useState<GroupApprovalPendingTask[]>([]);
  const [topic, setTopic] = useState<
    'all' | 'group_approval' | 'staff_debt' | 'client_debt' | 'membership'
  >('all');

  const load = () => {
    const token = getToken();
    if (!token) return;
    api.adminMyTasks(token).then(setTasks);
    api
      .bookingControlPendingApprovals(token, 'admin')
      .then(setGpPending)
      .catch(() => setGpPending([]));
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
    { id: 'group_approval' as const, label: `ГП (${gpPending.length})` },
    { id: 'staff_debt' as const, label: 'Долги сотрудников' },
    { id: 'client_debt' as const, label: 'Долги клиентов' },
    { id: 'membership' as const, label: 'Абонементы' },
  ];
  const visible = tasks.filter(
    (task) =>
      topic === 'all' ||
      (topic !== 'group_approval' && task.topic === topic),
  );
  const showGp =
    topic === 'all' || topic === 'group_approval';
  const showAssigned = topic !== 'group_approval';

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Мои задачи</h2>
      <div className="flex flex-wrap gap-2">
        {filters.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTopic(item.id)}
            className={
              topic === item.id ? 'btn-primary text-xs' : 'btn-secondary text-xs'
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      {showGp && gpPending.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-amber-200">
            ГП ждёт подтверждения администратора (общая очередь)
          </p>
          <ul className="space-y-3">
            {gpPending.map((item) => (
              <li key={item.sessionKey} className="card">
                <p className="font-medium">{item.title}</p>
                <p className="text-xs text-amber-300/90">
                  Проверено тренером
                  {item.trainerName ? `: ${item.trainerName}` : ''}
                </p>
                <p className="text-sm text-slate-400">
                  {formatDateTime(item.startAt)}
                  {item.performerName ? ` · ${item.performerName}` : ''}
                  {item.roomTitle ? ` · ${item.roomTitle}` : ''}
                </p>
                <p className="text-xs text-slate-500">
                  Тренер отметил {item.trainerSeenCount} · в 1С прибыло{' '}
                  {item.arrivedCount} · записано {item.bookedCount}
                </p>
                <div className="mt-3">
                  <Link
                    href={`/admin/booking-control?sessionKey=${encodeURIComponent(item.sessionKey)}`}
                    className="btn-primary inline-flex text-xs"
                  >
                    Открыть карточку
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {showGp && gpPending.length === 0 && topic === 'group_approval' ? (
        <p className="text-slate-400">Нет ГП на подтверждении</p>
      ) : null}

      {showAssigned ? (
        visible.length === 0 && (!showGp || gpPending.length === 0) ? (
          <p className="text-slate-400">Нет назначенных задач</p>
        ) : visible.length === 0 ? null : (
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
                {task.description && (
                  <p className="text-sm text-slate-400">{task.description}</p>
                )}
                {task.dueAt && (
                  <p className="text-xs text-slate-500">
                    До: {formatDateTime(task.dueAt)}
                  </p>
                )}
                {task.status !== AdminTaskStatus.DONE && (
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() =>
                        updateStatus(task.id, AdminTaskStatus.IN_PROGRESS)
                      }
                      className="btn-secondary text-xs flex-1"
                    >
                      В работу
                    </button>
                    <button
                      onClick={() => updateStatus(task.id, AdminTaskStatus.DONE)}
                      className="btn-primary text-xs flex-1"
                    >
                      Готово
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
