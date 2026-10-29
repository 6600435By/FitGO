'use client';

import type {
  SpaBoardBooking,
  SpaBoardHourBlock,
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

type PeriodEntry = { date: string; time: string };

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
): PeriodEntry[] {
  const base = new Date(startLocal);
  if (Number.isNaN(base.getTime()) || weeks < 1) return [];
  const time = localTimeHm(base);
  const out: PeriodEntry[] = [];
  for (let i = 0; i < weeks; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i * 7);
    out.push({ date: localDateKey(d), time });
  }
  return out;
}

/** Keep custom times for dates that remain; fill new weeks from defaultTime. */
function mergePeriodEntries(
  prev: PeriodEntry[],
  suggested: PeriodEntry[],
  defaultTime: string,
): PeriodEntry[] {
  const byDate = new Map(prev.map((e) => [e.date, e.time]));
  return suggested.map((s) => ({
    date: s.date,
    time: byDate.get(s.date) ?? s.time ?? defaultTime,
  }));
}

function entryToIso(entry: PeriodEntry) {
  return new Date(`${entry.date}T${entry.time}`).toISOString();
}

function formatDateShort(dateYmd: string) {
  return new Date(`${dateYmd}T12:00:00`).toLocaleDateString('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
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
  onSubmit: (payload: BookingPayload) => Promise<void>;
  onBulkSubmit?: (
    payload: BookingPayload & { dates: string[] },
  ) => Promise<void>;
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
  const [overlapConfirmed, setOverlapConfirmed] = useState(false);
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
    () => (periodMode ? buildWeeklyEntries(form.startAt, periodWeeks) : []),
    [form.startAt, periodMode, periodWeeks],
  );

  useEffect(() => {
    if (!periodMode) {
      setPeriodEntries([]);
      return;
    }
    const { timePart: defaultTime } = splitDatetimeLocal(form.startAt);
    setPeriodEntries((prev) =>
      mergePeriodEntries(prev, suggestedEntries, defaultTime || '10:00'),
    );
  }, [periodMode, suggestedEntries, form.startAt]);

  useEffect(() => {
    if (!open) return;
    setOverlapConfirmed(false);
  }, [open, form.startAt, form.serviceId, form.specialistId]);

  const selectedService = useMemo(
    () => bookable.find((s) => s.id === form.serviceId),
    [bookable, form.serviceId],
  );

  const resolvedSpecialistId = allowPickSpecialist
    ? form.specialistId
    : (defaultSpecialistId ?? form.specialistId);

  const fitSuggestions = useMemo(() => {
    if (!boardHours || !boardBookings || !selectedService || !resolvedSpecialistId) {
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

    const workBands = boardHours
      .filter(
        (h) =>
          h.specialistId === resolvedSpecialistId &&
          h.status === 'PUBLISHED' &&
          new Date(h.startAt).getTime() < dayEndMs &&
          new Date(h.endAt).getTime() > dayStartMs,
      )
      .map((h) => ({
        startMs: new Date(h.startAt).getTime(),
        endMs: new Date(h.endAt).getTime(),
      }));
    const bookings = boardBookings
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
    boardBookings,
    boardHours,
    form.startAt,
    resolvedSpecialistId,
    selectedService,
  ]);

  const placementCheck = useMemo(() => {
    if (!boardBookings || !selectedService || !resolvedSpecialistId || !form.startAt) {
      return null;
    }
    const start = new Date(form.startAt);
    if (Number.isNaN(start.getTime())) return null;
    const durationMin =
      selectedService.durationMin + (selectedService.bufferMin ?? 0);
    const startMs = start.getTime();
    const endMs = startMs + durationMin * 60_000;
    const peers = boardBookings
      .filter((b) => b.specialistId === resolvedSpecialistId && !b.busy)
      .map((b) => ({
        id: b.id,
        label: b.clientName ?? b.guestName ?? 'Клиент',
        startMs: new Date(b.startAt).getTime(),
        endMs: new Date(b.endAt).getTime(),
      }));
    return checkSpaPlacement(startMs, endMs, peers, SPA_OVERLAP_ALLOW_MIN);
  }, [boardBookings, form.startAt, resolvedSpecialistId, selectedService]);

  if (!open) return null;

  const selected = selectedService;
  const { datePart, timePart } = splitDatetimeLocal(form.startAt);
  const startIsPast =
    Boolean(form.startAt) && new Date(form.startAt).getTime() < Date.now();
  const needsOverlapConfirm =
    Boolean(placementCheck) &&
    !placementCheck!.fitsClean &&
    placementCheck!.allowedWithConfirm;
  const overlapBlocked =
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
        const dates = periodEntries.map(entryToIso).filter((iso) => {
          return !Number.isNaN(new Date(iso).getTime());
        });
        if (dates.length === 0) {
          setError('Некорректные даты периода');
          return;
        }
        await onBulkSubmit({ ...payload, dates });
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
            {boardHours && boardBookings && selected ? (
              <div className="space-y-1.5 pt-1">
                <p className="text-xs font-medium text-slate-400">Куда влезет</p>
                {fitSuggestions.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    На {selected.durationMin} мин в этот день окна нет
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
                Пересечение {placementCheck?.maxOverlapMin} мин — больше{' '}
                {SPA_OVERLAP_ALLOW_MIN} минут нельзя. Выберите другое время.
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
                  </div>
                  <ul className="max-h-48 space-y-1.5 overflow-y-auto text-sm">
                    {periodEntries.map((entry) => (
                      <li
                        key={entry.date}
                        className="flex flex-wrap items-center gap-2"
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
                        <span className="min-w-[6.5rem] capitalize text-slate-300">
                          {formatDateShort(entry.date)}
                        </span>
                        <TimeField
                          className="min-w-[8.5rem] flex-1"
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
                    ))}
                  </ul>
                  <div className="flex flex-wrap items-end gap-2">
                    <DateField
                      label="Добавить дату"
                      value={extraDate}
                      onChange={setExtraDate}
                    />
                    <TimeField
                      label="Время"
                      className="min-w-[8.5rem]"
                      value={extraTime}
                      onChange={setExtraTime}
                    />
                    <button
                      type="button"
                      className="btn-secondary text-xs"
                      onClick={() => {
                        if (!extraDate || !extraTime) return;
                        setPeriodEntries((prev) => {
                          if (prev.some((e) => e.date === extraDate)) {
                            return prev.map((e) =>
                              e.date === extraDate
                                ? { ...e, time: extraTime }
                                : e,
                            );
                          }
                          return [
                            ...prev,
                            { date: extraDate, time: extraTime },
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
