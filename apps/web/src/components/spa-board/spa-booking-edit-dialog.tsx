'use client';

import type { SpaBoardBooking, SpaService } from '@fitgo/shared-types';
import {
  SPA_OVERLAP_ALLOW_MIN,
  checkSpaPlacement,
} from '@fitgo/shared-types';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toDatetimeLocalValue } from '@/components/spa-board/spa-booking-dialog';
import { SpaBookingNotesFields } from '@/components/spa-board/spa-booking-notes-fields';
import { DateField, TimeField } from '@/components/ui/date-field';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const from = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const last = new Date(y, m + 1, 0).getDate();
  const to = `${y}-${String(m + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { from, to };
}

function clientBookingsHref(
  pathname: string | null,
  clientName: string,
  clientId?: string,
): string {
  const base = pathname?.startsWith('/specialist')
    ? '/specialist/my-sessions'
    : '/admin/booking-control';
  const { from, to } = currentMonthRange();
  const q = new URLSearchParams({ from, to, client: clientName });
  if (clientId) q.set('clientId', clientId);
  return `${base}?${q}`;
}

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
  allowManualPayment,
  boardBookings,
  busy,
  onClose,
  onSave,
  onCancel,
  onConfirmManualPayment,
}: {
  open: boolean;
  booking: SpaBoardBooking | null;
  services: SpaService[];
  specialists?: Array<{ id: string; firstName: string; lastName: string }>;
  allowPickSpecialist?: boolean;
  /** Admin-only: confirm paid SPA without posting to 1C. */
  allowManualPayment?: boolean;
  boardBookings?: SpaBoardBooking[];
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
    visitNote?: string;
    overlapConfirmed?: boolean;
  }) => Promise<void>;
  onCancel: () => Promise<void>;
  onConfirmManualPayment?: () => Promise<void>;
}) {
  const pathname = usePathname();
  const bookable = services.filter((s) => s.active && (s.bookable ?? true));
  const crmLocked = Boolean(booking?.crmLocked);
  const [error, setError] = useState('');
  const [phoneLookup, setPhoneLookup] = useState('');
  const [overlapConfirmed, setOverlapConfirmed] = useState(false);
  const [form, setForm] = useState({
    specialistId: '',
    guestName: '',
    guestPhone: '',
    serviceId: '',
    startAt: '',
    paymentType: 'PAID' as 'QUOTA' | 'PAID',
  });
  const [clientNote, setClientNote] = useState('');
  const [clientNoteSaved, setClientNoteSaved] = useState('');
  const [visitNote, setVisitNote] = useState('');
  const [clientNoteBusy, setClientNoteBusy] = useState(false);

  useEffect(() => {
    if (!open || !booking) return;
    setError('');
    setPhoneLookup('');
    setOverlapConfirmed(false);
    setForm({
      specialistId: booking.specialistId,
      guestName: booking.guestName ?? booking.clientName ?? '',
      guestPhone: booking.guestPhone ?? '',
      serviceId: booking.serviceId ?? bookable[0]?.id ?? '',
      startAt: toDatetimeLocalValue(booking.startAt),
      paymentType: booking.paymentType === 'QUOTA' ? 'QUOTA' : 'PAID',
    });
    setVisitNote(booking.visitNote ?? '');
    setClientNote(booking.clientNote ?? '');
    setClientNoteSaved(booking.clientNote ?? '');
    const token = getToken();
    if (token && (booking.clientId || booking.guestPhone)) {
      void api
        .getSpaClientNote(token, {
          clientId: booking.clientId,
          phone: booking.guestPhone,
        })
        .then((res) => {
          setClientNote(res.text);
          setClientNoteSaved(res.text);
        })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when dialog opens
  }, [open, booking?.id]);

  useEffect(() => {
    setOverlapConfirmed(false);
  }, [form.startAt, form.serviceId, form.specialistId]);

  const clientNoteEnabled = Boolean(
    booking?.clientId ||
      form.guestPhone.replace(/\D/g, '').length >= 9,
  );

  const placementCheck = useMemo(() => {
    if (!booking || !boardBookings || !form.startAt || !form.serviceId) {
      return null;
    }
    const service = bookable.find((s) => s.id === form.serviceId);
    if (!service) return null;
    const start = new Date(form.startAt);
    if (Number.isNaN(start.getTime())) return null;
    const specialistId = form.specialistId || booking.specialistId;
    const durationMin = service.durationMin + (service.bufferMin ?? 0);
    const startMs = start.getTime();
    const endMs = startMs + durationMin * 60_000;
    const peers = boardBookings
      .filter(
        (b) =>
          b.specialistId === specialistId && !b.busy && b.id !== booking.id,
      )
      .map((b) => ({
        id: b.id,
        label: b.clientName ?? b.guestName ?? 'Клиент',
        startMs: new Date(b.startAt).getTime(),
        endMs: new Date(b.endAt).getTime(),
      }));
    return checkSpaPlacement(startMs, endMs, peers, SPA_OVERLAP_ALLOW_MIN);
  }, [
    boardBookings,
    bookable,
    booking,
    form.serviceId,
    form.specialistId,
    form.startAt,
  ]);

  const saveClientNoteNow = async () => {
    const token = getToken();
    if (!token || !clientNoteEnabled) return;
    setClientNoteBusy(true);
    try {
      const res = await api.putSpaClientNote(token, {
        clientId: booking?.clientId,
        phone: form.guestPhone.trim() || undefined,
        text: clientNote,
      });
      setClientNote(res.text);
      setClientNoteSaved(res.text);
    } finally {
      setClientNoteBusy(false);
    }
  };

  const clientLink = useMemo(() => {
    if (!booking) return null;
    const name = (
      booking.guestName ??
      booking.clientName ??
      ''
    ).trim();
    if (!name) return null;
    return clientBookingsHref(pathname, name, booking.clientId);
  }, [booking, pathname]);

  if (!open || !booking) return null;

  const selected = bookable.find((s) => s.id === form.serviceId);
  const { datePart, timePart } = splitDatetimeLocal(form.startAt);
  const unlinked =
    booking.oneCLinkStatus === 'NOT_LINKED' && !booking.manualPaymentConfirmed;
  const canManualPay =
    Boolean(allowManualPayment) &&
    Boolean(onConfirmManualPayment) &&
    !crmLocked &&
    booking.paymentType === 'PAID' &&
    !booking.manualPaymentConfirmed &&
    !booking.consumedInCrm;
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
      return;
    }
    if (digits.length < 9) {
      setPhoneLookup('Введите номер полностью');
      return;
    }
    const token = getToken();
    if (!token) return;
    setPhoneLookup('Ищем клиента…');
    try {
      const found = await api.lookupSpaClientByPhone(token, raw);
      if (found.pending) {
        setPhoneLookup(
          '1С не ответила. Сохраните телефон — привязка повторится позже.',
        );
        return;
      }
      if (!found.found) {
        setPhoneLookup('В 1С и в базе нет. Сохраните ФИО и телефон.');
        return;
      }
      const name = `${found.lastName ?? ''} ${found.firstName ?? ''}`.trim();
      setPhoneLookup(
        found.clientId
          ? `Клиент из базы: ${name}. Сохраните — запись привяжется.`
          : `Клиент из 1С: ${name}. Сохраните — запись привяжется.`,
      );
      setForm((f) => ({
        ...f,
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
    if (allowPickSpecialist && !form.specialistId && !crmLocked) {
      setError('Укажите специалиста');
      return;
    }
    if (!form.guestName.trim() && !booking.clientId && !crmLocked) {
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
      const overlapFlag =
        needsOverlapConfirm && overlapConfirmed
          ? { overlapConfirmed: true as const }
          : {};
      if (crmLocked) {
        await onSave({
          serviceId: booking.serviceId ?? form.serviceId,
          startAt: startIso,
          paymentType: booking.paymentType === 'QUOTA' ? 'QUOTA' : 'PAID',
          visitNote: visitNote.trim(),
          ...overlapFlag,
        });
      } else {
        await onSave({
          specialistId: allowPickSpecialist ? form.specialistId : undefined,
          serviceId: form.serviceId,
          startAt: startIso,
          clientId: booking.clientId,
          guestName: form.guestName.trim() || undefined,
          guestPhone: form.guestPhone.trim() || undefined,
          paymentType: form.paymentType,
          visitNote: visitNote.trim(),
          ...overlapFlag,
        });
      }
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

  const confirmManual = async () => {
    if (!onConfirmManualPayment) return;
    if (
      !window.confirm(
        'Подтвердить оплату без документа в 1С? Мотивация засчитается, привязка к 1С не изменится.',
      )
    ) {
      return;
    }
    setError('');
    try {
      await onConfirmManualPayment();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Не удалось подтвердить оплату',
      );
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

        {crmLocked ? (
          <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            Проведено в 1С — можно менять только дату и время. Удаление
            недоступно, пока документ есть в 1С.
          </p>
        ) : booking.manualPaymentConfirmed ? (
          <p className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-200">
            Оплата подтверждена без 1С. Документ в CRM не создавался.
          </p>
        ) : unlinked ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Нет в 1С — списание и продажа ждут привязки по телефону. Укажите
            номер и сохраните.
          </p>
        ) : booking.consumedInCrm ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Документа в 1С нет (удалён или не создан) — можно править и удалить.
          </p>
        ) : null}

        {allowPickSpecialist && specialists ? (
          <label className="block space-y-1 text-sm">
            <span className="text-slate-400">Специалист</span>
            <select
              className="input"
              value={form.specialistId}
              disabled={crmLocked}
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
          <label className="block space-y-1 text-sm">
            <span className="text-slate-400">ФИО</span>
            <input
              className="input"
              value={form.guestName}
              disabled={crmLocked}
              onChange={(e) =>
                setForm((f) => ({ ...f, guestName: e.target.value }))
              }
            />
          </label>
          {clientLink ? (
            <p className="text-sm">
              <Link
                href={clientLink}
                className="text-fitgo-400 underline-offset-2 hover:underline"
                onClick={onClose}
              >
                Записи клиента
              </Link>
            </p>
          ) : null}
          <label className="block space-y-1 text-sm">
            <span className="text-slate-400">Телефон (необязательно)</span>
            <input
              className="input"
              value={form.guestPhone}
              disabled={crmLocked}
              onChange={(e) =>
                setForm((f) => ({ ...f, guestPhone: e.target.value }))
              }
              onBlur={(e) => {
                if (!crmLocked) void lookupPhone(e.target.value);
              }}
              placeholder="+375…"
            />
            {phoneLookup ? (
              <p className="text-xs text-slate-400">{phoneLookup}</p>
            ) : null}
          </label>
        </div>

        <div className="space-y-3 rounded-xl border border-white/5 bg-slate-900/40 p-3">
          <p className="text-sm font-medium text-slate-300">Запись</p>
          <label className="block space-y-1 text-sm">
            <span className="text-slate-400">
              {form.paymentType === 'QUOTA'
                ? 'Услуга (слот / длительность)'
                : 'Услуга'}
            </span>
            <select
              className="input"
              value={form.serviceId}
              disabled={crmLocked}
              onChange={(e) =>
                setForm((f) => ({ ...f, serviceId: e.target.value }))
              }
            >
              {bookable.map((s) => (
                <option key={s.id} value={s.id}>
                  {form.paymentType === 'QUOTA'
                    ? `${s.name} · ${s.durationMin} мин · абонемент`
                    : `${s.name} · ${s.durationMin} мин · ${formatPrice(s.priceMinor, s.currency)}`}
                </option>
              ))}
            </select>
            {form.paymentType === 'QUOTA' && booking?.membershipServiceName ? (
              <p className="text-xs text-emerald-300/90">
                Основание абонемента: {booking.membershipServiceName}
              </p>
            ) : form.paymentType === 'QUOTA' ? (
              <p className="text-xs text-amber-300/90">
                Строка абонемента не указана — в журнале только слот каталога.
              </p>
            ) : null}
            {selected ? (
              <p className="text-xs text-slate-500">
                {selected.durationMin} мин
                {selected.bufferMin ? ` + перерыв ${selected.bufferMin}` : ''}
                {form.paymentType === 'PAID'
                  ? ` · ${formatPrice(selected.priceMinor, selected.currency)}`
                  : ''}
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
              disabled={crmLocked}
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
            {form.paymentType === 'QUOTA' && unlinked ? (
              <p className="text-xs text-amber-300/90">
                Квоту можно списать только после привязки клиента к 1С.
              </p>
            ) : null}
          </label>
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

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {!crmLocked ? (
            <button
              type="button"
              className="btn-secondary flex-1"
              disabled={busy}
              onClick={() => {
                void remove();
              }}
            >
              Удалить запись
            </button>
          ) : null}
          {canManualPay ? (
            <button
              type="button"
              className="btn-secondary flex-1"
              disabled={busy}
              onClick={() => {
                void confirmManual();
              }}
            >
              Подтвердить оплату без 1С
            </button>
          ) : null}
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
