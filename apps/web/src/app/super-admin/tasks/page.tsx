'use client';

import type { AdminTaskItem, StaffMember } from '@fitgo/shared-types';
import { AdminTaskStatus, UserRole } from '@fitgo/shared-types';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { BirthdayCallScript } from '@/components/admin/birthday-call-script';
import { AdminTaskStatsPanel } from '@/components/super-admin/admin-task-stats-panel';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import {
  resolveViewFilters,
  usePersistViewMemory,
} from '@/lib/use-view-memory';
import { phoneTelHref } from '@/lib/phone';
import { formatDateTime } from '@/lib/utils';

function CallButton({ phone }: { phone?: string }) {
  const href = phoneTelHref(phone);
  if (!href || !phone) return null;
  return (
    <a
      href={href}
      className="btn-primary flex items-center justify-center text-center text-xs"
    >
      Позвонить {phone}
    </a>
  );
}

type TopicFilter =
  | 'all'
  | 'manager'
  | 'staff_debt'
  | 'client_debt'
  | 'membership'
  | 'installment'
  | 'birthday'
  | 'confirmation'
  | 'pt_sale_check'
  | 'other';

type MainTab = 'work' | 'stats';

function sourceLabel(source: string): string {
  if (source === 'STAFF_DEBT') return 'авто: долг сотрудника';
  if (source === 'CLIENT_DEBT' || source === 'DEBT_OVERDUE') {
    return 'авто: долг клиента';
  }
  if (source === 'MEMBERSHIP_EXPIRING') return 'авто: абонемент';
  if (source === 'INSTALLMENT_PAYMENT') return 'авто: рассрочка';
  if (source === 'BIRTHDAY') return 'авто: день рождения';
  if (source === 'BOOKING_CONFIRM') return 'авто: подтверждение';
  if (source === 'TRAINING_SALE_NO_PERFORMER') return 'авто: продажа ПТ';
  if (source === 'MANAGER' || source === 'DISCREPANCY') return 'от руководителя';
  return source;
}

function parseTopic(raw: string | null): TopicFilter {
  if (
    raw === 'manager' ||
    raw === 'staff_debt' ||
    raw === 'client_debt' ||
    raw === 'membership' ||
    raw === 'installment' ||
    raw === 'birthday' ||
    raw === 'confirmation' ||
    raw === 'pt_sale_check' ||
    raw === 'other'
  ) {
    return raw;
  }
  return 'all';
}

function parseTab(raw: string | null): MainTab {
  return raw === 'stats' ? 'stats' : 'work';
}

function matchesTopic(task: AdminTaskItem, topic: TopicFilter): boolean {
  if (topic === 'all') return true;
  if (topic === 'manager') {
    return task.source === 'MANAGER' || task.topic === 'manager';
  }
  if (topic === 'birthday') {
    return task.source === 'BIRTHDAY' || task.topic === 'birthday';
  }
  return task.topic === topic;
}

function isOverdue(task: AdminTaskItem, now: number): boolean {
  if (
    task.status === AdminTaskStatus.DONE ||
    task.status === AdminTaskStatus.CANCELLED
  ) {
    return false;
  }
  if (task.dueAt && new Date(task.dueAt).getTime() < now) return true;
  if (task.nextActionAt && new Date(task.nextActionAt).getTime() < now) {
    return true;
  }
  return false;
}

function isWaiting(task: AdminTaskItem, now: number): boolean {
  if (task.status !== AdminTaskStatus.IN_PROGRESS) return false;
  if (!task.nextActionAt) return false;
  return new Date(task.nextActionAt).getTime() > now;
}

type TasksViewMem = { topic: TopicFilter; tab: MainTab; assigneeId: string };

