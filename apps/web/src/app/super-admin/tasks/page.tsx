'use client';

import type { AdminTaskItem, StaffMember } from '@fitgo/shared-types';
import { AdminTaskStatus, UserRole } from '@fitgo/shared-types';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

export default function SuperAdminTasksPage() {
  const [tasks, setTasks] = useState<AdminTaskItem[]>([]);
  const [admins, setAdmins] = useState<StaffMember[]>([]);
  const [form, setForm] = useState({
    assigneeIds: [] as string[],
    title: '',
    description: '',
    dueAt: '',
    completionMode: 'INDIVIDUAL' as 'SHARED' | 'INDIVIDUAL',
  });
  const [showForm, setShowForm] = useState(false);
  const [topic, setTopic] = useState<
    'all' | 'manager' | 'staff_debt' | 'client_debt' | 'membership' | 'installment'
  >('all');

  const load = () => {
    const token = getToken();
    if (!token) return;
    Promise.all([api.superAdminTasks(token), api.superAdminStaff(token)]).then(
      ([taskList, staff]) => {
        setTasks(taskList);
        setAdmins(
          staff.filter((s) => s.roles.includes(UserRole.ADMIN) && s.isActive),
        );
      },
    );
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

  const filters = [
    { id: 'all' as const, label: 'Все' },
    { id: 'manager' as const, label: 'От руководителя' },
    { id: 'staff_debt' as const, label: 'Долги сотрудников' },
    { id: 'client_debt' as const, label: 'Долги клиентов' },
    { id: 'installment' as const, label: 'Рассрочки' },
    { id: 'membership' as const, label: 'Абонементы' },
  ];
  const visible = tasks.filter((task) => {
    if (topic === 'all') return true;
    if (topic === 'manager') return task.source === 'MANAGER' || task.topic === 'manager';
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
        {visible.length === 0 && (
          <li className="text-sm text-slate-400">Нет задач в этом фильтре</li>
        )}
        {visible.map((task) => (
          <li key={task.id} className="card">
            <div className="flex justify-between gap-2">
              <div>
                <p className="font-medium">{task.title}</p>
                <p className="text-sm text-slate-400">
                  {task.assignee
                    ? `${task.assignee.firstName} ${task.assignee.lastName}`
                    : 'Общая очередь'}
                  {task.source && task.source !== 'MANUAL' ? (
                    <span className="ml-2 text-xs text-amber-300/90">
                      ·{' '}
                      {task.source === 'STAFF_DEBT' ||
                      task.source === 'CLIENT_DEBT'
                        ? task.source === 'STAFF_DEBT'
                          ? 'авто: долг сотрудника'
                          : 'авто: долг клиента'
                        : task.source === 'DEBT_OVERDUE'
                          ? 'авто: долг клиента'
                          : task.source === 'MEMBERSHIP_EXPIRING'
                            ? 'авто: абонемент'
                            : task.source === 'INSTALLMENT_PAYMENT'
                              ? 'авто: рассрочка'
                              : task.source === 'MANAGER'
                                ? 'от руководителя'
                                : task.source}
                    </span>
                  ) : null}
                </p>
                {task.groupProgress ? (
                  <p className="text-xs text-slate-500">
                    {task.completionMode === 'SHARED' ? 'Общее' : 'Раздельно'} ·{' '}
                    {task.groupProgress.done}/{task.groupProgress.total}
                    {task.groupProgress.assignees.length
                      ? ` · ${task.groupProgress.assignees.join(', ')}`
                      : ''}
                  </p>
                ) : null}
                {task.dueAt && (
                  <p className="text-xs text-slate-500">
                    До: {formatDateTime(task.dueAt)}
                  </p>
                )}
              </div>
              <span className="text-xs text-slate-400">
                {statusLabel[task.status]}
              </span>
            </div>
            {task.status !== AdminTaskStatus.DONE &&
              task.status !== AdminTaskStatus.CANCELLED && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() =>
                      void setStatus(task.id, AdminTaskStatus.IN_PROGRESS)
                    }
                    className="btn-secondary text-xs"
                  >
                    В работу
                  </button>
                  <button
                    onClick={() =>
                      void setStatus(task.id, AdminTaskStatus.DONE)
                    }
                    className="btn-primary text-xs"
                  >
                    Выполнена
                  </button>
                  <button
                    onClick={() =>
                      void setStatus(task.id, AdminTaskStatus.CANCELLED)
                    }
                    className="btn-secondary text-xs"
                  >
                    Отмена
                  </button>
                </div>
              )}
          </li>
        ))}
      </ul>
    </div>
  );
}
