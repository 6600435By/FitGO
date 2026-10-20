'use client';

import type { SpaService, SpaWaitlistEntry } from '@fitgo/shared-types';
import {
  SPA_WAITLIST_WEEKDAY_ALL,
  SPA_WAITLIST_WEEKDAY_LABELS_RU,
  SPA_WAITLIST_WEEKDAY_WEEKDAYS,
  SPA_WAITLIST_WEEKDAY_WEEKEND,
  compareSpaWaitlistForBoard,
  formatSpaWaitlistMinutes,
  formatSpaWaitlistPreference,
  spaLocalDateKey,
  spaWaitlistFitsBoardDay,
} from '@fitgo/shared-types';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { toDatetimeLocalValue } from '@/components/spa-board/spa-booking-dialog';
import { DateField } from '@/components/ui/date-field';

type PeriodEntry = { date: string; time: string };
type PrefMode = 'exact' | 'window';
type TimeBand =
  | 'morning'
  | 'afternoon'
  | 'evening'
  | 'all'
  | 'custom';

const TIME_BANDS: Record<
  Exclude<TimeBand, 'custom' | 'all'>,
  { from: number; to: number }
> = {
  morning: { from: 9 * 60, to: 12 * 60 },
  afternoon: { from: 12 * 60, to: 17 * 60 },
  evening: { from: 17 * 60, to: 21 * 60 },
};

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function localDateKey(d: Date) {
  return spaLocalDateKey(d);
}

function localTimeHm(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localDateKey(d);
}

