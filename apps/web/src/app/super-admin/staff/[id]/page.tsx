'use client';

import type { StaffMember, StaffPayTrack } from '@fitgo/shared-types';
import { UserRole } from '@fitgo/shared-types';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { StaffPayProfileEditor } from '@/components/payroll/staff-pay-profile-editor';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export default function SuperAdminStaffDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [member, setMember] = useState<StaffMember | null>(null);
  const [password, setPassword] = useState('');
  const [credentials, setCredentials] = useState<{
    email: string;
    password: string;
  } | null>(null);
  const [message, setMessage] = useState('');

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
          {member.firstName} {member.lastName}
        </h2>
        <p className="text-sm text-slate-400">{member.email}</p>
        {member.phone && (
          <p className="text-sm text-slate-400">{member.phone}</p>
        )}
        {member.dateOfBirth && (
          <p className="text-sm text-slate-400">ДР: {member.dateOfBirth}</p>
        )}
        <p className="mt-2 text-xs text-slate-500">
          {member.roles.filter((r) => r !== UserRole.CLIENT).join(', ')}
        </p>
      </div>

      <StaffPayProfileEditor userId={id} suggestedTrack={suggestedTrack} />

      {credentials && (
        <div className="card border-fitgo-500/30 bg-fitgo-500/5 text-sm">
          <p>Новый пароль: {credentials.password}</p>
        </div>
      )}

      <button onClick={toggleActive} className="btn-secondary w-full">
        {member.isActive ? 'Деактивировать' : 'Активировать'}
      </button>

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

      {member.roles.includes(UserRole.ADMIN) && (
        <Link
          href={`/super-admin/permissions/${member.id}`}
          className="block text-sm text-fitgo-400"
        >
          Права доступа →
        </Link>
      )}

      {message && <p className="text-fitgo-400 text-sm">{message}</p>}
    </div>
  );
}
