'use client';

import type { Booking } from '@fitgo/shared-types';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime, sessionTypeLabel } from '@/lib/utils';

type HistoryFilter = 'all' | 'upcoming' | 'completed' | 'cancelled';

const FILTERS: { id: HistoryFilter; label: string }[] = [
  { id: 'all', label: 'Все' },
  { id: 'upcoming', label: 'Предстоящие' },
  { id: 'completed', label: 'Завершённые' },
  { id: 'cancelled', label: 'Отменённые' },
];

const LIFECYCLE_LABELS = {
  UPCOMING: 'Предстоящая',
  COMPLETED: 'Завершена',
  CANCELLED: 'Отменена',
  AWAITING_CONFIRMATION: 'Ожидает подтверждения',
};

export default function ClientBookingHistoryPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const load = useCallback(() => {
    const token = getToken();
    if (!token) return;

    setLoading(true);
    api
      .clientBookingHistory(token, filter)
      .then(setBookings)
      .catch((err) => setMessage(err.message))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">История записей</h2>
        <Link href="/client/bookings" className="text-sm text-fitgo-400">
          Активные →
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`rounded-full px-3 py-1 text-sm ${
              filter === f.id
                ? 'bg-fitgo-500 text-white'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {message && (
        <p className="rounded-xl bg-red-400/10 px-3 py-2 text-sm text-red-400">
          {message}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
        </div>
      ) : bookings.length === 0 ? (
        <div className="card text-center text-slate-400">
          <p>Нет записей по выбранному фильтру</p>
          <Link href="/client/schedule" className="btn-primary mt-4 inline-block">
            Записаться на занятие
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {bookings.map((booking) => (
            <li key={`${booking.source}-${booking.id}`} className="card">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{booking.title}</p>
                  <p className="text-sm text-slate-400">
                    {formatDateTime(booking.startAt)}
                  </p>
                  {booking.trainerName && (
                    <p className="text-sm text-slate-400">{booking.trainerName}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="rounded-full bg-slate-800 px-2 py-1 text-xs">
                    {sessionTypeLabel(booking.type)}
                  </span>
                  {booking.lifecycle && (
                    <span
                      className={`rounded-full px-2 py-1 text-xs ${
                        booking.lifecycle === 'UPCOMING'
                          ? 'bg-fitgo-500/10 text-fitgo-400'
                          : booking.lifecycle === 'CANCELLED'
                            ? 'bg-red-400/10 text-red-400'
                            : 'bg-slate-700 text-slate-300'
                      }`}
                    >
                      {LIFECYCLE_LABELS[booking.lifecycle]}
                    </span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
