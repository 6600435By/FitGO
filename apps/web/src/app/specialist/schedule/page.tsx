'use client';

import type {
  SpaBooking,
  SpaService,
  SpecialistCalendarResponse,
  SpecialistWorkSlotInput,
} from '@fitgo/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

const DAY_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

export default function SpecialistSchedulePage() {
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
      api.adminSpaClients(token).catch(() => []),
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

  const saveTemplate = async () => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    try {
      await api.specialistSetWorkSchedule(token, workSlots);
      setMessage('Шаблон сохранён');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const fillAndPublish = async () => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setMessage('');
    try {
      await api.specialistFillFromTemplate(token, period.start, period.end);
      const result = await api.specialistPublishSchedule(
        token,
        period.start,
        period.end,
      );
      setMessage(`Опубликовано блоков: ${result.publishedBlocks}`);
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка публикации');
    } finally {
      setBusy(false);
    }
  };

  const assignClient = async () => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setMessage('');
    try {
      await api.specialistAssignSpaBooking(token, assignForm);
      setShowAssign(false);
      setMessage('Клиент записан');
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка записи');
    } finally {
      setBusy(false);
    }
  };

  const completeBooking = async (bookingId: string) => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setMessage('');
    try {
      await api.specialistCompleteSpaBooking(token, bookingId);
      setMessage('Услуга подтверждена');
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка подтверждения');
    } finally {
      setBusy(false);
    }
  };

  const spaEvents =
    calendar?.events.filter((e) => e.kind === 'SPA') ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Расписание спа</h2>
        <button
          type="button"
          className="btn-primary"
          onClick={() => setShowAssign(true)}
        >
          Добавить клиента
        </button>
      </div>

      {message && (
        <p className="rounded-xl bg-fitgo-500/10 px-3 py-2 text-sm text-fitgo-300">
          {message}
        </p>
      )}

      <section className="card space-y-3">
        <h3 className="font-medium">Шаблон недели</h3>
        <ul className="space-y-2 text-sm">
          {workSlots.map((slot, idx) => (
            <li key={`${slot.dayOfWeek}-${slot.startTime}-${idx}`} className="flex gap-2">
              <span className="w-8 text-slate-400">{DAY_LABELS[slot.dayOfWeek]}</span>
              <span>
                {slot.startTime}–{slot.endTime}
              </span>
            </li>
          ))}
          {workSlots.length === 0 && (
            <li className="text-slate-400">Шаблон пуст — добавьте слоты</li>
          )}
        </ul>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary"
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
            className="btn-secondary"
            disabled={busy}
            onClick={saveTemplate}
          >
            Сохранить шаблон
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={fillAndPublish}
          >
            Заполнить и опубликовать (28 дн.)
          </button>
        </div>
        {calendar && (
          <p className="text-xs text-slate-500">
            Черновиков: {calendar.draftBlockCount}
            {calendar.lastPublication
              ? ` · последняя публикация ${formatDateTime(calendar.lastPublication.publishedAt)}`
              : ''}
          </p>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-medium">Календарь (14+ дней)</h3>
        {spaEvents.length === 0 ? (
          <p className="text-sm text-slate-500">Нет событий в периоде</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {spaEvents.slice(0, 42).map((e) => (
              <div
                key={e.id}
                className="rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 text-sm"
              >
                <p className="font-medium truncate">
                  {e.serviceName ?? e.title}
                </p>
                <p className="text-slate-400 truncate">
                  {e.clientName ?? (e.kind === 'OPEN_SLOT' ? 'Слот' : '—')}
                </p>
                <p className="text-xs text-slate-500">
                  {formatDateTime(e.startAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-medium">Ближайшие записи</h3>
        {bookings.length === 0 && spaEvents.length === 0 ? (
          <div className="card text-slate-400">Записей пока нет</div>
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
            ).map((b) => {
              const presence = b.usage?.presenceStatus;
              const trustHint =
                presence === 'VERIFIED_1C'
                  ? 'text-emerald-400'
                  : presence === 'ADMIN_OVERRIDE'
                    ? 'text-amber-300'
                    : 'text-slate-500';
              return (
              <li key={b.id} className="card">
                <p className="font-medium">{b.serviceName}</p>
                <p className="text-sm text-slate-300">{b.clientName}</p>
                <p className="text-sm text-slate-400">
                  {formatDateTime(b.startAt)} ·{' '}
                  {b.paymentType === 'QUOTA' ? 'По абонементу' : 'Платно'}
                </p>
                {b.usage && (
                  <p className={`mt-1 text-xs ${trustHint}`}>
                    Вход:{' '}
                    {b.usage.presenceStatus === 'VERIFIED_1C'
                      ? 'есть'
                      : b.usage.presenceStatus === 'ADMIN_OVERRIDE'
                        ? 'override'
                        : 'ожидается'}
                    {b.usage.controlLevel === 'ELEVATED'
                      ? ' · запись сотрудника'
                      : ''}
                  </p>
                )}
                {b.usage?.performanceStatus === 'CONFIRMED_BY_PERFORMER' ? (
                  <p className="mt-2 text-xs text-emerald-400">
                    Выполнение подтверждено
                    {b.usage.eligibleForMotivation ? ' · в мотивацию' : ''}
                  </p>
                ) : (
                  <button
                    type="button"
                    className="btn-secondary mt-2 text-sm"
                    disabled={busy}
                    onClick={() => completeBooking(b.id)}
                  >
                    Подтвердить выполнение
                  </button>
                )}
              </li>
              );
            })}
          </ul>
        )}
      </section>

      {showAssign && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          role="presentation"
          onClick={() => setShowAssign(false)}
        >
          <div
            className="card w-full max-w-lg space-y-3"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold">Добавить клиента</h3>
            <label className="block text-sm">
              <span className="text-slate-400">Клиент</span>
              <select
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2"
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
            <label className="block text-sm">
              <span className="text-slate-400">Услуга</span>
              <select
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2"
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
            <label className="block text-sm">
              <span className="text-slate-400">Начало (локальное)</span>
              <input
                type="datetime-local"
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2"
                value={assignForm.startAt}
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
            <label className="block text-sm">
              <span className="text-slate-400">Оплата</span>
              <select
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2"
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
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary flex-1"
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
                onClick={assignClient}
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
