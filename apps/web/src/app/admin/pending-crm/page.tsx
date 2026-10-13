'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

interface PendingRow {
  membershipId: string;
  userId: string;
  firstName: string;
  lastName: string;
  phone?: string;
  email: string;
  joinedAt: string;
  lastCrmSyncAt?: string;
}

export default function AdminPendingCrmPage() {
  const [rows, setRows] = useState<PendingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api
      .adminPendingCrm(token)
      .then(setRows)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <p className="text-sm text-slate-400">
        Зарегистрировались в FitGO, но ещё не найдены в CRM по телефону.
        Заведите клиента и штрихкод в 1С — привязка подтянется при обновлении
        карты.
      </p>

      {error && <p className="text-red-400">{error}</p>}

      {rows.length === 0 ? (
        <p className="card py-3 text-sm text-slate-400">Очередь пуста</p>
      ) : (
        <ul className="card divide-y divide-slate-800 !p-0 overflow-hidden">
          {rows.map((row) => (
            <li key={row.membershipId} className="px-4 py-3">
              <p className="font-semibold">
                {row.firstName} {row.lastName}
              </p>
              <p className="text-sm text-slate-400">
                {row.phone ?? 'без телефона'} · {row.email}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Вступил: {formatDateTime(row.joinedAt)}
                {row.lastCrmSyncAt
                  ? ` · sync ${formatDateTime(row.lastCrmSyncAt)}`
                  : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
