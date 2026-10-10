'use client';

import type {
  AdminDebtLine,
  AdminRenewalCounters,
  AdminTaskItem,
  GroupApprovalPendingTask,
} from '@fitgo/shared-types';
import { AdminTaskStatus } from '@fitgo/shared-types';
import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
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

type Topic =
  | 'today'
  | 'manager'
  | 'client_debt'
  | 'staff_debt'
  | 'installment'
  | 'membership'
  | 'group_approval'
  | 'spa_approval'
  | 'pt_approval';

function isDueTodayOrOverdue(task: AdminTaskItem): boolean {
  if (task.status === AdminTaskStatus.DONE || task.status === AdminTaskStatus.CANCELLED) {
    return false;
  }
  const now = Date.now();
  const ref = task.nextActionAt ?? task.dueAt;
  if (!ref) return true;
  return new Date(ref).getTime() <= now + 24 * 60 * 60 * 1000;
}

function AdminTasksInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialTopic = searchParams.get('topic');
  const initialTask = searchParams.get('task');

  const [tasks, setTasks] = useState<AdminTaskItem[]>([]);
  const [gpPending, setGpPending] = useState<GroupApprovalPendingTask[]>([]);
  const [spaPending, setSpaPending] = useState<GroupApprovalPendingTask[]>([]);
  const [ptPending, setPtPending] = useState<GroupApprovalPendingTask[]>([]);
  const [counters, setCounters] = useState<AdminRenewalCounters | null>(null);
  const [topic, setTopic] = useState<Topic>(
    initialTopic === 'membership' ||
      initialTopic === 'staff_debt' ||
      initialTopic === 'client_debt' ||
      initialTopic === 'group_approval' ||
      initialTopic === 'spa_approval' ||
      initialTopic === 'pt_approval' ||
      initialTopic === 'installment' ||
      initialTopic === 'manager' ||
      initialTopic === 'today'
      ? (initialTopic as Topic)
      : 'today',
  );
  const [openTaskId, setOpenTaskId] = useState<string | null>(initialTask);
  const [expandedDebtId, setExpandedDebtId] = useState<string | null>(null);
  const [debtLines, setDebtLines] = useState<Record<string, AdminDebtLine[]>>({});
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});

  const load = () => {
    const token = getToken();
    if (!token) return;
    api.adminMyTasks(token).then(setTasks);
    api
      .bookingControlPendingApprovals(token, 'admin', { kind: 'GROUP' })
      .then(setGpPending)
      .catch(() => setGpPending([]));
    api
      .bookingControlPendingApprovals(token, 'admin', { kind: 'SPA' })
      .then(setSpaPending)
      .catch(() => setSpaPending([]));
    api
      .bookingControlPendingApprovals(token, 'admin', { kind: 'PT' })
      .then(setPtPending)
      .catch(() => setPtPending([]));
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
    if (topic === 'today') params.delete('topic');
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

  const claim = async (id: string) => {
    const token = getToken();
    if (!token) return;
    await api.adminClaimTask(token, id);
    load();
  };

  const snooze = async (id: string, days: number) => {
    const token = getToken();
    if (!token) return;
    await api.adminSnoozeTask(token, id, days);
    load();
  };

  const comment = async (id: string) => {
    const token = getToken();
    const text = commentDraft[id]?.trim();
    if (!token || !text) return;
    await api.adminTaskComment(token, id, text);
    setCommentDraft((prev) => ({ ...prev, [id]: '' }));
    load();
  };

  const toggleDebt = async (id: string) => {
    if (expandedDebtId === id) {
      setExpandedDebtId(null);
      return;
    }
    setExpandedDebtId(id);
    if (debtLines[id]) return;
    const token = getToken();
    if (!token) return;
    try {
      const lines = await api.adminDebtLines(token, id);
      setDebtLines((prev) => ({ ...prev, [id]: lines }));
    } catch {
      setDebtLines((prev) => ({ ...prev, [id]: [] }));
    }
  };

  const managerTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.source === 'MANAGER' &&
          t.status !== AdminTaskStatus.DONE &&
          t.status !== AdminTaskStatus.CANCELLED,
      ),
    [tasks],
  );
  const clientDebt = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.topic === 'client_debt' &&
          t.status !== AdminTaskStatus.DONE &&
          t.status !== AdminTaskStatus.CANCELLED,
      ),
    [tasks],
  );
  const staffDebt = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.topic === 'staff_debt' &&
          t.status !== AdminTaskStatus.DONE &&
          t.status !== AdminTaskStatus.CANCELLED,
      ),
    [tasks],
  );
  const installmentTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.source === 'INSTALLMENT_PAYMENT' &&
          t.status !== AdminTaskStatus.DONE &&
          t.status !== AdminTaskStatus.CANCELLED &&
          isDueTodayOrOverdue(t),
      ),
    [tasks],
  );
  const membershipTasks = useMemo(
    () => tasks.filter((t) => t.source === 'MEMBERSHIP_EXPIRING'),
    [tasks],
  );

  const counts = {
    manager: managerTasks.filter(isDueTodayOrOverdue).length,
    client_debt: clientDebt.length,
    staff_debt: staffDebt.length,
    installment: installmentTasks.length,
    membership: counters?.callToday ?? membershipTasks.filter(isDueTodayOrOverdue).length,
    group_approval: gpPending.length,
    spa_approval: spaPending.length,
    pt_approval: ptPending.length,
  };

  const filters: { id: Topic; label: string; count?: number }[] = [
    { id: 'today', label: 'Сегодня' },
    { id: 'manager', label: 'От руководителя', count: counts.manager },
    { id: 'client_debt', label: 'Долги клиентов', count: counts.client_debt },
    { id: 'staff_debt', label: 'Долги сотрудников', count: counts.staff_debt },
    { id: 'installment', label: 'Рассрочки', count: counts.installment },
    { id: 'membership', label: 'Абонементы', count: counts.membership },
    { id: 'group_approval', label: 'ГП', count: counts.group_approval },
    { id: 'spa_approval', label: 'SPA', count: counts.spa_approval },
    { id: 'pt_approval', label: 'ПТ', count: counts.pt_approval },
  ];

  const renderPendingQueue = (
    items: GroupApprovalPendingTask[],
    emptyLabel: string,
    kindLabel: string,
  ) => {
    if (items.length === 0) {
      return <p className="text-slate-400">{emptyLabel}</p>;
    }
    return (
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.sessionKey} className="card">
            <p className="font-medium">{item.title}</p>
            <p className="text-xs text-amber-300/90">
              {item.reason === 'UNPAID'
                ? 'Не оплачена'
                : `${kindLabel} ждёт подтверждения`}
              {item.trainerName ? `: ${item.trainerName}` : ''}
            </p>
            <p className="text-sm text-slate-400">
              {formatDateTime(item.startAt)}
              {item.performerName ? ` · ${item.performerName}` : ''}
              {item.clientName ? ` · ${item.clientName}` : ''}
              {item.roomTitle ? ` · ${item.roomTitle}` : ''}
            </p>
            {item.kind === 'GROUP' ? (
              <p className="text-xs text-slate-500">
                Тренер отметил {item.trainerSeenCount} · в 1С прибыло{' '}
                {item.arrivedCount} · записано {item.bookedCount}
              </p>
            ) : null}
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
    );
  };

  const renderDebtList = (list: AdminTaskItem[], empty: string) => {
    if (list.length === 0) return <p className="text-slate-400">{empty}</p>;
    return (
      <ul className="space-y-3">
        {list.map((task) => (
          <li key={task.id} className="card space-y-2">
            <button
              type="button"
              className="w-full text-left"
              onClick={() => void toggleDebt(task.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {task.title.replace(/^Долг (клиента|сотрудника):\s*/i, '')}
                  </p>
                  <p className="text-sm text-slate-400">
                    {(task.debtTotal ?? 0).toFixed(2)} BYN
                    {task.debtCount != null ? ` · ${task.debtCount} продаж` : ''}
                    {task.sellers?.length
                      ? ` · ${task.sellers.slice(0, 2).join(', ')}`
                      : ''}
                  </p>
                </div>
                <div className="text-right text-sm">
                  {task.debtAgeDays != null && task.debtAgeDays > 7 ? (
                    <p className="text-amber-400">&gt; {task.debtAgeDays} дн.</p>
                  ) : task.debtAgeDays != null ? (
                    <p className="text-slate-500">{task.debtAgeDays} дн.</p>
                  ) : null}
                  <p className="text-slate-500">
                    {expandedDebtId === task.id ? 'свернуть' : 'детали ›'}
                  </p>
                </div>
              </div>
            </button>
            {expandedDebtId === task.id ? (
              <div className="space-y-2 border-t border-slate-700/50 pt-2">
                {(debtLines[task.id] ?? []).length === 0 ? (
                  <p className="text-xs text-slate-500">Нет строк или загрузка…</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {(debtLines[task.id] ?? []).map((line) => (
                      <li key={line.id} className="flex justify-between gap-2 text-slate-300">
                        <span>
                          {formatDate(line.soldAt)} · {line.productName}
                          {line.employeeName ? (
                            <span className="text-slate-500"> · {line.employeeName}</span>
                          ) : null}
                        </span>
                        <span>{line.amount.toFixed(2)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => void claim(task.id)}
                  >
                    Взять себе
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => void snooze(task.id, 3)}
                  >
                    Через 3 дн.
                  </button>
                  <button
                    type="button"
                    className="btn-primary text-xs"
                    onClick={() => void updateStatus(task.id, AdminTaskStatus.DONE)}
                  >
                    Готово
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    className="input flex-1 text-sm"
                    placeholder="Комментарий / позвонил…"
                    value={commentDraft[task.id] ?? ''}
                    onChange={(e) =>
                      setCommentDraft((prev) => ({
                        ...prev,
                        [task.id]: e.target.value,
                      }))
                    }
                  />
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => void comment(task.id)}
                  >
                    Записать
                  </button>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    );
  };

  const renderInstallments = () => {
    if (installmentTasks.length === 0) {
      return <p className="text-slate-400">Нет платежей по рассрочке на сегодня</p>;
    }
    return (
      <ul className="space-y-3">
        {installmentTasks.map((task) => (
          <li key={task.id} className="card space-y-2">
            <p className="font-medium">
              {task.title.replace(/^Рассрочка:\s*/i, '')}
            </p>
            <p className="text-sm text-slate-400">
              {task.templateName ?? 'Рассрочка'}
              {task.saleNumber ? ` · №${task.saleNumber}` : ''}
              {task.planDate ? ` · план ${formatDate(task.planDate)}` : ''}
              {task.planAmount != null ? ` · ${task.planAmount.toFixed(2)} BYN` : ''}
            </p>
            {task.overdueDays != null && task.overdueDays > 0 ? (
              <p className="text-xs text-amber-400">Просрочка {task.overdueDays} дн.</p>
            ) : (
              <p className="text-xs text-slate-500">Срок сегодня</p>
            )}
            {task.phone ? (
              <p className="text-xs text-slate-500">{task.phone}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => void claim(task.id)}
              >
                Взять себе
              </button>
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => void snooze(task.id, 2)}
              >
                Через 2 дн.
              </button>
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={() => void updateStatus(task.id, AdminTaskStatus.DONE)}
              >
                Готово
              </button>
            </div>
          </li>
        ))}
      </ul>
    );
  };

  const renderManager = () => {
    if (managerTasks.length === 0) {
      return <p className="text-slate-400">Нет задач от руководителя</p>;
    }
    return (
      <ul className="space-y-3">
        {managerTasks.map((task) => (
          <li key={task.id} className="card space-y-2">
            <div className="flex justify-between gap-2">
              <div>
                <p className="font-medium">{task.title}</p>
                {task.createdBy ? (
                  <p className="text-xs text-slate-500">
                    От: {task.createdBy.firstName} {task.createdBy.lastName}
                  </p>
                ) : null}
                {task.description ? (
                  <p className="text-sm text-slate-400">{task.description}</p>
                ) : null}
                {task.dueAt ? (
                  <p className="text-xs text-slate-500">
                    До: {formatDateTime(task.dueAt)}
                  </p>
                ) : null}
                {task.completionMode === 'SHARED' ? (
                  <p className="text-xs text-amber-300/90">
                    Общее выполнение — закроется у всех
                    {task.groupProgress
                      ? ` · ${task.groupProgress.done}/${task.groupProgress.total}`
                      : ''}
                  </p>
                ) : task.groupProgress ? (
                  <p className="text-xs text-slate-500">
                    Раздельно · {task.groupProgress.done}/{task.groupProgress.total}
                  </p>
                ) : null}
              </div>
            </div>
            {task.status !== AdminTaskStatus.DONE ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary text-xs flex-1"
                  onClick={() =>
                    void updateStatus(task.id, AdminTaskStatus.IN_PROGRESS)
                  }
                >
                  В работу
                </button>
                <button
                  type="button"
                  className="btn-primary text-xs flex-1"
                  onClick={() => void updateStatus(task.id, AdminTaskStatus.DONE)}
                >
                  Выполнена
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    );
  };

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
            {item.count != null && item.count > 0 ? ` (${item.count})` : ''}
          </button>
        ))}
      </div>

      {topic === 'today' ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {(
            [
              ['manager', 'От руководителя', counts.manager],
              ['client_debt', 'Долги клиентов', counts.client_debt],
              ['staff_debt', 'Долги сотрудников', counts.staff_debt],
              ['installment', 'Рассрочки', counts.installment],
              ['membership', 'Абонементы', counts.membership],
              ['group_approval', 'ГП', counts.group_approval],
              ['spa_approval', 'SPA', counts.spa_approval],
              ['pt_approval', 'ПТ', counts.pt_approval],
            ] as const
          ).map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              className="card py-3 text-left transition hover:border-fitgo-500/40"
              onClick={() => setTopic(id)}
            >
              <p className="stat-value text-xl">{count}</p>
              <p className="stat-label">{label}</p>
            </button>
          ))}
        </div>
      ) : null}

      {topic === 'manager' ? renderManager() : null}
      {topic === 'client_debt'
        ? renderDebtList(clientDebt, 'Нет долгов клиентов')
        : null}
      {topic === 'staff_debt'
        ? renderDebtList(staffDebt, 'Нет долгов сотрудников')
        : null}
      {topic === 'installment' ? renderInstallments() : null}

      {topic === 'membership' ? (
        <>
          {counters ? (
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
          {membershipTasks.length === 0 ? (
            <p className="text-slate-400">Нет задач по абонементам</p>
          ) : (
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
                          {task.stage === 'WILL_RENEW' ? ' · ждём покупку' : ''}
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
          )}
        </>
      ) : null}

      {topic === 'group_approval'
        ? renderPendingQueue(
            gpPending,
            'Нет ГП на подтверждении',
            'ГП',
          )
        : null}
      {topic === 'spa_approval'
        ? renderPendingQueue(
            spaPending,
            'Нет SPA на подтверждении',
            'SPA',
          )
        : null}
      {topic === 'pt_approval'
        ? renderPendingQueue(ptPending, 'Нет ПТ на контроле', 'ПТ')
        : null}

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
