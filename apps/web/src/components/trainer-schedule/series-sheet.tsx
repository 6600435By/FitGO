'use client';

import { Button, ResponsiveSheet } from '@fitgo/forma-ui';
import { useState } from 'react';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';

const DAYS = [
  { value: 1, label: 'Пн' },
  { value: 2, label: 'Вт' },
  { value: 3, label: 'Ср' },
  { value: 4, label: 'Чт' },
  { value: 5, label: 'Пт' },
  { value: 6, label: 'Сб' },
  { value: 0, label: 'Вс' },
];

export function SeriesSheet({
  clients,
  defaultDate,
  onClose,
  onSaved,
}: {
  clients: Array<{ id: string; firstName: string; lastName: string }>;
  defaultDate: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const me = getUser();
  const canChooseFlow = Boolean(me?.trainerClub && me?.trainerStaff);
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [dayOfWeek, setDayOfWeek] = useState(new Date(`${defaultDate}T12:00:00`).getDay());
  const [startTime, setStartTime] = useState('10:00');
  const [fromDate, setFromDate] = useState(defaultDate);
  const [toDate, setToDate] = useState('');
  const [occurrences, setOccurrences] = useState('8');
  const [ptFlow, setPtFlow] = useState<'CLUB' | 'PERSONAL'>('CLUB');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    const token = getToken();
    if (!token || !clientId) return;
    setBusy(true);
    setError('');
    try {
      await api.trainerCreateBookingSeries(token, {
        clientId,
        dayOfWeek,
        startTime,
        fromDate: new Date(`${fromDate}T00:00:00`).toISOString(),
        toDate: toDate
          ? new Date(`${toDate}T23:59:59`).toISOString()
          : undefined,
        occurrences: toDate ? undefined : Number(occurrences) || 8,
        ptFlow: canChooseFlow ? ptFlow : undefined,
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
      title="Серия записей"
      description="Постоянный клиент — записи создаются при публикации графика"
    >
      <div className="space-y-3 pb-2">
        <label className="block text-sm text-zinc-400">
          Клиент
          <select
            className="input mt-1 w-full"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.firstName} {c.lastName}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d) => (
            <button
              key={d.value}
              type="button"
              className={`rounded-full px-2.5 py-1 text-xs ${
                dayOfWeek === d.value
                  ? 'bg-forma-500 text-ink'
                  : 'bg-white/10 text-zinc-300'
              }`}
              onClick={() => setDayOfWeek(d.value)}
            >
              {d.label}
            </button>
          ))}
        </div>

        <label className="block text-sm text-zinc-400">
          Время
          <input
            type="time"
            className="input mt-1 w-full"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm text-zinc-400">
            С даты
            <input
              type="date"
              className="input mt-1 w-full"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </label>
          <label className="block text-sm text-zinc-400">
            По дату (или пусто)
            <input
              type="date"
              className="input mt-1 w-full"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </label>
        </div>

        {!toDate ? (
          <label className="block text-sm text-zinc-400">
            Сколько раз
            <input
              type="number"
              min={1}
              max={52}
              className="input mt-1 w-full"
              value={occurrences}
              onChange={(e) => setOccurrences(e.target.value)}
            />
          </label>
        ) : null}

        {canChooseFlow ? (
          <select
            className="input w-full"
            value={ptFlow}
            onChange={(e) => setPtFlow(e.target.value as 'CLUB' | 'PERSONAL')}
          >
            <option value="CLUB">Клубная</option>
            <option value="PERSONAL">Личная</option>
          </select>
        ) : null}

        {error ? <p className="text-sm text-red-400">{error}</p> : null}

        <Button
          type="button"
          className="w-full"
          disabled={busy || !clientId}
          loading={busy}
          onClick={save}
        >
          Создать серию
        </Button>
      </div>
    </ResponsiveSheet>
  );
}
