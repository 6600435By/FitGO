'use client';

import { SessionType, type ScheduleSlot } from '@fitgo/shared-types';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime, sessionTypeLabel } from '@/lib/utils';

export default function ClientSchedulePage() {
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [filter, setFilter] = useState<'ALL' | SessionType>('ALL');
  const [loading, setLoading] = useState(true);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const load = () => {
    const token = getToken();
    if (!token) return;
    api
      .clientSchedule(token)
      .then(setSlots)
      .catch((err) => setMessage(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleBook = async (sessionId: string) => {
    const token = getToken();
    if (!token) return;
    setBookingId(sessionId);
    setMessage('');
    try {
      const result = await api.clientBook(token, sessionId);
      if (result.success) {
        setMessage('Вы записаны!');
        load();
      } else {
        setMessage(result.message ?? 'Не удалось записаться');
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBookingId(null);
    }
  };

  const filtered =
    filter === 'ALL' ? slots : slots.filter((s) => s.type === filter);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Групповые занятия</h2>
      <p className="text-sm text-slate-400">
        Расписание из 1С. Персональные тренировки — в отдельном разделе.
      </p>

      <div className="flex gap-2">
        {(['ALL', SessionType.GROUP] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-sm ${
              filter === f
                ? 'bg-fitgo-500 text-white'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            {f === 'ALL' ? 'Все' : sessionTypeLabel(f)}
          </button>
        ))}
      </div>

      {message && (
        <p className="rounded-xl bg-fitgo-500/10 px-3 py-2 text-sm text-fitgo-400">
          {message}
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="card text-center text-slate-400">
          <p>Нет занятий по выбранному фильтру</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((slot) => (
            <li key={slot.id} className="card">
              <div className="mb-2 flex items-start justify-between">
                <div>
                  <p className="font-semibold">{slot.title}</p>
                  <p className="text-sm text-slate-400">
                    {formatDateTime(slot.startAt)}
                  </p>
                  {slot.trainerName && (
                    <p className="text-sm text-slate-400">{slot.trainerName}</p>
                  )}
                </div>
                <span className="rounded-full bg-slate-800 px-2 py-1 text-xs">
                  {sessionTypeLabel(slot.type)}
                </span>
              </div>
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="text-slate-400">
                  {slot.booked}/{slot.capacity} мест
                </span>
                <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-fitgo-500"
                    style={{ width: `${(slot.booked / slot.capacity) * 100}%` }}
                  />
                </div>
              </div>
              <button
                disabled={!slot.available || bookingId === slot.id}
                onClick={() => handleBook(slot.id)}
                className="btn-primary w-full disabled:opacity-50"
              >
                {slot.available ? 'Записаться' : 'Мест нет'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
