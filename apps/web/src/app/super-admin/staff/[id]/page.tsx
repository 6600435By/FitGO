'use client';

import type { StaffMember, StaffPayTrack } from '@fitgo/shared-types';
import { UserRole } from '@fitgo/shared-types';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { StaffPayProfileEditor } from '@/components/payroll/staff-pay-profile-editor';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

type StaffRoleId = 'ADMIN' | 'TRAINER' | 'SPECIALIST' | 'TECH';

const ROLE_OPTIONS: {
  id: StaffRoleId;
  label: string;
  role: UserRole;
}[] = [
  { id: 'TRAINER', label: 'Тренер', role: UserRole.TRAINER },
  { id: 'SPECIALIST', label: 'SPA-специалист', role: UserRole.SPECIALIST },
  { id: 'TECH', label: 'Техперсонал', role: UserRole.TECH },
  { id: 'ADMIN', label: 'Администратор', role: UserRole.ADMIN },
];

export default function SuperAdminStaffDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [member, setMember] = useState<StaffMember | null>(null);
  const [password, setPassword] = useState('');
  const [credentials, setCredentials] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const [message, setMessage] = useState('');
  const [rolesBusy, setRolesBusy] = useState(false);

  const load = () => {
    const token = getToken();
    if (!token) return;
    api.superAdminStaff(token).then((list) => {
      setMember(list.find((s) => s.id === id) ?? null);
    });
  };

  useEffect(() => {
    load();
  }, [id]);

  const suggestedTrack = useMemo((): StaffPayTrack | undefined => {
    if (!member) return undefined;
    if (member.roles.includes(UserRole.SPECIALIST)) return 'SPA';
    if (member.roles.includes(UserRole.TECH)) return 'TECH';
    if (member.roles.includes(UserRole.TRAINER)) return 'PT';
    if (member.roles.includes(UserRole.ADMIN)) return 'ADMIN';
    return undefined;
  }, [member]);

  const toggleActive = async () => {
    const token = getToken();
    if (!token || !member) return;
    await api.superAdminUpdateStaff(token, id, { isActive: !member.isActive });
    setMessage(member.isActive ? 'Деактивирован' : 'Активирован');
    load();
  };

  const resetPassword = async () => {
    const token = getToken();
    if (!token || !password || password.length < 6) return;
    const result = await api.superAdminUpdateStaff(token, id, { password });
    if (result.credentials) setCredentials(result.credentials);
    setPassword('');
    setMessage('Пароль обновлён');
  };

  const toggleRole = async (roleId: StaffRoleId) => {
    const token = getToken();
    if (!token || !member) return;
    const current = ROLE_OPTIONS.filter((r) =>
      member.roles.includes(r.role),
    ).map((r) => r.id);
    const has = current.includes(roleId);
    if (has && current.length === 1) {
      setMessage('Нужно хотя бы одно подразделение');
      return;
    }
    const next = has
      ? current.filter((r) => r !== roleId)
      : [...current, roleId];
    setRolesBusy(true);
    setMessage('');
    try {
      await api.superAdminUpdateStaff(token, id, { roles: next });
      setMessage('Подразделения обновлены');
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setRolesBusy(false);
    }
  };

  if (!member) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/super-admin/staff" className="text-sm text-fitgo-400">
        ← Staff
      </Link>

      <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
        <h2 className="text-xl font-semibold">
          {member.lastName} {member.firstName}
        </h2>
        {member.employeeCode && (
          <p className="text-sm text-slate-300">Код 1С: {member.employeeCode}</p>
        )}
        <p className="text-sm text-slate-400">{member.email}</p>
        {member.loginEnabled === false && (
          <p className="mt-1 text-sm text-amber-300">
            {member.roles.every(
              (r) => r === UserRole.TECH || r === UserRole.CLIENT,
            )
              ? 'Без входа в приложение — только график и ЗП'
              : 'Вход ещё не открыт'}
          </p>
        )}
        {member.phone && (
          <p className="text-sm text-slate-400">{member.phone}</p>
        )}
        {member.dateOfBirth && (
          <p className="text-sm text-slate-400">ДР: {member.dateOfBirth}</p>
        )}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4 space-y-3">
        <div>
          <h3 className="font-medium text-white">Подразделения</h3>
          <p className="text-xs text-slate-400">
            SPA и техперсонал — разные роли. Можно совмещать с тренером или админом.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ROLE_OPTIONS.map((r) => {
            const on = member.roles.includes(r.role);
            return (
              <button
                key={r.id}
                type="button"
                disabled={rolesBusy}
                onClick={() => toggleRole(r.id)}
                className={
                  on
                    ? 'btn-primary px-3 py-1.5 text-sm'
                    : 'btn-secondary px-3 py-1.5 text-sm'
                }
              >
                {r.label}
              </button>
            );
          })}
        </div>
        <div className="border-t border-slate-800 pt-3">
          <p className="mb-2 text-xs text-slate-400">
            Сторонний специалист — отдельная секция в сводном отчёте ЗП
          </p>
          <button
            type="button"
            disabled={rolesBusy}
            className={
              member.employmentKind === 'EXTERNAL'
                ? 'btn-primary px-3 py-1.5 text-sm'
                : 'btn-secondary px-3 py-1.5 text-sm'
            }
            onClick={async () => {
              const token = getToken();
              if (!token) return;
              const next =
                member.employmentKind === 'EXTERNAL' ? 'STAFF' : 'EXTERNAL';
              setRolesBusy(true);
              try {
                await api.payrollSetEmployment(token, id, next);
                setMessage(
                  next === 'EXTERNAL'
                    ? 'Отмечен как сторонний'
                    : 'Штатный сотрудник',
                );
                load();
              } catch (e) {
                setMessage(e instanceof Error ? e.message : 'Ошибка');
              } finally {
                setRolesBusy(false);
              }
            }}
          >
            {member.employmentKind === 'EXTERNAL'
              ? 'Сторонний ✓'
              : 'Сделать сторонним'}
          </button>
        </div>
        {member.roles.includes(UserRole.ADMIN) && (
          <Link
            href={`/super-admin/permissions/${member.id}`}
            className="inline-block text-sm text-fitgo-400"
          >
            Права доступа администратора →
          </Link>
        )}
      </div>

      <StaffPayProfileEditor
        userId={id}
        roles={member.roles}
        suggestedTrack={suggestedTrack}
      />

      {credentials && (
        <div className="card border-fitgo-500/30 bg-fitgo-500/5 text-sm">
          <p>Новый пароль: {credentials.password}</p>
        </div>
      )}

      <button onClick={toggleActive} className="btn-secondary w-full">
        {member.isActive ? 'Деактивировать' : 'Активировать'}
      </button>

      {!member.roles.every(
        (r) => r === UserRole.TECH || r === UserRole.CLIENT,
      ) && (
        <div className="rounded-2xl border border-slate-800 p-4 space-y-2">
          <p className="font-medium">Сброс пароля</p>
          <input
            className="input w-full"
            type="password"
            placeholder="Новый пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button onClick={resetPassword} className="btn-primary w-full">
            Сохранить пароль
          </button>
        </div>
      )}

      {message && <p className="text-fitgo-400 text-sm">{message}</p>}
    </div>
  );
}
