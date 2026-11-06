'use client';

import type {
  SpaBoardBooking,
  SpaBoardHourBlock,
  SpaBulkBookingResult,
  SpaService,
  SpaSpecialistClientSuggestion,
} from '@fitgo/shared-types';
import {
  SPA_OVERLAP_ALLOW_MIN,
  checkSpaPlacement,
  suggestSpaFitStarts,
} from '@fitgo/shared-types';
import { useEffect, useMemo, useState } from 'react';
import { SpaBookingNotesFields } from '@/components/spa-board/spa-booking-notes-fields';
import { SpaClientNameField } from '@/components/spa-board/spa-client-name-field';
import { DateField, TimeField } from '@/components/ui/date-field';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function formatPrice(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

function formatHm(ms: number) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

type BookingPayload = {
  specialistId?: string;
  clientId?: string;
  guestName?: string;
  guestPhone?: string;
  clientExternalId?: string;
  serviceId: string;
  startAt: string;
  paymentType: 'QUOTA' | 'PAID';
  visitNote?: string;
  overlapConfirmed?: boolean;
};

type PeriodEntry = {
  date: string;
  time: string;
  serviceId: string;
  /** True once the user changed service on this row (don't sync from main). */
  serviceTouched?: boolean;
};

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function localDateKey(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function localTimeHm(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function buildWeeklyEntries(
  startLocal: string,
  weeks: number,
  serviceId: string,
): PeriodEntry[] {
  const base = new Date(startLocal);
  if (Number.isNaN(base.getTime()) || weeks < 1) return [];
  const time = localTimeHm(base);
  const out: PeriodEntry[] = [];
  for (let i = 0; i < weeks; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i * 7);
    out.push({ date: localDateKey(d), time, serviceId });
  }
  return out;
}

/** Keep custom times/services for dates that remain; fill new weeks from defaults. */
function mergePeriodEntries(
  prev: PeriodEntry[],
  suggested: PeriodEntry[],
  defaultTime: string,
  defaultServiceId: string,
): PeriodEntry[] {
  const byDate = new Map(prev.map((e) => [e.date, e]));
  return suggested.map((s) => {
    const prevRow = byDate.get(s.date);
    if (!prevRow) {
      return {
        date: s.date,
        time: s.time || defaultTime,
        serviceId: defaultServiceId,
      };
    }
    return {
      date: s.date,
      time: prevRow.time || s.time || defaultTime,
      serviceId: prevRow.serviceTouched
        ? prevRow.serviceId
        : defaultServiceId,
      serviceTouched: prevRow.serviceTouched,
    };
  });
}

function entryToIso(entry: PeriodEntry) {
  return new Date(`${entry.date}T${entry.time}`).toISOString();
}

function formatDateCompact(dateYmd: string) {
  const d = new Date(`${dateYmd}T12:00:00`);
  const wd = d.toLocaleDateString('ru-RU', { weekday: 'short' });
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${wd} ${dd}.${mm}`;
}

export function SpaBookingDialog({
  open,
  onClose,
  services,
  specialists,
  defaultSpecialistId,
  defaultStartAt,
  allowPickSpecialist,
  boardHours,
  boardBookings,
  fetchBoardRange,
  onSubmit,
  onBulkSubmit,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  services: SpaService[];
  /** @deprecated unused — suggestions come from specialist history search */
  clients?: Array<{ id: string; firstName: string; lastName: string }>;
  specialists?: Array<{ id: string; firstName: string; lastName: string }>;
  defaultSpecialistId?: string;
  defaultStartAt?: string;
  allowPickSpecialist?: boolean;
  /** Current board data for «Куда влезет» suggestions. */
  boardHours?: SpaBoardHourBlock[];
  boardBookings?: SpaBoardBooking[];
  /** Load hours/bookings for period dates beyond the visible board window. */
  fetchBoardRange?: (
    fromIso: string,
    toIso: string,
  ) => Promise<{ hours: SpaBoardHourBlock[]; bookings: SpaBoardBooking[] }>;
  onSubmit: (payload: BookingPayload) => Promise<void>;
  onBulkSubmit?: (
    payload: BookingPayload & {
      dates?: string[];
      items?: Array<{
        startAt: string;
        serviceId?: string;
        overlapConfirmed?: boolean;
      }>;
    },
  ) => Promise<SpaBulkBookingResult | void>;
  busy?: boolean;
}) {
  const bookable = services.filter((s) => s.active && (s.bookable ?? true));
  const [phoneLookup, setPhoneLookup] = useState('');
  const [error, setError] = useState('');
  const [periodMode, setPeriodMode] = useState(false);
  const [periodWeeks, setPeriodWeeks] = useState(4);
  const [periodEntries, setPeriodEntries] = useState<PeriodEntry[]>([]);
  const [extraDate, setExtraDate] = useState('');
  const [extraTime, setExtraTime] = useState('10:00');
  const [extraServiceId, setExtraServiceId] = useState('');
  const [overlapConfirmed, setOverlapConfirmed] = useState(false);
  const [skippedRows, setSkippedRows] = useState<
    Array<{ date: string; reason: string }>
  >([]);
  const [rangeHours, setRangeHours] = useState<SpaBoardHourBlock[] | null>(
    null,
  );
  const [rangeBookings, setRangeBookings] = useState<SpaBoardBooking[] | null>(
    null,
  );
  const [form, setForm] = useState({
    specialistId: defaultSpecialistId ?? '',
    clientId: '',
    guestName: '',
    guestPhone: '',
    serviceId: bookable[0]?.id ?? '',
    startAt: defaultStartAt ?? '',
    paymentType: 'PAID' as 'QUOTA' | 'PAID',
  });
  const [clientExternalId, setClientExternalId] = useState('');
  const [clientNote, setClientNote] = useState('');
  const [clientNoteSaved, setClientNoteSaved] = useState('');
  const [visitNote, setVisitNote] = useState('');
  const [clientNoteBusy, setClientNoteBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setPhoneLookup('');
    setPeriodMode(false);
    setPeriodWeeks(4);
    setPeriodEntries([]);
    setExtraDate('');
    setExtraTime('10:00');
    setExtraServiceId(bookable[0]?.id ?? '');
    setSkippedRows([]);
    setClientExternalId('');
    setClientNote('');
    setClientNoteSaved('');
    setVisitNote('');
    setForm({
      specialistId: defaultSpecialistId ?? '',
      clientId: '',
      guestName: '',
      guestPhone: '',
      serviceId: bookable[0]?.id ?? '',
      startAt: defaultStartAt || toDatetimeLocalValue(new Date()),
      paymentType: 'PAID',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when dialog opens
  }, [open, defaultSpecialistId, defaultStartAt]);

  const applySuggestion = (s: SpaSpecialistClientSuggestion) => {
    setClientExternalId(s.clientExternalId ?? '');
    setForm((f) => ({
      ...f,
      clientId: s.clientId ?? '',
      guestName: s.label,
      guestPhone: s.guestPhone ?? f.guestPhone,
    }));
    setPhoneLookup(
      s.guestPhone
        ? `Выбрано из истории · ${s.guestPhone}`
        : 'Выбрано из истории',
    );
    void loadClientNote({
      clientId: s.clientId,
      clientExternalId: s.clientExternalId,
      phone: s.guestPhone,
    });
  };

  const clientNoteEnabled = Boolean(
    form.clientId ||
      clientExternalId ||
      form.guestPhone.replace(/\D/g, '').length >= 9,
  );

  const loadClientNote = async (opts: {
    clientId?: string;
    clientExternalId?: string;
    phone?: string;
  }) => {
    const token = getToken();
    if (!token) return;
    if (!opts.clientId && !opts.clientExternalId && !opts.phone) {
      setClientNote('');
      setClientNoteSaved('');
      return;
    }
    try {
      const res = await api.getSpaClientNote(token, opts);
      setClientNote(res.text);
      setClientNoteSaved(res.text);
    } catch {
      /* non-fatal */
    }
  };

  const saveClientNoteNow = async () => {
    const token = getToken();
    if (!token || !clientNoteEnabled) return;
    setClientNoteBusy(true);
    try {
      const res = await api.putSpaClientNote(token, {
        clientId: form.clientId || undefined,
        clientExternalId: clientExternalId || undefined,
        phone: form.guestPhone.trim() || undefined,
        text: clientNote,
      });
      setClientNote(res.text);
      setClientNoteSaved(res.text);
    } finally {
      setClientNoteBusy(false);
    }
  };

  const suggestedEntries = useMemo(
    () =>
      periodMode
        ? buildWeeklyEntries(form.startAt, periodWeeks, form.serviceId)
        : [],
    [form.serviceId, form.startAt, periodMode, periodWeeks],
  );

  useEffect(() => {
    if (!periodMode) {
      setPeriodEntries([]);
      return;
    }
    const { timePart: defaultTime } = splitDatetimeLocal(form.startAt);
    setPeriodEntries((prev) =>
      mergePeriodEntries(
        prev,
        suggestedEntries,
        defaultTime || '10:00',
        form.serviceId,
      ),
    );
  }, [form.serviceId, form.startAt, periodMode, suggestedEntries]);

  useEffect(() => {
    if (!open) return;
    setOverlapConfirmed(false);
  }, [open, form.startAt, form.serviceId, form.specialistId]);

  useEffect(() => {
    if (!open || !periodMode || !fetchBoardRange || periodEntries.length === 0) {
      setRangeHours(null);
      setRangeBookings(null);
      return;
    }
    const dates = [...periodEntries.map((e) => e.date)].sort();
    const from = new Date(`${dates[0]}T00:00:00`);
    const to = new Date(`${dates[dates.length - 1]}T23:59:59.999`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return;
    let cancelled = false;
    void fetchBoardRange(from.toISOString(), to.toISOString())
      .then((res) => {
        if (cancelled) return;
        setRangeHours(res.hours);
        setRangeBookings(res.bookings);
      })
      .catch(() => {
        if (cancelled) return;
        setRangeHours(null);
        setRangeBookings(null);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchBoardRange, open, periodEntries, periodMode]);

  const selectedService = useMemo(
    () => bookable.find((s) => s.id === form.serviceId),
    [bookable, form.serviceId],
  );

  const resolvedSpecialistId = allowPickSpecialist
    ? form.specialistId
    : (defaultSpecialistId ?? form.specialistId);

  const effectiveHours = rangeHours ?? boardHours;
  const effectiveBookings = rangeBookings ?? boardBookings;

  const fitSuggestions = useMemo(() => {
    if (
      !effectiveHours ||
      !effectiveBookings ||
      !selectedService ||
      !resolvedSpecialistId
    ) {
      return [];
    }
    if (!form.startAt) return [];
    const day = new Date(form.startAt);
    if (Number.isNaN(day.getTime())) return [];
    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const dayStartMs = dayStart.getTime();
    const dayEndMs = dayEnd.getTime();

    // Staff may book into DRAFT or PUBLISHED hours (same as API assertStaffBookingWindow).
    const workBands = effectiveHours
      .filter(
        (h) =>
          h.specialistId === resolvedSpecialistId &&
          (h.status === 'PUBLISHED' || h.status === 'DRAFT') &&
          new Date(h.startAt).getTime() < dayEndMs &&
          new Date(h.endAt).getTime() > dayStartMs,
      )
      .map((h) => ({
        startMs: new Date(h.startAt).getTime(),
        endMs: new Date(h.endAt).getTime(),
      }));
    const bookings = effectiveBookings
      .filter(
        (b) =>
          b.specialistId === resolvedSpecialistId &&
          !b.busy &&
          new Date(b.startAt).getTime() < dayEndMs &&
          new Date(b.endAt).getTime() > dayStartMs,
      )
      .map((b) => ({
        id: b.id,
        label: b.clientName ?? b.guestName ?? 'Клиент',
        startMs: new Date(b.startAt).getTime(),
        endMs: new Date(b.endAt).getTime(),
      }));
    const durationMin =
      selectedService.durationMin + (selectedService.bufferMin ?? 0);
    return suggestSpaFitStarts(workBands, bookings, durationMin, {
      allowOverlapMin: SPA_OVERLAP_ALLOW_MIN,
      maxSuggestions: 10,
    });
  }, [
    effectiveBookings,
    effectiveHours,
    form.startAt,
    resolvedSpecialistId,
    selectedService,
  ]);

  const placementCheck = useMemo(() => {
    if (
      !effectiveBookings ||
      !selectedService ||
      !resolvedSpecialistId ||
      !form.startAt
    ) {
      return null;
    }
    const start = new Date(form.startAt);
    if (Number.isNaN(start.getTime())) return null;
    const durationMin =
      selectedService.durationMin + (selectedService.bufferMin ?? 0);
    const startMs = start.getTime();
    const endMs = startMs + durationMin * 60_000;
    const peers = effectiveBookings
      .filter((b) => b.specialistId === resolvedSpecialistId && !b.busy)
      .map((b) => ({
        id: b.id,
        label: b.clientName ?? b.guestName ?? 'Клиент',
        startMs: new Date(b.startAt).getTime(),
        endMs: new Date(b.endAt).getTime(),
      }));
    return checkSpaPlacement(startMs, endMs, peers, SPA_OVERLAP_ALLOW_MIN);
  }, [effectiveBookings, form.startAt, resolvedSpecialistId, selectedService]);

  const periodRowStatuses = useMemo(() => {
    type RowStatus = 'ok' | 'overlap' | 'bad' | 'unknown';
    const out = new Map<string, { status: RowStatus; tip: string }>();
    if (!periodMode) return out;
    const sid = resolvedSpecialistId || defaultSpecialistId || '';
    for (const entry of periodEntries) {
      const svc =
        bookable.find((s) => s.id === entry.serviceId) ?? selectedService;
      const startMs = new Date(`${entry.date}T${entry.time}`).getTime();
      const durationMin =
        (svc?.durationMin ?? 60) + (svc?.bufferMin ?? 0);
      const endMs = startMs + durationMin * 60_000;
      if (!effectiveBookings || !effectiveHours || !sid || Number.isNaN(startMs)) {
        out.set(entry.date, { status: 'unknown', tip: '' });
        continue;
      }
      const peers = effectiveBookings
        .filter(
          (b) =>
            !b.busy &&
            b.specialistId === sid &&
            new Date(b.startAt).getTime() < endMs &&
            new Date(b.endAt).getTime() > startMs,
        )
        .map((b) => ({
          id: b.id,
          label: b.clientName ?? b.guestName ?? 'Клиент',
          startMs: new Date(b.startAt).getTime(),
          endMs: new Date(b.endAt).getTime(),
        }));
      const check = checkSpaPlacement(
        startMs,
        endMs,
        peers,
        SPA_OVERLAP_ALLOW_MIN,
      );
      const dayStart = new Date(startMs);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const dayStartMs = dayStart.getTime();
      const dayEndMs = dayEnd.getTime();
      const dayHours = effectiveHours.filter(
        (h) =>
          h.specialistId === sid &&
          (h.status === 'PUBLISHED' || h.status === 'DRAFT') &&
          new Date(h.startAt).getTime() < dayEndMs &&
          new Date(h.endAt).getTime() > dayStartMs,
      );
      // Board may only cover the visible week/day — missing days are unknown, not conflicts.
      if (dayHours.length === 0) {
        out.set(entry.date, {
          status: 'unknown',
          tip: 'Часы дня не в доске — проверит сервер',
        });
        continue;
      }
      const covered = dayHours.some(
        (h) =>
          new Date(h.startAt).getTime() <= startMs &&
          new Date(h.endAt).getTime() >= endMs,
      );
      if (!covered) {
        out.set(entry.date, { status: 'bad', tip: 'Вне часов смены' });
      } else if (check.fitsClean) {
        out.set(entry.date, { status: 'ok', tip: 'Свободно' });
      } else if (check.allowedWithConfirm) {
        out.set(entry.date, {
          status: 'overlap',
          tip: `Наслоение ${check.maxOverlapMin} мин`,
        });
      } else {
        out.set(entry.date, {
          status: 'bad',
          tip:
            (check.maxStackDepth ?? 0) > 2
              ? 'Уже две записи'
              : `Конфликт ${check.maxOverlapMin} мин`,
        });
      }
    }
    return out;
  }, [
    effectiveBookings,
    effectiveHours,
    bookable,
    defaultSpecialistId,
    periodEntries,
    periodMode,
    resolvedSpecialistId,
    selectedService,
  ]);

  const periodNeedsOverlapConfirm = useMemo(() => {
    if (!periodMode) return false;
    for (const row of periodRowStatuses.values()) {
      if (row.status === 'overlap') return true;
    }
    return false;
  }, [periodMode, periodRowStatuses]);

  const periodHasBlocked = useMemo(() => {
    if (!periodMode) return false;
    for (const row of periodRowStatuses.values()) {
      if (row.status === 'bad') return true;
    }
    return false;
  }, [periodMode, periodRowStatuses]);

  if (!open) return null;

  const selected = selectedService;
  const { datePart, timePart } = splitDatetimeLocal(form.startAt);
  const startIsPast =
    Boolean(form.startAt) && new Date(form.startAt).getTime() < Date.now();
  const needsOverlapConfirm =
    !periodMode &&
    Boolean(placementCheck) &&
    !placementCheck!.fitsClean &&
    placementCheck!.allowedWithConfirm;
  const overlapBlocked =
    !periodMode &&
    Boolean(placementCheck) &&
    !placementCheck!.fitsClean &&
    !placementCheck!.allowedWithConfirm;

  const setDatePart = (date: string) => {
    const time = timePart || '10:00';
    setForm((f) => ({
      ...f,
      startAt: date ? `${date}T${time}` : '',
    }));
  };

  const setTimePart = (time: string) => {
    const date = datePart || toDatetimeLocalValue(new Date()).slice(0, 10);
    setForm((f) => ({
      ...f,
      startAt: time ? `${date}T${time}` : `${date}T00:00`,
    }));
  };

  const lookupPhone = async (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (!digits.length) {
      setPhoneLookup('');
      setClientExternalId('');
      setForm((f) => ({ ...f, clientId: '' }));
      setClientNote('');
      setClientNoteSaved('');
      return;
    }
    if (digits.length < 9) {
      setPhoneLookup('Введите номер полностью');
      setClientExternalId('');
      setForm((f) => ({ ...f, clientId: '' }));
      return;
    }
    const token = getToken();
    if (!token) return;
    setPhoneLookup('Ищем клиента…');
    try {
      const found = await api.lookupSpaClientByPhone(token, raw);
      if (found.pending) {
        setPhoneLookup(
          '1С не ответила. Можно записать гостя по ФИО, телефон сохранится.',
        );
        setForm((f) => ({ ...f, clientId: found.clientId ?? '' }));
        void loadClientNote({
          clientId: found.clientId,
          phone: found.phone || raw,
        });
        return;
      }
      if (!found.found) {
        setPhoneLookup('В 1С и в базе нет. Укажите ФИО — запишем как гостя.');
        setClientExternalId('');
        setForm((f) => ({ ...f, clientId: '' }));
        void loadClientNote({ phone: found.phone || raw });
        return;
      }
      const name = `${found.lastName ?? ''} ${found.firstName ?? ''}`.trim();
      setPhoneLookup(
        found.clientId
          ? `Клиент из базы: ${name}`
          : `Клиент из 1С: ${name}. Запись свяжется с ним.`,
      );
      setClientExternalId(found.externalId ?? '');
      setForm((f) => ({
        ...f,
        clientId: found.clientId ?? '',
        guestName: f.guestName || name,
      }));
      void loadClientNote({
        clientId: found.clientId,
        clientExternalId: found.externalId,
        phone: found.phone || raw,
      });
    } catch (err) {
      setPhoneLookup(err instanceof Error ? err.message : 'Ошибка поиска');
    }
  };

  const buildPayload = (startIso: string): BookingPayload => {
    const phone = form.guestPhone.trim() || undefined;
    const note = visitNote.trim() || undefined;
    const ext = clientExternalId.trim() || undefined;
    return {
      specialistId: allowPickSpecialist ? form.specialistId : undefined,
      serviceId: form.serviceId,
      startAt: startIso,
      paymentType: form.paymentType,
      ...(needsOverlapConfirm && overlapConfirmed
        ? { overlapConfirmed: true }
        : {}),
      ...(note ? { visitNote: note } : { visitNote: '' }),
      ...(form.clientId
        ? {
            clientId: form.clientId,
            ...(phone ? { guestPhone: phone } : {}),
            ...(ext ? { clientExternalId: ext } : {}),
          }
        : {
            guestName: form.guestName.trim(),
            ...(phone ? { guestPhone: phone } : {}),
            ...(ext ? { clientExternalId: ext } : {}),
          }),
    };
  };

  const submit = async () => {
    setError('');
    if (!form.serviceId) {
      setError('Выберите услугу');
      return;
    }
    if (!form.startAt) {
      setError('Укажите время начала');
      return;
    }
    if (allowPickSpecialist && !form.specialistId) {
      setError('Укажите специалиста');
      return;
    }
    if (!form.clientId && !form.guestName.trim()) {
      setError('Укажите ФИО клиента');
      return;
    }
    if (periodMode) {
      if (periodHasBlocked) {
        setError(
          'В периоде есть конфликтующие даты (!). Уберите их или смените время.',
        );
        return;
      }
      if (periodNeedsOverlapConfirm && !overlapConfirmed) {
        setError('Подтвердите наслоение для дат периода');
        return;
      }
    } else {
      if (overlapBlocked) {
        setError(
          `Пересечение ${placementCheck?.maxOverlapMin ?? ''} мин — больше ${SPA_OVERLAP_ALLOW_MIN} минут нельзя`,
        );
        return;
      }
      if (needsOverlapConfirm && !overlapConfirmed) {
        setError('Подтвердите наслоение записей');
        return;
      }
    }
    const startIso = new Date(form.startAt).toISOString();
    if (Number.isNaN(new Date(startIso).getTime())) {
      setError('Некорректная дата');
      return;
    }
    try {
      if (
        clientNoteEnabled &&
        clientNote.trim() !== clientNoteSaved.trim()
      ) {
        await saveClientNoteNow();
      }
      const payload = buildPayload(startIso);
      if (periodMode && onBulkSubmit) {
        if (periodEntries.length === 0) {
          setError('Выберите хотя бы одну дату');
          return;
        }
        const items = periodEntries
          .map((entry) => {
            const iso = entryToIso(entry);
            if (Number.isNaN(new Date(iso).getTime())) return null;
            return {
              startAt: iso,
              serviceId: entry.serviceId || form.serviceId,
              ...(periodNeedsOverlapConfirm && overlapConfirmed
                ? { overlapConfirmed: true as const }
                : {}),
            };
          })
          .filter((x): x is NonNullable<typeof x> => Boolean(x));
        if (items.length === 0) {
          setError('Некорректные даты периода');
          return;
        }
        const result = await onBulkSubmit({
          ...payload,
          items,
          dates: items.map((i) => i.startAt),
        });
        if (result?.skipped?.length) {
          setSkippedRows(result.skipped);
          setError(
            `Создано ${result.created.length}, пропущено ${result.skipped.length}. Исправьте даты ниже и отправьте снова.`,
          );
          setPeriodEntries((prev) =>
            prev.filter((e) =>
              result.skipped.some((s) => {
                const sk = new Date(s.date);
                if (Number.isNaN(sk.getTime())) return false;
                return localDateKey(sk) === e.date;
              }),
            ),
          );
          return;
        }
        setSkippedRows([]);
      } else {
        await onSubmit(payload);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось записать');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="card max-h-[min(92dvh,100%)] w-full max-w-md space-y-3 overflow-y-auto overscroll-contain rounded-b-none sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Новая запись</h3>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={onClose}
          >
            Закрыть
          </button>
        </div>

        {allowPickSpecialist && specialists ? (
          <label className="block space-y-1 text-sm">
            <span className="text-slate-400">Специалист</span>
            <select
              className="input"
              value={form.specialistId}
              onChange={(e) =>
                setForm((f) => ({ ...f, specialistId: e.target.value }))
              }
            >
              <option value="">Выберите</option>
              {specialists.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.lastName} {s.firstName}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="space-y-3 rounded-xl border border-white/5 bg-slate-900/40 p-3">
          <p className="text-sm font-medium text-slate-300">Клиент</p>
          <SpaClientNameField
            guestName={form.guestName}
            guestPhone={form.guestPhone}
            specialistId={
              allowPickSpecialist
                ? form.specialistId || undefined
                : defaultSpecialistId
            }
            onGuestNameChange={(name) =>
              setForm((f) => ({ ...f, guestName: name }))
            }
            onClearPick={() => {
              setForm((f) => ({ ...f, clientId: '' }));
              setClientExternalId('');
              setPhoneLookup('');
            }}
            onPick={applySuggestion}
          />
          <label className="block space-y-1 text-sm">
            <span className="text-slate-400">Телефон (необязательно)</span>
            <input
              className="input"
              value={form.guestPhone}
              onChange={(e) =>
                setForm((f) => ({ ...f, guestPhone: e.target.value }))
              }
              onBlur={(e) => lookupPhone(e.target.value)}
              placeholder="+375…"
            />
          </label>
          {phoneLookup ? (
            <p className="text-xs text-slate-400">{phoneLookup}</p>
          ) : (
            <p className="text-xs text-slate-500">
              Начните вводить имя — появятся клиенты, которые уже были у
              специалиста. Без номера запись сохранится с пометкой «Нет в
              1С»; телефон добавит админ на контроле.
            </p>
          )}
        </div>

        <div className="space-y-3 rounded-xl border border-white/5 bg-slate-900/40 p-3">
          <p className="text-sm font-medium text-slate-300">Запись</p>
          <label className="block space-y-1 text-sm">
            <span className="text-slate-400">Услуга</span>
            <select
              className="input"
              value={form.serviceId}
              onChange={(e) =>
                setForm((f) => ({ ...f, serviceId: e.target.value }))
              }
            >
              {bookable.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.durationMin} мин ·{' '}
                  {formatPrice(s.priceMinor, s.currency)}
                </option>
              ))}
            </select>
            {selected ? (
              <p className="text-xs text-slate-500">
                {selected.durationMin} мин
                {selected.bufferMin ? ` + перерыв ${selected.bufferMin}` : ''}
              </p>
            ) : null}
          </label>

          <div className="space-y-1">
            <p className="text-sm text-slate-400">Дата и время начала</p>
            <div className="grid grid-cols-2 gap-2">
              <DateField
                label="Дата"
                value={datePart}
                onChange={setDatePart}
              />
              <TimeField
                label="Время"
                value={timePart || '10:00'}
                onChange={setTimePart}
              />
            </div>
            <p className="text-xs text-slate-500">
              Можно изменить вручную. Запись в прошлое — если забыли добавить
              сразу.
              {startIsPast ? (
                <span className="text-amber-300/90">
                  {' '}
                  Сейчас указано прошлое время.
                </span>
              ) : null}
            </p>
            {effectiveHours && effectiveBookings && selected ? (
              <div className="space-y-1.5 pt-1">
                <p className="text-xs font-medium text-slate-400">Куда влезет</p>
                {fitSuggestions.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    На {selected.durationMin} мин в этот день окна нет (учтите
                    часы смены, в т.ч. черновик)
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {fitSuggestions.map((s) => (
                      <button
                        key={s.startMs}
                        type="button"
                        className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                          s.kind === 'clean'
                            ? 'bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/30'
                            : 'bg-amber-500/15 text-amber-100 ring-1 ring-amber-500/30'
                        }`}
                        onClick={() => {
                          const local = toDatetimeLocalValue(new Date(s.startMs));
                          setForm((f) => ({ ...f, startAt: local }));
                        }}
                      >
                        {formatHm(s.startMs)}
                        {s.kind === 'overlap'
                          ? ` · ∩ ${s.overlapMin} мин`
                          : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
            {needsOverlapConfirm ? (
              <label className="mt-2 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-100">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={overlapConfirmed}
                  onChange={(e) => setOverlapConfirmed(e.target.checked)}
                />
                <span>
                  Пересечение {placementCheck?.maxOverlapMin} мин
                  {placementCheck?.peers[0]
                    ? ` с «${placementCheck.peers[0].label}»`
                    : ''}
                  . Подтверждаю наслоение.
                </span>
              </label>
            ) : null}
            {overlapBlocked ? (
              <p className="mt-2 text-xs text-rose-300">
                {(placementCheck?.maxStackDepth ?? 0) > 2
                  ? 'На это время уже две записи — третья накладка запрещена. Выберите другое время.'
                  : `Пересечение ${placementCheck?.maxOverlapMin} мин — больше ${SPA_OVERLAP_ALLOW_MIN} минут нельзя. Выберите другое время.`}
              </p>
            ) : null}
          </div>

          <label className="block space-y-1 text-sm">
            <span className="text-slate-400">Оплата</span>
            <select
              className="input"
              value={form.paymentType}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  paymentType: e.target.value as 'QUOTA' | 'PAID',
                }))
              }
            >
              <option value="PAID">Платно</option>
              <option value="QUOTA">По квоте</option>
            </select>
          </label>

          {onBulkSubmit ? (
            <div className="space-y-2 border-t border-white/5 pt-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={periodMode}
                  onChange={(e) => setPeriodMode(e.target.checked)}
                />
                <span>Запись на период</span>
              </label>
              {periodMode ? (
                <div className="space-y-2">
                  <label className="block space-y-1 text-sm">
                    <span className="text-slate-400">Недель (тот же день)</span>
                    <input
                      type="number"
                      className="input"
                      min={1}
                      max={26}
                      value={periodWeeks}
                      onChange={(e) =>
                        setPeriodWeeks(
                          Math.max(
                            1,
                            Math.min(26, Number(e.target.value) || 1),
                          ),
                        )
                      }
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() => {
                        const t = timePart || '10:00';
                        setPeriodEntries((prev) =>
                          prev.map((e) => ({ ...e, time: t })),
                        );
                      }}
                    >
                      Это время всем
                    </button>
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() => {
                        const sid = form.serviceId;
                        setPeriodEntries((prev) =>
                          prev.map((e) => ({
                            ...e,
                            serviceId: sid,
                            serviceTouched: false,
                          })),
                        );
                      }}
                    >
                      Эту услугу всем
                    </button>
                  </div>
                  {skippedRows.length > 0 ? (
                    <ul className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-100">
                      {skippedRows.map((s) => (
                        <li key={`${s.date}-${s.reason}`}>
                          {formatDateCompact(
                            Number.isNaN(new Date(s.date).getTime())
                              ? s.date.slice(0, 10)
                              : localDateKey(new Date(s.date)),
                          )}
                          : {s.reason}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {periodNeedsOverlapConfirm ? (
                    <label className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-100">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={overlapConfirmed}
                        onChange={(e) =>
                          setOverlapConfirmed(e.target.checked)
                        }
                      />
                      <span>
                        Разрешить наслоение до {SPA_OVERLAP_ALLOW_MIN} мин в
                        датах периода (≈ или ·).
                      </span>
                    </label>
                  ) : null}
                  <ul className="max-h-56 space-y-1.5 overflow-y-auto text-sm">
                    {periodEntries.map((entry) => {
                      const row = periodRowStatuses.get(entry.date);
                      const rowStatus = row?.status ?? 'unknown';
                      const rowTip = row?.tip ?? '';
                      return (
                        <li
                          key={entry.date}
                          className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-1.5 sm:grid-cols-[auto_auto_minmax(0,1fr)_5.5rem]"
                        >
                          <button
                            type="button"
                            className="text-slate-500 hover:text-rose-300"
                            title="Убрать"
                            onClick={() =>
                              setPeriodEntries((prev) =>
                                prev.filter((e) => e.date !== entry.date),
                              )
                            }
                          >
                            ×
                          </button>
                          <span
                            className="w-[4.75rem] shrink-0 capitalize text-slate-300"
                            title={rowTip}
                          >
                            <span className="mr-1 inline-block w-2 text-center text-[10px]">
                              {rowStatus === 'ok'
                                ? '✓'
                                : rowStatus === 'overlap'
                                  ? '≈'
                                  : rowStatus === 'bad'
                                    ? '!'
                                    : '·'}
                            </span>
                            {formatDateCompact(entry.date)}
                          </span>
                          <select
                            className="input !px-1.5 !py-1 text-xs"
                            value={entry.serviceId || form.serviceId}
                            onChange={(e) => {
                              const serviceId = e.target.value;
                              setPeriodEntries((prev) =>
                                prev.map((row) =>
                                  row.date === entry.date
                                    ? {
                                        ...row,
                                        serviceId,
                                        serviceTouched: true,
                                      }
                                    : row,
                                ),
                              );
                            }}
                          >
                            {bookable.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                          <TimeField
                            className="w-[5.5rem] shrink-0"
                            compact
                            value={entry.time}
                            onChange={(t) => {
                              setPeriodEntries((prev) =>
                                prev.map((row) =>
                                  row.date === entry.date
                                    ? { ...row, time: t }
                                    : row,
                                ),
                              );
                            }}
                          />
                        </li>
                      );
                    })}
                  </ul>
                  <div className="flex flex-wrap items-end gap-2">
                    <DateField
                      label="Добавить дату"
                      value={extraDate}
                      onChange={setExtraDate}
                    />
                    <label className="block min-w-[8rem] flex-1 space-y-1 text-sm">
                      <span className="block h-4 text-[11px] text-slate-500">
                        Услуга
                      </span>
                      <select
                        className="input !py-1 text-xs"
                        value={extraServiceId || form.serviceId}
                        onChange={(e) => setExtraServiceId(e.target.value)}
                      >
                        {bookable.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <TimeField
                      label="Время"
                      className="w-[5.5rem]"
                      compact
                      value={extraTime}
                      onChange={setExtraTime}
                    />
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() => {
                        if (!extraDate || !extraTime) return;
                        const sid = extraServiceId || form.serviceId;
                        setPeriodEntries((prev) => {
                          if (prev.some((e) => e.date === extraDate)) {
                            return prev.map((e) =>
                              e.date === extraDate
                                ? {
                                    ...e,
                                    time: extraTime,
                                    serviceId: sid,
                                    serviceTouched: true,
                                  }
                                : e,
                            );
                          }
                          return [
                            ...prev,
                            {
                              date: extraDate,
                              time: extraTime,
                              serviceId: sid,
                              serviceTouched: true,
                            },
                          ].sort((a, b) => a.date.localeCompare(b.date));
                        });
                        setExtraDate('');
                      }}
                    >
                      +
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <SpaBookingNotesFields
          clientNote={clientNote}
          visitNote={visitNote}
          clientNoteSaved={clientNoteSaved}
          clientNoteEnabled={clientNoteEnabled}
          clientNoteBusy={clientNoteBusy}
          onClientNoteChange={setClientNote}
          onVisitNoteChange={setVisitNote}
          onSaveClientNote={() => {
            void saveClientNoteNow().catch((err) => {
              setError(
                err instanceof Error
                  ? err.message
                  : 'Не удалось сохранить комментарий',
              );
            });
          }}
        />

        {error ? (
          <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          className="btn-primary w-full"
          disabled={busy}
          onClick={() => {
            void submit();
          }}
        >
          {busy
            ? 'Записываем…'
            : periodMode
              ? `Создать ${periodEntries.length || 0} записей`
              : 'Записать'}
        </button>
      </div>
    </div>
  );
}

/** Convert ISO to datetime-local value in local TZ. */
export function toDatetimeLocalValue(isoOrDate: string | Date) {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function splitDatetimeLocal(value: string): {
  datePart: string;
  timePart: string;
} {
  if (!value) return { datePart: '', timePart: '' };
  const [datePart = '', timeRaw = ''] = value.split('T');
  const timePart = timeRaw.slice(0, 5);
  return { datePart, timePart };
}
