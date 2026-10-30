'use client';

import type { Booking, ScheduleSlot } from '@fitgo/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ModuleGate } from '@/components/module-gate';
import { api } from '@/lib/api';
import { cancelGroupBooking } from '@/lib/cancel-booking';
import { getToken } from '@/lib/auth';
import { formatDateTime, getWeekRange, sessionTypeLabel } from '@/lib/utils';

interface FilterOption {
  value: string;
  label: string;
}

export default function ClientSchedulePage() {
  return (
    <ModuleGate module="group_classes">
      <ClientSchedulePageInner />
    </ModuleGate>
  );
}

function ClientSchedulePageInner() {
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [crmStatus, setCrmStatus] = useState<'LINKED' | 'PENDING_CRM' | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [serviceFilter, setServiceFilter] = useState('');
  const [trainerFilter, setTrainerFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [waitlistId, setWaitlistId] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const weekRange = useMemo(() => getWeekRange(weekOffset), [weekOffset]);
  const canBook = crmStatus !== 'PENDING_CRM';

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
      api.clientDashboard(token).catch(() => null),
    ])
      .then(([schedule, userBookings, dashboard]) => {
        setSlots(schedule);
        setBookings(userBookings);
        if (dashboard) setCrmStatus(dashboard.crmStatus ?? null);
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

  const handleJoinWaitlist = async (sessionId: string) => {
    const token = getToken();
    if (!token) return;
    setWaitlistId(sessionId);
    setMessage('');
    try {
      const entry = await api.clientJoinWaitlist(token, sessionId);
      setMessage(
        entry.isFirstInQueue
          ? `Вы первые в листе ожидания (позиция ${entry.position}). Мы уведомим, когда освободится место.`
          : `Вы в листе ожидания (позиция ${entry.position}). Мы уведомим, когда освободится место.`,
      );
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setWaitlistId(null);
    }
  };

  const handleLeaveWaitlist = async (sessionId: string) => {
    const token = getToken();
    if (!token) return;
    setWaitlistId(sessionId);
    try {
      await api.clientLeaveWaitlist(token, sessionId);
      setMessage('Вы вышли из листа ожидания');
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setWaitlistId(null);
    }
  };

  const handleConfirmWaitlist = async (sessionId: string) => {
    const token = getToken();
    if (!token) return;
    setBookingId(sessionId);
    setMessage('');
    try {
      const result = await api.clientConfirmWaitlist(token, sessionId);
      if (result.success) {
        setMessage('Запись подтверждена на сервере клуба!');
        load();
      } else {
        setMessage(result.message ?? 'Не удалось подтвердить запись');
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBookingId(null);
    }
  };

  const handleCancel = async (sessionId: string, title: string) => {
    setCancellingId(sessionId);
    setMessage('');
    try {
      const result = await cancelGroupBooking(sessionId, title);
      if (result.success) {
        setMessage('Запись отменена на сервере клуба. Администратор уведомлён.');
        load();
      } else if (result.message && result.message !== 'Отменено') {
        setMessage(result.message ?? 'Не удалось отменить');
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setCancellingId(null);
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
        Расписание групповых занятий из 1С. При заполнении группы открывается лист ожидания.
      </p>

      {!canBook && (
        <div className="card border border-amber-500/30 bg-amber-500/5 text-sm text-slate-300">
          Запись пока недоступна — клиент не привязан к 1С. Смотрите расписание и
          оформите карточку на ресепшен.
        </div>
      )}

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
            const wl = slot.waitlist;
            const onWaitlist = !!wl?.userPosition;
            const canConfirm = wl?.canConfirm;

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
                    {wl?.open && wl.count > 0 && (
                      <span className="ml-2 text-amber-400">
                        · лист ожидания: {wl.count}
                      </span>
                    )}
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
                  <div className="space-y-2">
                    <div className="rounded-xl bg-fitgo-500/10 px-3 py-2 text-center text-sm text-fitgo-400">
                      Вы записаны
                    </div>
                    <button
                      type="button"
                      disabled={cancellingId === slot.id}
                      onClick={() => handleCancel(slot.id, slot.title)}
                      className="btn-secondary w-full disabled:opacity-50"
                    >
                      {cancellingId === slot.id ? 'Отмена…' : 'Отменить запись'}
                    </button>
                  </div>
                ) : canConfirm ? (
                  <div className="space-y-2">
                    <div className="rounded-xl bg-amber-400/10 px-3 py-2 text-center text-sm text-amber-300">
                      Освободилось место — подтвердите запись
                    </div>
                    <button
                      type="button"
                      disabled={bookingId === slot.id}
                      onClick={() => handleConfirmWaitlist(slot.id)}
                      className="btn-primary w-full disabled:opacity-50"
                    >
                      {bookingId === slot.id ? 'Запись…' : 'Подтвердить запись'}
                    </button>
                    <button
                      type="button"
                      disabled={waitlistId === slot.id}
                      onClick={() => handleLeaveWaitlist(slot.id)}
                      className="btn-secondary w-full text-sm disabled:opacity-50"
                    >
                      Отказаться
                    </button>
                  </div>
                ) : onWaitlist ? (
                  <div className="space-y-2">
                    <div className="rounded-xl bg-amber-400/10 px-3 py-2 text-center text-sm text-amber-300">
                      {wl?.isFirstInQueue
                        ? `Вы первые в листе ожидания (#${wl.userPosition})`
                        : `В листе ожидания · позиция ${wl?.userPosition}`}
                    </div>
                    <button
                      type="button"
                      disabled={waitlistId === slot.id}
                      onClick={() => handleLeaveWaitlist(slot.id)}
                      className="btn-secondary w-full disabled:opacity-50"
                    >
                      Выйти из очереди
                    </button>
                  </div>
                ) : slot.available ? (
                  <button
                    type="button"
                    disabled={!canBook || bookingId === slot.id}
                    onClick={() => handleBook(slot.id)}
                    className="btn-primary w-full disabled:opacity-50"
                  >
                    {!canBook
                      ? 'Нужна карта 1С'
                      : bookingId === slot.id
                        ? 'Запись…'
                        : 'Записаться'}
                  </button>
                ) : wl?.open ? (
                  <button
                    type="button"
                    disabled={!canBook || waitlistId === slot.id}
                    onClick={() => handleJoinWaitlist(slot.id)}
                    className="btn-primary w-full disabled:opacity-50"
                  >
                    {!canBook
                      ? 'Нужна карта 1С'
                      : waitlistId === slot.id
                        ? 'Добавление…'
                        : 'В лист ожидания'}
                  </button>
                ) : (
                  <button disabled className="btn-primary w-full opacity-50">
                    Мест нет
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
