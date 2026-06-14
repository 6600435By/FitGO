'use client';

import type { StaffMember } from '@fitgo/shared-types';
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
  const [showForm, setShowForm] = useState(false);
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    phone: '',
    email: '',
    password: randomPassword(),
    role: 'TRAINER' as 'ADMIN' | 'TRAINER',
  });
  const [error, setError] = useState('');

  const load = () => {
    const token = getToken();
    if (!token) return;
    api.superAdminStaff(token).then(setStaff).catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, []);

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
      setForm({ ...form, firstName: '', lastName: '', email: '', password: randomPassword() });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  const exportCsv = async () => {
    const token = getToken();
    if (!token) return;
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/super-admin/staff/export.csv`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'staff.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Сотрудники</h2>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary text-sm">
          {showForm ? 'Отмена' : '+ Добавить'}
        </button>
      </div>

      {credentials && (
        <div className="card border-fitgo-500/30 bg-fitgo-500/5">
          <p className="font-medium text-fitgo-300">Учётные данные (сохраните сейчас)</p>
          <p className="mt-2 text-sm">Логин: {credentials.email}</p>
          <p className="text-sm">Пароль: {credentials.password}</p>
          <button onClick={() => setCredentials(null)} className="btn-secondary mt-3 w-full">
            Закрыть
          </button>
        </div>
      )}

      {showForm && (
        <div className="card space-y-3">
          <input className="input w-full" placeholder="Имя" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          <input className="input w-full" placeholder="Фамилия" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          <input className="input w-full" type="date" placeholder="Дата рождения" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} />
          <input className="input w-full" placeholder="Телефон" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <input className="input w-full" placeholder="Логин (email)" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <div className="flex gap-2">
            <input className="input flex-1" placeholder="Пароль" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <button type="button" onClick={() => setForm({ ...form, password: randomPassword() })} className="btn-secondary shrink-0">
              Сгенерировать
            </button>
          </div>
          <select className="input w-full" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'ADMIN' | 'TRAINER' })}>
            <option value="TRAINER">Тренер</option>
            <option value="ADMIN">Администратор</option>
          </select>
          <button onClick={create} className="btn-primary w-full">Создать</button>
        </div>
      )}

      {error && <p className="text-red-400">{error}</p>}

      <button onClick={exportCsv} className="btn-secondary w-full text-sm">
        Экспорт CSV
      </button>

      <ul className="space-y-2">
        {staff.map((member) => (
          <li key={member.id}>
            <Link href={`/super-admin/staff/${member.id}`} className="card block">
              <div className="flex justify-between">
                <div>
                  <p className="font-medium">{member.firstName} {member.lastName}</p>
                  <p className="text-sm text-slate-400">{member.email}</p>
                </div>
                <span className={`text-xs ${member.isActive ? 'text-emerald-400' : 'text-red-400'}`}>
                  {member.isActive ? 'активен' : 'выкл.'}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {member.roles.filter((r) => r !== UserRole.CLIENT).join(', ')}
              </p>
              {member.roles.includes(UserRole.ADMIN) && (
                <Link href={`/super-admin/permissions/${member.id}`} onClick={(e) => e.stopPropagation()} className="mt-2 inline-block text-sm text-fitgo-400">
                  Права доступа →
                </Link>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
