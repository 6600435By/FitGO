'use client';

import type { Booking, ScheduleSlot } from '@fitgo/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime, getWeekRange, sessionTypeLabel } from '@/lib/utils';

interface FilterOption {
  value: string;
  label: string;
}

export default function ClientSchedulePage() {
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [serviceFilter, setServiceFilter] = useState('');
  const [trainerFilter, setTrainerFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const weekRange = useMemo(() => getWeekRange(weekOffset), [weekOffset]);

  const load = useCallback(() => {
    const token = getToken();
    if (!token) return;

    setLoading(true);
    Promise.all([
      api.clientSchedule(token, {
        from: weekRange.from,
        to: weekRange.to,
      }),
      api.clientBookings(token),
    ])
      .then(([schedule, userBookings]) => {
        setSlots(schedule);
        setBookings(userBookings);
      })
      .catch((err) => setMessage(err.message))
      .finally(() => setLoading(false));
  }, [weekRange.from, weekRange.to]);

  useEffect(() => {
    load();
  }, [load]);

  const serviceOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const slot of slots) {
      if (slot.serviceId) {
        map.set(slot.serviceId, slot.title);
      }
    }
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [slots]);

  const trainerOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const slot of slots) {
      if (slot.trainerId && slot.trainerName) {
        map.set(slot.trainerId, slot.trainerName);
      }
    }
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [slots]);

  const bookedSessionIds = useMemo(
    () =>
      new Set(
        bookings
          .filter((b) => b.source === '1c' || !b.source)
          .map((b) => b.sessionId),
      ),
    [bookings],
  );

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

  const filtered = slots.filter((slot) => {
    if (serviceFilter && slot.serviceId !== serviceFilter) return false;
    if (trainerFilter && slot.trainerId !== trainerFilter) return false;
    return true;
  });

  if (loading && slots.length === 0) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Расписание групповых занятий из 1С.
      </p>

      <div className="card flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={weekOffset <= 0}
          onClick={() => setWeekOffset((w) => w - 1)}
          className="btn-secondary shrink-0 disabled:opacity-40"
        >
          ←
        </button>
        <div className="text-center">
          <p className="text-sm text-slate-400">Неделя</p>
          <p className="font-medium">{weekRange.label}</p>
        </div>
        <button
          type="button"
          disabled={weekOffset >= 2}
          onClick={() => setWeekOffset((w) => w + 1)}
          className="btn-secondary shrink-0 disabled:opacity-40"
        >
          →
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <select
          value={serviceFilter}
          onChange={(e) => setServiceFilter(e.target.value)}
          className="rounded-xl bg-slate-800 px-3 py-2 text-sm"
        >
          <option value="">Все занятия</option>
          {serviceOptions.map((opt: FilterOption) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          value={trainerFilter}
          onChange={(e) => setTrainerFilter(e.target.value)}
          className="rounded-xl bg-slate-800 px-3 py-2 text-sm"
        >
          <option value="">Все тренеры</option>
          {trainerOptions.map((opt: FilterOption) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {message && (
        <p className="rounded-xl bg-fitgo-500/10 px-3 py-2 text-sm text-fitgo-400">
          {message}
        </p>
      )}

      {filtered.length === 0 ? (
        <div className="card text-center text-slate-400">
          <p>Нет предстоящих занятий на выбранную неделю</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((slot) => {
            const isBooked = bookedSessionIds.has(slot.id);
            return (
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
                      style={{
                        width: `${slot.capacity ? (slot.booked / slot.capacity) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
                {isBooked ? (
                  <div className="rounded-xl bg-fitgo-500/10 px-3 py-2 text-center text-sm text-fitgo-400">
                    Вы записаны
                  </div>
                ) : (
                  <button
                    disabled={!slot.available || bookingId === slot.id}
                    onClick={() => handleBook(slot.id)}
                    className="btn-primary w-full disabled:opacity-50"
                  >
                    {slot.available ? 'Записаться' : 'Мест нет'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
