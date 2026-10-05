'use client';

import type { SpaService } from '@fitgo/shared-types';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function formatPrice(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)} ${currency}`;
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
  onSubmit: (payload: {
    specialistId?: string;
    clientId?: string;
    guestName?: string;
    guestPhone?: string;
    serviceId: string;
    startAt: string;
    paymentType: 'QUOTA' | 'PAID';
  }) => Promise<void>;
  busy?: boolean;
}) {
  const bookable = services.filter((s) => s.active && (s.bookable ?? true));
  const [mode, setMode] = useState<'base' | 'phone'>('phone');
  const [phoneLookup, setPhoneLookup] = useState('');
  const [error, setError] = useState('');
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
      await onSubmit({
        specialistId: allowPickSpecialist ? form.specialistId : undefined,
        serviceId: form.serviceId,
        startAt: startIso,
        paymentType: form.paymentType,
        ...(mode === 'base'
          ? { clientId: form.clientId }
          : form.clientId
            ? { clientId: form.clientId, guestPhone: form.guestPhone }
            : {
                guestName: form.guestName,
                guestPhone: form.guestPhone,
              }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось записать');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="card w-full max-w-md space-y-3">
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
              <span className="text-slate-400">Телефон</span>
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
            ) : null}
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
            <label className="block space-y-1 text-sm">
              <span className="text-[11px] text-slate-500">Дата</span>
              <input
                type="date"
                className="input date-field"
                value={datePart}
                onChange={(e) => setDatePart(e.target.value)}
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="text-[11px] text-slate-500">Время</span>
              <input
                type="time"
                className="input date-field"
                step={300}
                value={timePart}
                onChange={(e) => setTimePart(e.target.value)}
              />
            </label>
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
          {busy ? 'Записываем…' : 'Записать'}
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
