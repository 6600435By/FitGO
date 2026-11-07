'use client';

import type { TrainerCalendarEvent } from '@fitgo/shared-types';
import { Button, ResponsiveSheet } from '@fitgo/forma-ui';
import { useState } from 'react';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';

const BUFFER_OPTS = [0, 15, 30, 60] as const;

export function BookingActionSheet({
  event,
  onClose,
  onChanged,
}: {
  event: TrainerCalendarEvent;
  onClose: () => void;
  onChanged: () => void;
}) {
  const me = getUser();
  const isPersonal = Boolean(me?.trainerClub);
  const canHardDelete =
    Boolean(me?.trainerClub) &&
    event.kind === 'PERSONAL' &&
    Boolean(event.bookingId) &&
    (event.ptFlow === 'PERSONAL' ||
      (!event.ptFlow && Boolean(me?.trainerClub) && !me?.trainerStaff));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [debitPackage, setDebitPackage] = useState(false);
  const [seriesScope, setSeriesScope] = useState<'one' | 'future'>('one');
  const [moveAt, setMoveAt] = useState(() => {
    const d = new Date(event.startAt);
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  });
  const [bufferBefore, setBufferBefore] = useState(event.bufferBeforeMin ?? 0);
  const [bufferAfter, setBufferAfter] = useState(event.bufferAfterMin ?? 0);

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
        {event.ptControlLabel && event.ptFlow !== 'PERSONAL' ? (
          <p className="text-sm text-zinc-400">{event.ptControlLabel}</p>
        ) : null}
        {event.clientIssue && event.clientIssue !== 'NONE' ? (
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            Нет в 1С — ждёт привязки.
          </p>
        ) : null}

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Перенос
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
            Перенести
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
            Отмена
          </p>
          <input
            className="input w-full"
            placeholder="Причина (необязательно)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {isPersonal ? (
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={debitPackage}
                onChange={(e) => setDebitPackage(e.target.checked)}
              />
              Списать с личного пакета
            </label>
          ) : null}
          {event.seriesId ? (
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={seriesScope === 'future'}
                onChange={(e) =>
                  setSeriesScope(e.target.checked ? 'future' : 'one')
                }
              />
              Отменить все будущие и остановить серию
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
                      debitPackage: isPersonal ? debitPackage : undefined,
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
                      debitPackage: isPersonal ? debitPackage : undefined,
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
              Запись исчезнет без следа. Если занятие уже списано с пакета —
              занятие вернётся клиенту.
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
        ) : null}

        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <Button type="button" variant="ghost" className="w-full" onClick={onClose}>
          Закрыть
        </Button>
      </div>
    </ResponsiveSheet>
  );
}
