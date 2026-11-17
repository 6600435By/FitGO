'use client';

import type { TrainerClientLookupResult } from '@fitgo/shared-types';
import { Chip, ResponsiveSheet } from '@fitgo/forma-ui';
import { useEffect, useMemo, useState } from 'react';
import { useTrainerUiV2 } from '@/components/trainer-shell/trainer-ui-v2';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';

type BasisOpt = {
  payKind: 'BLOCK' | 'PAID' | 'GIFT';
  label: string;
  basisServiceName?: string;
  remaining?: number;
};

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
  const forma = useTrainerUiV2();
  const canChooseFlow = Boolean(me?.trainerClub && me?.trainerStaff);
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [nameQuery, setNameQuery] = useState('');
  const [phone, setPhone] = useState('+375');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [lookup, setLookup] = useState<TrainerClientLookupResult | null>(null);
  const [looking, setLooking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [ptFlow, setPtFlow] = useState<'CLUB' | 'PERSONAL'>('CLUB');
  const [basisOptions, setBasisOptions] = useState<BasisOpt[]>([]);
  const [basisKey, setBasisKey] = useState('PAID');
  const [basisMessage, setBasisMessage] = useState('');

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
    const token = getToken();
    if (!token || !clientId || !forma) {
      setBasisOptions([]);
      setBasisMessage('');
      setBasisKey('PAID');
      return;
    }
    let cancelled = false;
    api
      .trainerClientPtBasis(token, clientId)
      .then((res) => {
        if (cancelled) return;
        setBasisOptions(res.options);
        setBasisMessage(res.message ?? '');
        const first = res.options[0];
        setBasisKey(
          first ? `${first.payKind}:${first.basisServiceName ?? ''}` : 'PAID',
        );
      })
      .catch(() => {
        if (!cancelled) {
          setBasisOptions([{ payKind: 'PAID', label: 'Разовая оплата' }]);
          setBasisKey('PAID');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, forma]);

  const phoneDigits = phone.replace(/\D/g, '');
  const phoneReady = phoneDigits.length >= 12;
  const guestReady =
    phoneReady && firstName.trim().length > 0 && lastName.trim().length > 0;
  const canAssign = Boolean(clientId) || guestReady;

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
            // Guest path: clear roster selection so Записать uses phone+FIO.
            if (!res.inRoster) setClientId('');
          } else if (res.found === false) {
            setHint('Нет в 1С — введите ФИО и нажмите «Записать»');
            setClientId('');
          }
        })
        .catch(() => setLookup(null))
        .finally(() => setLooking(false));
    }, 400);
    return () => window.clearTimeout(t);
  }, [phone, phoneReady, clients]);

  const handleAssign = async () => {
    const token = getToken();
    if (!token || !canAssign) return;

    setSaving(true);
    setError('');
    try {
      const selected =
        basisOptions.find(
          (o) => `${o.payKind}:${o.basisServiceName ?? ''}` === basisKey,
        ) ?? basisOptions.find((o) => o.payKind === 'PAID');
      if (clientId) {
        await api.trainerAssignPersonalBooking(token, {
          clientId,
          startAt,
          ptFlow: canChooseFlow ? ptFlow : undefined,
          payKind: selected?.payKind,
          basisServiceName: selected?.basisServiceName,
          isComplimentary: selected?.payKind === 'GIFT' || undefined,
        });
      } else {
        await api.trainerAssignPersonalBooking(token, {
          phone,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          startAt,
          clientExternalId: lookup?.externalId,
          ptFlow: canChooseFlow ? ptFlow : undefined,
          payKind: selected?.payKind,
          basisServiceName: selected?.basisServiceName,
          isComplimentary: selected?.payKind === 'GIFT' || undefined,
        });
      }
      onAssigned();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка назначения');
    } finally {
      setSaving(false);
    }
  };

  const showGuestFields =
    !clientId ||
    lookup?.found === false ||
    (lookup?.found === true && !lookup.inRoster && lookup.source !== 'roster');

  const body = (
    <>
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

        {showGuestFields && (
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
        )}

        {filtered.length === 0 ? (
          <p className="text-sm text-amber-400">
            Нет клиентов в базе — можно записать гостя по телефону и ФИО.
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
            <option value="">— Гость / не из списка —</option>
            {filtered.map((client) => (
              <option key={client.id} value={client.id}>
                {client.firstName} {client.lastName}
                {client.phone ? ` · ${client.phone}` : ''}
              </option>
            ))}
          </select>
        )}

        {forma && clientId && basisOptions.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-slate-400">Основание</p>
            {basisMessage ? (
              <p className="text-xs text-amber-300">{basisMessage}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {basisOptions.map((o) => {
                const key = `${o.payKind}:${o.basisServiceName ?? ''}`;
                return (
                  <Chip
                    key={key}
                    active={basisKey === key}
                    onClick={() => setBasisKey(key)}
                  >
                    {o.label}
                  </Chip>
                );
              })}
            </div>
          </div>
        ) : null}

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
              <option value="PERSONAL">Личная (Расчёты)</option>
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
            disabled={saving || !canAssign}
            className="btn-primary flex-1 disabled:opacity-50"
          >
            {saving ? 'Сохранение...' : 'Записать'}
          </button>
        </div>
    </>
  );

  if (forma) {
    return (
      <ResponsiveSheet
        open
        onOpenChange={(o) => !o && onClose()}
        title="Записать на ПТ"
      >
        <div className="space-y-4 pb-2">{body}</div>
      </ResponsiveSheet>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="card w-full max-w-md space-y-4">
        <h3 className="text-lg font-semibold">Записать на ПТ</h3>
        {body}
      </div>
    </div>
  );
}
