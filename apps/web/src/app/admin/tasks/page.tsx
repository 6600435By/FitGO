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
import { phoneTelHref } from '@/lib/phone';
import { formatDate, formatDateTime } from '@/lib/utils';

const STAGE_LABEL: Record<string, string> = {
  NEW: 'Новый',
  NO_ANSWER: 'Не дозвонились',
  THINKING: 'Думает',
  WILL_RENEW: 'Продлит',
  RENEWED: 'Продлил',
  LOST: 'Отказ',
};

type Group = 'all' | 'clients' | 'staff' | 'manager' | 'control';

type Topic =
  | 'membership'
  | 'birthday'
  | 'client_debt'
  | 'installment'
  | 'staff_debt'
  | 'group_approval'
  | 'spa_approval'
  | 'pt_approval'
  | 'pt_sale_check'
  | 'confirmation';

function isDueTodayOrOverdue(task: AdminTaskItem): boolean {
  if (task.status === AdminTaskStatus.DONE || task.status === AdminTaskStatus.CANCELLED) {
    return false;
  }
  const now = Date.now();
  const ref = task.nextActionAt ?? task.dueAt;
  if (!ref) return true;
  return new Date(ref).getTime() <= now + 24 * 60 * 60 * 1000;
}

function CallButton({ phone }: { phone?: string }) {
  const href = phoneTelHref(phone);
  if (!href || !phone) return null;
  return (
    <a href={href} className="btn-primary flex w-full items-center justify-center text-center text-xs">
      Позвонить {phone}
    </a>
  );
}

function AdminTasksInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialGroup = searchParams.get('group');
  const initialTopic = searchParams.get('topic');
  const initialTask = searchParams.get('task');

  const [tasks, setTasks] = useState<AdminTaskItem[]>([]);
  const [gpPending, setGpPending] = useState<GroupApprovalPendingTask[]>([]);
  const [spaPending, setSpaPending] = useState<GroupApprovalPendingTask[]>([]);
  const [ptPending, setPtPending] = useState<GroupApprovalPendingTask[]>([]);
  const [counters, setCounters] = useState<AdminRenewalCounters | null>(null);
  const [skippedBirthdays, setSkippedBirthdays] = useState(0);
  const [birthdayScanError, setBirthdayScanError] = useState<string | null>(
    null,
  );
  const resolvedTopic: Topic | null =
    initialTopic === 'membership' ||
    initialTopic === 'birthday' ||
    initialTopic === 'staff_debt' ||
    initialTopic === 'client_debt' ||
    initialTopic === 'group_approval' ||
    initialTopic === 'spa_approval' ||
    initialTopic === 'pt_approval' ||
    initialTopic === 'installment' ||
    initialTopic === 'pt_sale_check' ||
    initialTopic === 'confirmation'
      ? (initialTopic as Topic)
      : null;
  const groupFromTopic = (t: Topic | null): Group | null => {
    if (!t) return null;
    if (t === 'staff_debt') return 'staff';
    if (
      t === 'membership' ||
      t === 'birthday' ||
      t === 'client_debt' ||
      t === 'installment'
    ) {
      return 'clients';
    }
    if (
      t === 'group_approval' ||
      t === 'spa_approval' ||
      t === 'pt_approval' ||
      t === 'pt_sale_check' ||
      t === 'confirmation'
    ) {
      return 'control';
    }
    return null;
  };
  const [group, setGroup] = useState<Group>(
    initialGroup === 'clients' ||
      initialGroup === 'staff' ||
      initialGroup === 'manager' ||
      initialGroup === 'control' ||
      initialGroup === 'all'
      ? (initialGroup as Group)
      : (groupFromTopic(resolvedTopic) ?? 'all'),
  );
  const [topic, setTopic] = useState<Topic | null>(resolvedTopic);
  const [openTaskId, setOpenTaskId] = useState<string | null>(initialTask);
  const [expandedDebtId, setExpandedDebtId] = useState<string | null>(null);
  const [debtLines, setDebtLines] = useState<Record<string, AdminDebtLine[]>>({});
  const [debtLoadingId, setDebtLoadingId] = useState<string | null>(null);
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
    api
      .adminBirthdaySkipped(token)
      .then((r) => {
        setSkippedBirthdays(r.skipped ?? 0);
        setBirthdayScanError(r.scanError?.trim() || null);
        // Scan finishes after the first list paint. Reload so new birthday
        // rows show up without waiting on 1C for the rest of the queue.
        return api.adminMyTasks(token).then(setTasks);
      })
      .catch(() => {
        setSkippedBirthdays(0);
        setBirthdayScanError(null);
      });
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (group === 'all') params.delete('group');
    else params.set('group', group);
    if (topic) params.set('topic', topic);
    else params.delete('topic');
    if (openTaskId) params.set('task', openTaskId);
    else params.delete('task');
    const qs = params.toString();
    router.replace(qs ? `/admin/tasks?${qs}` : '/admin/tasks', { scroll: false });
  }, [group, topic, openTaskId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectGroup = (next: Group) => {
    setGroup(next);
    setTopic(null);
    setOpenTaskId(null);
  };

  const selectTopic = (next: Topic) => {
    setTopic(next);
    setOpenTaskId(null);
  };

  const updateStatus = async (
    id: string,
    status: AdminTaskStatus,
    askComment = false,
  ) => {
    const token = getToken();
    if (!token) return;
    let comment: string | undefined;
    if (askComment && status === AdminTaskStatus.DONE) {
      const note = window.prompt('Что выяснили? (необязательно)');
      if (note === null) return;
      comment = note.trim() || undefined;
    }
    await api.adminUpdateTask(token, id, status, comment);
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
    setDebtLoadingId(id);
    try {
      const lines = await api.adminDebtLines(token, id);
      setDebtLines((prev) => ({ ...prev, [id]: lines }));
    } catch {
      setDebtLines((prev) => ({ ...prev, [id]: [] }));
    } finally {
      setDebtLoadingId(null);
    }
  };

  const debtDisplayName = (task: AdminTaskItem) =>
    task.title
      .replace(/^Долг (клиента|сотрудника):\s*/i, '')
      .replace(/\s*\([\d\s.,]+\s*BYN\)\s*$/i, '')
      .trim();

  const managerTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          (t.source === 'MANAGER' || t.source === 'DISCREPANCY') &&
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
  const birthdayTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.source === 'BIRTHDAY' &&
          t.status !== AdminTaskStatus.DONE &&
          t.status !== AdminTaskStatus.CANCELLED,
      ),
    [tasks],
  );
  const confirmationTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.source === 'BOOKING_CONFIRM' &&
          t.status !== AdminTaskStatus.DONE &&
          t.status !== AdminTaskStatus.CANCELLED,
      ),
    [tasks],
  );
  const ptSaleCheckTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.source === 'TRAINING_SALE_NO_PERFORMER' &&
          t.status !== AdminTaskStatus.DONE &&
          t.status !== AdminTaskStatus.CANCELLED,
      ),
    [tasks],
  );

  const counts = {
    manager: managerTasks.filter(isDueTodayOrOverdue).length,
    client_debt: clientDebt.length,
    staff_debt: staffDebt.length,
    installment: installmentTasks.length,
    membership: counters?.callToday ?? membershipTasks.filter(isDueTodayOrOverdue).length,
    birthday: birthdayTasks.length,
    group_approval: gpPending.length,
    spa_approval: spaPending.length,
    pt_approval: ptPending.length,
    pt_sale_check: ptSaleCheckTasks.length,
    confirmation: confirmationTasks.length,
  };

  const clientsTotal =
    counts.membership + counts.birthday + counts.client_debt + counts.installment;
  const controlTotal =
    counts.group_approval +
    counts.spa_approval +
    counts.pt_approval +
    counts.pt_sale_check +
    counts.confirmation;
  const allTotal = clientsTotal + counts.staff_debt + counts.manager + controlTotal;

  const groupFilters: { id: Group; label: string; count: number }[] = [
    { id: 'all', label: 'Все', count: allTotal },
    { id: 'clients', label: 'Клиенты', count: clientsTotal },
    { id: 'staff', label: 'Персонал', count: counts.staff_debt },
    { id: 'manager', label: 'Руководитель', count: counts.manager },
    { id: 'control', label: 'Контроль', count: controlTotal },
  ];

  const clientSub: { id: Topic; label: string; count: number }[] = [
    { id: 'membership', label: 'По сроку', count: counts.membership },
    { id: 'birthday', label: 'Дни рождения', count: counts.birthday },
    { id: 'client_debt', label: 'Долги', count: counts.client_debt },
    { id: 'installment', label: 'Рассрочки', count: counts.installment },
  ];

  const controlSub: { id: Topic; label: string; count: number }[] = [
    { id: 'group_approval', label: 'ГП', count: counts.group_approval },
    { id: 'pt_approval', label: 'ПТ', count: counts.pt_approval },
    { id: 'pt_sale_check', label: 'Продажи ПТ', count: counts.pt_sale_check },
    { id: 'spa_approval', label: 'SPA', count: counts.spa_approval },
    { id: 'confirmation', label: 'Подтверждения', count: counts.confirmation },
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
                  <p className="font-medium">{debtDisplayName(task)}</p>
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
            <CallButton phone={task.phone} />
            {expandedDebtId === task.id ? (
              <div className="space-y-2 border-t border-slate-700/50 pt-2">
                {debtLoadingId === task.id ? (
                  <p className="text-xs text-slate-500">Загрузка строк…</p>
                ) : (debtLines[task.id] ?? []).length === 0 ? (
                  <p className="text-xs text-slate-500">Нет неоплаченных продаж</p>
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
            <CallButton phone={task.phone} />
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

  const renderPtSaleChecks = () => {
    if (ptSaleCheckTasks.length === 0) {
      return (
        <p className="text-slate-400">
          Нет продаж разовых ПТ без исполнителя
        </p>
      );
    }
    return (
      <ul className="space-y-3">
        {ptSaleCheckTasks.map((task) => (
          <li key={task.id} className="card space-y-2">
            <p className="font-medium">{task.title}</p>
            {task.description ? (
              <p className="whitespace-pre-line text-sm text-slate-400">
                {task.description}
              </p>
            ) : null}
            {task.dueAt ? (
              <p className="text-xs text-slate-500">
                Продажа: {formatDateTime(task.dueAt)}
              </p>
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
                className="btn-primary text-xs"
                onClick={() =>
                  void updateStatus(task.id, AdminTaskStatus.DONE)
                }
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
                  <p className="whitespace-pre-line text-sm text-slate-400">
                    {task.description}
                  </p>
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
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  className="btn-secondary px-3 py-2 text-xs"
                  onClick={() =>
                    void updateStatus(task.id, AdminTaskStatus.IN_PROGRESS)
                  }
                >
                  В работу
                </button>
                <button
                  type="button"
                  className="btn-primary px-3 py-2 text-xs"
                  onClick={() =>
                    void updateStatus(
                      task.id,
                      AdminTaskStatus.DONE,
                      task.source === 'DISCREPANCY',
                    )
                  }
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

  const renderBirthdays = () => {
    if (birthdayTasks.length === 0) {
      return (
        <div className="space-y-2">
          <p className="text-slate-400">Нет дней рождения на сегодня</p>
          {birthdayScanError ? (
            <p className="text-xs text-amber-300/90">
              1С не отдала дни рождения: {birthdayScanError}
            </p>
          ) : null}
          {skippedBirthdays > 0 ? (
            <p className="text-xs text-slate-500">
              Ещё {skippedBirthdays} сегодня, не были в клубе больше 2 лет
            </p>
          ) : null}
        </div>
      );
    }
    return (
      <div className="space-y-3">
        {skippedBirthdays > 0 ? (
          <p className="text-xs text-slate-500">
            Ещё {skippedBirthdays} сегодня, не были в клубе больше 2 лет
          </p>
        ) : null}
        <ul className="space-y-3">
          {birthdayTasks.map((task) => (
            <li key={task.id} className="card space-y-2">
              <p className="font-medium">
                {task.title.replace(/^День рождения:\s*/i, '')}
              </p>
              <p className="text-sm text-slate-400">Поздравить сегодня</p>
              <CallButton phone={task.phone} />
              <button
                type="button"
                className="btn-primary w-full text-xs"
                onClick={() => void updateStatus(task.id, AdminTaskStatus.DONE)}
              >
                Поздравили
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  const confirmClient = async (
    taskId: string,
    clientExternalId: string,
    confirmed = true,
  ) => {
    const token = getToken();
    if (!token) return;
    await api.adminConfirmBookingClient(token, taskId, {
      clientExternalId,
      confirmed,
    });
    load();
  };

  const renderConfirmations = () => {
    if (confirmationTasks.length === 0) {
      return (
        <p className="text-slate-400">
          Нет подтверждений на завтра (реформеры / SPA)
        </p>
      );
    }
    return (
      <ul className="space-y-3">
        {confirmationTasks.map((task) => {
          const sessionKey =
            typeof task.sessionKey === 'string' ? task.sessionKey : undefined;
          const clients = task.confirmClients ?? [];
          const doneCount = clients.filter((c) => c.confirmed).length;
          return (
            <li key={task.id} className="card space-y-2">
              <p className="font-medium">
                {task.title.replace(/^Подтверждение:\s*/i, '')}
              </p>
              <p className="text-sm text-slate-400">
                {task.membershipName ?? 'Запись'}
                {task.roomTitle ? ` · ${task.roomTitle}` : ''}
                {task.dueAt ? ` · ${formatDateTime(task.dueAt)}` : ''}
              </p>
              {clients.length > 0 ? (
                <>
                  <p className="text-xs text-slate-500">
                    Проверено {doneCount} из {clients.length}
                  </p>
                  <ul className="space-y-2">
                    {clients.map((client) => (
                      <li
                        key={client.externalId}
                        className={`rounded-lg border px-3 py-2 ${
                          client.confirmed
                            ? 'border-emerald-800/60 bg-emerald-950/30'
                            : 'border-slate-800 bg-slate-950/40'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-medium text-slate-100">
                              {client.clientName}
                            </p>
                            {client.confirmed ? (
                              <p className="text-[11px] text-emerald-400/90">
                                Подтверждён
                              </p>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            className={
                              client.confirmed
                                ? 'btn-secondary text-[11px]'
                                : 'btn-primary text-[11px]'
                            }
                            onClick={() =>
                              void confirmClient(
                                task.id,
                                client.externalId,
                                !client.confirmed,
                              )
                            }
                          >
                            {client.confirmed ? 'Снять' : 'Проверил'}
                          </button>
                        </div>
                        {!client.confirmed ? (
                          <div className="mt-2">
                            <CallButton phone={client.phone} />
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <CallButton phone={task.phone} />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-primary flex-1 text-xs"
                      onClick={() =>
                        void updateStatus(task.id, AdminTaskStatus.DONE)
                      }
                    >
                      Подтвердил
                    </button>
                  </div>
                </>
              )}
              {sessionKey ? (
                <Link
                  href={`/admin/booking-control?sessionKey=${encodeURIComponent(sessionKey)}`}
                  className="btn-secondary inline-flex w-full items-center justify-center text-xs"
                >
                  К записи
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  };

  const renderMembership = () => (
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
  );

  const renderAllHub = () => (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {(
        [
          [
            'clients' as const,
            'Клиенты',
            clientsTotal,
            `По сроку ${counts.membership} · ДР ${counts.birthday} · Долги ${counts.client_debt} · Рассрочки ${counts.installment}`,
          ],
          [
            'staff' as const,
            'Персонал',
            counts.staff_debt,
            `Долги сотрудников ${counts.staff_debt}`,
          ],
          [
            'manager' as const,
            'Руководитель',
            counts.manager,
            `Задач ${counts.manager}`,
          ],
          [
            'control' as const,
            'Контроль',
            controlTotal,
            `ГП ${counts.group_approval} · ПТ ${counts.pt_approval} · Продажи ${counts.pt_sale_check} · SPA ${counts.spa_approval} · Подтв. ${counts.confirmation}`,
          ],
        ] as const
      ).map(([id, label, count, detail]) => (
        <button
          key={id}
          type="button"
          className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-3 text-left transition hover:border-fitgo-500/40"
          onClick={() => selectGroup(id)}
        >
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-medium">{label}</p>
            <p className="stat-value text-lg leading-none">{count}</p>
          </div>
          <p className="mt-1 text-[11px] text-slate-400">{detail}</p>
        </button>
      ))}
    </div>
  );

  const showSub =
    group === 'clients'
      ? clientSub
      : group === 'control'
        ? controlSub
        : group === 'staff'
          ? ([{ id: 'staff_debt' as Topic, label: 'Долги', count: counts.staff_debt }] as const)
          : null;

  const activeTopic =
    topic ??
    (group === 'staff'
      ? 'staff_debt'
      : group === 'clients'
        ? null
        : group === 'control'
          ? null
          : null);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-400">Очередь на сегодня</p>
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

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {groupFilters.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => selectGroup(item.id)}
            className={
              group === item.id
                ? 'btn-primary shrink-0 px-3 py-2 text-xs'
                : 'btn-secondary shrink-0 px-3 py-2 text-xs'
            }
          >
            {item.label}
            {item.count > 0 ? ` (${item.count})` : ''}
          </button>
        ))}
      </div>

      {showSub ? (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {showSub.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => selectTopic(item.id)}
              className={
                activeTopic === item.id
                  ? 'btn-primary shrink-0 px-3 py-2 text-xs'
                  : 'btn-secondary shrink-0 px-3 py-2 text-xs'
              }
            >
              {item.label}
              {item.count > 0 ? ` (${item.count})` : ''}
            </button>
          ))}
        </div>
      ) : null}

      {group === 'all' ? renderAllHub() : null}
      {group === 'manager' ? renderManager() : null}
      {group === 'staff' || activeTopic === 'staff_debt'
        ? group === 'staff' && (!topic || topic === 'staff_debt')
          ? renderDebtList(staffDebt, 'Нет долгов сотрудников')
          : null
        : null}

      {group === 'clients' && !activeTopic ? (
        <div className="grid grid-cols-2 gap-2">
          {clientSub.map((item) => (
            <button
              key={item.id}
              type="button"
              className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-left transition hover:border-fitgo-500/40"
              onClick={() => selectTopic(item.id)}
            >
              <p className="stat-value text-lg leading-none">{item.count}</p>
              <p className="mt-1 text-[11px] text-slate-400">{item.label}</p>
            </button>
          ))}
        </div>
      ) : null}

      {group === 'control' && !activeTopic ? (
        <div className="grid grid-cols-2 gap-2">
          {controlSub.map((item) => (
            <button
              key={item.id}
              type="button"
              className="rounded-xl border border-slate-800 bg-slate-900/60 px-3 py-2.5 text-left transition hover:border-fitgo-500/40"
              onClick={() => selectTopic(item.id)}
            >
              <p className="stat-value text-lg leading-none">{item.count}</p>
              <p className="mt-1 text-[11px] text-slate-400">{item.label}</p>
            </button>
          ))}
        </div>
      ) : null}

      {activeTopic === 'client_debt' ? renderDebtList(clientDebt, 'Нет долгов клиентов') : null}
      {activeTopic === 'installment' ? renderInstallments() : null}
      {activeTopic === 'membership' ? renderMembership() : null}
      {activeTopic === 'birthday' ? renderBirthdays() : null}
      {activeTopic === 'confirmation' ? renderConfirmations() : null}
      {activeTopic === 'pt_sale_check' ? renderPtSaleChecks() : null}
      {activeTopic === 'group_approval'
        ? renderPendingQueue(gpPending, 'Нет ГП на подтверждении', 'ГП')
        : null}
      {activeTopic === 'spa_approval'
        ? renderPendingQueue(
            spaPending,
            'Нет SPA после сеанса. Записи на завтра — во вкладке «Подтверждения».',
            'SPA',
          )
        : null}
      {activeTopic === 'pt_approval'
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
