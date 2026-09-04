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
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Клиенты без 1С</h2>
        <p className="mt-1 text-sm text-slate-400">
          Зарегистрировались в FitGO, но ещё не найдены в CRM по телефону.
          Заведите клиента и штрихкод в 1С — привязка подтянется при обновлении
          карты.
        </p>
      </div>

      {error && <p className="text-red-400">{error}</p>}

      {rows.length === 0 ? (
        <div className="card text-center text-slate-400">Очередь пуста</div>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.membershipId} className="card">
              <p className="font-semibold">
                {row.firstName} {row.lastName}
              </p>
              <p className="text-sm text-slate-400">
                {row.phone ?? 'без телефона'} · {row.email}
              </p>
              <p className="mt-1 text-xs text-slate-500">
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