function SuperAdminTasksInner() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const ownerId = getUser()?.id ?? '';
  const now = Date.now();

  const boot = (() => {
    const defaults: TasksViewMem = {
      topic: 'all',
      tab: 'work',
      assigneeId: '',
    };
    const resolved = resolveViewFilters<TasksViewMem>({
      userId: ownerId,
      pathname,
      slot: 'main',
      search: searchParams,
      urlKeys: ['topic', 'tab', 'assigneeId'],
      fromUrl: (s) => ({
        topic: parseTopic(s.get('topic')),
        tab: parseTab(s.get('tab')),
        assigneeId: s.get('assigneeId') ?? '',
      }),
      defaults,
    });
    return {
      topic: parseTopic(resolved.topic),
      tab: parseTab(resolved.tab),
      assigneeId: resolved.assigneeId ?? '',
    };
  })();

  const [tasks, setTasks] = useState<AdminTaskItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [admins, setAdmins] = useState<StaffMember[]>([]);
  const [form, setForm] = useState({
    assigneeIds: [] as string[],
    title: '',
    description: '',
    dueAt: '',
    completionMode: 'INDIVIDUAL' as 'SHARED' | 'INDIVIDUAL',
  });
  const [showForm, setShowForm] = useState(false);
  const [topic, setTopic] = useState<TopicFilter>(boot.topic);
  const [tab, setTab] = useState<MainTab>(boot.tab);
  const [assigneeFilter, setAssigneeFilter] = useState(boot.assigneeId);
  const [onShiftOnly, setOnShiftOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [doneOpen, setDoneOpen] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelComment, setCancelComment] = useState('');
  const [reworkTask, setReworkTask] = useState<AdminTaskItem | null>(null);
  const [reworkComment, setReworkComment] = useState('');
  const [reworkPool, setReworkPool] = useState(false);
  const [reworkAssigneeId, setReworkAssigneeId] = useState('');
  const [reworkDueAt, setReworkDueAt] = useState('');

  usePersistViewMemory<TasksViewMem>({
    data: { topic, tab, assigneeId: assigneeFilter },
    toSearchParams: (d) => {
      const q = new URLSearchParams();
      if (d.topic && d.topic !== 'all') q.set('topic', d.topic);
      if (d.tab && d.tab !== 'work') q.set('tab', d.tab);
      if (d.assigneeId) q.set('assigneeId', d.assigneeId);
      return q;
    },
  });

  const load = () => {
    const token = getToken();
    if (!token) return;
    setLoadError(null);
    Promise.all([
      api.superAdminTasks(token, {
        assigneeId: assigneeFilter || undefined,
        onShift: onShiftOnly || undefined,
      }),
      api.superAdminStaff(token),
    ])
      .then(([taskList, staff]) => {
        setTasks(taskList);
        setAdmins(
          staff.filter((s) => s.roles.includes(UserRole.ADMIN) && s.isActive),
        );
      })
      .catch((err: unknown) => {
        setLoadError(
          err instanceof Error ? err.message : 'Не удалось загрузить задачи',
        );
      })
      .finally(() => setLoaded(true));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on filters
  }, [assigneeFilter, onShiftOnly]);

  const toggleAssignee = (id: string) => {
    setForm((prev) => ({
      ...prev,
      assigneeIds: prev.assigneeIds.includes(id)
        ? prev.assigneeIds.filter((x) => x !== id)
        : [...prev.assigneeIds, id],
    }));
  };

  const create = async () => {
    const token = getToken();
    if (!token || !form.assigneeIds.length || !form.title.trim()) return;
    await api.superAdminCreateTask(token, {
      assigneeIds: form.assigneeIds,
      title: form.title,
      description: form.description || undefined,
      dueAt: form.dueAt || undefined,
      completionMode: form.completionMode,
    });
    setShowForm(false);
    setForm({
      assigneeIds: [],
      title: '',
      description: '',
      dueAt: '',
      completionMode: 'INDIVIDUAL',
    });
    load();
  };

  const setStatus = async (
    id: string,
    status: AdminTaskStatus,
    comment?: string,
  ) => {
    const token = getToken();
    if (!token) return;
    await api.superAdminUpdateTask(token, id, { status, comment });
    load();
  };

  const assign = async (id: string, assigneeId: string) => {
    const token = getToken();
    if (!token) return;
    await api.superAdminUpdateTask(token, id, {
      assigneeId: assigneeId || null,
    });
    load();
  };

  const submitCancel = async () => {
    if (!cancelId || cancelComment.trim().length < 2) return;
    await setStatus(cancelId, AdminTaskStatus.CANCELLED, cancelComment.trim());
    setCancelId(null);
    setCancelComment('');
  };

  const submitRework = async () => {
    const token = getToken();
    if (!token || !reworkTask || reworkComment.trim().length < 2) return;
    if (!reworkPool && !reworkAssigneeId) return;
    await api.superAdminReworkTask(token, reworkTask.id, {
      comment: reworkComment.trim(),
      pool: reworkPool || undefined,
      assigneeId: reworkPool ? undefined : reworkAssigneeId,
      dueAt: reworkDueAt || undefined,
    });
    setReworkTask(null);
    setReworkComment('');
    setReworkPool(false);
    setReworkAssigneeId('');
    setReworkDueAt('');
    setTab('work');
    load();
  };

  const filters: { id: TopicFilter; label: string }[] = [
    { id: 'all', label: 'Все' },
    { id: 'manager', label: 'От руководителя' },
    { id: 'staff_debt', label: 'Долги сотрудников' },
    { id: 'client_debt', label: 'Долги клиентов' },
    { id: 'installment', label: 'Рассрочки' },
    { id: 'membership', label: 'Абонементы' },
    { id: 'birthday', label: 'Дни рождения' },
    { id: 'confirmation', label: 'Подтверждение записи' },
    { id: 'pt_sale_check', label: 'Продажа ПТ' },
    { id: 'other', label: 'Прочее' },
  ];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((task) => {
      if (!matchesTopic(task, topic)) return false;
      if (!q) return true;
      const hay = `${task.title} ${task.description ?? ''} ${task.phone ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [tasks, topic, search]);

  const lanes = useMemo(() => {
    const attention: AdminTaskItem[] = [];
    const pool: AdminTaskItem[] = [];
    const assigned: AdminTaskItem[] = [];
    const waiting: AdminTaskItem[] = [];
    const doneToday: AdminTaskItem[] = [];

    for (const task of filtered) {
      if (task.status === AdminTaskStatus.DONE) {
        doneToday.push(task);
        continue;
      }
      if (task.status === AdminTaskStatus.CANCELLED) continue;

      const waitingFuture = isWaiting(task, now);
      const overdue = isOverdue(task, now);
      const needsRework = (task.reworkCount ?? 0) > 0;

      if (needsRework || overdue) {
        attention.push(task);
        continue;
      }
      if (waitingFuture) {
        waiting.push(task);
        continue;
      }
      if (task.status === AdminTaskStatus.OPEN && !task.assignee) {
        pool.push(task);
        continue;
      }
      assigned.push(task);
    }

    const byPerson = new Map<string, { name: string; tasks: AdminTaskItem[] }>();
    for (const t of assigned) {
      const id = t.assignee?.id ?? 'unknown';
      const name = t.assignee
        ? `${t.assignee.firstName} ${t.assignee.lastName}`.trim()
        : 'Без имени';
      const row = byPerson.get(id) ?? { name, tasks: [] };
      row.tasks.push(t);
      byPerson.set(id, row);
    }

    return { attention, pool, byPerson, waiting, doneToday };
  }, [filtered, now]);

  const statusLabel: Record<AdminTaskStatus, string> = {
    OPEN: 'Открыта',
    IN_PROGRESS: 'В работе',
    DONE: 'Выполнена',
    CANCELLED: 'Отменена',
  };

  const renderCard = (task: AdminTaskItem, opts?: { showRework?: boolean }) => {
    const isBirthday =
      task.source === 'BIRTHDAY' || task.topic === 'birthday';
    const overdue = isOverdue(task, now);
    return (
      <li key={task.id} className="card space-y-2">
        <div className="flex justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{task.title}</p>
              {(task.reworkCount ?? 0) > 0 &&
              task.status !== AdminTaskStatus.DONE ? (
                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-300">
                  Доработка
                </span>
              ) : null}
              {overdue ? (
                <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-xs text-rose-300">
                  Просрочено
                </span>
              ) : null}
            </div>
            {task.reworkComment ? (
              <p className="mt-1 text-sm text-amber-200/90">
                {task.reworkComment}
              </p>
            ) : null}
            <p className="text-sm text-slate-400">
              {task.assignee
                ? `${task.assignee.firstName} ${task.assignee.lastName}`
                : 'Общая очередь'}
              {task.source && task.source !== 'MANUAL' ? (
                <span className="ml-2 text-xs text-amber-300/90">
                  · {sourceLabel(task.source)}
                </span>
              ) : null}
            </p>
            {isBirthday ? (
              <p className="text-sm text-slate-400">Поздравить сегодня</p>
            ) : null}
            {task.groupProgress ? (
              <p className="text-xs text-slate-500">
                {task.completionMode === 'SHARED' ? 'Общее' : 'Раздельно'} ·{' '}
                {task.groupProgress.done}/{task.groupProgress.total}
                {task.groupProgress.assignees.length
                  ? ` · ${task.groupProgress.assignees.join(', ')}`
                  : ''}
              </p>
            ) : null}
            {task.dueAt && !isBirthday ? (
              <p className="text-xs text-slate-500">
                До: {formatDateTime(task.dueAt)}
              </p>
            ) : null}
            {task.nextActionAt && isWaiting(task, now) ? (
              <p className="text-xs text-slate-500">
                Ожидание до: {formatDateTime(task.nextActionAt)}
              </p>
            ) : null}
          </div>
          <span className="text-xs text-slate-400">
            {statusLabel[task.status]}
          </span>
        </div>
        {isBirthday ? (
          <>
            <BirthdayCallScript
              firstName={task.firstName}
              middleName={task.middleName}
              title={task.title}
            />
            <CallButton phone={task.phone} />
          </>
        ) : null}
        {task.status !== AdminTaskStatus.DONE &&
          task.status !== AdminTaskStatus.CANCELLED && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <select
                className="input text-xs"
                value={task.assignee?.id ?? ''}
                onChange={(e) => void assign(task.id, e.target.value)}
              >
                <option value="">Общая очередь</option>
                {admins.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.firstName} {a.lastName}
                  </option>
                ))}
              </select>
              {!isBirthday ? (
                <button
                  type="button"
                  onClick={() =>
                    void setStatus(task.id, AdminTaskStatus.IN_PROGRESS)
                  }
                  className="btn-secondary text-xs"
                >
                  В работу
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void setStatus(task.id, AdminTaskStatus.DONE)}
                className="btn-primary text-xs"
              >
                {isBirthday ? 'Поздравили' : 'Выполнена'}
              </button>
              {!isBirthday ? (
                <button
                  type="button"
                  onClick={() => {
                    setCancelId(task.id);
                    setCancelComment('');
                  }}
                  className="btn-secondary text-xs"
                >
                  Отмена
                </button>
              ) : null}
            </div>
          )}
        {opts?.showRework && task.status === AdminTaskStatus.DONE ? (
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => {
              setReworkTask(task);
              setReworkComment('');
              setReworkPool(false);
              setReworkAssigneeId(task.assignee?.id ?? admins[0]?.id ?? '');
              setReworkDueAt('');
            }}
          >
            На доработку
          </button>
        ) : null}
      </li>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Задачи</h2>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/super-admin/task-settings"
            className="btn-secondary text-sm"
          >
            Настройки
          </Link>
          {tab === 'work' ? (
            <button
              type="button"
              onClick={() => setShowForm(!showForm)}
              className="btn-primary text-sm"
            >
              {showForm ? 'Отмена' : '+ Задача'}
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTab('work')}
          className={tab === 'work' ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
        >
          В работе
        </button>
        <button
          type="button"
          onClick={() => setTab('stats')}
          className={
            tab === 'stats' ? 'btn-primary text-sm' : 'btn-secondary text-sm'
          }
        >
          Статистика
        </button>
      </div>

      {tab === 'stats' ? (
        <AdminTaskStatsPanel />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {filters.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTopic(item.id)}
                className={
                  topic === item.id
                    ? 'btn-primary text-xs'
                    : 'btn-secondary text-xs'
                }
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input max-w-xs text-sm"
              placeholder="Поиск…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="input text-sm"
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
            >
              <option value="">Все сотрудники</option>
              {admins.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.firstName} {a.lastName}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={onShiftOnly}
                onChange={(e) => setOnShiftOnly(e.target.checked)}
              />
              Только на смене
            </label>
          </div>

          {showForm && (
            <div className="card space-y-3">
              <p className="text-sm text-slate-400">Администраторы</p>
              <div className="max-h-40 space-y-1 overflow-y-auto rounded border border-slate-700/50 p-2">
                {admins.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.assigneeIds.includes(a.id)}
                      onChange={() => toggleAssignee(a.id)}
                    />
                    {a.firstName} {a.lastName}
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-3 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="completionMode"
                    checked={form.completionMode === 'INDIVIDUAL'}
                    onChange={() =>
                      setForm({ ...form, completionMode: 'INDIVIDUAL' })
                    }
                  />
                  Раздельное выполнение
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="completionMode"
                    checked={form.completionMode === 'SHARED'}
                    onChange={() =>
                      setForm({ ...form, completionMode: 'SHARED' })
                    }
                  />
                  Общее (закроет у всех)
                </label>
              </div>
              <input
                className="input w-full"
                placeholder="Заголовок"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
              <textarea
                className="input w-full"
                placeholder="Описание"
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                rows={2}
              />
              <input
                className="input w-full"
                type="datetime-local"
                value={form.dueAt}
                onChange={(e) =>
                  setForm({
                    ...form,
                    dueAt: e.target.value
                      ? new Date(e.target.value).toISOString()
                      : '',
                  })
                }
              />
              <button
                type="button"
                onClick={() => void create()}
                className="btn-primary w-full"
              >
                Создать
              </button>
            </div>
          )}

          {!loaded && <p className="text-sm text-slate-400">Загрузка задач…</p>}
          {loaded && loadError && (
            <p className="text-sm text-amber-300/90">{loadError}</p>
          )}

          {loaded && !loadError && (
            <div className="space-y-6">
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-rose-300">
                  Нужно внимание ({lanes.attention.length})
                </h3>
                <ul className="space-y-3">
                  {lanes.attention.length === 0 ? (
                    <li className="text-sm text-slate-500">Нет</li>
                  ) : (
                    lanes.attention.map((t) => renderCard(t))
                  )}
                </ul>
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-200">
                  Общая очередь ({lanes.pool.length})
                </h3>
                <ul className="space-y-3">
                  {lanes.pool.length === 0 ? (
                    <li className="text-sm text-slate-500">Пусто</li>
                  ) : (
                    lanes.pool.map((t) => renderCard(t))
                  )}
                </ul>
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-200">
                  У сотрудников ({[...lanes.byPerson.values()].reduce(
                    (n, r) => n + r.tasks.length,
                    0,
                  )})
                </h3>
                {[...lanes.byPerson.entries()].map(([id, row]) => {
                  const overdueN = row.tasks.filter((t) =>
                    isOverdue(t, now),
                  ).length;
                  return (
                    <div key={id} className="space-y-2">
                      <p className="text-sm text-slate-300">
                        {row.name} · {row.tasks.length}
                        {overdueN > 0 ? (
                          <span className="ml-2 text-rose-300">
                            просрочено {overdueN}
                          </span>
                        ) : null}
                      </p>
                      <ul className="space-y-3">
                        {row.tasks.map((t) => renderCard(t))}
                      </ul>
                    </div>
                  );
                })}
                {lanes.byPerson.size === 0 ? (
                  <p className="text-sm text-slate-500">Нет назначенных</p>
                ) : null}
              </section>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-200">
                  Ожидание ({lanes.waiting.length})
                </h3>
                <ul className="space-y-3">
                  {lanes.waiting.length === 0 ? (
                    <li className="text-sm text-slate-500">Нет</li>
                  ) : (
                    lanes.waiting.map((t) => renderCard(t))
                  )}
                </ul>
              </section>

              <section className="space-y-2">
                <button
                  type="button"
                  className="text-sm font-semibold text-slate-200"
                  onClick={() => setDoneOpen((v) => !v)}
                >
                  Закрытые сегодня ({lanes.doneToday.length}){' '}
                  {doneOpen ? '▾' : '▸'}
                </button>
                {doneOpen ? (
                  <ul className="space-y-3">
                    {lanes.doneToday.length === 0 ? (
                      <li className="text-sm text-slate-500">Нет</li>
                    ) : (
                      lanes.doneToday.map((t) =>
                        renderCard(t, { showRework: true }),
                      )
                    )}
                  </ul>
                ) : null}
              </section>
            </div>
          )}
        </>
      )}

      {cancelId ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="card w-full max-w-md space-y-3">
            <h3 className="font-semibold">Причина отмены</h3>
            <textarea
              className="input w-full"
              rows={3}
              value={cancelComment}
              onChange={(e) => setCancelComment(e.target.value)}
              placeholder="Комментарий обязателен"
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary text-sm"
                onClick={() => void submitCancel()}
              >
                Отменить задачу
              </button>
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() => setCancelId(null)}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reworkTask ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="card w-full max-w-md space-y-3">
            <h3 className="font-semibold">На доработку</h3>
            <p className="text-sm text-slate-400">{reworkTask.title}</p>
            <textarea
              className="input w-full"
              rows={3}
              value={reworkComment}
              onChange={(e) => setReworkComment(e.target.value)}
              placeholder="Что переделать"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={reworkPool}
                onChange={(e) => setReworkPool(e.target.checked)}
              />
              Всё подразделение (общая очередь)
            </label>
            {!reworkPool ? (
              <select
                className="input w-full text-sm"
                value={reworkAssigneeId}
                onChange={(e) => setReworkAssigneeId(e.target.value)}
              >
                {admins.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.firstName} {a.lastName}
                  </option>
                ))}
              </select>
            ) : null}
            <input
              className="input w-full"
              type="datetime-local"
              value={reworkDueAt}
              onChange={(e) =>
                setReworkDueAt(
                  e.target.value
                    ? new Date(e.target.value).toISOString()
                    : '',
                )
              }
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-primary text-sm"
                onClick={() => void submitRework()}
              >
                Вернуть
              </button>
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() => setReworkTask(null)}
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function SuperAdminTasksPage() {
  return (
    <Suspense fallback={<p className="text-slate-400">Загрузка…</p>}>
      <SuperAdminTasksInner />
    </Suspense>
  );
}
