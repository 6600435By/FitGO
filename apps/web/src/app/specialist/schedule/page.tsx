'use client';

import type {
  SpaBoardBooking,
  SpaBoardResponse,
  SpaBooking,
  SpaService,
  SpecialistCalendarResponse,
  SpecialistWorkSlotInput,
} from '@fitgo/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SpaBoard } from '@/components/spa-board/spa-board';
import {
  SpaBookingDialog,
  toDatetimeLocalValue,
} from '@/components/spa-board/spa-booking-dialog';
import { SpaHoursEditor } from '@/components/spa-board/spa-hours-editor';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

export default function SpecialistSchedulePage() {
  const me = getUser();
  const [board, setBoard] = useState<SpaBoardResponse | null>(null);
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
  const [day, setDay] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [showAssign, setShowAssign] = useState(false);
  const [assignDefaults, setAssignDefaults] = useState<{
    startAt?: string;
  }>({});
  const [selectedBooking, setSelectedBooking] = useState<SpaBoardBooking | null>(
    null,
  );

  const boardPeriod = useMemo(() => {
    const start = new Date(day);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start: start.toISOString(), end: end.toISOString() };
  }, [day]);

  const publishPeriod = useMemo(() => {
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
    const [brd, cal, slots, bks, svc, cls] = await Promise.all([
      api.specialistSpaBoard(token, boardPeriod.start, boardPeriod.end),
      api.specialistCalendar(token, publishPeriod.start, publishPeriod.end),
      api.specialistWorkSchedule(token),
      api.specialistSpaBookings(token),
      api.specialistOwnServices(token),
      api.adminSpaClients(token).catch(() => []),
    ]);
    setBoard(brd);
    setCalendar(cal);
    setWorkSlots(slots);
    setBookings(bks);
    setServices(svc);
    setClients(cls);
  }, [boardPeriod.end, boardPeriod.start, publishPeriod.end, publishPeriod.start]);

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
      const check = await api.specialistAvailabilityCheck(token, {
        startAt: publishPeriod.start,
        endAt: publishPeriod.end,
      });
      if (check.overlaps?.length) {
        const names = check.overlaps
          .map((o) => o.specialistName)
          .filter(Boolean)
          .slice(0, 5)
          .join(', ');
        const ok = window.confirm(
          `Пересекается с другими специалистами (${names || 'коллеги'}). Всё равно открыть время?`,
        );
        if (!ok) {
          setBusy(false);
          return;
        }
      }
      await api.specialistFillFromTemplate(
        token,
        publishPeriod.start,
        publishPeriod.end,
      );
      const result = await api.specialistPublishSchedule(
        token,
        publishPeriod.start,
        publishPeriod.end,
      );
      setMessage(`Опубликовано блоков: ${result.publishedBlocks}`);
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка публикации');
    } finally {
      setBusy(false);
    }
  };

  const assignClient = async (payload: {
    clientId?: string;
    guestName?: string;
    guestPhone?: string;
    serviceId: string;
    startAt: string;
    paymentType: 'QUOTA' | 'PAID';
  }) => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setMessage('');
    try {
      await api.specialistAssignSpaBooking(token, payload);
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
      setSelectedBooking(null);
      setMessage('Подтверждено. Ждёт администратора.');
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка подтверждения');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Расписание спа</h2>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setAssignDefaults({});
            setShowAssign(true);
          }}
        >
          Добавить клиента
        </button>
      </div>

      {message && (
        <p className="rounded-xl bg-fitgo-500/10 px-3 py-2 text-sm text-fitgo-300">
          {message}
        </p>
      )}

      {board ? (
        <SpaBoard
          board={board}
          mode="specialist"
          viewerSpecialistId={me?.id}
          day={day}
          onDayChange={setDay}
          onEmptySlotClick={({ specialistId, startAt }) => {
            if (me?.id && specialistId !== me.id) return;
            setAssignDefaults({
              startAt: toDatetimeLocalValue(startAt),
            });
            setShowAssign(true);
          }}
          onBookingClick={(b) => setSelectedBooking(b)}
        />
      ) : (
        <p className="text-sm text-slate-400">Загрузка доски…</p>
      )}

      <SpaHoursEditor
        workSlots={workSlots}
        onChange={setWorkSlots}
        busy={busy}
        draftBlockCount={calendar?.draftBlockCount}
        lastPublicationAt={calendar?.lastPublication?.publishedAt}
        onSaveTemplate={saveTemplate}
        onFillAndPublish={fillAndPublish}
      />

      <section className="space-y-3">
        <h3 className="font-medium">Ближайшие записи</h3>
        {bookings.length === 0 ? (
          <div className="card text-slate-400">Записей пока нет</div>
        ) : (
          <ul className="space-y-2">
            {bookings.map((b) => {
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
                    </p>
                  )}
                  {b.usage?.performanceStatus === 'CONFIRMED_BY_PERFORMER' ? (
                    <p className="mt-2 text-xs text-emerald-400">
                      Специалист подтвердил · ждёт администратора
                    </p>
                  ) : new Date(b.endAt) <= new Date() ? (
                    <button
                      type="button"
                      className="btn-secondary mt-2 text-sm"
                      disabled={busy}
                      onClick={() => completeBooking(b.id)}
                    >
                      Подтвердить
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <SpaBookingDialog
        key={`${showAssign}-${assignDefaults.startAt ?? ''}`}
        open={showAssign}
        onClose={() => setShowAssign(false)}
        services={services}
        clients={clients}
        defaultStartAt={assignDefaults.startAt}
        busy={busy}
        onSubmit={assignClient}
      />

      {selectedBooking && !selectedBooking.busy ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="card w-full max-w-md space-y-3">
            <h3 className="font-medium">{selectedBooking.serviceName}</h3>
            <p className="text-sm text-slate-300">
              {selectedBooking.clientName}
            </p>
            <p className="text-sm text-slate-400">
              {formatDateTime(selectedBooking.startAt)} –{' '}
              {formatDateTime(selectedBooking.endAt)}
            </p>
            {selectedBooking.approvalLabel ? (
              <p className="text-sm text-amber-300">
                {selectedBooking.approvalLabel}
              </p>
            ) : null}
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary flex-1"
                onClick={() => setSelectedBooking(null)}
              >
                Закрыть
              </button>
              {selectedBooking.approvalPhase === 'PENDING_PERFORMER' ||
              (new Date(selectedBooking.endAt) <= new Date() &&
                !selectedBooking.approvalPhase) ? (
                <button
                  type="button"
                  className="btn-primary flex-1"
                  disabled={busy}
                  onClick={() => completeBooking(selectedBooking.id)}
                >
                  Подтвердить
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
