'use client';

import type { SpaService, SpaWaitlistEntry } from '@fitgo/shared-types';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { toDatetimeLocalValue } from '@/components/spa-board/spa-booking-dialog';
import { DateField } from '@/components/ui/date-field';

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildWeeklyDates(startLocal: string, weeks: number): string[] {
  const base = new Date(startLocal);
  if (Number.isNaN(base.getTime()) || weeks < 1) return [];
  const out: string[] = [];
  for (let i = 0; i < weeks; i++) {
    const d = new Date(base);
    d.setDate(d.getDate() + i * 7);
    out.push(d.toISOString());
  }
  return out;
}

function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function SpaWaitlistPanel({
  entries,
  services,
  specialists,
  clients,
  defaultSpecialistId,
  defaultStartAt,
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
  allowPickSpecialist?: boolean;
  busy?: boolean;
  onReload: () => Promise<void>;
  onBook: (entry: SpaWaitlistEntry) => void;
  onMessage: (msg: string) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const bookable = services.filter((s) => s.active && (s.bookable ?? true));

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

      {entries.length === 0 ? null : (
        <ul className="space-y-2">
          {entries.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-white/5 bg-slate-900/40 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="font-medium">{e.clientName}</p>
                <p className="text-slate-400">
                  {e.serviceName} · {formatTime(e.desiredStartAt)}
                  {allowPickSpecialist ? ` · ${e.specialistName}` : ''}
                </p>
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
            </li>
          ))}
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [periodMode, setPeriodMode] = useState(false);
  const [periodWeeks, setPeriodWeeks] = useState(4);
  const [periodDates, setPeriodDates] = useState<string[]>([]);
  const [extraDate, setExtraDate] = useState('');
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
    setPeriodMode(false);
    setPeriodWeeks(4);
    setExtraDate('');
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

  const suggestedDates = useMemo(
    () => (periodMode ? buildWeeklyDates(form.startAt, periodWeeks) : []),
    [form.startAt, periodMode, periodWeeks],
  );

  useEffect(() => {
    if (!periodMode) {
      setPeriodDates([]);
      return;
    }
    setPeriodDates(suggestedDates);
  }, [periodMode, suggestedDates]);

  if (!open) return null;

  const { datePart, timePart } = splitLocal(form.startAt);

  const createOne = async (
    token: string,
    desiredStartAt: string,
  ) => {
    const payload = {
      serviceId: form.serviceId,
      desiredStartAt,
      ...(mode === 'base'
        ? { clientId: form.clientId }
        : form.clientId
          ? { clientId: form.clientId, guestPhone: form.guestPhone }
          : {
              guestName: form.guestName,
              guestPhone: form.guestPhone,
            }),
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
    const startIso = new Date(form.startAt).toISOString();
    if (Number.isNaN(new Date(startIso).getTime())) {
      setError('Некорректная дата');
      return;
    }
    const dates = periodMode
      ? periodDates
      : [startIso];
    if (dates.length === 0) {
      setError('Выберите хотя бы одну дату');
      return;
    }
    const token = getToken();
    if (!token) return;
    setSaving(true);
    try {
      let ok = 0;
      let lastErr = '';
      for (const iso of dates) {
        try {
          await createOne(token, iso);
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
              <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
                {periodDates.map((iso) => (
                  <li key={iso}>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked
                        onChange={() =>
                          setPeriodDates((prev) =>
                            prev.filter((d) => d !== iso),
                          )
                        }
                      />
                      <span>{formatDateShort(iso)}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-end gap-2">
                <DateField
                  label="Добавить дату"
                  value={extraDate}
                  onChange={setExtraDate}
                />
                <button
                  type="button"
                  className="btn-secondary text-xs"
                  onClick={() => {
                    if (!extraDate || !timePart) return;
                    const local = `${extraDate}T${timePart}`;
                    const iso = new Date(local).toISOString();
                    if (Number.isNaN(new Date(iso).getTime())) return;
                    setPeriodDates((prev) =>
                      prev.includes(iso) ? prev : [...prev, iso].sort(),
                    );
                    setExtraDate('');
                  }}
                >
                  +
                </button>
              </div>
            </div>
          ) : null}
        </div>

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
            : periodMode
              ? `Добавить ${periodDates.length || 0} заявок`
              : 'Добавить'}
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
