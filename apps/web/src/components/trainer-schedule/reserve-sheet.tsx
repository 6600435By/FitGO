'use client';

import { Button, ResponsiveSheet } from '@fitgo/forma-ui';
import { useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export function ReserveSheet({
  startAt,
  endAt,
  clients,
  onClose,
  onSaved,
}: {
  startAt: string;
  endAt?: string;
  clients: Array<{ id: string; firstName: string; lastName: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const start = new Date(startAt);
  const defaultEnd = endAt
    ? new Date(endAt)
    : new Date(start.getTime() + 60 * 60_000);
  const toLocal = (d: Date) => {
    const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  };

  const [kind, setKind] = useState<'HOLD_CLIENT' | 'PERSONAL_BLOCK'>(
    'HOLD_CLIENT',
  );
  const [from, setFrom] = useState(toLocal(start));
  const [to, setTo] = useState(toLocal(defaultEnd));
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [holdHours, setHoldHours] = useState('12');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const token = getToken();
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      await api.trainerCreateScheduleHold(token, {
        startAt: new Date(from).toISOString(),
        endAt: new Date(to).toISOString(),
        kind,
        holdClientId: kind === 'HOLD_CLIENT' ? clientId : undefined,
        holdHours:
          kind === 'HOLD_CLIENT'
            ? Math.min(168, Math.max(1, Number(holdHours) || 12))
            : undefined,
        note: note.trim() || undefined,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ResponsiveSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Резерв"
      className="max-h-[85dvh]"
    >
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <button
            type="button"
            className={`flex-1 rounded-xl px-3 py-2 text-sm ${
              kind === 'HOLD_CLIENT'
                ? 'bg-forma-500 text-ink'
                : 'bg-white/10 text-zinc-300'
            }`}
            onClick={() => setKind('HOLD_CLIENT')}
          >
            Под клиента
          </button>
          <button
            type="button"
            className={`flex-1 rounded-xl px-3 py-2 text-sm ${
              kind === 'PERSONAL_BLOCK'
                ? 'bg-forma-500 text-ink'
                : 'bg-white/10 text-zinc-300'
            }`}
            onClick={() => setKind('PERSONAL_BLOCK')}
          >
            Блокировка
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="min-w-0 text-sm text-zinc-400">
            С
            <input
              type="datetime-local"
              className="input mt-1 w-full min-w-0 max-w-full text-[13px]"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="min-w-0 text-sm text-zinc-400">
            По
            <input
              type="datetime-local"
              className="input mt-1 w-full min-w-0 max-w-full text-[13px]"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>

        {kind === 'HOLD_CLIENT' ? (
          <>
            <label className="block min-w-0 text-sm text-zinc-400">
              Клиент
              <select
                className="input mt-1 w-full"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              >
                {clients.length === 0 ? (
                  <option value="">Нет клиентов в базе</option>
                ) : null}
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-zinc-400">
              Освободить через (часов)
              <input
                type="number"
                min={1}
                max={168}
                inputMode="numeric"
                className="input mt-1 w-full"
                value={holdHours}
                onChange={(e) => setHoldHours(e.target.value)}
              />
            </label>
          </>
        ) : null}

        <label className="block text-sm text-zinc-400">
          Комментарий
          <input
            className="input mt-1 w-full"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              kind === 'PERSONAL_BLOCK' ? 'Обед, личное…' : 'Ориентировочно'
            }
          />
        </label>

        {error ? <p className="text-sm text-red-400">{error}</p> : null}

        <Button
          type="button"
          className="sticky bottom-0 w-full"
          disabled={busy || (kind === 'HOLD_CLIENT' && !clientId)}
          onClick={save}
        >
          {busy ? 'Сохранение…' : 'Сохранить'}
        </Button>
      </div>
    </ResponsiveSheet>
  );
}
