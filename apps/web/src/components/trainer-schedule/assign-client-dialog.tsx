'use client';

import type { TrainerClientLookupResult } from '@fitgo/shared-types';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';

export function AssignClientDialog({
  startAt,
  clients,
  onClose,
  onAssigned,
}: {
  startAt: string;
  clients: Array<{ id: string; firstName: string; lastName: string; phone?: string }>;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const me = getUser();
  const canChooseFlow = Boolean(me?.trainerClub && me?.trainerStaff);
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [nameQuery, setNameQuery] = useState('');
  const [phone, setPhone] = useState('+375');
  const [lookup, setLookup] = useState<TrainerClientLookupResult | null>(null);
  const [looking, setLooking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [ptFlow, setPtFlow] = useState<'CLUB' | 'PERSONAL'>('CLUB');

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

  useEffect(() => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 12) {
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
          } else if (res.source === '1c' || res.source === 'fitgo') {
            setHint(
              res.inRoster
                ? 'Клиент в базе'
                : `Найден: ${res.lastName ?? ''} ${res.firstName ?? ''}`.trim(),
            );
          } else if (res.found === false) {
            setHint('Нет в 1С — сначала добавьте в «Клиенты»');
          }
        })
        .catch(() => setLookup(null))
        .finally(() => setLooking(false));
    }, 400);
    return () => window.clearTimeout(t);
  }, [phone, clients]);

  const handleAssign = async () => {
    const token = getToken();
    if (!token || !clientId) return;

    setSaving(true);
    setError('');
    try {
      await api.trainerAssignPersonalBooking(token, clientId, startAt, {
        ptFlow: canChooseFlow ? ptFlow : undefined,
      });
      onAssigned();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка назначения');
    } finally {
      setSaving(false);
    }
  };

  const handleAddFromLookup = async () => {
    const token = getToken();
    if (!token || !lookup?.found) return;
    if (!lookup.firstName || !lookup.lastName) {
      setError('Нет ФИО — добавьте клиента вручную в разделе «Клиенты»');
      return;
    }
    setAdding(true);
    setError('');
    try {
      const result = await api.trainerAddOfflineClient(token, {
        firstName: lookup.firstName,
        lastName: lookup.lastName,
        phone: lookup.phone,
        clientExternalId: lookup.externalId,
      });
      if ('message' in result) {
        setHint(result.message);
      } else {
        setClientId(result.id);
        setHint('Добавлен в базу — можно назначить');
        onAssigned();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось добавить');
    } finally {
      setAdding(false);
    }
  };

  const canAddFromLookup =
    lookup?.found &&
    !lookup.inRoster &&
    lookup.source !== 'roster' &&
    Boolean(lookup.firstName && lookup.lastName);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="card w-full max-w-md space-y-4">
        <h3 className="text-lg font-semibold">Назначить клиента</h3>
        <p className="text-sm text-slate-400">
          {new Date(startAt).toLocaleString('ru-RU', {
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit',
          })}
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
        {looking && <p className="text-xs text-slate-400">Ищем…</p>}
        {hint && <p className="text-sm text-slate-300">{hint}</p>}

        {canAddFromLookup && (
          <button
            type="button"
            className="btn-secondary w-full text-sm"
            disabled={adding}
            onClick={handleAddFromLookup}
          >
            {adding ? 'Добавляем…' : 'Добавить найденного в базу'}
          </button>
        )}

        {filtered.length === 0 ? (
          <p className="text-sm text-amber-400">
            Нет клиентов в базе. Добавьте через раздел «Клиенты» или по телефону выше.
          </p>
        ) : (
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="input"
          >
            {filtered.map((client) => (
              <option key={client.id} value={client.id}>
                {client.firstName} {client.lastName}
                {client.phone ? ` · ${client.phone}` : ''}
              </option>
            ))}
          </select>
        )}

        {canChooseFlow && (
          <div className="space-y-1">
            <p className="text-xs text-slate-400">Схема записи</p>
            <select
              className="input"
              value={ptFlow}
              onChange={(e) =>
                setPtFlow(e.target.value as 'CLUB' | 'PERSONAL')
              }
            >
              <option value="CLUB">Клубная (контроль и ЗП)</option>
              <option value="PERSONAL">Личная (Мои оплаты)</option>
            </select>
          </div>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            Отмена
          </button>
          <button
            type="button"
            onClick={handleAssign}
            disabled={saving || !clientId}
            className="btn-primary flex-1 disabled:opacity-50"
          >
            {saving ? 'Сохранение...' : 'Назначить'}
          </button>
        </div>
      </div>
    </div>
  );
}
