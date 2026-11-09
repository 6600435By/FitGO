'use client';

import type { TrainerClientLookupResult } from '@fitgo/shared-types';
import { ResponsiveSheet } from '@fitgo/forma-ui';
import { useEffect, useMemo, useState } from 'react';
import { useTrainerUiV2 } from '@/components/trainer-shell/trainer-ui-v2';
import { DateField, TimeField } from '@/components/ui/date-field';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';

export function AddTrainingDialog({
  clients,
  defaultDate,
  onClose,
  onAdded,
}: {
  clients: Array<{ id: string; firstName: string; lastName: string; phone?: string }>;
  defaultDate?: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const forma = useTrainerUiV2();
  const me = getUser();
  const canChooseFlow = Boolean(me?.trainerClub && me?.trainerStaff);
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [nameQuery, setNameQuery] = useState('');
  const [phone, setPhone] = useState('+375');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [lookup, setLookup] = useState<TrainerClientLookupResult | null>(null);
  const [looking, setLooking] = useState(false);
  const [hint, setHint] = useState('');
  const [ptFlow, setPtFlow] = useState<'CLUB' | 'PERSONAL'>('CLUB');
  const [date, setDate] = useState(
    defaultDate ?? new Date().toLocaleDateString('fr-CA'),
  );
  const [time, setTime] = useState('10:00');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (clients[0]) setClientId(clients[0].id);
  }, [clients]);

  const filtered = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => {
      const name = `${c.firstName} ${c.lastName}`.toLowerCase();
      const p = (c.phone ?? '').replace(/\D/g, '');
      return name.includes(q) || (p && p.includes(q.replace(/\D/g, '')));
    });
  }, [clients, nameQuery]);

  const phoneDigits = phone.replace(/\D/g, '');
  const phoneReady = phoneDigits.length >= 12;
  const guestReady =
    phoneReady && firstName.trim().length > 0 && lastName.trim().length > 0;
  const canSubmit = Boolean(clientId) || guestReady;

  useEffect(() => {
    if (!phoneReady) {
      setLookup(null);
      return;
    }
    const token = getToken();
    if (!token) return;
    const t = window.setTimeout(() => {
      setLooking(true);
      api
        .trainerClientLookup(token, phone)
        .then((res) => {
          setLookup(res);
          if (res.clientId && clients.some((c) => c.id === res.clientId)) {
            setClientId(res.clientId);
            setHint('Клиент найден в вашей базе');
          } else if (res.found && (res.source === '1c' || res.source === 'fitgo')) {
            if (res.firstName) setFirstName(res.firstName);
            if (res.lastName) setLastName(res.lastName);
            setHint(
              res.inRoster
                ? 'Клиент в базе'
                : `Найден: ${res.lastName ?? ''} ${res.firstName ?? ''}`.trim() +
                    (res.source === '1c' ? ' · 1С' : ''),
            );
            if (!res.inRoster) setClientId('');
          } else if (res.found === false) {
            setHint('Нет в 1С — введите ФИО и создайте тренировку');
            setClientId('');
          }
        })
        .catch(() => setLookup(null))
        .finally(() => setLooking(false));
    }, 400);
    return () => window.clearTimeout(t);
  }, [phone, phoneReady, clients]);

  const showGuestFields =
    !clientId ||
    lookup?.found === false ||
    (lookup?.found === true && !lookup.inRoster && lookup.source !== 'roster');

  const handleSubmit = async () => {
    const token = getToken();
    if (!token || !canSubmit) return;

    const startAt = new Date(`${date}T${time}:00`);
    if (Number.isNaN(startAt.getTime())) {
      setError('Некорректная дата или время');
      return;
    }

    setSaving(true);
    setError('');
    try {
      if (clientId) {
        await api.trainerAssignPersonalBooking(token, {
          clientId,
          startAt: startAt.toISOString(),
          ptFlow: canChooseFlow ? ptFlow : undefined,
        });
      } else {
        await api.trainerAssignPersonalBooking(token, {
          phone,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          startAt: startAt.toISOString(),
          clientExternalId: lookup?.externalId,
          ptFlow: canChooseFlow ? ptFlow : undefined,
        });
      }
      onAdded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  const body = (
    <>
      <p className="text-sm text-slate-400">
        Клиент из базы или новый по телефону и ФИО
      </p>

      <input
        className="input w-full"
        inputMode="tel"
        placeholder="Телефон +375…"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <input
        className="input w-full"
        placeholder="Или поиск по ФИО в базе"
        value={nameQuery}
        onChange={(e) => setNameQuery(e.target.value)}
      />
      {looking ? <p className="text-xs text-slate-400">Ищем…</p> : null}
      {hint ? <p className="text-sm text-slate-300">{hint}</p> : null}

      {showGuestFields ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            className="input"
            placeholder="Имя"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
          <input
            className="input"
            placeholder="Фамилия"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <p className="text-sm text-amber-400">
          Нет клиентов в базе — можно создать тренировку для нового по телефону и
          ФИО.
        </p>
      ) : (
        <select
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            setHint('');
          }}
          className="input"
        >
          <option value="">— Новый клиент / не из списка —</option>
          {filtered.map((client) => (
            <option key={client.id} value={client.id}>
              {client.firstName} {client.lastName}
              {client.phone ? ` · ${client.phone}` : ''}
            </option>
          ))}
        </select>
      )}

      <div className="grid grid-cols-2 items-start gap-3">
        <DateField label="Дата" value={date} onChange={setDate} />
        <TimeField label="Время" value={time} onChange={setTime} />
      </div>

      {canChooseFlow ? (
        <div className="space-y-1">
          <p className="text-xs text-slate-400">Схема записи</p>
          <select
            className="input"
            value={ptFlow}
            onChange={(e) => setPtFlow(e.target.value as 'CLUB' | 'PERSONAL')}
          >
            <option value="CLUB">Клубная (контроль и ЗП)</option>
            <option value="PERSONAL">Личная (Расчёты)</option>
          </select>
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="btn-secondary flex-1">
          Отмена
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={saving || !canSubmit}
          className="btn-primary flex-1 disabled:opacity-50"
        >
          {saving ? 'Сохранение...' : 'Создать'}
        </button>
      </div>
    </>
  );

  if (forma) {
    return (
      <ResponsiveSheet
        open
        onOpenChange={(o) => !o && onClose()}
        title="Добавить тренировку"
      >
        <div className="space-y-4 pb-2">{body}</div>
      </ResponsiveSheet>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="card w-full max-w-md space-y-4">
        <h3 className="text-lg font-semibold">Добавить тренировку</h3>
        {body}
      </div>
    </div>
  );
}
