'use client';

import type {
  AdminTaskItem,
  AdminTaskTemplateItem,
  StaffMember,
} from '@fitgo/shared-types';
import { AdminTaskStatus, UserRole } from '@fitgo/shared-types';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { AdminTaskStatsPanel } from '@/components/super-admin/admin-task-stats-panel';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import {
  resolveViewFilters,
  usePersistViewMemory,
} from '@/lib/use-view-memory';
import { formatDateTime } from '@/lib/utils';

type BoardMode = 'attention' | 'people' | 'list' | 'stats';
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

type MetricFilter =
  | 'all'
  | 'overdue'
  | 'unassigned'
  | 'rework'
  | 'blocked'
  | 'done_today';

function isOverdue(task: AdminTaskItem, now: number) {
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

function matchesTopic(task: AdminTaskItem, topic: TopicFilter) {
  if (topic === 'all') return true;
  if (topic === 'manager') {
    return task.source === 'MANAGER' || task.topic === 'manager';
  }
  if (topic === 'birthday') {
    return task.source === 'BIRTHDAY' || task.topic === 'birthday';
  }
  return task.topic === topic;
}

function parseMode(raw: string | null): BoardMode {
  if (
    raw === 'people' ||
    raw === 'list' ||
    raw === 'stats' ||
    raw === 'attention'
  ) {
    return raw;
  }
  return 'attention';
}

type Mem = {
  mode: BoardMode;
  topic: TopicFilter;
  metric: MetricFilter;
  assigneeId: string;
};

export function ManagerTaskBoard() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const ownerId = getUser()?.id ?? '';
  const now = Date.now();

  const boot = (() => {
    const defaults: Mem = {
      mode: 'attention',
      topic: 'all',
      metric: 'all',
      assigneeId: '',
    };
    const resolved = resolveViewFilters<Mem>({
      userId: ownerId,
      pathname,
      slot: 'main',
      search: searchParams,
      urlKeys: ['mode', 'topic', 'metric', 'assigneeId', 'tab'],
      fromUrl: (s) => ({
        mode:
          s.get('tab') === 'stats'
            ? 'stats'
            : parseMode(s.get('mode') ?? s.get('tab')),
        topic: (s.get('topic') as TopicFilter) || 'all',
        metric: (s.get('metric') as MetricFilter) || 'all',
        assigneeId: s.get('assigneeId') ?? '',
      }),
      defaults,
    });
    return resolved;
  })();

  const [tasks, setTasks] = useState<AdminTaskItem[]>([]);
  const [admins, setAdmins] = useState<StaffMember[]>([]);
  const [templates, setTemplates] = useState<AdminTaskTemplateItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<BoardMode>(parseMode(boot.mode));
  const [topic, setTopic] = useState<TopicFilter>(
    (boot.topic as TopicFilter) || 'all',
  );
  const [metric, setMetric] = useState<MetricFilter>(
    (boot.metric as MetricFilter) || 'all',
  );
  const [assigneeFilter, setAssigneeFilter] = useState(boot.assigneeId ?? '');
  const [onShiftOnly, setOnShiftOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [events, setEvents] = useState<
    Array<{
      id: string;
      kind?: string;
      comment?: string;
      actorName?: string;
      createdAt: string;
      stage?: string;
    }>
  >([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    assigneeIds: [] as string[],
    title: '',
    description: '',
    dueAt: '',
    completionMode: 'INDIVIDUAL' as 'SHARED' | 'INDIVIDUAL',
    priority: 'NORMAL',
    pool: false,
    onShift: false,
    checklist: '',
  });
  const [reworkTask, setReworkTask] = useState<AdminTaskItem | null>(null);
  const [reworkComment, setReworkComment] = useState('');
  const [reworkPool, setReworkPool] = useState(false);
  const [reworkAssigneeId, setReworkAssigneeId] = useState('');
  const [reworkDueAt, setReworkDueAt] = useState('');
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelComment, setCancelComment] = useState('');
  const [bulkAssignee, setBulkAssignee] = useState('');
  const [peoplePerson, setPeoplePerson] = useState<string | null>(null);

  usePersistViewMemory<Mem>({
    data: { mode, topic, metric, assigneeId: assigneeFilter },
    toSearchParams: (d) => {
      const q = new URLSearchParams();
      if (d.mode && d.mode !== 'attention') q.set('mode', d.mode);
      if (d.topic && d.topic !== 'all') q.set('topic', d.topic);
      if (d.metric && d.metric !== 'all') q.set('metric', d.metric);
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
      api.superAdminTaskTemplates(token).catch(() => []),
    ])
      .then(([taskList, staff, tpls]) => {
        setTasks(taskList);
        setAdmins(
          staff.filter((s) => s.roles.includes(UserRole.ADMIN) && s.isActive),
        );
        setTemplates(tpls);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assigneeFilter, onShiftOnly]);

  useEffect(() => {
    if (!detailId) {
      setEvents([]);
      return;
    }
    const token = getToken();
    if (!token) return;
    api
      .superAdminTaskEvents(token, detailId)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [detailId]);

  const metrics = useMemo(() => {
    let open = 0;
    let overdue = 0;
    let unassigned = 0;
    let rework = 0;
    let blocked = 0;
    let doneToday = 0;
    for (const t of tasks) {
      if (t.status === AdminTaskStatus.DONE) {
        doneToday += 1;
        continue;
      }
      if (t.status === AdminTaskStatus.CANCELLED) continue;
      open += 1;
      if (isOverdue(t, now)) overdue += 1;
      if (!t.assignee) unassigned += 1;
      if ((t.reworkCount ?? 0) > 0) rework += 1;
      if (t.blockedReason) blocked += 1;
    }
    return { open, overdue, unassigned, rework, blocked, doneToday };
  }, [tasks, now]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((task) => {
      if (!matchesTopic(task, topic)) return false;
      if (metric === 'overdue' && !isOverdue(task, now)) return false;
      if (metric === 'unassigned' && task.assignee) return false;
      if (metric === 'rework' && !(task.reworkCount ?? 0)) return false;
      if (metric === 'blocked' && !task.blockedReason) return false;
      if (metric === 'done_today' && task.status !== AdminTaskStatus.DONE) {
        return false;
      }
      if (
        metric !== 'done_today' &&
        mode === 'attention' &&
        task.status === AdminTaskStatus.DONE
      ) {
        // attention hides done unless metric says so
      }
      if (!q) return true;
      const hay =
        `${task.title} ${task.description ?? ''} ${task.phone ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [tasks, topic, metric, search, now, mode]);

  const attention = useMemo(
    () =>
      filtered.filter((t) => {
        if (
          t.status === AdminTaskStatus.DONE ||
          t.status === AdminTaskStatus.CANCELLED
        ) {
          return false;
        }
        return (
          isOverdue(t, now) ||
          !t.assignee ||
          (t.reworkCount ?? 0) > 0 ||
          !!t.blockedReason
        );
      }),
    [filtered, now],
  );

  const byPerson = useMemo(() => {
    const map = new Map<string, { name: string; tasks: AdminTaskItem[] }>();
    for (const t of filtered) {
      if (
        t.status === AdminTaskStatus.DONE ||
        t.status === AdminTaskStatus.CANCELLED
      ) {
        continue;
      }
      const id = t.assignee?.id ?? 'pool';
      const name = t.assignee
        ? `${t.assignee.firstName} ${t.assignee.lastName}`.trim()
        : 'Общая очередь';
      const row = map.get(id) ?? { name, tasks: [] };
      row.tasks.push(t);
      map.set(id, row);
    }
    return [...map.entries()].sort((a, b) => b[1].tasks.length - a[1].tasks.length);
  }, [filtered]);

  const detail = tasks.find((t) => t.id === detailId) ?? null;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const create = async () => {
    const token = getToken();
    if (!token || !form.title.trim()) return;
    if (!form.pool && !form.onShift && !form.assigneeIds.length) return;
    await api.superAdminCreateTask(token, {
      assigneeIds: form.pool || form.onShift ? undefined : form.assigneeIds,
      title: form.title,
      description: form.description || undefined,
      dueAt: form.dueAt || undefined,
      completionMode: form.completionMode,
      priority: form.priority,
      pool: form.pool || undefined,
      onShift: form.onShift || undefined,
      checklist: form.checklist
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean),
    });
    setShowForm(false);
    setForm({
      assigneeIds: [],
      title: '',
      description: '',
      dueAt: '',
      completionMode: 'INDIVIDUAL',
      priority: 'NORMAL',
      pool: false,
      onShift: false,
      checklist: '',
    });
    load();
  };

  const assign = async (id: string, assigneeId: string) => {
    const token = getToken();
    if (!token) return;
    if (
      !window.confirm(
        assigneeId
          ? 'Переназначить задачу этому сотруднику?'
          : 'Вернуть в общую очередь?',
      )
    ) {
      return;
    }
    await api.superAdminUpdateTask(token, id, {
      assigneeId: assigneeId || null,
    });
    load();
  };

  const bulkAssign = async () => {
    const token = getToken();
    if (!token || !selected.size) return;
    await api.superAdminBulkUpdateTasks(token, {
      ids: [...selected],
      assigneeId: bulkAssignee || null,
    });
    setSelected(new Set());
    load();
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
    setMode('attention');
    load();
  };

  const submitCancel = async () => {
    const token = getToken();
    if (!token || !cancelId || cancelComment.trim().length < 2) return;
    await api.superAdminUpdateTask(token, cancelId, {
      status: AdminTaskStatus.CANCELLED,
      comment: cancelComment.trim(),
    });
    setCancelId(null);
    setCancelComment('');
    load();
  };

  const applyTemplate = (tpl: AdminTaskTemplateItem) => {
    setShowForm(true);
    setForm((prev) => ({
      ...prev,
      title: tpl.title,
      description: tpl.description ?? '',
      priority: tpl.priority,
      assigneeIds: tpl.assigneeIds,
      pool: tpl.assignMode === 'POOL',
      onShift: tpl.assignMode === 'ON_SHIFT',
      checklist: (tpl.checklist ?? []).join('\n'),
    }));
  };

  const metricBtns: { id: MetricFilter; label: string; value: number }[] = [
    { id: 'all', label: 'Открыто', value: metrics.open },
    { id: 'overdue', label: 'Просрочено', value: metrics.overdue },
    { id: 'unassigned', label: 'Без исполнителя', value: metrics.unassigned },
    { id: 'rework', label: 'Доработка', value: metrics.rework },
    { id: 'blocked', label: 'Не могу', value: metrics.blocked },
    { id: 'done_today', label: 'Сделано сегодня', value: metrics.doneToday },
  ];

  const renderTaskRow = (task: AdminTaskItem, opts?: { check?: boolean }) => {
    const overdue = isOverdue(task, now);
    return (
      <li
        key={task.id}
        className="card flex flex-wrap items-start gap-2 !p-3"
      >
        {opts?.check ? (
          <input
            type="checkbox"
            className="mt-1"
            checked={selected.has(task.id)}
            onChange={() => toggleSelect(task.id)}
          />
        ) : null}
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => setDetailId(task.id)}
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="font-medium">{task.title}</p>
            {overdue ? (
              <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] text-rose-300">
                Просрочено
              </span>
            ) : null}
            {(task.reworkCount ?? 0) > 0 ? (
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-300">
                Доработка
              </span>
            ) : null}
            {task.blockedReason ? (
              <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-200">
                Не могу
              </span>
            ) : null}
          </div>
          <p className="text-xs text-slate-400">
            {task.assignee
              ? `${task.assignee.firstName} ${task.assignee.lastName}`
              : 'Очередь'}
            {task.dueAt ? ` · до ${formatDateTime(task.dueAt)}` : ''}
            {task.priority && task.priority !== 'NORMAL'
              ? ` · ${task.priority}`
              : ''}
          </p>
          {task.blockedReason ? (
            <p className="text-xs text-amber-200/90">{task.blockedReason}</p>
          ) : null}
        </button>
        <div className="flex flex-wrap gap-1">
          {task.status === AdminTaskStatus.DONE ? (
            <button
              type="button"
              className="btn-secondary text-[11px]"
              onClick={() => {
                setReworkTask(task);
                setReworkComment('');
                setReworkPool(false);
                setReworkAssigneeId(task.assignee?.id ?? admins[0]?.id ?? '');
              }}
            >
              Доработка
            </button>
          ) : (
            <button
              type="button"
              className="btn-primary text-[11px]"
              onClick={() => {
                const token = getToken();
                if (!token) return;
                void api
                  .superAdminUpdateTask(token, task.id, {
                    status: AdminTaskStatus.DONE,
                  })
                  .then(load);
              }}
            >
              Закрыть
            </button>
          )}
        </div>
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
          {mode !== 'stats' ? (
            <button
              type="button"
              onClick={() => setShowForm((v) => !v)}
              className="btn-primary text-sm"
            >
              {showForm ? 'Отмена' : '+ Задача'}
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6">
        {metricBtns.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              setMetric(m.id);
              if (mode === 'stats') setMode('attention');
            }}
            className={`rounded-xl border px-2 py-2 text-left ${
              metric === m.id
                ? 'border-fitgo-500/50 bg-fitgo-500/10'
                : 'border-slate-800 bg-slate-900/50'
            }`}
          >
            <p className="text-[10px] text-slate-500">{m.label}</p>
            <p
              className={`text-lg font-semibold tabular-nums ${
                m.id === 'overdue' && m.value > 0 ? 'text-rose-300' : ''
              }`}
            >
              {m.value}
            </p>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['attention', 'Внимание'],
            ['people', 'По людям'],
            ['list', 'Список'],
            ['stats', 'Статистика'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            className={
              mode === id ? 'btn-primary text-sm' : 'btn-secondary text-sm'
            }
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'stats' ? (
        <AdminTaskStatsPanel />
      ) : (
        <>
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
              На смене
            </label>
            <select
              className="input text-sm"
              value={topic}
              onChange={(e) => setTopic(e.target.value as TopicFilter)}
            >
              <option value="all">Все виды</option>
              <option value="manager">От руководителя</option>
              <option value="client_debt">Долги клиентов</option>
              <option value="staff_debt">Долги сотрудников</option>
              <option value="membership">Абонементы</option>
              <option value="installment">Рассрочки</option>
              <option value="birthday">Дни рождения</option>
              <option value="confirmation">Подтверждения</option>
              <option value="pt_sale_check">Продажа ПТ</option>
            </select>
          </div>

          {showForm ? (
            <div className="card space-y-3">
              {templates.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {templates.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      className="btn-secondary text-[11px]"
                      onClick={() => applyTemplate(tpl)}
                    >
                      {tpl.title}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-3 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.pool}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        pool: e.target.checked,
                        onShift: e.target.checked ? false : form.onShift,
                      })
                    }
                  />
                  Общая очередь
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.onShift}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        onShift: e.target.checked,
                        pool: e.target.checked ? false : form.pool,
                      })
                    }
                  />
                  Всем на смене
                </label>
              </div>
              {!form.pool && !form.onShift ? (
                <div className="max-h-32 space-y-1 overflow-y-auto rounded border border-slate-700/50 p-2">
                  {admins.map((a) => (
                    <label
                      key={a.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={form.assigneeIds.includes(a.id)}
                        onChange={() =>
                          setForm((prev) => ({
                            ...prev,
                            assigneeIds: prev.assigneeIds.includes(a.id)
                              ? prev.assigneeIds.filter((x) => x !== a.id)
                              : [...prev.assigneeIds, a.id],
                          }))
                        }
                      />
                      {a.firstName} {a.lastName}
                    </label>
                  ))}
                </div>
              ) : null}
              <select
                className="input text-sm"
                value={form.priority}
                onChange={(e) =>
                  setForm({ ...form, priority: e.target.value })
                }
              >
                <option value="LOW">Низкий</option>
                <option value="NORMAL">Обычный</option>
                <option value="HIGH">Высокий</option>
                <option value="URGENT">Срочный</option>
              </select>
              <input
                className="input w-full"
                placeholder="Заголовок"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
              <textarea
                className="input w-full"
                placeholder="Описание"
                rows={2}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
              <textarea
                className="input w-full"
                placeholder="Чек-лист (по строке)"
                rows={2}
                value={form.checklist}
                onChange={(e) =>
                  setForm({ ...form, checklist: e.target.value })
                }
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => {
                    const end = new Date();
                    end.setHours(23, 0, 0, 0);
                    setForm({ ...form, dueAt: end.toISOString() });
                  }}
                >
                  До конца смены
                </button>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => {
                    const d = new Date();
                    d.setDate(d.getDate() + 1);
                    d.setHours(12, 0, 0, 0);
                    setForm({ ...form, dueAt: d.toISOString() });
                  }}
                >
                  Завтра 12:00
                </button>
              </div>
              <input
                className="input w-full"
                type="datetime-local"
                value={
                  form.dueAt
                    ? new Date(form.dueAt).toISOString().slice(0, 16)
                    : ''
                }
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
                className="btn-primary w-full"
                onClick={() => void create()}
              >
                Создать
              </button>
            </div>
          ) : null}

          {mode === 'list' && selected.size > 0 ? (
            <div className="card flex flex-wrap items-center gap-2 !p-3">
              <span className="text-sm text-slate-400">
                Выбрано {selected.size}
              </span>
              <select
                className="input text-sm"
                value={bulkAssignee}
                onChange={(e) => setBulkAssignee(e.target.value)}
              >
                <option value="">В очередь</option>
                {admins.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.firstName} {a.lastName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={() => void bulkAssign()}
              >
                Переназначить
              </button>
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => setSelected(new Set())}
              >
                Снять выбор
              </button>
            </div>
          ) : null}

          {!loaded && <p className="text-sm text-slate-400">Загрузка…</p>}
          {loadError && (
            <p className="text-sm text-amber-300/90">{loadError}</p>
          )}

          <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
            <div className="space-y-3">
              {mode === 'attention' ? (
                <>
                  <h3 className="text-sm font-semibold text-rose-300">
                    Нужно внимание ({attention.length})
                  </h3>
                  <ul className="space-y-2">
                    {attention.length === 0 ? (
                      <li className="text-sm text-slate-500">Нет исключений</li>
                    ) : (
                      attention.map((t) => renderTaskRow(t))
                    )}
                  </ul>
                </>
              ) : null}

              {mode === 'people' ? (
                <div className="space-y-3">
                  {byPerson.map(([id, row]) => {
                    const overdueN = row.tasks.filter((t) =>
                      isOverdue(t, now),
                    ).length;
                    const expanded = peoplePerson === id;
                    return (
                      <div key={id} className="space-y-2">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2 text-left"
                          onClick={() =>
                            setPeoplePerson((v) => (v === id ? null : id))
                          }
                        >
                          <span className="text-sm text-slate-200">
                            {row.name} · {row.tasks.length}
                          </span>
                          {overdueN > 0 ? (
                            <span className="text-xs text-rose-300">
                              просрочено {overdueN}
                            </span>
                          ) : null}
                        </button>
                        <ul
                          className={`space-y-2 ${
                            expanded ? 'block' : 'hidden lg:block'
                          }`}
                        >
                          {row.tasks.map((t) => renderTaskRow(t))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {mode === 'list' ? (
                <ul className="space-y-2">
                  {filtered.map((t) => renderTaskRow(t, { check: true }))}
                </ul>
              ) : null}
            </div>

            <div className="hidden lg:block">
              {detail ? (
                <div className="card sticky top-4 space-y-3 !p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold">{detail.title}</p>
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() => setDetailId(null)}
                    >
                      Закрыть
                    </button>
                  </div>
                  {detail.description ? (
                    <p className="whitespace-pre-line text-sm text-slate-400">
                      {detail.description}
                    </p>
                  ) : null}
                  {detail.blockedReason ? (
                    <p className="text-sm text-amber-200">
                      Не могу: {detail.blockedReason}
                    </p>
                  ) : null}
                  <select
                    className="input text-sm"
                    value={detail.assignee?.id ?? ''}
                    onChange={(e) => void assign(detail.id, e.target.value)}
                  >
                    <option value="">Общая очередь</option>
                    {admins.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.firstName} {a.lastName}
                      </option>
                    ))}
                  </select>
                  <div className="flex flex-wrap gap-2">
                    {detail.status !== AdminTaskStatus.DONE ? (
                      <>
                        <button
                          type="button"
                          className="btn-primary text-xs"
                          onClick={() => {
                            const token = getToken();
                            if (!token) return;
                            void api
                              .superAdminUpdateTask(token, detail.id, {
                                status: AdminTaskStatus.DONE,
                              })
                              .then(load);
                          }}
                        >
                          Выполнена
                        </button>
                        <button
                          type="button"
                          className="btn-secondary text-xs"
                          onClick={() => {
                            setCancelId(detail.id);
                            setCancelComment('');
                          }}
                        >
                          Отмена
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary text-xs"
                        onClick={() => {
                          setReworkTask(detail);
                          setReworkComment('');
                          setReworkAssigneeId(
                            detail.assignee?.id ?? admins[0]?.id ?? '',
                          );
                        }}
                      >
                        На доработку
                      </button>
                    )}
                  </div>
                  <div className="space-y-1 border-t border-slate-800 pt-2">
                    <p className="text-xs font-medium text-slate-400">
                      Лента событий
                    </p>
                    {events.length === 0 ? (
                      <p className="text-xs text-slate-500">Пока пусто</p>
                    ) : (
                      <ul className="max-h-64 space-y-1 overflow-y-auto text-xs text-slate-400">
                        {events.map((e) => (
                          <li key={e.id}>
                            {formatDateTime(e.createdAt)}
                            {e.actorName ? ` · ${e.actorName}` : ''}
                            {e.comment ? ` — ${e.comment}` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : (
                <div className="card !p-4 text-sm text-slate-500">
                  Выберите задачу для деталей и ленты событий
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Mobile detail sheet */}
      {detail && mode !== 'stats' ? (
        <div className="fixed inset-0 z-30 flex items-end bg-black/60 lg:hidden">
          <div className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-slate-950 p-4">
            <div className="mb-3 flex items-start justify-between gap-2">
              <p className="font-semibold">{detail.title}</p>
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => setDetailId(null)}
              >
                Закрыть
              </button>
            </div>
            <select
              className="input mb-3 w-full text-sm"
              value={detail.assignee?.id ?? ''}
              onChange={(e) => void assign(detail.id, e.target.value)}
            >
              <option value="">Общая очередь</option>
              {admins.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.firstName} {a.lastName}
                </option>
              ))}
            </select>
            <ul className="space-y-1 text-xs text-slate-400">
              {events.map((e) => (
                <li key={e.id}>
                  {formatDateTime(e.createdAt)}
                  {e.comment ? ` — ${e.comment}` : ''}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {cancelId ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="card w-full max-w-md space-y-3">
            <h3 className="font-semibold">Причина отмены</h3>
            <textarea
              className="input w-full"
              rows={3}
              value={cancelComment}
              onChange={(e) => setCancelComment(e.target.value)}
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
              Общая очередь
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
              value={
                reworkDueAt
                  ? new Date(reworkDueAt).toISOString().slice(0, 16)
                  : ''
              }
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
