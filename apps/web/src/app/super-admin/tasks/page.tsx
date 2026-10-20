'use client';

import type { AdminTaskItem, StaffMember } from '@fitgo/shared-types';
import { AdminTaskStatus, UserRole } from '@fitgo/shared-types';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { BirthdayCallScript } from '@/components/admin/birthday-call-script';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
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

function SuperAdminTasksInner() {
  const searchParams = useSearchParams();
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
  const [topic, setTopic] = useState<TopicFilter>(() =>
    parseTopic(searchParams.get('topic')),
  );

  const load = () => {
    const token = getToken();
    if (!token) return;
    setLoadError(null);
    Promise.all([api.superAdminTasks(token), api.superAdminStaff(token)])
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
  }, []);

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

  const setStatus = async (id: string, status: AdminTaskStatus) => {
    const token = getToken();
    if (!token) return;
    await api.superAdminUpdateTask(token, id, { status });
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
  const visible = tasks.filter((task) => {
    if (topic === 'all') return true;
    if (topic === 'manager') {
      return task.source === 'MANAGER' || task.topic === 'manager';
    }
    if (topic === 'birthday') {
      return task.source === 'BIRTHDAY' || task.topic === 'birthday';
    }
    return task.topic === topic;
  });

  const statusLabel: Record<AdminTaskStatus, string> = {
    OPEN: 'Открыта',
    IN_PROGRESS: 'В работе',
    DONE: 'Выполнена',
    CANCELLED: 'Отменена',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Задачи админов</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="btn-primary text-sm"
        >
          {showForm ? 'Отмена' : '+ Задача'}
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
          </button>
        ))}
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
                onChange={() => setForm({ ...form, completionMode: 'SHARED' })}
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
            onChange={(e) => setForm({ ...form, description: e.target.value })}
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
          <button onClick={() => void create()} className="btn-primary w-full">
            Создать
          </button>
        </div>
      )}

      <ul className="space-y-3">
        {!loaded && (
          <li className="text-sm text-slate-400">Загрузка задач…</li>
        )}
        {loaded && loadError && (
          <li className="text-sm text-amber-300/90">{loadError}</li>
        )}
        {loaded && !loadError && visible.length === 0 && (
          <li className="text-sm text-slate-400">Нет задач в этом фильтре</li>
        )}
        {visible.map((task) => {
          const isBirthday =
            task.source === 'BIRTHDAY' || task.topic === 'birthday';
          return (
            <li key={task.id} className="card space-y-2">
              <div className="flex justify-between gap-2">
                <div>
                  <p className="font-medium">{task.title}</p>
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
                      {task.completionMode === 'SHARED'
                        ? 'Общее'
                        : 'Раздельно'}{' '}
                      · {task.groupProgress.done}/{task.groupProgress.total}
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
                  <div className="mt-1 flex flex-wrap gap-2">
                    {!isBirthday ? (
                      <button
                        onClick={() =>
                          void setStatus(task.id, AdminTaskStatus.IN_PROGRESS)
                        }
                        className="btn-secondary text-xs"
                      >
                        В работу
                      </button>
                    ) : null}
                    <button
                      onClick={() =>
                        void setStatus(task.id, AdminTaskStatus.DONE)
                      }
                      className="btn-primary text-xs"
                    >
                      {isBirthday ? 'Поздравили' : 'Выполнена'}
                    </button>
                    {!isBirthday ? (
                      <button
                        onClick={() =>
                          void setStatus(task.id, AdminTaskStatus.CANCELLED)
                        }
                        className="btn-secondary text-xs"
                      >
                        Отмена
                      </button>
                    ) : null}
                  </div>
                )}
            </li>
          );
        })}
      </ul>
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
