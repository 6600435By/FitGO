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
import { SpaBookingEditDialog } from '@/components/spa-board/spa-booking-edit-dialog';
import { SpaDayHoursDialog } from '@/components/spa-board/spa-day-hours-dialog';
import {
  normalizeHm,
  SpaHoursEditor,
} from '@/components/spa-board/spa-hours-editor';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

function toDayIso(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeSlots(slots: SpecialistWorkSlotInput[]) {
  return slots.map((s) => ({
    ...s,
    startTime: normalizeHm(s.startTime),
    endTime: normalizeHm(s.endTime),
  }));
}

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
  const [showDayHours, setShowDayHours] = useState(false);

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

  const dayHoursForMe = useMemo(() => {
    if (!board || !me?.id) return null;
    const blocks = board.hours.filter(
      (h) =>
        h.specialistId === me.id &&
        new Date(h.startAt) < new Date(boardPeriod.end) &&
        new Date(h.endAt) > new Date(boardPeriod.start),
    );
    if (blocks.length === 0) return { startTime: null, endTime: null };
    const start = new Date(
      Math.min(...blocks.map((b) => new Date(b.startAt).getTime())),
    );
    const end = new Date(
      Math.max(...blocks.map((b) => new Date(b.endAt).getTime())),
    );
    const fmt = (d: Date) =>
      `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return { startTime: fmt(start), endTime: fmt(end) };
  }, [board, boardPeriod.end, boardPeriod.start, me?.id]);

  const saveTemplate = async () => {
    const token = getToken();
    if (!token) return;
    if (workSlots.length === 0) {
      setMessage('Отметьте хотя бы один рабочий день');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const saved = await api.specialistSetWorkSchedule(
        token,
        normalizeSlots(workSlots),
      );
      setWorkSlots(saved);
      setMessage('Шаблон сохранён');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setBusy(false);
    }
  };

  const fillAndPublish = async () => {
    const token = getToken();
    if (!token) return;
    if (workSlots.length === 0) {
      setMessage('Отметьте хотя бы один рабочий день');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const saved = await api.specialistSetWorkSchedule(
        token,
        normalizeSlots(workSlots),
      );
      setWorkSlots(saved);

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
      const filled = await api.specialistFillFromTemplate(
        token,
        publishPeriod.start,
        publishPeriod.end,
      );
      const result = await api.specialistPublishSchedule(
        token,
        publishPeriod.start,
        publishPeriod.end,
      );
      setMessage(
        `Шаблон сохранён · создано ${filled.createdBlocks}, опубликовано ${result.publishedBlocks}`,
      );
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка публикации');
    } finally {
      setBusy(false);
    }
  };

  const saveDayHours = async (value: {
    startTime: string | null;
    endTime: string | null;
  }) => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setMessage('');
    try {
      await api.specialistSetDayHours(token, {
        day: toDayIso(day),
        startTime: value.startTime,
        endTime: value.endTime,
      });
      setShowDayHours(false);
      const dayLabel = day.toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'short',
      });
      setMessage(
        value.startTime && value.endTime
          ? `Часы на ${dayLabel}: ${value.startTime}–${value.endTime}`
          : `${dayLabel}: выходной`,
      );
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка сохранения дня');
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
      throw err;
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

  const moveBooking = async (args: {
    booking: SpaBoardBooking;
    specialistId: string;
    startAt: Date;
  }) => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setMessage('');
    try {
      await api.specialistUpdateSpaBooking(token, args.booking.id, {
        startAt: args.startAt.toISOString(),
      });
      setMessage('Запись перенесена');
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Не удалось перенести');
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const saveBookingCard = async (payload: {
    specialistId?: string;
    serviceId: string;
    startAt: string;
    clientId?: string;
    guestName?: string;
    guestPhone?: string;
    paymentType: 'QUOTA' | 'PAID';
  }) => {
    const token = getToken();
    if (!token || !selectedBooking) return;
    setBusy(true);
    setMessage('');
    try {
      await api.specialistUpdateSpaBooking(token, selectedBooking.id, {
        serviceId: payload.serviceId,
        startAt: payload.startAt,
        clientId: payload.clientId,
        guestName: payload.guestName,
        guestPhone: payload.guestPhone,
        paymentType: payload.paymentType,
      });
      setSelectedBooking(null);
      setMessage('Запись сохранена');
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка сохранения');
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const cancelBookingCard = async () => {
    const token = getToken();
    if (!token || !selectedBooking) return;
    setBusy(true);
    setMessage('');
    try {
      await api.specialistCancelSpaBooking(token, selectedBooking.id);
      setSelectedBooking(null);
      setMessage('Запись отменена');
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка отмены');
      throw err;
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
          onBookingDoubleClick={(b) => {
            if (!b.busy) setSelectedBooking(b);
          }}
          onBookingMove={moveBooking}
          onEditDayHours={() => setShowDayHours(true)}
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

      <SpaDayHoursDialog
        key={`${toDayIso(day)}-${dayHoursForMe?.startTime ?? 'off'}-${dayHoursForMe?.endTime ?? 'off'}`}
        open={showDayHours}
        dayLabel={day.toLocaleDateString('ru-RU', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })}
        initialStart={dayHoursForMe?.startTime}
        initialEnd={dayHoursForMe?.endTime}
        busy={busy}
        onClose={() => setShowDayHours(false)}
        onSave={saveDayHours}
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

      <SpaBookingEditDialog
        open={Boolean(selectedBooking && !selectedBooking.busy)}
        booking={selectedBooking}
        services={services}
        busy={busy}
        onClose={() => setSelectedBooking(null)}
        onSave={saveBookingCard}
        onCancel={cancelBookingCard}
      />
    </div>
  );
}
