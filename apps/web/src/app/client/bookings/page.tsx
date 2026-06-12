'use client';

import type { Booking } from '@fitgo/shared-types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime, sessionTypeLabel } from '@/lib/utils';

export default function ClientBookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const load = () => {
    const token = getToken();
    if (!token) return;
    api
      .clientBookings(token)
      .then(setBookings)
      .catch((err) => setMessage(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleCancel = async (booking: Booking) => {
    const token = getToken();
    if (!token) return;
    setCancellingId(booking.sessionId);
    try {
      const result =
        booking.source === 'fitgo'
          ? await api.clientCancelPersonalBooking(token, booking.sessionId)
          : await api.clientCancelBooking(token, booking.sessionId);
      if (result.success) {
        setMessage('Запись отменена');
        load();
      } else {
        setMessage('Не удалось отменить');
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setCancellingId(null);
    }
  };

  const upcoming = bookings.filter(
    (b) => new Date(b.startAt) >= new Date(),
  );
  const past = bookings.filter((b) => new Date(b.startAt) < new Date());

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Мои записи</h2>

      {message && (
        <p className="rounded-xl bg-fitgo-500/10 px-3 py-2 text-sm text-fitgo-400">
          {message}
        </p>
      )}

      {upcoming.length === 0 ? (
        <div className="card text-center">
          <p className="text-slate-400">Нет предстоящих записей</p>
          <Link href="/client/schedule" className="btn-primary mt-4 inline-block">
            Посмотреть расписание
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {upcoming.map((booking) => (
            <li key={booking.id} className="card">
              <p className="font-semibold">{booking.title}</p>
              <p className="text-sm text-slate-400">
                {formatDateTime(booking.startAt)}
              </p>
              {booking.trainerName && (
                <p className="text-sm text-slate-400">{booking.trainerName}</p>
              )}
              <span className="mt-2 inline-block rounded-full bg-slate-800 px-2 py-1 text-xs">
                {sessionTypeLabel(booking.type)}
              </span>
              <button
                onClick={() => handleCancel(booking)}
                disabled={cancellingId === booking.sessionId}
                className="btn-secondary mt-3 w-full"
              >
                Отменить запись
              </button>
            </li>
          ))}
        </ul>
      )}

      {past.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-slate-400">Прошедшие</h3>
          <ul className="space-y-2">
            {past.map((booking) => (
              <li
                key={booking.id}
                className="rounded-xl bg-slate-800/50 px-3 py-2 text-sm text-slate-400"
              >
                {booking.title} — {formatDateTime(booking.startAt)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
