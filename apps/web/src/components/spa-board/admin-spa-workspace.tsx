'use client';

import type {
  SpaBoardBooking,
  SpaBoardResponse,
  SpaBooking,
  SpaQuotaRule,
  SpaService,
  SpaSpecialistSummary,
  SpaWaitlistEntry,
} from '@fitgo/shared-types';
import {
  MEMBERSHIP_INCLUDED_SPA_NAMES,
  spaWaitlistFitsSlot,
  UserRole,
} from '@fitgo/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SpaBoard } from '@/components/spa-board/spa-board';
import {
  boardPeriodForView,
  defaultSpaBoardView,
  type SpaBoardView,
  writeStoredSpaBoardView,
} from '@/components/spa-board/spa-board-period';
import { SpaBoardViewToggle } from '@/components/spa-board/spa-board-view-toggle';
import {
  SpaBookingDialog,
  toDatetimeLocalValue,
} from '@/components/spa-board/spa-booking-dialog';
import { SpaBookingEditDialog } from '@/components/spa-board/spa-booking-edit-dialog';
import { SpaDayHoursDialog } from '@/components/spa-board/spa-day-hours-dialog';
import { SpaWaitlistPanel } from '@/components/spa-board/spa-waitlist-panel';
import { SpaWaitlistPickDialog } from '@/components/spa-board/spa-waitlist-pick-dialog';
import { SpaWeekBoard } from '@/components/spa-board/spa-week-board';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
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
  const [boardView, setBoardView] = useState<SpaBoardView>('day');
  const [weekFilterSpecialistId, setWeekFilterSpecialistId] = useState('');
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
  const [waitlist, setWaitlist] = useState<SpaWaitlistEntry[]>([]);
  const [waitlistPick, setWaitlistPick] = useState<{
    specialistId?: string;
    startAt?: string;
    endAt?: string;
    title?: string;
    allowNew?: boolean;
  } | null>(null);
  const [freedBanner, setFreedBanner] = useState<{
    specialistId: string;
    startAt: string;
    endAt: string;
    count: number;
  } | null>(null);
  const [ruleDraft, setRuleDraft] = useState({
    allowedServiceIds: [] as string[],
    allowedSpecialistIds: [] as string[],
  });

  const canEditQuotaRules = useMemo(() => {
    const roles = getUser()?.roles ?? [];
    return (
      roles.includes(UserRole.SUPER_ADMIN) || roles.includes(UserRole.MANAGER)
    );
  }, []);

  const period = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 14);
    return { start: start.toISOString(), end: end.toISOString() };
  }, []);

  const boardPeriod = useMemo(
    () => boardPeriodForView(day, boardView),
    [boardView, day],
  );

  useEffect(() => {
    setBoardView(defaultSpaBoardView());
  }, []);

  const changeBoardView = (v: SpaBoardView) => {
    setBoardView(v);
    writeStoredSpaBoardView(v);
  };

  const reload = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    const [svc, rls, sps, bks, cls, brd, wl] = await Promise.all([
      api.adminSpaServices(token),
      canEditQuotaRules
        ? api.adminSpaQuotaRules(token)
        : Promise.resolve([] as SpaQuotaRule[]),
      api.adminSpaSpecialists(token),
      api.adminSpaCalendar(token, period.start, period.end),
      api.adminSpaClients(token),
      api.adminSpaBoard(token, boardPeriod.start, boardPeriod.end),
      api.adminSpaWaitlist(token, boardPeriod.start, boardPeriod.end),
    ]);
    setServices(svc);
    setRules(rls);
    setSpecialists(sps);
    setBookings(bks);
    setClients(cls);
    setBoard(brd);
    setWaitlist(wl);
    const allowedServiceIds = [
      ...new Set(rls.flatMap((r) => r.allowedServiceIds)),
    ];
    const allowedSpecialistIds = [
      ...new Set(rls.flatMap((r) => r.allowedSpecialistIds)),
    ];
    setRuleDraft({ allowedServiceIds, allowedSpecialistIds });
  }, [
    boardPeriod.end,
    boardPeriod.start,
    canEditQuotaRules,
    period.end,
    period.start,
  ]);

  /** Light poll so other admins/specialists' bookings appear without full page reload. */
  const refreshLive = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    const [brd, wl, bks] = await Promise.all([
      api.adminSpaBoard(token, boardPeriod.start, boardPeriod.end),
      api.adminSpaWaitlist(token, boardPeriod.start, boardPeriod.end),
      api.adminSpaCalendar(token, period.start, period.end),
    ]);
    setBoard(brd);
    setWaitlist(wl);
    setBookings(bks);
  }, [boardPeriod.end, boardPeriod.start, period.end, period.start]);

  const matchingWaitlist = useCallback(
    (specialistId: string, startAt: string, endAt?: string) => {
      return waitlist.filter(
        (e) => spaWaitlistFitsSlot(e, specialistId, startAt, endAt).fits,
      );
    },
    [waitlist],
  );

  const bookFromWaitlist = async (
    entry: SpaWaitlistEntry,
    startAtOverride?: string,
  ) => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setMessage('');
    try {
      await api.adminBookFromSpaWaitlist(token, entry.id, {
        startAt: startAtOverride,
        paymentType: 'PAID',
      });
      setWaitlistPick(null);
      setFreedBanner(null);
      setMessage(`Записан: ${entry.clientName}`);
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка записи');
      throw err;
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    reload().catch((err) =>
      setMessage(err instanceof Error ? err.message : 'Ошибка загрузки'),
    );
  }, [reload]);

  useEffect(() => {
    if (tab !== 'calendar') return;
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (busy) return;
      void refreshLive().catch(() => undefined);
    };
    const interval = window.setInterval(tick, 8_000);
    const onVis = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [tab, busy, refreshLive]);

  useEffect(() => {
    if (!canEditQuotaRules && tab === 'rules') setTab('calendar');
  }, [canEditQuotaRules, tab]);

  const dayHoursForSpecialist = useMemo(() => {
    const sid = dayHoursSpecialistId;
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
  }, [board, boardPeriod.end, boardPeriod.start, dayHoursSpecialistId]);

  const dayHoursSpecialistLabel = useMemo(() => {
    const sp = specialists.find((s) => s.id === dayHoursSpecialistId);
    return sp ? `${sp.lastName} ${sp.firstName}` : '';
  }, [dayHoursSpecialistId, specialists]);

  const activeCatalogServices = useMemo(
    () => services.filter((s) => s.active),
    [services],
  );

  const saveRules = async () => {
    const token = getToken();
    if (!token || !canEditQuotaRules) return;
    setBusy(true);
    try {
      // Exact 1C VIP pack lines (qty varies). One allowlist → each SPA line name.
      // Gift PT is complimentary PT, not SpaQuotaRule.
      const next =
        ruleDraft.allowedServiceIds.length === 0
          ? []
          : MEMBERSHIP_INCLUDED_SPA_NAMES.map((membershipServiceName) => ({
              membershipServiceName,
              allowedServiceIds: ruleDraft.allowedServiceIds,
              allowedSpecialistIds: ruleDraft.allowedSpecialistIds,
            }));
      const updated = await api.adminSetSpaQuotaRules(token, next);
      setRules(updated);
      setMessage(
        next.length
          ? `Правила квоты: ${MEMBERSHIP_INCLUDED_SPA_NAMES.join(', ')}`
          : 'Правила квоты очищены',
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const toggleAllCatalogServices = () => {
    const ids = activeCatalogServices.map((s) => s.id);
    const allOn =
      ids.length > 0 && ids.every((id) => ruleDraft.allowedServiceIds.includes(id));
    setRuleDraft((d) => ({
      ...d,
      allowedServiceIds: allOn ? [] : ids,
    }));
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
    visitNote?: string;
    overlapConfirmed?: boolean;
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
        visitNote: payload.visitNote,
        overlapConfirmed: payload.overlapConfirmed,
      });
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

  const bulkAssignFromDialog = async (payload: {
    specialistId?: string;
    clientId?: string;
    guestName?: string;
    guestPhone?: string;
    serviceId: string;
    startAt: string;
    paymentType: 'QUOTA' | 'PAID';
    visitNote?: string;
    dates: string[];
    overlapConfirmed?: boolean;
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
      const result = await api.adminBulkAssignSpaBooking(token, {
        specialistId: payload.specialistId,
        serviceId: payload.serviceId,
        startAt: payload.startAt,
        paymentType: payload.paymentType,
        clientId: payload.clientId,
        guestName: payload.guestName,
        guestPhone: payload.guestPhone,
        visitNote: payload.visitNote,
        dates: payload.dates,
        overlapConfirmed: payload.overlapConfirmed,
      });
      setShowAssign(false);
      const skipNote =
        result.skipped.length > 0
          ? ` · пропущено ${result.skipped.length}`
          : '';
      setMessage(`Создано записей: ${result.created.length}${skipNote}`);
      await reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка записи');
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const saveDayHours = async (value: {
    startTime: string | null;
    endTime: string | null;
  }) => {
    const token = getToken();
    const sid = dayHoursSpecialistId;
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

  const cancelBooking = async (
    bookingId: string,
    freed?: { specialistId: string; startAt: string; endAt: string },
  ) => {
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
      if (freed) {
        const matches = matchingWaitlist(
          freed.specialistId,
          freed.startAt,
          freed.endAt,
        );
        if (matches.length > 0) {
          setFreedBanner({ ...freed, count: matches.length });
        }
      }
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

  const moveBooking = async (args: {
    booking: SpaBoardBooking;
    specialistId: string;
    startAt: Date;
    overlapConfirmed?: boolean;
  }) => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setMessage('');
    try {
      await api.adminUpdateSpaBooking(token, args.booking.id, {
        specialistId: args.specialistId,
        startAt: args.startAt.toISOString(),
        overlapConfirmed: args.overlapConfirmed,
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
    visitNote?: string;
    overlapConfirmed?: boolean;
  }) => {
    const token = getToken();
    if (!token || !selectedBooking) return;
    setBusy(true);
    setMessage('');
    try {
      await api.adminUpdateSpaBooking(token, selectedBooking.id, {
        specialistId: payload.specialistId,
        serviceId: payload.serviceId,
        startAt: payload.startAt,
        clientId: payload.clientId,
        guestName: payload.guestName,
        guestPhone: payload.guestPhone,
        paymentType: payload.paymentType,
        visitNote: payload.visitNote,
        overlapConfirmed: payload.overlapConfirmed,
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

  const confirmManualPaymentCard = async () => {
    const token = getToken();
    if (!token || !selectedBooking) return;
    setBusy(true);
    setMessage('');
    try {
      await api.adminConfirmSpaManualPayment(token, selectedBooking.id);
      setSelectedBooking(null);
      setMessage('Оплата подтверждена без 1С');
      await reload();
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : 'Не удалось подтвердить оплату',
      );
      throw err;
    } finally {
      setBusy(false);
    }
  };

  const cancelBookingCard = async () => {
    const token = getToken();
    if (!token || !selectedBooking) return;
    const freed = {
      specialistId: selectedBooking.specialistId,
      startAt: selectedBooking.startAt,
      endAt: selectedBooking.endAt,
    };
    setBusy(true);
    setMessage('');
    try {
      await api.adminCancelSpaBooking(token, selectedBooking.id);
      setSelectedBooking(null);
      setMessage('Запись отменена');
      await reload();
      const matches = matchingWaitlist(
        freed.specialistId,
        freed.startAt,
        freed.endAt,
      );
      if (matches.length > 0) {
        setFreedBanner({ ...freed, count: matches.length });
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ошибка отмены');
      throw err;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">SPA</h2>
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
            ...(canEditQuotaRules
              ? ([['rules', 'Правила квоты']] as Array<
                  ['rules', string]
                >)
              : []),
            ['specialists', 'Специалисты'],
          ] as Array<
            ['calendar' | 'services' | 'rules' | 'specialists', string]
          >
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="hidden text-sm text-slate-400 sm:block">
              Показаны только услуги с галочкой «Активна» в Каталоге SPA.
            </p>
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
            {services
              .filter((s) => s.active)
              .map((s) => (
              <li key={s.id} className="card flex justify-between gap-2 text-sm">
                <div>
                  <p className="font-medium">{s.name}</p>
                  <p className="text-slate-400">
                    {s.kind} · {s.durationMin} мин · buffer {s.bufferMin}
                    {(s.bookable ?? true) ? '' : ' · не в записи'}
                  </p>
                </div>
                <div className="text-right">
                  <p>{formatPrice(s.priceMinor, s.currency)}</p>
                </div>
              </li>
            ))}
            {services.filter((s) => s.active).length === 0 && (
              <li className="card text-slate-400">
                Нет активных услуг — включите «Активна» в Каталоге SPA.
              </li>
            )}
          </ul>
        </div>
      )}

      {tab === 'rules' && canEditQuotaRules && (
        <div className="space-y-4">
          <div className="card space-y-3">
            <h3 className="font-medium">Списание с абонемента</h3>
            <p className="text-sm text-slate-400">
              Услуги из абонемента (кол-во в карточке 1С разное):{' '}
              {MEMBERSHIP_INCLUDED_SPA_NAMES.join(', ')}. Плюс «Подарочная ПТ с
              тренером» — это ПТ, не SPA. Отметьте позиции каталога FitGO, на
              которые списывается квота VIP / блока массажей.
            </p>
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-slate-400">
                  Услуги каталога ({ruleDraft.allowedServiceIds.length} выбрано)
                </p>
                <button
                  type="button"
                  className="btn-secondary px-3 py-1 text-xs"
                  onClick={toggleAllCatalogServices}
                  disabled={activeCatalogServices.length === 0}
                >
                  {activeCatalogServices.length > 0 &&
                  activeCatalogServices.every((s) =>
                    ruleDraft.allowedServiceIds.includes(s.id),
                  )
                    ? 'Снять все'
                    : 'Выбрать все'}
                </button>
              </div>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-slate-800 p-2">
                {activeCatalogServices.map((s) => {
                  const on = ruleDraft.allowedServiceIds.includes(s.id);
                  return (
                    <label
                      key={s.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${
                        on ? 'bg-fitgo-500/15 text-fitgo-100' : 'text-slate-300'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setRuleDraft((d) => ({
                            ...d,
                            allowedServiceIds: on
                              ? d.allowedServiceIds.filter((id) => id !== s.id)
                              : [...d.allowedServiceIds, s.id],
                          }))
                        }
                      />
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      <span className="shrink-0 text-xs text-slate-500">
                        {s.durationMin} мин
                      </span>
                    </label>
                  );
                })}
                {activeCatalogServices.length === 0 && (
                  <p className="px-2 py-3 text-sm text-slate-500">
                    Нет активных услуг каталога
                  </p>
                )}
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
              Сохранить
            </button>
            {rules.length > 0 && ruleDraft.allowedServiceIds.length === 0 ? (
              <p className="text-xs text-amber-400/90">
                Пустой список снимет все правила списания с абонемента.
              </p>
            ) : null}
          </div>
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
                {services
                  .filter((s) => s.active)
                  .map((s) => {
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
          </div>

          {freedBanner ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
              <span>
                Освободилось время — {freedBanner.count} в листе ожидания
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-primary text-xs"
                  onClick={() => {
                    setWaitlistPick({
                      specialistId: freedBanner.specialistId,
                      startAt: freedBanner.startAt,
                      endAt: freedBanner.endAt,
                      title: 'Освободилось время',
                      allowNew: false,
                    });
                  }}
                >
                  Выбрать
                </button>
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => setFreedBanner(null)}
                >
                  Скрыть
                </button>
              </div>
            </div>
          ) : null}

          <SpaWaitlistPanel
            entries={waitlist}
            services={services}
            specialists={specialists}
            clients={clients}
            boardDayYmd={toDayIso(day)}
            allowPickSpecialist
            busy={busy}
            onReload={reload}
            onMessage={setMessage}
            onBook={(entry) => {
              void bookFromWaitlist(entry);
            }}
          />

          <div className="flex flex-wrap items-center gap-2">
            <SpaBoardViewToggle view={boardView} onChange={changeBoardView} />
          </div>

          {board ? (
            boardView === 'week' ? (
              <SpaWeekBoard
                board={board}
                mode="admin"
                day={day}
                onDayChange={setDay}
                filterSpecialistId={weekFilterSpecialistId}
                onFilterSpecialistChange={setWeekFilterSpecialistId}
                onEmptySlotClick={({ specialistId, startAt }) => {
                  const iso = startAt.toISOString();
                  const matches = matchingWaitlist(specialistId, iso);
                  if (
                    matches.length > 0 ||
                    waitlist.some((e) => e.specialistId === specialistId)
                  ) {
                    setWaitlistPick({
                      specialistId,
                      startAt: iso,
                      title: 'Свободный слот',
                      allowNew: true,
                    });
                    setAssignDefaults({
                      specialistId,
                      startAt: toDatetimeLocalValue(startAt),
                    });
                    return;
                  }
                  setAssignDefaults({
                    specialistId,
                    startAt: toDatetimeLocalValue(startAt),
                  });
                  setShowAssign(true);
                }}
                onBookingDoubleClick={(b) => {
                  if (!b.busy) setSelectedBooking(b);
                }}
                onBookingMove={moveBooking}
              />
            ) : (
              <SpaBoard
                board={board}
                mode="admin"
                day={day}
                onDayChange={setDay}
                onEmptySlotClick={({ specialistId, startAt }) => {
                  const iso = startAt.toISOString();
                  const matches = matchingWaitlist(specialistId, iso);
                  if (
                    matches.length > 0 ||
                    waitlist.some((e) => e.specialistId === specialistId)
                  ) {
                    setWaitlistPick({
                      specialistId,
                      startAt: iso,
                      title: 'Свободный слот',
                      allowNew: true,
                    });
                    setAssignDefaults({
                      specialistId,
                      startAt: toDatetimeLocalValue(startAt),
                    });
                    return;
                  }
                  setAssignDefaults({
                    specialistId,
                    startAt: toDatetimeLocalValue(startAt),
                  });
                  setShowAssign(true);
                }}
                onBookingDoubleClick={(b) => {
                  if (!b.busy) setSelectedBooking(b);
                }}
                onBookingMove={moveBooking}
                onEditDayHours={({ specialistId }) => {
                  setDayHoursSpecialistId(specialistId);
                  setShowDayHours(true);
                }}
              />
            )
          ) : (
            <p className="text-sm text-slate-400">Загрузка доски…</p>
          )}

          <ul className="space-y-2">
            {bookings.map((b) => (
              <li key={b.id} className="card space-y-2 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {b.membershipServiceName ?? b.serviceName}
                    </p>
                    {b.membershipServiceName && b.serviceName ? (
                      <p className="text-xs text-slate-500">
                        Слот: {b.serviceName}
                      </p>
                    ) : null}
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
                      onClick={() =>
                        cancelBooking(b.id, {
                          specialistId: b.specialistId,
                          startAt: b.startAt,
                          endAt: b.endAt,
                        })
                      }
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
            boardHours={board?.hours}
            boardBookings={board?.bookings}
            busy={busy}
            onSubmit={assignFromDialog}
            onBulkSubmit={bulkAssignFromDialog}
          />

          <SpaWaitlistPickDialog
            open={Boolean(waitlistPick)}
            title={waitlistPick?.title}
            entries={waitlist}
            specialistId={waitlistPick?.specialistId}
            slotStartAt={waitlistPick?.startAt}
            slotEndAt={waitlistPick?.endAt}
            showSpecialist
            busy={busy}
            onClose={() => setWaitlistPick(null)}
            onBook={async (entry) => {
              await bookFromWaitlist(entry, waitlistPick?.startAt);
            }}
            onNewBooking={
              waitlistPick?.allowNew
                ? () => {
                    setWaitlistPick(null);
                    setShowAssign(true);
                  }
                : undefined
            }
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

          <SpaBookingEditDialog
            open={Boolean(selectedBooking && !selectedBooking.busy)}
            booking={selectedBooking}
            services={services}
            specialists={specialists}
            allowPickSpecialist
            allowManualPayment
            boardBookings={board?.bookings}
            busy={busy}
            onClose={() => setSelectedBooking(null)}
            onSave={saveBookingCard}
            onCancel={cancelBookingCard}
            onConfirmManualPayment={confirmManualPaymentCard}
          />
        </div>
      )}
    </div>
  );
}
