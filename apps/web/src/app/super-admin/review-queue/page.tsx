'use client';

import type { ServiceUsageReviewItem } from '@fitgo/shared-types';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

export default function ReviewQueuePage() {
  const [items, setItems] = useState<ServiceUsageReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [note, setNote] = useState<Record<string, string>>({});

  const load = () => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    api
      .superAdminReviewQueue(token)
      .then(setItems)
      .catch((err) => setMessage(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const ack = async (item: ServiceUsageReviewItem) => {
    const token = getToken();
    if (!token) return;
    try {
      await api.superAdminAckReview(token, item.kind, item.id);
      setMessage('Проверено');
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка');
    }
  };

  const overridePresence = async (item: ServiceUsageReviewItem) => {
    const token = getToken();
    if (!token) return;
    const n = note[item.id]?.trim();
    if (!n) {
      setMessage('Укажите причину подтверждения входа');
      return;
    }
    try {
      await api.superAdminPresenceOverride(token, item.kind, item.id, n);
      setMessage('Вход подтверждён (override)');
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка');
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Записи под контролем</h1>
      <p className="text-sm text-slate-400">
        Повышенный уровень: записаны админом или сотрудником. Dual-gate: вход +
        факт услуги.
      </p>
      {message && <p className="text-sm text-fitgo-400">{message}</p>}
      {loading ? (
        <p className="text-slate-400">Загрузка…</p>
      ) : items.length === 0 ? (
        <p className="text-slate-400">Очередь пуста</p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={`${item.kind}-${item.id}`} className="card space-y-2">
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded bg-amber-500/20 px-2 py-0.5 text-amber-300">
                  {item.kind}
                </span>
                <span className="rounded bg-slate-800 px-2 py-0.5">
                  {item.origin}
                </span>
                <span className="rounded bg-slate-800 px-2 py-0.5">
                  presence: {item.presenceStatus}
                </span>
                <span className="rounded bg-slate-800 px-2 py-0.5">
                  performance: {item.performanceStatus}
                </span>
                <span className="rounded bg-slate-800 px-2 py-0.5">
                  usage: {item.usageStatus}
                </span>
                {item.isComplimentary && (
                  <span className="rounded bg-violet-500/20 px-2 py-0.5 text-violet-300">
                    подарочная
                  </span>
                )}
              </div>
              <p className="font-semibold">{item.title}</p>
              <p className="text-sm text-slate-400">
                {item.clientName} · {item.performerName}
              </p>
              <p className="text-sm text-slate-400">
                {formatDateTime(item.startAt)}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  onClick={() => ack(item)}
                >
                  OK / снять флаг
                </button>
                {item.presenceStatus === 'PENDING' && (
                  <>
                    <input
                      className="input flex-1 min-w-[12rem] text-sm"
                      placeholder="Причина override входа"
                      value={note[item.id] ?? ''}
                      onChange={(e) =>
                        setNote((prev) => ({
                          ...prev,
                          [item.id]: e.target.value,
                        }))
                      }
                    />
                    <button
                      type="button"
                      className="btn-primary text-sm"
                      onClick={() => overridePresence(item)}
                    >
                      Подтвердить вход
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
