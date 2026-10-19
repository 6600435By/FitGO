'use client';

import type { SpaService } from '@fitgo/shared-types';
import { useEffect, useMemo, useState } from 'react';
import { DateField, TimeField } from '@/components/ui/date-field';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function formatPrice(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)} ${currency}`;
}

type BookingPayload = {
  specialistId?: string;
  clientId?: string;
  guestName?: string;
  guestPhone?: string;
  serviceId: string;
  startAt: string;
  paymentType: 'QUOTA' | 'PAID';
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
  clients,
  specialists,
  defaultSpecialistId,
  defaultStartAt,
  allowPickSpecialist,
  onSubmit,
  onBulkSubmit,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  services: SpaService[];
  clients: Array<{ id: string; firstName: string; lastName: string }>;
  specialists?: Array<{ id: string; firstName: string; lastName: string }>;
  defaultSpecialistId?: string;
  defaultStartAt?: string;
  allowPickSpecialist?: boolean;
  onSubmit: (payload: BookingPayload) => Promise<void>;
  onBulkSubmit?: (
    payload: BookingPayload & { dates: string[] },
  ) => Promise<void>;
  busy?: boolean;
}) {
  const bookable = services.filter((s) => s.active && (s.bookable ?? true));
  const [mode, setMode] = useState<'base' | 'phone'>('phone');
  const [phoneLookup, setPhoneLookup] = useState('');
  const [error, setError] = useState('');
  const [periodMode, setPeriodMode] = useState(false);
  const [periodWeeks, setPeriodWeeks] = useState(4);
  const [periodEntries, setPeriodEntries] = useState<PeriodEntry[]>([]);
  const [extraDate, setExtraDate] = useState('');
  const [extraTime, setExtraTime] = useState('10:00');
  const [form, setForm] = useState({
    specialistId: defaultSpecialistId ?? '',
    clientId: '',
    guestName: '',
    guestPhone: '',
    serviceId: bookable[0]?.id ?? '',
    startAt: defaultStartAt ?? '',
    paymentType: 'PAID' as 'QUOTA' | 'PAID',
  });

  useEffect(() => {
    if (!open) return;
    setError('');
    setPhoneLookup('');
    setMode('phone');
    setPeriodMode(false);
    setPeriodWeeks(4);
    setPeriodEntries([]);
    setExtraDate('');
    setExtraTime('10:00');
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

  if (!open) return null;

  const selected = bookable.find((s) => s.id === form.serviceId);
  const { datePart, timePart } = splitDatetimeLocal(form.startAt);
  const startIsPast =
    Boolean(form.startAt) && new Date(form.startAt).getTime() < Date.now();

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
      setForm((f) => ({ ...f, clientId: '' }));
      return;
    }
    if (digits.length < 9) {
      setPhoneLookup('Введите номер полностью');
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
        return;
      }
      if (!found.found) {
        setPhoneLookup('В 1С и в базе нет. Укажите ФИО — запишем как гостя.');
        setForm((f) => ({ ...f, clientId: '' }));
        return;
      }
      const name = `${found.lastName ?? ''} ${found.firstName ?? ''}`.trim();
      setPhoneLookup(
        found.clientId
          ? `Клиент из базы: ${name}`
          : `Клиент из 1С: ${name}. Запись свяжется с ним.`,
      );
      setForm((f) => ({
        ...f,
        clientId: found.clientId ?? '',
        guestName: f.guestName || name,
      }));
    } catch (err) {
      setPhoneLookup(err instanceof Error ? err.message : 'Ошибка поиска');
    }
  };

  const buildPayload = (startIso: string): BookingPayload => {
    const phone = form.guestPhone.trim() || undefined;
    return {
      specialistId: allowPickSpecialist ? form.specialistId : undefined,
      serviceId: form.serviceId,
      startAt: startIso,
      paymentType: form.paymentType,
      ...(mode === 'base'
        ? { clientId: form.clientId }
        : form.clientId
          ? { clientId: form.clientId, ...(phone ? { guestPhone: phone } : {}) }
          : {
              guestName: form.guestName.trim(),
              ...(phone ? { guestPhone: phone } : {}),
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
    if (mode === 'base' && !form.clientId) {
      setError('Выберите клиента из базы');
      return;
    }
    if (mode === 'phone' && !form.clientId && !form.guestName.trim()) {
      setError('Укажите ФИО клиента');
      return;
    }
    const startIso = new Date(form.startAt).toISOString();
    if (Number.isNaN(new Date(startIso).getTime())) {
      setError('Некорректная дата');
      return;
    }
    try {
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

        <div className="flex gap-2 text-xs">
          <button
            type="button"
            className={mode === 'phone' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setMode('phone')}
          >
            Вручную
          </button>
          <button
            type="button"
            className={mode === 'base' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setMode('base')}
          >
            Из базы
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

        {mode === 'base' ? (
          <label className="block space-y-1 text-sm">
            <span className="text-slate-400">Клиент</span>
            <select
              className="input"
              value={form.clientId}
              onChange={(e) =>
                setForm((f) => ({ ...f, clientId: e.target.value }))
              }
            >
              <option value="">Выберите</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.lastName} {c.firstName}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
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
                Без номера запись сохранится с пометкой «Нет в 1С». Телефон
                добавит админ на контроле записей.
              </p>
            )}
            <label className="block space-y-1 text-sm">
              <span className="text-slate-400">ФИО</span>
              <input
                className="input"
                value={form.guestName}
                onChange={(e) =>
                  setForm((f) => ({ ...f, guestName: e.target.value }))
                }
              />
            </label>
          </>
        )}

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
              <span className="text-amber-300/90"> Сейчас указано прошлое время.</span>
            ) : null}
          </p>
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
          <div className="space-y-2 rounded-xl border border-white/5 bg-slate-900/40 p-3">
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
                        Math.max(1, Math.min(26, Number(e.target.value) || 1)),
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
                        return [...prev, { date: extraDate, time: extraTime }].sort(
                          (a, b) => a.date.localeCompare(b.date),
                        );
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
