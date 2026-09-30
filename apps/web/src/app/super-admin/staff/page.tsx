'use client';

import type { StaffMember, StaffPaySummary } from '@fitgo/shared-types';
import { UserRole } from '@fitgo/shared-types';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function randomPassword() {
  return `Fit${Math.random().toString(36).slice(2, 10)}!`;
}

type DeptFilter =
  | 'ALL'
  | 'MANAGER'
  | 'ADMIN'
  | 'TRAINER_GP'
  | 'TRAINER_STAFF'
  | 'TRAINER_CLUB'
  | 'SPECIALIST'
  | 'TECH';

const DEPT_FILTERS: { id: DeptFilter; label: string }[] = [
  { id: 'ALL', label: 'Все' },
  { id: 'MANAGER', label: 'Упр.' },
  { id: 'ADMIN', label: 'Админы' },
  { id: 'TRAINER_GP', label: 'Тренеры ГП' },
  { id: 'TRAINER_STAFF', label: 'Тренеры штат' },
  { id: 'TRAINER_CLUB', label: 'Тренеры клуб' },
  { id: 'SPECIALIST', label: 'SPA' },
  { id: 'TECH', label: 'Техперсонал' },
];

type StaffRoleId = 'ADMIN' | 'MANAGER' | 'TRAINER' | 'SPECIALIST' | 'TECH';

const ROLE_OPTIONS: {
  id: StaffRoleId;
  label: string;
}[] = [
  { id: 'MANAGER', label: 'Управляющий' },
  { id: 'TRAINER', label: 'Тренер' },
  { id: 'SPECIALIST', label: 'SPA-специалист' },
  { id: 'TECH', label: 'Техперсонал' },
  { id: 'ADMIN', label: 'Администратор' },
];

function formatRoles(roles: UserRole[]): string {
  return roles
    .filter((r) => r !== UserRole.CLIENT)
    .map((r) => {
      if (r === UserRole.MANAGER) return 'Упр.';
      if (r === UserRole.ADMIN) return 'Админ';
      if (r === UserRole.TRAINER) return 'Тренер';
      if (r === UserRole.SPECIALIST) return 'SPA';
      if (r === UserRole.TECH) return 'Техперсонал';
      return r;
    })
    .join(', ');
}

function needsAppLogin(roles: StaffRoleId[]): boolean {
  return roles.some(
    (r) =>
      r === 'ADMIN' ||
      r === 'MANAGER' ||
      r === 'TRAINER' ||
      r === 'SPECIALIST',
  );
}

function trainerGroupLabels(member: StaffMember): string[] {
  if (!member.roles.includes(UserRole.TRAINER)) return [];
  const labels: string[] = [];
  if (member.groupPrograms) labels.push('ГП');
  if (member.trainerStaff) labels.push('Штат');
  if (member.trainerClub) labels.push('Клуб');
  return labels;
}

function isTechOnlyMember(roles: UserRole[]): boolean {
  const staff = roles.filter((r) => r !== UserRole.CLIENT);
  return staff.length > 0 && staff.every((r) => r === UserRole.TECH);
}

