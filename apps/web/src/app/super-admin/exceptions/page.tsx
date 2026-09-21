'use client';

import type { TrustExceptionItem } from '@fitgo/shared-types';
import { TRUST_REASON_LABELS } from '@fitgo/shared-types';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

function bandClass(band: string) {
  if (band === 'GREEN') return 'text-emerald-400';
  if (band === 'RED') return 'text-red-400';
  return 'text-amber-300';
}

export default function TrustExceptionsPage() {
  const [spaPt, setSpaPt] = useState<TrustExceptionItem[]>([]);
  const [groups, setGroups] = useState<TrustExceptionItem[]>([]);
  const [note, setNote] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    Promise.all([
      api.superAdminTrustExceptions(token),
      api.adminGroupSessionExceptions(token),
    ])
      .then(([a, b]) => {
        setSpaPt(a);
        setGroups(b);
      })
      .catch((e) => setMessage(e.message || 'Ошибка'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const resolveSpaPt = async (item: TrustExceptionItem) => {
    const token = getToken();
    if (!token || item.kind === 'GROUP_SESSION') return;
    const n = note[item.id]?.trim();
    if (!n) {
      setMessage('Укажите причину');
      return;
    }
    await api.superAdminResolveTrust(token, item.kind, item.id, n);
    load();
  };

  const resolveGroup = async (item: TrustExceptionItem) => {
    const token = getToken();
    if (!token) return;
    const n = note[item.id]?.trim();
    if (!n) {
      setMessage('Укажите причину');
      return;
    }
    await api.adminResolveGroupSession(token, item.id, n);
    load();
  };

  const returnGroup = async (item: TrustExceptionItem) => {
    const token = getToken();
    if (!token) return;
    await api.adminReturnGroupSession(token, item.id);
    load();
  };

  const all = [...spaPt, ...groups].sort(
    (a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime(),
  );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Нестыковки</h1>
      <p className="text-sm text-slate-400">
        Только жёлтые и красные. Зелёный путь в ЗП идёт без этой очереди.
      </p>
      {message && <p className="text-sm text-red-400">{message}</p>}
      {loading ? (
        <p className="text-slate-400">Загрузка…</p>
      ) : all.length === 0 ? (
        <p className="text-emerald-400">Очередь пуста — всё сходится.</p>
      ) : (
        <ul className="space-y-3">
          {all.map((item) => (
            <li
              key={`${item.kind}-${item.id}`}
              className="rounded border border-slate-800 p-3 space-y-2"
            >
              <div className="flex flex-wrap gap-2 justify-between">
                <div>
                  <p className="font-medium">{item.title}</p>
                  <p className="text-sm text-slate-400">
                    {item.performerName}
                    {item.clientName ? ` · ${item.clientName}` : ''}
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(item.startAt)} · {item.kind}
                    {item.baselineCount != null
                      ? ` · эталон ${item.baselineCount} / факт ${item.attendedCount ?? '—'}`
                      : ''}
                  </p>
                </div>
                <span className={`text-sm font-semibold ${bandClass(item.trustBand)}`}>
                  {item.trustBand}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {item.trustReasons
                  .map(
                    (c) =>
                      TRUST_REASON_LABELS[
                        c as keyof typeof TRUST_REASON_LABELS
                      ] ?? c,
                  )
                  .join(' · ')}
              </p>
              <div className="flex flex-wrap gap-2 items-end">
                <input
                  className="input flex-1 min-w-[12rem]"
                  placeholder="Причина принятия"
                  value={note[item.id] ?? ''}
                  onChange={(e) =>
                    setNote((prev) => ({ ...prev, [item.id]: e.target.value }))
                  }
                />
                {item.kind === 'GROUP_SESSION' ? (
                  <>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => resolveGroup(item)}
                    >
                      Принять
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => returnGroup(item)}
                    >
                      Вернуть тренеру
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => resolveSpaPt(item)}
                  >
                    Принять
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
