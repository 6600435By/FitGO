'use client';

import type { TrustExceptionItem } from '@fitgo/shared-types';
import { TRUST_REASON_LABELS } from '@fitgo/shared-types';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

export default function AdminExceptionsPage() {
  const [items, setItems] = useState<TrustExceptionItem[]>([]);
  const [note, setNote] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');

  const load = useCallback(() => {
    const token = getToken();
    if (!token) return;
    api
      .adminGroupSessionExceptions(token)
      .then(setItems)
      .catch((e) => setMessage(e.message || 'Ошибка'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Нестыковки групп</h1>
      <p className="text-sm text-slate-400">
        Журналы занятий с жёлтым/красным доверием. Зелёные сюда не попадают.
      </p>
      {message && <p className="text-sm text-red-400">{message}</p>}
      {items.length === 0 ? (
        <p className="text-emerald-400">Очередь пуста.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded border border-slate-800 p-3 space-y-2"
            >
              <p className="font-medium">{item.title}</p>
              <p className="text-sm text-slate-400">
                {item.performerName} · {formatDateTime(item.startAt)} ·{' '}
                <span className="text-amber-300">{item.trustBand}</span>
              </p>
              <p className="text-xs text-slate-500">
                эталон {item.baselineCount} / факт {item.attendedCount} ·{' '}
                {item.trustReasons
                  .map(
                    (c) =>
                      TRUST_REASON_LABELS[
                        c as keyof typeof TRUST_REASON_LABELS
                      ] ?? c,
                  )
                  .join(' · ')}
              </p>
              <div className="flex flex-wrap gap-2">
                <input
                  className="input flex-1"
                  placeholder="Причина"
                  value={note[item.id] ?? ''}
                  onChange={(e) =>
                    setNote((p) => ({ ...p, [item.id]: e.target.value }))
                  }
                />
                <button
                  type="button"
                  className="btn-primary"
                  onClick={async () => {
                    const token = getToken();
                    if (!token || !note[item.id]?.trim()) return;
                    await api.adminResolveGroupSession(
                      token,
                      item.id,
                      note[item.id],
                    );
                    load();
                  }}
                >
                  Принять
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={async () => {
                    const token = getToken();
                    if (!token) return;
                    await api.adminReturnGroupSession(token, item.id);
                    load();
                  }}
                >
                  Вернуть
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
