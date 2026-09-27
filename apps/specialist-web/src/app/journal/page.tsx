'use client';

import type {
  SpaBooking,
  SpaService,
  SpecialistCalendarResponse,
  SpecialistWorkSlotInput,
} from '@fitgo/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { formatDateTime, getToken } from '@/lib/auth';

const DAY_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

export default function JournalPage() {
  const [calendar, setCalendar] = useState<SpecialistCalendarResponse | null>(
    null,
  );
  const [workSlots, setWorkSlots] = useState<SpecialistWorkSlotInput[]>([]);
  const [bookings, setBookings] = useState<SpaBooking[]>([]);
  const [services, setServices] = useState<SpaService[]>([]);
  const [clients, setClients] = useState<
    Array<{ id: string; firstName: string; lastName: string }>
  >([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [assignForm, setAssignForm] = useState({
    clientId: '',
    serviceId: '',
    startAt: '',
    paymentType: 'PAID' as 'QUOTA' | 'PAID',
  });

  const period = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 28);
    end.setHours(23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
  }, []);

  const reload = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    const [cal, slots, bks, svc, cls] = await Promise.all([
      api.specialistCalendar(token, period.start, period.end),
      api.specialistWorkSchedule(token),
      api.specialistSpaBookings(token),
      api.specialistOwnServices(token),
      api.spaClients(token).catch(() => []),
    ]);
    setCalendar(cal);
    setWorkSlots(slots);
    setBookings(bks);
    setServices(svc);
    setClients(cls);
  }, [period.end, period.start]);

  useEffect(() => {
    reload().catch((err) =>
      setMessage(err instanceof Error ? err.message : 'Ошибка загрузки'),
    );
  }, [reload]);

  const run = async (fn: () => Promise<void>, ok: string) => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setMessage('');
    try {
      await fn();
      setMessage(ok);
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const spaEvents = calendar?.events.filter((e) => e.kind === 'SPA') ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-2xl">Журнал</h1>
        <button
          type="button"
          className="btn-primary"
          onClick={() => setShowAssign(true)}
        >
          Записать клиента
        </button>
      </div>

      {message && (
        <p
          className="rounded-xl px-3 py-2 text-sm"
          style={{
            background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
            color: 'var(--fg)',
          }}
        >
          {message}
        </p>
      )}

      <section className="panel space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          Шаблон недели
        </h2>
        <ul className="space-y-2 text-sm">
          {workSlots.map((slot, idx) => (
            <li key={`${slot.dayOfWeek}-${slot.startTime}-${idx}`} className="flex gap-2">
              <span className="w-8" style={{ color: 'var(--muted)' }}>
                {DAY_LABELS[slot.dayOfWeek]}
              </span>
              <span>
                {slot.startTime}–{slot.endTime}
              </span>
            </li>
          ))}
          {workSlots.length === 0 && (
            <li style={{ color: 'var(--muted)' }}>Шаблон пуст</li>
          )}
        </ul>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() =>
              setWorkSlots((prev) => [
                ...prev,
                { dayOfWeek: 1, startTime: '10:00', endTime: '20:00' },
              ])
            }
          >
            + Пн 10–20
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const token = getToken()!;
                await api.specialistSetWorkSchedule(token, workSlots);
              }, 'Шаблон сохранён')
            }
          >
            Сохранить
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const token = getToken()!;
                await api.specialistFillFromTemplate(
                  token,
                  period.start,
                  period.end,
                );
                await api.specialistPublishSchedule(
                  token,
                  period.start,
                  period.end,
                );
              }, 'График опубликован на 28 дней')
            }
          >
            Опубликовать
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          Ближайшие записи
        </h2>
        {bookings.length === 0 && spaEvents.length === 0 ? (
          <div className="panel" style={{ color: 'var(--muted)' }}>
            Записей пока нет
          </div>
        ) : (
          <ul className="space-y-2">
            {(bookings.length > 0
              ? bookings
              : spaEvents.map((e) => ({
                  id: e.bookingId ?? e.id,
                  startAt: e.startAt,
                  endAt: e.endAt,
                  clientName: e.clientName ?? 'Клиент',
                  serviceName: e.serviceName ?? e.title,
                  paymentType: e.paymentType ?? 'PAID',
                  usage: undefined as SpaBooking['usage'],
                }))
            ).map((b) => (
              <li key={b.id} className="panel space-y-2">
                <div>
                  <p className="font-medium">{b.serviceName}</p>
                  <p className="text-sm" style={{ color: 'var(--muted)' }}>
                    {b.clientName} · {formatDateTime(b.startAt)} ·{' '}
                    {b.paymentType === 'QUOTA' ? 'Абонемент' : 'Платно'}
                  </p>
                </div>
                {b.usage?.performanceStatus === 'CONFIRMED_BY_PERFORMER' ? (
                  <p className="text-xs" style={{ color: 'var(--accent)' }}>
                    Выполнение подтверждено
                    {b.usage.eligibleForMotivation ? ' · в мотивацию' : ''}
                  </p>
                ) : (
                  <button
                    type="button"
                    className="btn-ghost text-sm"
                    disabled={busy}
                    onClick={() =>
                      run(
                        async () => {
                          await api.specialistCompleteSpaBooking(
                            getToken()!,
                            b.id,
                          );
                        },
                        'Услуга подтверждена',
                      )
                    }
                  >
                    Подтвердить выполнение
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {showAssign && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          role="presentation"
          onClick={() => setShowAssign(false)}
        >
          <div
            className="panel w-full max-w-lg space-y-3"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-xl">Новая запись</h3>
            <label className="block space-y-1 text-sm">
              <span style={{ color: 'var(--muted)' }}>Клиент</span>
              <select
                className="field"
                value={assignForm.clientId}
                onChange={(e) =>
                  setAssignForm((f) => ({ ...f, clientId: e.target.value }))
                }
              >
                <option value="">Выберите</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              <span style={{ color: 'var(--muted)' }}>Услуга</span>
              <select
                className="field"
                value={assignForm.serviceId}
                onChange={(e) =>
                  setAssignForm((f) => ({ ...f, serviceId: e.target.value }))
                }
              >
                <option value="">Выберите</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.durationMin} мин)
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              <span style={{ color: 'var(--muted)' }}>Начало</span>
              <input
                type="datetime-local"
                className="field"
                value={
                  assignForm.startAt
                    ? new Date(assignForm.startAt).toISOString().slice(0, 16)
                    : ''
                }
                onChange={(e) =>
                  setAssignForm((f) => ({
                    ...f,
                    startAt: e.target.value
                      ? new Date(e.target.value).toISOString()
                      : '',
                  }))
                }
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span style={{ color: 'var(--muted)' }}>Оплата</span>
              <select
                className="field"
                value={assignForm.paymentType}
                onChange={(e) =>
                  setAssignForm((f) => ({
                    ...f,
                    paymentType: e.target.value as 'QUOTA' | 'PAID',
                  }))
                }
              >
                <option value="PAID">Платно</option>
                <option value="QUOTA">По абонементу</option>
              </select>
            </label>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                className="btn-ghost flex-1"
                onClick={() => setShowAssign(false)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="btn-primary flex-1"
                disabled={
                  busy ||
                  !assignForm.clientId ||
                  !assignForm.serviceId ||
                  !assignForm.startAt
                }
                onClick={() => {
                  setShowAssign(false);
                  void run(async () => {
                    await api.specialistAssignSpaBooking(
                      getToken()!,
                      assignForm,
                    );
                  }, 'Клиент записан');
                }}
              >
                Записать
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
