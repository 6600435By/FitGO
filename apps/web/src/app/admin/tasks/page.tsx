'use client';

import type {
  AdminRenewalCounters,
  AdminTaskItem,
  GroupApprovalPendingTask,
} from '@fitgo/shared-types';
import { AdminTaskStatus } from '@fitgo/shared-types';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { RenewalTaskSheet } from '@/components/admin/renewal-task-sheet';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/utils';

const STAGE_LABEL: Record<string, string> = {
  NEW: 'Новый',
  NO_ANSWER: 'Не дозвонились',
  THINKING: 'Думает',
  WILL_RENEW: 'Продлит',
  RENEWED: 'Продлил',
  LOST: 'Отказ',
};

function AdminTasksInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTopic = searchParams.get('topic');
  const initialTask = searchParams.get('task');

  const [tasks, setTasks] = useState<AdminTaskItem[]>([]);
  const [gpPending, setGpPending] = useState<GroupApprovalPendingTask[]>([]);
  const [counters, setCounters] = useState<AdminRenewalCounters | null>(null);
  const [topic, setTopic] = useState<
    'all' | 'group_approval' | 'staff_debt' | 'client_debt' | 'membership'
  >(
    initialTopic === 'membership' ||
      initialTopic === 'staff_debt' ||
      initialTopic === 'client_debt' ||
      initialTopic === 'group_approval'
      ? initialTopic
      : 'all',
  );
  const [openTaskId, setOpenTaskId] = useState<string | null>(initialTask);

  const load = () => {
    const token = getToken();
    if (!token) return;
    api.adminMyTasks(token).then(setTasks);
    api
      .bookingControlPendingApprovals(token, 'admin')
      .then(setGpPending)
      .catch(() => setGpPending([]));
    api
      .adminRenewalCounters(token)
      .then(setCounters)
      .catch(() => setCounters(null));
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (topic === 'all') params.delete('topic');
    else params.set('topic', topic);
    if (openTaskId) params.set('task', openTaskId);
    else params.delete('task');
    const qs = params.toString();
    router.replace(qs ? `/admin/tasks?${qs}` : '/admin/tasks', { scroll: false });
  }, [topic, openTaskId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    {
      id: 'membership' as const,
      label: `Абонементы${counters ? ` (${counters.callToday})` : ''}`,
    },
  ];
  const visible = tasks.filter(
    (task) =>
      topic === 'all' ||
      (topic !== 'group_approval' && task.topic === topic),
  );
  const showGp = topic === 'all' || topic === 'group_approval';
  const showAssigned = topic !== 'group_approval';
  const membershipTasks = visible.filter(
    (t) => t.source === 'MEMBERSHIP_EXPIRING',
  );
  const otherTasks = visible.filter((t) => t.source !== 'MEMBERSHIP_EXPIRING');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Мои задачи</h2>
        <button
          type="button"
          className="btn-secondary text-xs"
          onClick={() => {
            const token = getToken();
            if (!token) return;
            void api.adminRefreshRenewals(token).then(load);
          }}
        >
          Обновить абонементы
        </button>
      </div>

      {counters && (topic === 'all' || topic === 'membership') ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <div className="card py-3">
            <p className="stat-value text-xl">{counters.callToday}</p>
            <p className="stat-label">К звонку сегодня</p>
          </div>
          <div className="card py-3">
            <p className="stat-value text-xl">{counters.inProgress}</p>
            <p className="stat-label">В работе</p>
          </div>
          <div className="card py-3">
            <p className="stat-value text-xl">{counters.renewed}</p>
            <p className="stat-label">Продлили (мес.)</p>
          </div>
          <div className="card py-3">
            <p className="stat-value text-xl">{counters.lost}</p>
            <p className="stat-label">Отказ (мес.)</p>
          </div>
        </div>
      ) : null}

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

      {showAssigned && membershipTasks.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-amber-200">Продление абонементов</p>
          <ul className="space-y-3">
            {membershipTasks.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  className="card w-full text-left transition hover:border-fitgo-500/40"
                  onClick={() => setOpenTaskId(task.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {task.title.replace(/^Абонемент истекает:\s*/i, '')}
                      </p>
                      <p className="text-sm text-slate-400">
                        {task.membershipName ?? 'Абонемент'}
                        {task.validUntil
                          ? ` · до ${formatDate(task.validUntil)}`
                          : ''}
                        {task.phone ? ` · ${task.phone}` : ''}
                      </p>
                      <p className="mt-1 text-xs text-amber-300/90">
                        {STAGE_LABEL[task.stage ?? 'NEW'] ?? task.stage}
                        {task.assignee
                          ? ` · ${task.assignee.firstName}`
                          : ' · свободна'}
                      </p>
                    </div>
                    <div className="text-right text-sm">
                      {task.daysLeft != null ? (
                        <p className="text-amber-400">{task.daysLeft} дн.</p>
                      ) : null}
                      <p className="text-slate-500">открыть ›</p>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {showAssigned ? (
        otherTasks.length === 0 &&
        membershipTasks.length === 0 &&
        (!showGp || gpPending.length === 0) ? (
          <p className="text-slate-400">Нет назначенных задач</p>
        ) : otherTasks.length === 0 ? null : (
          <ul className="space-y-3">
            {otherTasks.map((task) => (
              <li key={task.id} className="card">
                <p className="font-medium">{task.title}</p>
                {task.source && task.source !== 'MANUAL' ? (
                  <p className="text-xs text-amber-300/90">
                    {task.source === 'STAFF_DEBT'
                      ? 'Автозадача: долг сотрудника'
                      : task.source === 'DEBT_OVERDUE'
                        ? 'Автозадача: долг клиента'
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
                      onClick={() =>
                        updateStatus(task.id, AdminTaskStatus.DONE)
                      }
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

      {openTaskId ? (
        <RenewalTaskSheet
          taskId={openTaskId}
          onClose={() => setOpenTaskId(null)}
          onUpdated={load}
        />
      ) : null}
    </div>
  );
}

export default function AdminTasksPage() {
  return (
    <Suspense fallback={<p className="text-slate-400">Загрузка…</p>}>
      <AdminTasksInner />
    </Suspense>
  );
}
