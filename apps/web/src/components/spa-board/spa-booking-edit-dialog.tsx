'use client';

import type { SpaBoardBooking, SpaService } from '@fitgo/shared-types';
import { useEffect, useState } from 'react';
import { toDatetimeLocalValue } from '@/components/spa-board/spa-booking-dialog';

function formatPrice(minor: number, currency: string) {
  return `${(minor / 100).toFixed(2)} ${currency}`;
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

export function SpaBookingEditDialog({
  open,
  booking,
  services,
  specialists,
  allowPickSpecialist,
  busy,
  onClose,
  onSave,
  onCancel,
}: {
  open: boolean;
  booking: SpaBoardBooking | null;
  services: SpaService[];
  specialists?: Array<{ id: string; firstName: string; lastName: string }>;
  allowPickSpecialist?: boolean;
  busy?: boolean;
  onClose: () => void;
  onSave: (payload: {
    specialistId?: string;
    serviceId: string;
    startAt: string;
    clientId?: string;
    guestName?: string;
    guestPhone?: string;
    paymentType: 'QUOTA' | 'PAID';
  }) => Promise<void>;
  onCancel: () => Promise<void>;
}) {
  const bookable = services.filter((s) => s.active && (s.bookable ?? true));
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    specialistId: '',
    guestName: '',
    guestPhone: '',
    serviceId: '',
    startAt: '',
    paymentType: 'PAID' as 'QUOTA' | 'PAID',
  });

  useEffect(() => {
    if (!open || !booking) return;
    setError('');
    setForm({
      specialistId: booking.specialistId,
      guestName: booking.guestName ?? booking.clientName ?? '',
      guestPhone: booking.guestPhone ?? '',
      serviceId: booking.serviceId ?? bookable[0]?.id ?? '',
      startAt: toDatetimeLocalValue(booking.startAt),
      paymentType: booking.paymentType === 'QUOTA' ? 'QUOTA' : 'PAID',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when dialog opens
  }, [open, booking?.id]);

  if (!open || !booking) return null;

  const selected = bookable.find((s) => s.id === form.serviceId);
  const { datePart, timePart } = splitDatetimeLocal(form.startAt);

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
    if (!form.guestName.trim() && !booking.clientId) {
      setError('Укажите ФИО клиента');
      return;
    }
    const startIso = new Date(form.startAt).toISOString();
    if (Number.isNaN(new Date(startIso).getTime())) {
      setError('Некорректная дата');
      return;
    }
    try {
      await onSave({
        specialistId: allowPickSpecialist ? form.specialistId : undefined,
        serviceId: form.serviceId,
        startAt: startIso,
        clientId: booking.clientId,
        guestName: form.guestName.trim() || undefined,
        guestPhone: form.guestPhone.trim() || undefined,
        paymentType: form.paymentType,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить');
    }
  };

  const remove = async () => {
    if (!window.confirm('Отменить эту запись?')) return;
    setError('');
    try {
      await onCancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отменить');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="card w-full max-w-md space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Карточка записи</h3>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={onClose}
          >
            Закрыть
          </button>
        </div>

        {booking.approvalLabel ? (
          <p className="text-sm text-amber-300">{booking.approvalLabel}</p>
        ) : null}

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

        <label className="block space-y-1 text-sm">
          <span className="text-slate-400">Клиент</span>
          <input
            className="input"
            value={form.guestName}
            onChange={(e) =>
              setForm((f) => ({ ...f, guestName: e.target.value }))
            }
          />
        </label>

        <label className="block space-y-1 text-sm">
          <span className="text-slate-400">Телефон</span>
          <input
            className="input"
            value={form.guestPhone}
            onChange={(e) =>
              setForm((f) => ({ ...f, guestPhone: e.target.value }))
            }
            placeholder="+375…"
          />
        </label>

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

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            className="btn-secondary flex-1"
            disabled={busy}
            onClick={() => {
              void remove();
            }}
          >
            Отменить запись
          </button>
          <button
            type="button"
            className="btn-primary flex-1"
            disabled={busy}
            onClick={() => {
              void submit();
            }}
          >
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
}
