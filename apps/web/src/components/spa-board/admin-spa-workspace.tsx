'use client';

import type {
  SpaBoardBooking,
  SpaBoardResponse,
  SpaBooking,
  SpaQuotaRule,
  SpaService,
  SpaSpecialistSummary,
  SpecialistWorkSlotInput,
} from '@fitgo/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SpaBoard } from '@/components/spa-board/spa-board';
import {
  SpaBookingDialog,
  toDatetimeLocalValue,
} from '@/components/spa-board/spa-booking-dialog';
import { SpaDayHoursDialog } from '@/components/spa-board/spa-day-hours-dialog';
import {
  normalizeHm,
  SpaHoursEditor,
} from '@/components/spa-board/spa-hours-editor';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { formatDateTime } from '@/lib/utils';

function formatPrice(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

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

export function AdminSpaWorkspace() {
  const [tab, setTab] = useState<
    'services' | 'rules' | 'specialists' | 'calendar'
  >('calendar');
  const [services, setServices] = useState<SpaService[]>([]);
  const [rules, setRules] = useState<SpaQuotaRule[]>([]);
  const [specialists, setSpecialists] = useState<SpaSpecialistSummary[]>([]);
  const [bookings, setBookings] = useState<SpaBooking[]>([]);
  const [board, setBoard] = useState<SpaBoardResponse | null>(null);
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
  const [filterSpecialistIds, setFilterSpecialistIds] = useState<string[]>([]);
  const [filterApproval, setFilterApproval] = useState('ALL');
  const [scheduleSpecialistId, setScheduleSpecialistId] = useState('');
  const [workSlots, setWorkSlots] = useState<SpecialistWorkSlotInput[]>([]);
  const [showAssign, setShowAssign] = useState(false);
  const [assignDefaults, setAssignDefaults] = useState<{
    specialistId?: string;
    startAt?: string;
  }>({});
  const [showDayHours, setShowDayHours] = useState(false);
  const [dayHoursSpecialistId, setDayHoursSpecialistId] = useState('');
  const [selectedBooking, setSelectedBooking] = useState<SpaBoardBooking | null>(
    null,
  );
  const [ruleDraft, setRuleDraft] = useState({
    membershipServiceName: 'Массаж классический общий',
    allowedServiceIds: [] as string[],
    allowedSpecialistIds: [] as string[],
  });

  const period = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 14);
    return { start: start.toISOString(), end: end.toISOString() };
  }, []);

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

  const activeScheduleId =
    scheduleSpecialistId || filterSpecialistIds[0] || specialists[0]?.id || '';

  const reload = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    const [svc, rls, sps, bks, cls, brd] = await Promise.all([
      api.adminSpaServices(token),
      api.adminSpaQuotaRules(token),
      api.adminSpaSpecialists(token),
      api.adminSpaCalendar(token, period.start, period.end),
      api.adminSpaClients(token),
      api.adminSpaBoard(token, boardPeriod.start, boardPeriod.end, {
        specialistIds: filterSpecialistIds.length
          ? filterSpecialistIds
          : undefined,
        approval: filterApproval !== 'ALL' ? filterApproval : undefined,
      }),
    ]);
    setServices(svc);
    setRules(rls);
    setSpecialists(sps);
    setBookings(bks);
    setClients(cls);
    setBoard(brd);
  }, [
    boardPeriod.end,
    boardPeriod.start,
    filterApproval,
    filterSpecialistIds,
    period.end,
    period.start,
  ]);

  useEffect(() => {
    reload().catch((err) =>
      setMessage(err instanceof Error ? err.message : 'Ошибка загрузки'),
    );
  }, [reload]);

  useEffect(() => {
    if (!activeScheduleId) {
      setWorkSlots([]);
      return;
    }
    const token = getToken();
    if (!token) return;
    api
      .adminGetSpecialistWorkSchedule(token, activeScheduleId)
      .then(setWorkSlots)
      .catch(() => setWorkSlots([]));
  }, [activeScheduleId]);

  const dayHoursForSpecialist = useMemo(() => {
    const sid = dayHoursSpecialistId || activeScheduleId;
    if (!board || !sid) return null;
    const blocks = board.hours.filter(
      (h) =>
        h.specialistId === sid &&
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
  }, [
    activeScheduleId,
    board,
    boardPeriod.end,
    boardPeriod.start,
    dayHoursSpecialistId,
  ]);

  const scheduleSpecialistName = useMemo(() => {
    const sp = specialists.find((s) => s.id === activeScheduleId);
    return sp ? `${sp.lastName} ${sp.firstName}` : '';
  }, [activeScheduleId, specialists]);

  const dayHoursSpecialistLabel = useMemo(() => {
    const sid = dayHoursSpecialistId || activeScheduleId;
    const sp = specialists.find((s) => s.id === sid);
    return sp ? `${sp.lastName} ${sp.firstName}` : '';
  }, [activeScheduleId, dayHoursSpecialistId, specialists]);

  const saveRules = async () => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    try {
      const next = [
        ...rules.filter(
          (r) => r.membershipServiceName !== ruleDraft.membershipServiceName,
        ),
        {
          membershipServiceName: ruleDraft.membershipServiceName.trim(),
          allowedServiceIds: ruleDraft.allowedServiceIds,
          allowedSpecialistIds: ruleDraft.allowedSpecialistIds,
        },
      ].filter((r) => r.membershipServiceName && r.allowedServiceIds.length > 0);
      const updated = await api.adminSetSpaQuotaRules(token, next);
      setRules(updated);
      setMessage('Правила квоты сохранены');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const toggleSpecialistService = async (
    specialistId: string,
    serviceId: string,
  ) => {
    const token = getToken();
    if (!token) return;
    const sp = specialists.find((s) => s.id === specialistId);
    if (!sp) return;
    const next = sp.serviceIds.includes(serviceId)
      ? sp.serviceIds.filter((id) => id !== serviceId)
      : [...sp.serviceIds, serviceId];
    setBusy(true);
    try {
      const updated = await api.adminSetSpecialistServices(
        token,
        specialistId,
        next,
      );
      setSpecialists(updated);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const assignFromDialog = async (payload: {
    specialistId?: string;
    clientId?: string;
    guestName?: string;
    guestPhone?: string;
    serviceId: string;
    startAt: string;
    paymentType: 'QUOTA' | 'PAID';
  }) => {
    const token = getToken();
    if (!token) return;
    if (!payload.specialistId) {
      setMessage('Укажите специалиста');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await api.adminAssignSpaBooking(token, {
        specialistId: payload.specialistId,
        serviceId: payload.serviceId,
        startAt: payload.startAt,
        paymentType: payload.paymentType,
        clientId: payload.clientId,
        guestName: payload.guestName,
        guestPhone: payload.guestPhone,
      });
      setShowAssign(false);
      setMessage('Клиент записан');
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка записи');
    } finally {
      setBusy(false);
    }
  };

  const saveTemplate = async () => {
    const token = getToken();
    if (!token || !activeScheduleId) return;
    if (workSlots.length === 0) {
      setMessage('Отметьте хотя бы один рабочий день');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const saved = await api.adminSetSpecialistWorkSchedule(
        token,
        activeScheduleId,
        normalizeSlots(workSlots),
      );
      setWorkSlots(saved);
      setMessage(`Шаблон сохранён · ${scheduleSpecialistName}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setBusy(false);
    }
  };

  const fillAndPublish = async () => {
    const token = getToken();
    if (!token || !activeScheduleId) return;
    if (workSlots.length === 0) {
      setMessage('Отметьте хотя бы один рабочий день');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const saved = await api.adminSetSpecialistWorkSchedule(
        token,
        activeScheduleId,
        normalizeSlots(workSlots),
      );
      setWorkSlots(saved);
      const filled = await api.adminFillSpecialistFromTemplate(
        token,
        activeScheduleId,
        publishPeriod.start,
        publishPeriod.end,
      );
      const result = await api.adminPublishSpecialistSchedule(
        token,
        activeScheduleId,
        publishPeriod.start,
        publishPeriod.end,
      );
      setMessage(
        `${scheduleSpecialistName}: шаблон сохранён · создано ${filled.createdBlocks}, опубликовано ${result.publishedBlocks}`,
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
    const sid = dayHoursSpecialistId || activeScheduleId;
    if (!token || !sid) return;
    setBusy(true);
    setMessage('');
    try {
      await api.adminSetSpecialistDayHours(token, sid, {
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
          ? `${dayHoursSpecialistLabel}: ${dayLabel} ${value.startTime}–${value.endTime}`
          : `${dayHoursSpecialistLabel}: ${dayLabel} — выходной`,
      );
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка сохранения дня');
    } finally {
      setBusy(false);
    }
  };

  const cancelBooking = async (bookingId: string) => {
    const token = getToken();
    if (!token) return;
    if (!window.confirm('Отменить эту запись?')) return;
    setBusy(true);
    setMessage('');
    try {
      await api.adminCancelSpaBooking(token, bookingId);
      setSelectedBooking(null);
      setMessage('Запись отменена');
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка отмены');
    } finally {
      setBusy(false);
    }
  };

  const rescheduleBooking = async (booking: SpaBoardBooking | SpaBooking) => {
    const token = getToken();
    if (!token) return;
    if (!window.confirm('Отменить текущую запись и создать новую?')) return;
    setBusy(true);
    setMessage('');
    try {
      await api.adminCancelSpaBooking(token, booking.id);
      setSelectedBooking(null);
      setAssignDefaults({
        specialistId: booking.specialistId,
        startAt: toDatetimeLocalValue(new Date(booking.startAt)),
      });
      setShowAssign(true);
      setMessage('Старая запись отменена — укажите новое время');
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Спа</h2>
      {message && (
        <p className="rounded-xl bg-fitgo-500/10 px-3 py-2 text-sm text-fitgo-300">
          {message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['calendar', 'Расписание'],
            ['services', 'Услуги'],
            ['rules', 'Правила квоты'],
            ['specialists', 'Специалисты'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-full px-3 py-1.5 text-sm ${
              tab === key
                ? 'bg-fitgo-500 text-white'
                : 'bg-slate-800 text-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'services' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button
              type="button"
              className="btn-secondary text-sm"
              disabled={busy}
              onClick={async () => {
                const token = getToken();
                if (!token) return;
                setBusy(true);
                try {
                  const res = await api.superAdminSyncNomenclatureFrom1C(
                    token,
                    'spa',
                  );
                  const r = res.results[0];
                  setMessage(
                    r
                      ? `Из 1С SPA: +${r.added}, upd ${r.updated}, off ${r.deactivated}${r.error ? ` (${r.error})` : ''}`
                      : 'Sync выполнен',
                  );
                  await reload();
                } catch (err) {
                  setMessage(
                    err instanceof Error ? err.message : 'Ошибка sync',
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Обновить из 1С
            </button>
          </div>
          <ul className="space-y-2">
            {services.map((s) => (
              <li key={s.id} className="card flex justify-between gap-2 text-sm">
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-slate-400">
                    {s.kind} · {s.durationMin} мин · buffer {s.bufferMin}
                  </p>
                </div>
                <div className="text-right">
                  <p>{formatPrice(s.priceMinor, s.currency)}</p>
                  <p className="text-xs text-slate-500">
                    {s.active ? 'активна' : 'скрыта'}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'rules' && (
        <div className="space-y-4">
          <div className="card space-y-3">
            <h3 className="font-medium">Правило для услуги абонемента</h3>
            <label className="block text-sm">
              <span className="text-slate-400">Название в абонементе (1С)</span>
              <input
                className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2"
                value={ruleDraft.membershipServiceName}
                onChange={(e) =>
                  setRuleDraft((d) => ({
                    ...d,
                    membershipServiceName: e.target.value,
                  }))
                }
              />
            </label>
            <div>
              <p className="mb-2 text-sm text-slate-400">Разрешённые услуги</p>
              <div className="flex flex-wrap gap-2">
                {services.map((s) => {
                  const on = ruleDraft.allowedServiceIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`rounded-full px-3 py-1 text-xs ${
                        on ? 'bg-fitgo-500 text-white' : 'bg-slate-800'
                      }`}
                      onClick={() =>
                        setRuleDraft((d) => ({
                          ...d,
                          allowedServiceIds: on
                            ? d.allowedServiceIds.filter((id) => id !== s.id)
                            : [...d.allowedServiceIds, s.id],
                        }))
                      }
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm text-slate-400">
                Разрешённые специалисты
              </p>
              <div className="flex flex-wrap gap-2">
                {specialists.map((sp) => {
                  const on = ruleDraft.allowedSpecialistIds.includes(sp.id);
                  return (
                    <button
                      key={sp.id}
                      type="button"
                      className={`rounded-full px-3 py-1 text-xs ${
                        on ? 'bg-fitgo-500 text-white' : 'bg-slate-800'
                      }`}
                      onClick={() =>
                        setRuleDraft((d) => ({
                          ...d,
                          allowedSpecialistIds: on
                            ? d.allowedSpecialistIds.filter(
                                (id) => id !== sp.id,
                              )
                            : [...d.allowedSpecialistIds, sp.id],
                        }))
                      }
                    >
                      {sp.firstName} {sp.lastName}
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={saveRules}
            >
              Сохранить правило
            </button>
          </div>
          <ul className="space-y-2 text-sm">
            {rules.map((r) => (
              <li key={r.id} className="card">
                <p className="font-medium">{r.membershipServiceName}</p>
                <p className="text-slate-400">
                  услуг: {r.allowedServiceIds.length}, специалистов:{' '}
                  {r.allowedSpecialistIds.length}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'specialists' && (
        <ul className="space-y-3">
          {specialists.map((sp) => (
            <li key={sp.id} className="card space-y-2">
              <p className="font-medium">
                {sp.firstName} {sp.lastName}
              </p>
              <div className="flex flex-wrap gap-2">
                {services.map((s) => {
                  const on = sp.serviceIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      disabled={busy}
                      className={`rounded-full px-2 py-1 text-xs ${
                        on
                          ? 'bg-fitgo-500/30 text-fitgo-200'
                          : 'bg-slate-800 text-slate-500'
                      }`}
                      onClick={() => toggleSpecialistService(sp.id, s.id)}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
          {specialists.length === 0 && (
            <li className="card text-slate-400">
              Нет специалистов — создайте через супер-админ → сотрудники
            </li>
          )}
        </ul>
      )}

      {tab === 'calendar' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setAssignDefaults({});
                setShowAssign(true);
              }}
            >
              Новая запись
            </button>
            <select
              className="input text-sm"
              value={filterApproval}
              onChange={(e) => setFilterApproval(e.target.value)}
            >
              <option value="ALL">Все статусы подтверждения</option>
              <option value="PENDING">Ждут подтверждения</option>
              <option value="PENDING_PERFORMER">Ждёт специалиста</option>
              <option value="PENDING_ADMIN">Ждёт администратора</option>
              <option value="APPROVED">Подтверждено</option>
            </select>
            <select
              className="input text-sm"
              value={filterSpecialistIds[0] ?? ''}
              onChange={(e) =>
                setFilterSpecialistIds(e.target.value ? [e.target.value] : [])
              }
            >
              <option value="">Доска: все специалисты</option>
              {specialists.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.lastName} {s.firstName}
                </option>
              ))}
            </select>
          </div>

          {board ? (
            <SpaBoard
              board={board}
              mode="admin"
              day={day}
              onDayChange={setDay}
              onEmptySlotClick={({ specialistId, startAt }) => {
                setAssignDefaults({
                  specialistId,
                  startAt: toDatetimeLocalValue(startAt),
                });
                setShowAssign(true);
              }}
              onBookingClick={(b) => setSelectedBooking(b)}
              onEditDayHours={({ specialistId }) => {
                setDayHoursSpecialistId(specialistId);
                setShowDayHours(true);
              }}
            />
          ) : (
            <p className="text-sm text-slate-400">Загрузка доски…</p>
          )}

          <div className="space-y-3">
            <label className="block text-[11px] text-slate-500">
              График специалиста
              <select
                className="input mt-0.5 block h-9 max-w-md py-1 text-sm"
                value={activeScheduleId}
                onChange={(e) => setScheduleSpecialistId(e.target.value)}
              >
                {specialists.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.lastName} {s.firstName}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-slate-500">
              Шаблон недели и публикация на 28 дней. Один день — «Часы дня» на
              доске.
            </p>
            {activeScheduleId ? (
              <SpaHoursEditor
                workSlots={workSlots}
                onChange={setWorkSlots}
                busy={busy}
                title={
                  scheduleSpecialistName
                    ? `График · ${scheduleSpecialistName}`
                    : 'График специалиста'
                }
                onSaveTemplate={saveTemplate}
                onFillAndPublish={fillAndPublish}
              />
            ) : (
              <p className="text-sm text-slate-400">Нет специалистов</p>
            )}
          </div>

          <ul className="space-y-2">
            {bookings.map((b) => (
              <li key={b.id} className="card space-y-2 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{b.serviceName}</p>
                    <p className="text-slate-300">
                      {b.clientName} → {b.specialistName}
                    </p>
                    <p className="text-slate-400">
                      {formatDateTime(b.startAt)} ·{' '}
                      {b.paymentType === 'QUOTA' ? 'абонемент' : 'платно'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-secondary px-3 py-1.5 text-xs"
                      disabled={busy}
                      onClick={() => rescheduleBooking(b)}
                    >
                      Перенести
                    </button>
                    <button
                      type="button"
                      className="btn-secondary px-3 py-1.5 text-xs"
                      disabled={busy}
                      onClick={() => cancelBooking(b.id)}
                    >
                      Отменить
                    </button>
                  </div>
                </div>
              </li>
            ))}
            {bookings.length === 0 && (
              <li className="card text-slate-400">Записей нет</li>
            )}
          </ul>

          <SpaBookingDialog
            key={`${showAssign}-${assignDefaults.specialistId ?? ''}-${assignDefaults.startAt ?? ''}`}
            open={showAssign}
            onClose={() => setShowAssign(false)}
            services={services}
            clients={clients}
            specialists={specialists}
            allowPickSpecialist
            defaultSpecialistId={assignDefaults.specialistId}
            defaultStartAt={assignDefaults.startAt}
            busy={busy}
            onSubmit={assignFromDialog}
          />

          <SpaDayHoursDialog
            key={`${toDayIso(day)}-${dayHoursSpecialistId}-${dayHoursForSpecialist?.startTime ?? 'off'}`}
            open={showDayHours}
            dayLabel={`${dayHoursSpecialistLabel} · ${day.toLocaleDateString(
              'ru-RU',
              {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              },
            )}`}
            initialStart={dayHoursForSpecialist?.startTime}
            initialEnd={dayHoursForSpecialist?.endTime}
            busy={busy}
            onClose={() => setShowDayHours(false)}
            onSave={saveDayHours}
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
                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    className="btn-secondary flex-1"
                    onClick={() => setSelectedBooking(null)}
                  >
                    Закрыть
                  </button>
                  <button
                    type="button"
                    className="btn-secondary flex-1"
                    disabled={busy}
                    onClick={() => rescheduleBooking(selectedBooking)}
                  >
                    Перенести
                  </button>
                  <button
                    type="button"
                    className="btn-primary flex-1"
                    disabled={busy}
                    onClick={() => cancelBooking(selectedBooking.id)}
                  >
                    Отменить
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
