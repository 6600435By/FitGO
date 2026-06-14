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
  const [form, setForm] = useState({ assigneeId: '', title: '', description: '', dueAt: '' });
  const [showForm, setShowForm] = useState(false);

  const load = () => {
    const token = getToken();
    if (!token) return;
    Promise.all([
      api.superAdminTasks(token),
      api.superAdminStaff(token),
    ]).then(([taskList, staff]) => {
      setTasks(taskList);
      setAdmins(staff.filter((s) => s.roles.includes(UserRole.ADMIN) && s.isActive));
    });
  };

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    const token = getToken();
    if (!token || !form.assigneeId || !form.title.trim()) return;
    await api.superAdminCreateTask(token, {
      assigneeId: form.assigneeId,
      title: form.title,
      description: form.description || undefined,
      dueAt: form.dueAt || undefined,
    });
    setShowForm(false);
    setForm({ assigneeId: '', title: '', description: '', dueAt: '' });
    load();
  };

  const setStatus = async (id: string, status: AdminTaskStatus) => {
    const token = getToken();
    if (!token) return;
    await api.superAdminUpdateTask(token, id, { status });
    load();
  };

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
        <button onClick={() => setShowForm(!showForm)} className="btn-primary text-sm">
          {showForm ? 'Отмена' : '+ Задача'}
        </button>
      </div>

      {showForm && (
        <div className="card space-y-3">
          <select className="input w-full" value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>
            <option value="">Выберите администратора</option>
            {admins.map((a) => (
              <option key={a.id} value={a.id}>{a.firstName} {a.lastName}</option>
            ))}
          </select>
          <input className="input w-full" placeholder="Заголовок" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <textarea className="input w-full" placeholder="Описание" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
          <input className="input w-full" type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value ? new Date(e.target.value).toISOString() : '' })} />
          <button onClick={create} className="btn-primary w-full">Создать</button>
        </div>
      )}

      <ul className="space-y-3">
        {tasks.map((task) => (
          <li key={task.id} className="card">
            <div className="flex justify-between gap-2">
              <div>
                <p className="font-medium">{task.title}</p>
                <p className="text-sm text-slate-400">
                  {task.assignee.firstName} {task.assignee.lastName}
                </p>
                {task.dueAt && (
                  <p className="text-xs text-slate-500">До: {formatDateTime(task.dueAt)}</p>
                )}
              </div>
              <span className="text-xs text-slate-400">{statusLabel[task.status]}</span>
            </div>
            {task.status !== AdminTaskStatus.DONE && task.status !== AdminTaskStatus.CANCELLED && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => setStatus(task.id, AdminTaskStatus.IN_PROGRESS)} className="btn-secondary text-xs">В работу</button>
                <button onClick={() => setStatus(task.id, AdminTaskStatus.DONE)} className="btn-primary text-xs">Выполнена</button>
                <button onClick={() => setStatus(task.id, AdminTaskStatus.CANCELLED)} className="btn-secondary text-xs">Отмена</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