export default function SuperAdminStaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [pay, setPay] = useState<StaffPaySummary[]>([]);
  const [filter, setFilter] = useState<DeptFilter>('ALL');
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
    loginTouched: false,
    password: randomPassword(),
    roles: ['TRAINER'] as StaffRoleId[],
    trainerGp: false,
    trainerStaff: true,
    trainerClub: false,
  });
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

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

  const visible = useMemo(() => {
    if (filter === 'ALL') return staff;
    if (filter === 'MANAGER') {
      return staff.filter((m) => m.roles.includes(UserRole.MANAGER));
    }
    if (filter === 'TRAINER_GP') {
      return staff.filter((m) => m.groupPrograms);
    }
    if (filter === 'TRAINER_STAFF') {
      return staff.filter((m) => m.trainerStaff);
    }
    if (filter === 'TRAINER_CLUB') {
      return staff.filter((m) => m.trainerClub);
    }
    if (filter === 'ADMIN') {
      return staff.filter((m) => m.roles.includes(UserRole.ADMIN));
    }
    if (filter === 'SPECIALIST') {
      return staff.filter((m) => m.roles.includes(UserRole.SPECIALIST));
    }
    if (filter === 'TECH') {
      return staff.filter((m) => m.roles.includes(UserRole.TECH));
    }
    return staff;
  }, [staff, filter]);

  const toggleFormRole = (role: StaffRoleId) => {
    setForm((prev) => {
      const has = prev.roles.includes(role);
      if (has && prev.roles.length === 1) return prev;
      return {
        ...prev,
        roles: has
          ? prev.roles.filter((r) => r !== role)
          : [...prev.roles, role],
      };
    });
  };

  const create = async () => {
    const token = getToken();
    if (!token) return;
    setError('');
    const appLogin = needsAppLogin(form.roles);
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError('Укажите имя и фамилию');
      return;
    }
    if (appLogin && form.password.length < 6) {
      setError('Пароль не короче 6 символов. Логин по умолчанию — фамилия, его можно изменить.');
      return;
    }
    try {
      const result = await api.superAdminCreateStaff(token, {
        firstName: form.firstName,
        lastName: form.lastName,
        dateOfBirth: form.dateOfBirth || undefined,
        phone: form.phone || undefined,
        roles: form.roles,
        ...(form.roles.includes('TRAINER')
          ? {
              groupPrograms: form.trainerGp,
              trainerStaff: form.trainerStaff,
              trainerClub: form.trainerClub,
            }
          : {}),
        ...(appLogin
          ? {
              ...(form.email.trim() ? { email: form.email.trim() } : {}),
              password: form.password,
            }
          : {}),
      });
      if (result.credentials) setCredentials(result.credentials);
      setShowForm(false);
      setForm({
        firstName: '',
        lastName: '',
        dateOfBirth: '',
        phone: '',
        email: '',
        loginTouched: false,
        password: randomPassword(),
        roles: ['TRAINER'],
        trainerGp: false,
        trainerStaff: true,
        trainerClub: false,
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
      `${(process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '')}/api/super-admin/staff/export.csv`,
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
            Тренеры делятся на ГП, штат и клуб. Группы и ставки — на карточке,
            оттуда схема копируется на выбранные группы.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            className="btn-secondary text-sm"
            disabled={syncing}
            onClick={async () => {
              const token = getToken();
              if (!token) return;
              setSyncing(true);
              setError('');
              setSyncMsg('');
              try {
                const res = await api.superAdminSyncStaffFrom1C(token, true);
                const added = res.results.reduce((s, r) => s + r.added, 0);
                const updated = res.results.reduce((s, r) => s + r.updated, 0);
                const fetched = res.results.reduce(
                  (s, r) => s + (r.fetched ?? 0),
                  0,
                );
                const pruned = res.results.reduce(
                  (s, r) => s + (r.pruned ?? 0),
                  0,
                );
                const removed = res.removed ?? 0;
                const errs = res.results
                  .filter((r) => r.error)
                  .map((r) => `${r.key}: ${r.error}`)
                  .join('; ');
                setSyncMsg(
                  `Из 1С: удалено stub ${removed}, получено ${fetched}, +${added} новых, ${updated} обновлено, снято лишних ${pruned}` +
                    (errs ? `. ${errs}` : ''),
                );
                if (res.credentials[0]) {
                  setCredentials({
                    email: res.credentials[0].email,
                    password: res.credentials[0].password,
                  });
                }
                load();
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Ошибка sync');
              } finally {
                setSyncing(false);
              }
            }}
          >
            {syncing ? 'Обновляем…' : 'Обновить из 1С'}
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="btn-primary text-sm"
          >
            {showForm ? 'Отмена' : '+ Добавить'}
          </button>
        </div>
      </div>

      {syncMsg ? (
        <p className="text-sm text-fitgo-300">{syncMsg}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {DEPT_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={
              filter === f.id
                ? 'btn-primary px-3 py-1.5 text-sm'
                : 'btn-secondary px-3 py-1.5 text-sm'
            }
          >
            {f.label}
          </button>
        ))}
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
          <label className="block text-xs text-slate-400">
            Имя
            <input
              className="input mt-1 w-full"
              value={form.firstName}
              onChange={(e) => setForm({ ...form, firstName: e.target.value })}
            />
          </label>
          <label className="block text-xs text-slate-400">
            Фамилия
            <input
              className="input mt-1 w-full"
              value={form.lastName}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  lastName: e.target.value,
                  email: prev.loginTouched
                    ? prev.email
                    : e.target.value.trim().replace(/\s+/g, ''),
                }))
              }
            />
          </label>
          <label className="block text-xs text-slate-400">
            Дата рождения
            <input
              className="input mt-1 w-full"
              type="date"
              value={form.dateOfBirth}
              onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
            />
          </label>
          <label className="block text-xs text-slate-400">
            Телефон
            <input
              className="input mt-1 w-full"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </label>
          <div>
            <p className="text-xs text-slate-400">Подразделения (можно несколько)</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {ROLE_OPTIONS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => toggleFormRole(r.id)}
                  className={
                    form.roles.includes(r.id)
                      ? 'btn-primary px-3 py-1.5 text-sm'
                      : 'btn-secondary px-3 py-1.5 text-sm'
                  }
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          {form.roles.includes('TRAINER') ? (
            <div>
              <p className="text-xs text-slate-400">
                Группы тренера (можно несколько)
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(
                  [
                    ['trainerGp', 'Тренеры ГП'],
                    ['trainerStaff', 'Тренеры штат'],
                    ['trainerClub', 'Тренеры клуб'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() =>
                      setForm((prev) => ({ ...prev, [key]: !prev[key] }))
                    }
                    className={
                      form[key]
                        ? 'btn-primary px-3 py-1.5 text-sm'
                        : 'btn-secondary px-3 py-1.5 text-sm'
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {needsAppLogin(form.roles) ? (
            <>
              <label className="block text-xs text-slate-400">
                Логин
                <input
                  className="input mt-1 w-full"
                  placeholder="По умолчанию фамилия"
                  value={form.email}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      email: e.target.value,
                      loginTouched: true,
                    })
                  }
                />
              </label>
              <label className="block text-xs text-slate-400">
                Пароль
                <div className="mt-1 flex gap-2">
                  <input
                    className="input flex-1"
                    value={form.password}
                    onChange={(e) =>
                      setForm({ ...form, password: e.target.value })
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setForm({ ...form, password: randomPassword() })
                    }
                    className="btn-secondary shrink-0"
                  >
                    Сгенерировать
                  </button>
                </div>
              </label>
            </>
          ) : (
            <p className="rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2 text-xs text-slate-400">
              Техперсонал без входа в приложение — только график смен, учёт часов
              и расчёт ЗП.
            </p>
          )}
          <p className="text-xs text-slate-500">
            Ставки и мотивация задаются после создания — откройте карточку сотрудника.
          </p>
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
        {visible.map((member) => {
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
                      {member.lastName} {member.firstName}
                    </p>
                    <p className="text-sm text-slate-400">Логин: {member.email}</p>
                    {isTechOnlyMember(member.roles) ? (
                      <p className="text-xs text-slate-500">Без входа в приложение</p>
                    ) : member.loginEnabled === false ? (
                      <p className="text-xs text-amber-300">Вход ещё не открыт</p>
                    ) : null}
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
                  {formatRoles(member.roles)}
                  {trainerGroupLabels(member).length
                    ? ` · ${trainerGroupLabels(member).join(', ')}`
                    : ''}
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
            {visible.map((member) => {
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
                    <p className="text-xs text-slate-500">
                      Логин: {member.email}
                      {isTechOnlyMember(member.roles)
                        ? ' · без входа'
                        : member.loginEnabled === false
                          ? ' · вход позже'
                          : ''}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {formatRoles(member.roles)}
                    {trainerGroupLabels(member).length ? (
                      <span className="mt-1 block text-xs text-slate-300">
                        {trainerGroupLabels(member).join(' · ')}
                      </span>
                    ) : null}
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
