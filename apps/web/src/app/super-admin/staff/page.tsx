'use client';

import type { StaffMember, StaffPaySummary } from '@fitgo/shared-types';
import { UserRole } from '@fitgo/shared-types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function randomPassword() {
  return `Fit${Math.random().toString(36).slice(2, 10)}!`;
}

export default function SuperAdminStaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [pay, setPay] = useState<StaffPaySummary[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [credentials, setCredentials] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    phone: '',
    email: '',
    password: randomPassword(),
    role: 'TRAINER' as 'ADMIN' | 'TRAINER' | 'SPECIALIST',
  });
  const [error, setError] = useState('');

  const load = () => {
    const token = getToken();
    if (!token) return;
    Promise.all([
      api.superAdminStaff(token),
      api.payrollStaff(token).catch(() => [] as StaffPaySummary[]),
    ])
      .then(([members, payList]) => {
        setStaff(members);
        setPay(payList);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, []);

  const payById = new Map(pay.map((p) => [p.userId, p]));

  const create = async () => {
    const token = getToken();
    if (!token) return;
    setError('');
    try {
      const result = await api.superAdminCreateStaff(token, {
        ...form,
        dateOfBirth: form.dateOfBirth || undefined,
        phone: form.phone || undefined,
      });
      setCredentials(result.credentials);
      setShowForm(false);
      setForm({
        ...form,
        firstName: '',
        lastName: '',
        email: '',
        password: randomPassword(),
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  const exportCsv = async () => {
    const token = getToken();
    if (!token) return;
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/super-admin/staff/export.csv`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'staff.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold md:text-2xl">Сотрудники</h2>
          <p className="text-sm text-slate-400">
            Чипы мотивации — схема ЗП. Редактирование на карточке сотрудника.
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="btn-primary shrink-0 text-sm"
        >
          {showForm ? 'Отмена' : '+ Добавить'}
        </button>
      </div>

      {credentials && (
        <div className="card border-fitgo-500/30 bg-fitgo-500/5">
          <p className="font-medium text-fitgo-300">
            Учётные данные (сохраните сейчас)
          </p>
          <p className="mt-2 text-sm">Логин: {credentials.email}</p>
          <p className="text-sm">Пароль: {credentials.password}</p>
          <button
            onClick={() => setCredentials(null)}
            className="btn-secondary mt-3 w-full"
          >
            Закрыть
          </button>
        </div>
      )}

      {showForm && (
        <div className="card space-y-3">
          <input
            className="input w-full"
            placeholder="Имя"
            value={form.firstName}
            onChange={(e) => setForm({ ...form, firstName: e.target.value })}
          />
          <input
            className="input w-full"
            placeholder="Фамилия"
            value={form.lastName}
            onChange={(e) => setForm({ ...form, lastName: e.target.value })}
          />
          <input
            className="input w-full"
            type="date"
            value={form.dateOfBirth}
            onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
          />
          <input
            className="input w-full"
            placeholder="Телефон"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <input
            className="input w-full"
            placeholder="Логин (email)"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <div className="flex gap-2">
            <input
              className="input flex-1"
              placeholder="Пароль"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <button
              type="button"
              onClick={() => setForm({ ...form, password: randomPassword() })}
              className="btn-secondary shrink-0"
            >
              Сгенерировать
            </button>
          </div>
          <select
            className="input w-full"
            value={form.role}
            onChange={(e) =>
              setForm({
                ...form,
                role: e.target.value as 'ADMIN' | 'TRAINER' | 'SPECIALIST',
              })
            }
          >
            <option value="TRAINER">Тренер</option>
            <option value="SPECIALIST">Спа-специалист</option>
            <option value="ADMIN">Администратор</option>
          </select>
          <button onClick={create} className="btn-primary w-full">
            Создать
          </button>
        </div>
      )}

      {error && <p className="text-red-400">{error}</p>}

      <button onClick={exportCsv} className="btn-secondary w-full text-sm sm:w-auto">
        Экспорт CSV
      </button>

      <ul className="space-y-2 md:hidden">
        {staff.map((member) => {
          const p = payById.get(member.id);
          return (
            <li key={member.id}>
              <Link
                href={`/super-admin/staff/${member.id}`}
                className="block rounded-2xl border border-slate-800 bg-slate-950/50 p-4 transition hover:border-slate-700"
              >
                <div className="flex justify-between gap-3">
                  <div>
                    <p className="font-medium text-white">
                      {member.firstName} {member.lastName}
                    </p>
                    <p className="text-sm text-slate-400">{member.email}</p>
                  </div>
                  <span
                    className={`shrink-0 text-xs ${
                      member.isActive ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {member.isActive ? 'активен' : 'выкл.'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {member.roles.filter((r) => r !== UserRole.CLIENT).join(', ')}
                  {p?.track ? ` · ${p.track}` : ''}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(p?.payChips ?? ['Ставки не заданы']).map((c) => (
                    <span
                      key={c}
                      className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="hidden overflow-hidden rounded-2xl border border-slate-800 md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-950/80 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Сотрудник</th>
              <th className="px-4 py-3">Роль / схема</th>
              <th className="px-4 py-3">Мотивация</th>
              <th className="px-4 py-3">Статус</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((member) => {
              const p = payById.get(member.id);
              return (
                <tr
                  key={member.id}
                  className="border-t border-slate-900/80 hover:bg-slate-900/40"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/super-admin/staff/${member.id}`}
                      className="font-medium text-white hover:text-fitgo-300"
                    >
                      {member.lastName} {member.firstName}
                    </Link>
                    <p className="text-xs text-slate-500">{member.email}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {member.roles
                      .filter((r) => r !== UserRole.CLIENT)
                      .join(', ')}
                    {p?.track ? (
                      <span className="ml-1 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase text-slate-300">
                        {p.track}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(p?.payChips ?? ['—']).map((c) => (
                        <span
                          key={c}
                          className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300"
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        member.isActive ? 'text-emerald-400' : 'text-red-400'
                      }
                    >
                      {member.isActive ? 'активен' : 'выкл.'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
