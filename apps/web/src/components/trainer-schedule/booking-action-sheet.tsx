'use client';

import type { TrainerCalendarEvent } from '@fitgo/shared-types';
import { Button, ResponsiveSheet } from '@fitgo/forma-ui';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';

const BUFFER_OPTS = [0, 15, 30, 60] as const;

function moneyMinor(minor: number) {
  return `${(minor / 100).toLocaleString('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} BYN`;
}

export function BookingActionSheet({
  event,
  clients = [],
  onClose,
  onChanged,
}: {
  event: TrainerCalendarEvent;
  clients?: Array<{ id: string; firstName: string; lastName: string }>;
  onClose: () => void;
  onChanged: () => void;
}) {
  const me = getUser();
  const isPersonalLedger =
    event.ptFlow === 'PERSONAL' ||
    (!event.ptFlow && Boolean(me?.trainerClub) && !me?.trainerStaff);
  const controlledByAdmin =
    Boolean(event.isComplimentary) ||
    event.ptFlow === 'CLUB' ||
    Boolean(event.linkedDocExternalId) ||
    !isPersonalLedger;
  const ended =
    Boolean(event.endAt) && new Date(event.endAt).getTime() <= Date.now();
  const clientMissed =
    event.bookingStatus === 'CANCELLED' ||
    (ended && event.origin === 'CLIENT_BOOKED');
  /** Hard-delete: own create, or client booking after no-show/cancel; no 1C doc. */
  const canHardDelete =
    Boolean(me?.trainerClub) &&
    event.kind === 'PERSONAL' &&
    Boolean(event.bookingId) &&
    !event.isComplimentary &&
    !event.linkedDocExternalId &&
    (event.origin === 'TRAINER_ASSIGNED' ||
      (event.origin === 'CLIENT_BOOKED' && clientMissed) ||
      (!event.origin && isPersonalLedger && !controlledByAdmin));

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [debitPackage, setDebitPackage] = useState(false);
  const [seriesScope, setSeriesScope] = useState<'one' | 'future'>('one');
  const [clientId, setClientId] = useState(event.clientId ?? '');
  const [clientQ, setClientQ] = useState('');
  const [moveAt, setMoveAt] = useState(() => {
    const d = new Date(event.startAt);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  });
  const [bufferBefore, setBufferBefore] = useState(event.bufferBeforeMin ?? 0);
  const [bufferAfter, setBufferAfter] = useState(event.bufferAfterMin ?? 0);

  const filteredClients = useMemo(() => {
    const needle = clientQ.trim().toLowerCase();
    if (!needle) return clients.slice(0, 40);
    return clients
      .filter((c) =>
        `${c.firstName} ${c.lastName}`.toLowerCase().includes(needle),
      )
      .slice(0, 40);
  }, [clients, clientQ]);

  const run = async (fn: () => Promise<unknown>) => {
    const token = getToken();
    if (!token || !event.bookingId) return;
    setBusy(true);
    setError('');
    try {
      await fn();
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveSheet open onOpenChange={(o) => !o && onClose()} title={event.title}>
      <div className="space-y-4 pb-2">
        {!isPersonalLedger && event.ptFlow !== 'PERSONAL' ? (
          <div className="rounded-xl border border-forma-500/20 bg-forma-500/5 px-3 py-2 text-sm text-forma-200">
            <p className="font-medium text-forma-100">
              {event.ptControlLabel?.trim() ||
                (event.linkedDocExternalId ? 'Есть продажа' : 'Ждёт продажу')}
            </p>
            <p className="mt-1 text-xs text-forma-400">
              {event.linkedDocExternalId
                ? `Документ: ${event.linkedDocExternalId}`
                : event.isComplimentary || event.origin === 'CLIENT_BOOKED'
                  ? 'Списание с абонемента подтянется само — нажимать не нужно.'
                  : 'Оплата подтянется сама — нажимать не нужно. Если после занятия продажи нет, администратор увидит это в контроле.'}
            </p>
          </div>
        ) : null}
        {event.isComplimentary ? (
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Подарочная ПТ — основание с абонемента. Удаление недоступно.
          </p>
        ) : null}
        {event.clientIssue && event.clientIssue !== 'NONE' ? (
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Клиент не в 1С — ждёт привязки в справочнике.
          </p>
        ) : null}

        {event.bookingId && event.clientId ? (
          <Link
            href={`/trainer/sessions/${encodeURIComponent(event.bookingId)}?clientId=${encodeURIComponent(event.clientId)}`}
            onClick={onClose}
            className="inline-flex w-full items-center justify-center rounded-2xl border border-white/10 bg-ink-raised px-4 py-3.5 text-[15px] font-medium text-white hover:bg-white/[0.06]"
          >
            Открыть тренировку
          </Link>
        ) : null}

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Клиент
          </p>
          {event.clientId ? (
            <Link
              href={`/trainer/clients/${encodeURIComponent(event.clientId)}?from=schedule&date=${encodeURIComponent(event.startAt.slice(0, 10))}`}
              className="inline-block text-sm text-forma-400 underline"
              onClick={onClose}
            >
              Открыть карточку
              {event.clientName ? ` · ${event.clientName}` : ''}
            </Link>
          ) : null}
          <input
            className="input w-full"
            placeholder="Поиск клиента…"
            value={clientQ}
            onChange={(e) => setClientQ(e.target.value)}
          />
          <div className="max-h-32 space-y-1 overflow-y-auto">
            {filteredClients.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`flex w-full rounded-xl border px-3 py-2 text-left text-sm ${
                  clientId === c.id
                    ? 'border-forma-500/50 bg-forma-500/10 text-white'
                    : 'border-white/10 text-zinc-300'
                }`}
                onClick={() => setClientId(c.id)}
              >
                {c.firstName} {c.lastName}
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={busy || !clientId || clientId === event.clientId}
            onClick={() =>
              run(() =>
                api.trainerUpdatePersonalBooking(getToken()!, event.bookingId!, {
                  clientId,
                }),
              )
            }
          >
            Сменить клиента
          </Button>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Дата и время
          </p>
          <input
            type="datetime-local"
            className="input w-full"
            value={moveAt}
            onChange={(e) => setMoveAt(e.target.value)}
          />
          {event.seriesId ? (
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={seriesScope === 'future'}
                onChange={(e) =>
                  setSeriesScope(e.target.checked ? 'future' : 'one')
                }
              />
              Все будущие в серии (шаблон времени тоже)
            </label>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={busy}
            onClick={() =>
              run(() =>
                api.trainerUpdatePersonalBooking(getToken()!, event.bookingId!, {
                  startAt: new Date(moveAt).toISOString(),
                  seriesScope,
                }),
              )
            }
          >
            Сохранить время
          </Button>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Буфер (мин)
          </p>
          <div className="flex flex-wrap gap-2">
            <span className="text-sm text-zinc-400">До:</span>
            {BUFFER_OPTS.map((n) => (
              <button
                key={`b-${n}`}
                type="button"
                className={`rounded-full px-2.5 py-1 text-xs ${
                  bufferBefore === n
                    ? 'bg-forma-500 text-ink'
                    : 'bg-white/10 text-zinc-300'
                }`}
                onClick={() => setBufferBefore(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="text-sm text-zinc-400">После:</span>
            {BUFFER_OPTS.map((n) => (
              <button
                key={`a-${n}`}
                type="button"
                className={`rounded-full px-2.5 py-1 text-xs ${
                  bufferAfter === n
                    ? 'bg-forma-500 text-ink'
                    : 'bg-white/10 text-zinc-300'
                }`}
                onClick={() => setBufferAfter(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            disabled={busy}
            onClick={() =>
              run(() =>
                api.trainerUpdatePersonalBooking(getToken()!, event.bookingId!, {
                  bufferBeforeMin: bufferBefore,
                  bufferAfterMin: bufferAfter,
                }),
              )
            }
          >
            Сохранить буфер
          </Button>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Быстрая отмена
          </p>
          <input
            className="input w-full"
            placeholder="Причина (необязательно)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {isPersonalLedger ? (
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={debitPackage}
                onChange={(e) => setDebitPackage(e.target.checked)}
              />
              Списать с личного пакета
            </label>
          ) : null}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1 text-red-300"
              disabled={busy}
              onClick={() =>
                run(() =>
                  api.trainerUpdatePersonalBooking(
                    getToken()!,
                    event.bookingId!,
                    {
                      action: 'cancel',
                      cancelReason: reason || undefined,
                      debitPackage: isPersonalLedger ? debitPackage : undefined,
                      seriesScope,
                    },
                  ),
                )
              }
            >
              Отменить
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              disabled={busy}
              onClick={() =>
                run(() =>
                  api.trainerUpdatePersonalBooking(
                    getToken()!,
                    event.bookingId!,
                    {
                      action: 'no_show',
                      cancelReason: reason || 'Неявка',
                      debitPackage: isPersonalLedger ? debitPackage : undefined,
                    },
                  ),
                )
              }
            >
              Неявка
            </Button>
          </div>
        </div>

        {canHardDelete ? (
          <div className="space-y-2 border-t border-white/10 pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Удаление
            </p>
            <p className="text-xs text-zinc-500">
              Свои записи или запись клиента после неявки/отмены. Без документа
              1С и без подарка. Списание с пакета вернётся клиенту.
            </p>
            <Button
              type="button"
              variant="secondary"
              className="w-full border-red-500/40 text-red-300"
              disabled={busy}
              onClick={() => {
                if (
                  !window.confirm(
                    'Удалить запись полностью? Это нельзя отменить.',
                  )
                ) {
                  return;
                }
                run(() =>
                  api.trainerDeletePersonalBooking(
                    getToken()!,
                    event.bookingId!,
                  ),
                );
              }}
            >
              Удалить запись
            </Button>
          </div>
        ) : controlledByAdmin ? (
          <p className="text-xs text-zinc-500">
            Эту запись нельзя удалить — списание или оплата через 1С / подарок.
            Меняйте статус.
          </p>
        ) : null}

        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <Button type="button" variant="ghost" className="w-full" onClick={onClose}>
          Закрыть
        </Button>
      </div>
    </ResponsiveSheet>
  );
}
