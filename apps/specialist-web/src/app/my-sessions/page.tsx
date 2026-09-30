'use client';

import {
  paymentLabelRu,
  type BookingControlDetail,
  type BookingControlListItem,
} from '@fitgo/shared-types';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function fmt(iso: string) {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function MySessionsPage() {
  const [from, setFrom] = useState(
    new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
  );
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState<BookingControlListItem[]>([]);
  const [selected, setSelected] = useState<BookingControlDetail | null>(null);
  const [comment, setComment] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    const token = getToken();
    if (!token) return;
    setLoading(true);
    api
      .bookingControlList(token, { from, to })
      .then(setItems)
      .catch((e) => setMessage(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setLoading(false));
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const open = async (sessionKey: string) => {
    const token = getToken();
    if (!token) return;
    try {
      setSelected(await api.bookingControlDetail(token, sessionKey));
      setComment('');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  const sendRemark = async () => {
    const token = getToken();
    if (!token || !selected || !comment.trim()) return;
    try {
      await api.bookingControlRemark(token, selected.sessionKey, comment.trim());
      setMessage('Замечание отправлено');
      setSelected(await api.bookingControlDetail(token, selected.sessionKey));
      load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  return (
    <div className="space-y-4 p-4">
      <h1 className="text-xl font-semibold">Мои занятия</h1>
      <p className="text-sm opacity-70">
        SPA из 1С. Замечание отправит запись на проверку администратору.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          type="date"
          className="field"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input
          type="date"
          className="field"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <button type="button" className="btn-secondary" onClick={load}>
          Обновить
        </button>
      </div>
      {message && <p className="text-sm text-emerald-400">{message}</p>}
      {loading ? (
        <p className="opacity-60">Загрузка…</p>
      ) : items.length === 0 ? (
        <p className="opacity-60">Нет записей</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.sessionKey}>
              <button
                type="button"
                className="panel w-full space-y-1 text-left"
                onClick={() => open(item.sessionKey)}
              >
                <p className="font-medium">{item.title}</p>
                <p className="text-sm opacity-70">
                  {fmt(item.startAt)} · {item.clientName} ·{' '}
                  {paymentLabelRu(item.payment)}
                  {item.needsReview ? ' · на проверке' : ''}
                  {item.source === 'FITGO' ? ' · ещё нет в 1С' : ''}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/50 p-4 sm:items-center sm:justify-center">
          <div className="panel max-h-[90vh] w-full max-w-md overflow-y-auto space-y-3">
            <div className="flex justify-between gap-2">
              <h2 className="font-semibold">{selected.title}</h2>
              <button
                type="button"
                className="btn-secondary text-sm"
                onClick={() => setSelected(null)}
              >
                Закрыть
              </button>
            </div>
            <p className="text-sm opacity-70">
              {fmt(selected.startAt)} · {selected.clientName} ·{' '}
              {paymentLabelRu(selected.payment)}
            </p>
            {selected.remark && (
              <p className="rounded-lg bg-rose-500/10 p-2 text-sm text-rose-200">
                На проверке: {selected.remark.staffComment}
              </p>
            )}
            {!selected.remark && (
              <>
                <textarea
                  className="field min-h-[4rem] w-full"
                  placeholder="Комментарий"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-primary w-full"
                  disabled={!comment.trim()}
                  onClick={sendRemark}
                >
                  Отправить на проверку
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