function startOfWeekMonday(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00`);
  const js = d.getDay();
  const offset = js === 0 ? -6 : 1 - js;
  d.setDate(d.getDate() + offset);
  return localDateKey(d);
}

function minutesToHm(min: number): string {
  return formatSpaWaitlistMinutes(min);
}

function hmToMinutes(hm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h < 0 || h > 23 || mi < 0 || mi > 59) return null;
  return h * 60 + mi;
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

function clientPayload(
  mode: 'base' | 'phone',
  form: { clientId: string; guestName: string; guestPhone: string },
) {
  if (mode === 'base') return { clientId: form.clientId };
  if (form.clientId) {
    return { clientId: form.clientId, guestPhone: form.guestPhone };
  }
  return {
    guestName: form.guestName,
    guestPhone: form.guestPhone,
  };
}

export function SpaWaitlistPanel({
  entries,
  services,
  specialists,
  clients,
  defaultSpecialistId,
  defaultStartAt,
  boardDayYmd,
  allowPickSpecialist,
  busy,
  onReload,
  onBook,
  onMessage,
}: {
  entries: SpaWaitlistEntry[];
  services: SpaService[];
  specialists?: Array<{ id: string; firstName: string; lastName: string }>;
  clients: Array<{ id: string; firstName: string; lastName: string }>;
  defaultSpecialistId?: string;
  defaultStartAt?: string;
  /** Local YYYY-MM-DD of the open board day — for sort and «Могут в этот день». */
  boardDayYmd?: string;
  allowPickSpecialist?: boolean;
  busy?: boolean;
  onReload: () => Promise<void>;
  onBook: (entry: SpaWaitlistEntry) => void;
  onMessage: (msg: string) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [editEntry, setEditEntry] = useState<SpaWaitlistEntry | null>(null);
  const bookable = services.filter((s) => s.active && (s.bookable ?? true));
  const dayKey = boardDayYmd ?? localDateKey(new Date());

  const sorted = useMemo(() => {
    return [...entries].sort((a, b) =>
      compareSpaWaitlistForBoard(a, b, dayKey),
    );
  }, [entries, dayKey]);

  const fitCount = useMemo(
    () => sorted.filter((e) => spaWaitlistFitsBoardDay(e, dayKey)).length,
    [sorted, dayKey],
  );

  return (
    <div className="card !p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">
          Лист ожидания
          {entries.length > 0 ? (
            <span className="ml-2 text-slate-400">· {entries.length}</span>
          ) : (
            <span className="ml-2 text-xs font-normal text-slate-500">
              · заявок нет
            </span>
          )}
        </h3>
        <button
          type="button"
          className="btn-secondary !px-2.5 !py-1 text-xs"
          disabled={busy}
          onClick={() => setShowAdd(true)}
        >
          В лист
        </button>
      </div>

      {sorted.length === 0 ? null : (
        <ul className="space-y-2">
          {sorted.map((e, idx) => {
            const fitsDay = spaWaitlistFitsBoardDay(e, dayKey);
            const showFitHeader = fitsDay && (idx === 0 || !spaWaitlistFitsBoardDay(sorted[idx - 1]!, dayKey));
            return (
              <li key={e.id} className="space-y-1">
                {showFitHeader ? (
                  <p className="text-[11px] font-medium uppercase tracking-wide text-fitgo-400/80">
                    Могут в этот день
                    {fitCount > 0 ? ` · ${fitCount}` : ''}
                  </p>
                ) : null}
                {!fitsDay &&
                idx > 0 &&
                spaWaitlistFitsBoardDay(sorted[idx - 1]!, dayKey) ? (
                  <p className="pt-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                    Другие заявки
                  </p>
                ) : null}
                <div className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-white/5 bg-slate-900/40 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{e.clientName}</p>
                    <p className="text-slate-400">
                      {e.serviceName}
                      {allowPickSpecialist ? ` · ${e.specialistName}` : ''}
                    </p>
                    <p className="text-xs text-slate-300">
                      {formatSpaWaitlistPreference(e)}
                    </p>
                    {e.note ? (
                      <p className="text-xs text-slate-500">{e.note}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-primary px-3 py-1.5 text-xs"
                      disabled={busy}
                      onClick={() => onBook(e)}
                    >
                      Записать
                    </button>
                    {e.preference === 'WINDOW' ? (
                      <button
                        type="button"
                        className="btn-secondary px-3 py-1.5 text-xs"
                        disabled={busy}
                        onClick={() => setEditEntry(e)}
                      >
                        Изменить
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn-secondary px-3 py-1.5 text-xs"
                      disabled={busy}
                      onClick={() => {
                        void (async () => {
                          const token = getToken();
                          if (!token) return;
                          try {
                            if (allowPickSpecialist) {
                              await api.adminCancelSpaWaitlist(token, e.id);
                            } else {
                              await api.specialistCancelSpaWaitlist(token, e.id);
                            }
                            onMessage('Заявка снята');
                            await onReload();
                          } catch (err) {
                            onMessage(
                              err instanceof Error ? err.message : 'Ошибка',
                            );
                          }
                        })();
                      }}
                    >
                      Снять
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {showAdd ? (
        <SpaWaitlistAddDialog
          open={showAdd}
          onClose={() => setShowAdd(false)}
          bookable={bookable}
          specialists={specialists}
          clients={clients}
          defaultSpecialistId={defaultSpecialistId}
          defaultStartAt={defaultStartAt}
          allowPickSpecialist={allowPickSpecialist}
          busy={busy}
          onCreated={async (summary) => {
            setShowAdd(false);
            onMessage(summary ?? 'Добавлено в лист ожидания');
            await onReload();
          }}
          onError={onMessage}
        />
      ) : null}

      {editEntry ? (
        <SpaWaitlistEditWindowDialog
          open={Boolean(editEntry)}
          entry={editEntry}
          allowPickSpecialist={allowPickSpecialist}
          busy={busy}
          onClose={() => setEditEntry(null)}
          onSaved={async () => {
            setEditEntry(null);
            onMessage('Период обновлён');
            await onReload();
          }}
          onError={onMessage}
        />
      ) : null}
    </div>
  );
}

function SpaWaitlistAddDialog({
  open,
  onClose,
  bookable,
  specialists,
  clients,
  defaultSpecialistId,
  defaultStartAt,
  allowPickSpecialist,
  busy,
  onCreated,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  bookable: SpaService[];
  specialists?: Array<{ id: string; firstName: string; lastName: string }>;
  clients: Array<{ id: string; firstName: string; lastName: string }>;
  defaultSpecialistId?: string;
  defaultStartAt?: string;
  allowPickSpecialist?: boolean;
  busy?: boolean;
  onCreated: (summary?: string) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [mode, setMode] = useState<'base' | 'phone'>('phone');
  const [prefMode, setPrefMode] = useState<PrefMode>('exact');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [periodMode, setPeriodMode] = useState(false);
  const [periodWeeks, setPeriodWeeks] = useState(4);
  const [periodEntries, setPeriodEntries] = useState<PeriodEntry[]>([]);
  const [extraDate, setExtraDate] = useState('');
  const [extraTime, setExtraTime] = useState('10:00');
  const [note, setNote] = useState('');
  const [windowForm, setWindowForm] = useState(() => defaultWindowForm());
  const [form, setForm] = useState({
    specialistId: defaultSpecialistId ?? '',
    clientId: '',
    guestName: '',
    guestPhone: '',
    serviceId: bookable[0]?.id ?? '',
    startAt: defaultStartAt || toDatetimeLocalValue(new Date()),
  });

  useEffect(() => {
    if (!open) return;
    setError('');
    setMode('phone');
    setPrefMode('exact');
    setPeriodMode(false);
    setPeriodWeeks(4);
    setPeriodEntries([]);
    setExtraDate('');
    setExtraTime('10:00');
    setNote('');
    setWindowForm(defaultWindowForm());
    setForm({
      specialistId: defaultSpecialistId ?? '',
      clientId: '',
      guestName: '',
      guestPhone: '',
      serviceId: bookable[0]?.id ?? '',
      startAt: defaultStartAt || toDatetimeLocalValue(new Date()),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultSpecialistId, defaultStartAt]);

  const suggestedEntries = useMemo(
    () =>
      prefMode === 'exact' && periodMode
        ? buildWeeklyEntries(form.startAt, periodWeeks)
        : [],
    [form.startAt, periodMode, periodWeeks, prefMode],
  );

  useEffect(() => {
    if (prefMode !== 'exact' || !periodMode) {
      setPeriodEntries([]);
      return;
    }
    const { timePart: defaultTime } = splitLocal(form.startAt);
    setPeriodEntries((prev) =>
      mergePeriodEntries(prev, suggestedEntries, defaultTime || '10:00'),
    );
  }, [periodMode, suggestedEntries, form.startAt, prefMode]);

  const liveSummary = useMemo(() => {
    const serviceName =
      bookable.find((s) => s.id === form.serviceId)?.name ?? 'услуга';
    const clientLabel =
      mode === 'base'
        ? (() => {
            const c = clients.find((x) => x.id === form.clientId);
            return c ? `${c.lastName} ${c.firstName}`.trim() : 'клиент';
          })()
        : form.guestName.trim() || 'клиент';
    if (prefMode === 'window') {
      const { timeFromMin, timeToMin } = resolveTimeBand(windowForm);
      return `${clientLabel} · ${serviceName} · ${formatSpaWaitlistPreference({
        preference: 'WINDOW',
        specialistId: form.specialistId || 'x',
        desiredStartAt: `${windowForm.windowStart}T00:00:00`,
        desiredEndAt: `${windowForm.windowEnd}T23:59:59`,
        windowStart: windowForm.windowStart,
        windowEnd: windowForm.windowEnd,
        timeFromMin,
        timeToMin,
        weekdays: windowForm.weekdays,
      })}`;
    }
    const start = new Date(form.startAt);
    if (Number.isNaN(start.getTime())) return `${clientLabel} · ${serviceName}`;
    return `${clientLabel} · ${serviceName} · ${formatSpaWaitlistPreference({
      preference: 'EXACT',
      specialistId: form.specialistId || 'x',
      desiredStartAt: start.toISOString(),
      desiredEndAt: start.toISOString(),
    })}`;
  }, [bookable, clients, form, mode, prefMode, windowForm]);

  if (!open) return null;

  const { datePart, timePart } = splitLocal(form.startAt);

  const createExact = async (token: string, desiredStartAt: string) => {
    const payload = {
      serviceId: form.serviceId,
      preference: 'EXACT' as const,
      desiredStartAt,
      note: note.trim() || undefined,
      ...clientPayload(mode, form),
    };
    if (allowPickSpecialist) {
      await api.adminCreateSpaWaitlist(token, {
        ...payload,
        specialistId: form.specialistId,
      });
    } else {
      await api.specialistCreateSpaWaitlist(token, payload);
    }
  };

  const createWindow = async (token: string) => {
    const { timeFromMin, timeToMin } = resolveTimeBand(windowForm);
    const payload = {
      serviceId: form.serviceId,
      preference: 'WINDOW' as const,
      windowStart: windowForm.windowStart,
      windowEnd: windowForm.windowEnd,
      timeFromMin: timeFromMin ?? undefined,
      timeToMin: timeToMin ?? undefined,
      weekdays: windowForm.weekdays,
      note: note.trim() || undefined,
      ...clientPayload(mode, form),
    };
    if (allowPickSpecialist) {
      await api.adminCreateSpaWaitlist(token, {
        ...payload,
        specialistId: form.specialistId,
      });
    } else {
      await api.specialistCreateSpaWaitlist(token, payload);
    }
  };

  const submit = async () => {
    setError('');
    if (!form.serviceId) {
      setError('Выберите услугу');
      return;
    }
    if (allowPickSpecialist && !form.specialistId) {
      setError('Укажите специалиста');
      return;
    }
    if (mode === 'base' && !form.clientId) {
      setError('Выберите клиента');
      return;
    }
    if (mode === 'phone' && !form.clientId && !form.guestName.trim()) {
      setError('Укажите ФИО');
      return;
    }

    const token = getToken();
    if (!token) return;
    setSaving(true);
    try {
      if (prefMode === 'window') {
        if (!windowForm.windowStart || !windowForm.windowEnd) {
          setError('Укажите период');
          return;
        }
        if ((windowForm.weekdays & SPA_WAITLIST_WEEKDAY_ALL) === 0) {
          setError('Выберите хотя бы один день');
          return;
        }
        if (windowForm.timeBand === 'custom') {
          const from = hmToMinutes(windowForm.customFrom);
          const to = hmToMinutes(windowForm.customTo);
          if (from == null || to == null || from >= to) {
            setError('Некорректный интервал часов');
            return;
          }
        }
        await createWindow(token);
        await onCreated();
        return;
      }

      const startIso = new Date(form.startAt).toISOString();
      if (Number.isNaN(new Date(startIso).getTime())) {
        setError('Некорректная дата');
        return;
      }
      const dates = periodMode
        ? periodEntries
            .map(entryToIso)
            .filter((iso) => !Number.isNaN(new Date(iso).getTime()))
        : [startIso];
      if (dates.length === 0) {
        setError('Выберите хотя бы одну дату');
        return;
      }
      let ok = 0;
      let lastErr = '';
      for (const iso of dates) {
        try {
          await createExact(token, iso);
          ok += 1;
        } catch (err) {
          lastErr = err instanceof Error ? err.message : 'Ошибка';
        }
      }
      if (ok === 0) {
        const msg = lastErr || 'Не удалось добавить';
        setError(msg);
        onError(msg);
        return;
      }
      await onCreated(
        ok < dates.length
          ? `Добавлено ${ok} из ${dates.length}. ${lastErr}`
          : dates.length > 1
            ? `Добавлено в лист: ${ok} заявок`
            : undefined,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка';
      setError(msg);
      onError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="card max-h-[min(92dvh,100%)] w-full max-w-md space-y-3 overflow-y-auto rounded-b-none sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">В лист ожидания</h3>
          <button type="button" className="btn-secondary text-xs" onClick={onClose}>
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
              <span className="text-slate-400">Телефон</span>
              <input
                className="input"
                value={form.guestPhone}
                onChange={(e) =>
                  setForm((f) => ({ ...f, guestPhone: e.target.value }))
                }
              />
            </label>
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
                {s.name} · {s.durationMin} мин
              </option>
            ))}
          </select>
        </label>

        <div className="flex gap-2 text-xs">
          <button
            type="button"
            className={prefMode === 'exact' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setPrefMode('exact')}
          >
            Конкретное время
          </button>
          <button
            type="button"
            className={prefMode === 'window' ? 'btn-primary' : 'btn-secondary'}
            onClick={() => {
              setPrefMode('window');
              setPeriodMode(false);
            }}
          >
            Свободный период
          </button>
        </div>

        {prefMode === 'exact' ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <DateField
                label="Дата"
                value={datePart}
                onChange={(v) => {
                  const time = timePart || '10:00';
                  setForm((f) => ({
                    ...f,
                    startAt: v ? `${v}T${time}` : '',
                  }));
                }}
              />
              <label className="block space-y-1 text-sm">
                <span className="text-[11px] text-slate-500">Время</span>
                <input
                  type="time"
                  className="input date-field"
                  step={60}
                  value={timePart}
                  onChange={(e) => {
                    const date =
                      datePart || toDatetimeLocalValue(new Date()).slice(0, 10);
                    setForm((f) => ({
                      ...f,
                      startAt: e.target.value
                        ? `${date}T${e.target.value}`
                        : `${date}T00:00`,
                    }));
                  }}
                />
              </label>
            </div>

            <div className="space-y-2 rounded-xl border border-white/5 bg-slate-900/40 p-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={periodMode}
                  onChange={(e) => setPeriodMode(e.target.checked)}
                />
                <span>То же время каждую неделю</span>
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
                        <input
                          type="time"
                          className="input date-field !w-auto"
                          step={60}
                          value={entry.time}
                          onChange={(e) => {
                            const t = e.target.value;
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
                    <label className="block space-y-1 text-sm">
                      <span className="text-[11px] text-slate-500">Время</span>
                      <input
                        type="time"
                        className="input date-field"
                        step={60}
                        value={extraTime}
                        onChange={(e) => setExtraTime(e.target.value)}
                      />
                    </label>
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
          </>
        ) : (
          <WindowFields
            value={windowForm}
            onChange={setWindowForm}
          />
        )}

        <label className="block space-y-1 text-sm">
          <span className="text-slate-400">Заметка</span>
          <input
            className="input"
            maxLength={200}
            placeholder="Необязательно"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <p className="rounded-xl border border-white/5 bg-slate-900/40 px-3 py-2 text-xs text-slate-300">
          {liveSummary}
        </p>

        {error ? (
          <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          className="btn-primary w-full"
          disabled={busy || saving}
          onClick={() => {
            void submit();
          }}
        >
          {saving
            ? 'Сохраняем…'
            : prefMode === 'window'
              ? 'Добавить период'
              : periodMode
                ? `Добавить ${periodEntries.length || 0} заявок`
                : 'Добавить'}
        </button>
      </div>
    </div>
  );
}

type WindowFormState = {
  windowStart: string;
  windowEnd: string;
  weekdays: number;
  timeBand: TimeBand;
  customFrom: string;
  customTo: string;
};

function defaultWindowForm(): WindowFormState {
  const today = localDateKey(new Date());
  return {
    windowStart: today,
    windowEnd: addDaysYmd(today, 6),
    weekdays: SPA_WAITLIST_WEEKDAY_WEEKDAYS,
    timeBand: 'morning',
    customFrom: '09:00',
    customTo: '12:00',
  };
}

function resolveTimeBand(form: WindowFormState): {
  timeFromMin: number | null;
  timeToMin: number | null;
} {
  if (form.timeBand === 'all') return { timeFromMin: null, timeToMin: null };
  if (form.timeBand === 'custom') {
    return {
      timeFromMin: hmToMinutes(form.customFrom),
      timeToMin: hmToMinutes(form.customTo),
    };
  }
  const band = TIME_BANDS[form.timeBand];
  return { timeFromMin: band.from, timeToMin: band.to };
}

function applyDatePreset(
  preset: 'today' | 'tomorrow' | '7d' | '14d' | 'week',
): Pick<WindowFormState, 'windowStart' | 'windowEnd'> {
  const today = localDateKey(new Date());
  if (preset === 'today') return { windowStart: today, windowEnd: today };
  if (preset === 'tomorrow') {
    const t = addDaysYmd(today, 1);
    return { windowStart: t, windowEnd: t };
  }
  if (preset === '7d') return { windowStart: today, windowEnd: addDaysYmd(today, 6) };
  if (preset === '14d') return { windowStart: today, windowEnd: addDaysYmd(today, 13) };
  const mon = startOfWeekMonday(today);
  return { windowStart: mon, windowEnd: addDaysYmd(mon, 6) };
}

function WindowFields({
  value,
  onChange,
}: {
  value: WindowFormState;
  onChange: (next: WindowFormState) => void;
}) {
  const chip = (active: boolean) =>
    active ? 'btn-primary !px-2 !py-1 text-xs' : 'btn-secondary !px-2 !py-1 text-xs';

  return (
    <div className="space-y-3 rounded-xl border border-white/5 bg-slate-900/40 p-3">
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ['today', 'Сегодня'],
            ['tomorrow', 'Завтра'],
            ['7d', '7 дней'],
            ['14d', '14 дней'],
            ['week', 'Эта неделя'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={chip(false)}
            onClick={() =>
              onChange({ ...value, ...applyDatePreset(key) })
            }
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <DateField
          label="С"
          value={value.windowStart}
          onChange={(v) =>
            onChange({
              ...value,
              windowStart: v,
              windowEnd:
                v && value.windowEnd && value.windowEnd < v
                  ? v
                  : value.windowEnd,
            })
          }
        />
        <DateField
          label="По"
          value={value.windowEnd}
          onChange={(v) => onChange({ ...value, windowEnd: v })}
        />
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] text-slate-500">Часы</p>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['morning', 'Утро 09–12'],
              ['afternoon', 'День 12–17'],
              ['evening', 'Вечер 17–21'],
              ['all', 'Весь день'],
              ['custom', 'Свой'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={chip(value.timeBand === key)}
              onClick={() => onChange({ ...value, timeBand: key })}
            >
              {label}
            </button>
          ))}
        </div>
        {value.timeBand === 'custom' ? (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <label className="block space-y-1 text-sm">
              <span className="text-[11px] text-slate-500">С</span>
              <input
                type="time"
                className="input date-field"
                step={60}
                value={value.customFrom}
                onChange={(e) =>
                  onChange({ ...value, customFrom: e.target.value })
                }
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-[11px] text-slate-500">До</span>
              <input
                type="time"
                className="input date-field"
                step={60}
                value={value.customTo}
                onChange={(e) =>
                  onChange({ ...value, customTo: e.target.value })
                }
              />
            </label>
          </div>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] text-slate-500">Дни</p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className={chip(value.weekdays === SPA_WAITLIST_WEEKDAY_WEEKDAYS)}
            onClick={() =>
              onChange({ ...value, weekdays: SPA_WAITLIST_WEEKDAY_WEEKDAYS })
            }
          >
            Будни
          </button>
          <button
            type="button"
            className={chip(value.weekdays === SPA_WAITLIST_WEEKDAY_WEEKEND)}
            onClick={() =>
              onChange({ ...value, weekdays: SPA_WAITLIST_WEEKDAY_WEEKEND })
            }
          >
            Выходные
          </button>
          <button
            type="button"
            className={chip(value.weekdays === SPA_WAITLIST_WEEKDAY_ALL)}
            onClick={() =>
              onChange({ ...value, weekdays: SPA_WAITLIST_WEEKDAY_ALL })
            }
          >
            Все
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SPA_WAITLIST_WEEKDAY_LABELS_RU.map((label, i) => {
            const bit = 1 << i;
            const on = (value.weekdays & bit) !== 0;
            return (
              <button
                key={label}
                type="button"
                className={chip(on)}
                onClick={() =>
                  onChange({
                    ...value,
                    weekdays: on
                      ? value.weekdays & ~bit
                      : value.weekdays | bit,
                  })
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function entryToWindowForm(entry: SpaWaitlistEntry): WindowFormState {
  const from = entry.timeFromMin;
  const to = entry.timeToMin;
  let timeBand: TimeBand = 'all';
  let customFrom = '09:00';
  let customTo = '12:00';
  if (from != null && to != null) {
    const match = (
      Object.entries(TIME_BANDS) as Array<
        [Exclude<TimeBand, 'custom' | 'all'>, { from: number; to: number }]
      >
    ).find(([, b]) => b.from === from && b.to === to);
    if (match) {
      timeBand = match[0];
    } else {
      timeBand = 'custom';
      customFrom = minutesToHm(from);
      customTo = minutesToHm(to);
    }
  }
  return {
    windowStart: entry.windowStart ?? localDateKey(new Date()),
    windowEnd: entry.windowEnd ?? localDateKey(new Date()),
    weekdays: entry.weekdays ?? SPA_WAITLIST_WEEKDAY_ALL,
    timeBand,
    customFrom,
    customTo,
  };
}

function SpaWaitlistEditWindowDialog({
  open,
  entry,
  allowPickSpecialist,
  busy,
  onClose,
  onSaved,
  onError,
}: {
  open: boolean;
  entry: SpaWaitlistEntry;
  allowPickSpecialist?: boolean;
  busy?: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [windowForm, setWindowForm] = useState(() => entryToWindowForm(entry));
  const [note, setNote] = useState(entry.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setWindowForm(entryToWindowForm(entry));
    setNote(entry.note ?? '');
    setError('');
  }, [open, entry]);

  if (!open) return null;

  const submit = async () => {
    setError('');
    if ((windowForm.weekdays & SPA_WAITLIST_WEEKDAY_ALL) === 0) {
      setError('Выберите хотя бы один день');
      return;
    }
    const { timeFromMin, timeToMin } = resolveTimeBand(windowForm);
    if (windowForm.timeBand === 'custom') {
      if (timeFromMin == null || timeToMin == null || timeFromMin >= timeToMin) {
        setError('Некорректный интервал часов');
        return;
      }
    }
    const token = getToken();
    if (!token) return;
    setSaving(true);
    try {
      const payload = {
        windowStart: windowForm.windowStart,
        windowEnd: windowForm.windowEnd,
        timeFromMin,
        timeToMin,
        weekdays: windowForm.weekdays,
        note: note.trim() || null,
      };
      if (allowPickSpecialist) {
        await api.adminUpdateSpaWaitlist(token, entry.id, payload);
      } else {
        await api.specialistUpdateSpaWaitlist(token, entry.id, payload);
      }
      await onSaved();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ошибка';
      setError(msg);
      onError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="card max-h-[min(92dvh,100%)] w-full max-w-md space-y-3 overflow-y-auto rounded-b-none sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Изменить период</h3>
          <button type="button" className="btn-secondary text-xs" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <p className="text-sm text-slate-400">
          {entry.clientName} · {entry.serviceName}
        </p>
        <WindowFields value={windowForm} onChange={setWindowForm} />
        <label className="block space-y-1 text-sm">
          <span className="text-slate-400">Заметка</span>
          <input
            className="input"
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <p className="rounded-xl border border-white/5 bg-slate-900/40 px-3 py-2 text-xs text-slate-300">
          {formatSpaWaitlistPreference({
            preference: 'WINDOW',
            specialistId: entry.specialistId,
            desiredStartAt: entry.desiredStartAt,
            desiredEndAt: entry.desiredEndAt,
            windowStart: windowForm.windowStart,
            windowEnd: windowForm.windowEnd,
            ...resolveTimeBand(windowForm),
            weekdays: windowForm.weekdays,
          })}
        </p>
        {error ? (
          <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          className="btn-primary w-full"
          disabled={busy || saving}
          onClick={() => {
            void submit();
          }}
        >
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}

function splitLocal(value: string) {
  if (!value) return { datePart: '', timePart: '' };
  const [datePart = '', timeRaw = ''] = value.split('T');
  return { datePart, timePart: timeRaw.slice(0, 5) };
}
