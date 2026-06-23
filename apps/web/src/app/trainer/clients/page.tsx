'use client';

import { MembershipStatus, type TrainerClientSummary } from '@fitgo/shared-types';
import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import {
  formatDate,
  membershipStatusColor,
  membershipStatusLabel,
} from '@/lib/utils';

function rosterStatusLabel(client: TrainerClientSummary): string {
  if (client.rosterStatus === 'REJECTED') return 'Отклонён';
  if (client.rosterStatus === 'PENDING') return 'Ожидает ответа';
  if (!client.clientAccepted && client.hasApp) return 'Ожидает подтверждения';
  if (!client.hasApp) return 'Офлайн';
  return 'Подтверждён';
}

function rosterStatusColor(client: TrainerClientSummary): string {
  if (client.rosterStatus === 'REJECTED') return 'bg-red-500/20 text-red-300';
  if (client.rosterStatus === 'PENDING') return 'bg-amber-500/20 text-amber-300';
  if (!client.clientAccepted) return 'bg-amber-500/20 text-amber-300';
  return 'bg-fitgo-500/20 text-fitgo-300';
}

export default function TrainerClientsPage() {
  const [clients, setClients] = useState<TrainerClientSummary[]>([]);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'offline' | 'invite' | null>(null);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  const loadClients = useCallback(() => {
    const token = getToken();
    if (!token) return;

    api
      .trainerClients(token)
      .then(setClients)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  const handleOfflineSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const token = getToken();
    if (!token) return;

    const form = new FormData(e.currentTarget);
    setSaving(true);
    setFormError('');
    setFormSuccess('');

    try {
      const result = await api.trainerAddOfflineClient(token, {
        firstName: String(form.get('firstName')),
        lastName: String(form.get('lastName')),
        phone: String(form.get('phone')),
        notes: String(form.get('notes') || '') || undefined,
      });

      if ('message' in result) {
        setFormSuccess(result.message);
      } else {
        setFormSuccess('Клиент добавлен в вашу базу');
        setMode(null);
        loadClients();
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  const handleInviteSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const token = getToken();
    if (!token) return;

    const form = new FormData(e.currentTarget);
    setSaving(true);
    setFormError('');
    setFormSuccess('');

    try {
      const result = await api.trainerInviteClient(token, String(form.get('phone')));
      setFormSuccess(result.message);
      setMode(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  if (error) return <p className="text-red-400">{error}</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Мои клиенты</h2>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => {
              setMode('offline');
              setFormError('');
              setFormSuccess('');
            }}
          >
            Добавить офлайн
          </button>
          <button
            type="button"
            className="btn-primary text-sm"
            onClick={() => {
              setMode('invite');
              setFormError('');
              setFormSuccess('');
            }}
          >
            Пригласить
          </button>
        </div>
      </div>

      {mode === 'offline' && (
        <form onSubmit={handleOfflineSubmit} className="card space-y-3">
          <h3 className="font-medium">Офлайн-клиент</h3>
          <p className="text-sm text-slate-400">
            Клиент дал телефон лично. Если номер свободен — сразу попадёт в базу.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <input name="firstName" className="input" placeholder="Имя" required />
            <input name="lastName" className="input" placeholder="Фамилия" required />
          </div>
          <input name="phone" className="input" placeholder="Телефон" required />
          <input name="notes" className="input" placeholder="Заметка (необязательно)" />
          {formError && <p className="text-sm text-red-400">{formError}</p>}
          {formSuccess && <p className="text-sm text-fitgo-400">{formSuccess}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={() => setMode(null)}>
              Отмена
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Сохранение...' : 'Добавить'}
            </button>
          </div>
        </form>
      )}

      {mode === 'invite' && (
        <form onSubmit={handleInviteSubmit} className="card space-y-3">
          <h3 className="font-medium">Пригласить клиента</h3>
          <p className="text-sm text-slate-400">
            Клиент должен подтвердить приглашение в приложении. Ответ всегда одинаковый.
          </p>
          <input name="phone" className="input" placeholder="Телефон" required />
          {formError && <p className="text-sm text-red-400">{formError}</p>}
          {formSuccess && <p className="text-sm text-fitgo-400">{formSuccess}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={() => setMode(null)}>
              Отмена
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Отправка...' : 'Отправить приглашение'}
            </button>
          </div>
        </form>
      )}

      {clients.length === 0 ? (
        <div className="card text-center text-slate-400">
          <p>Пока нет клиентов в вашей базе</p>
          <p className="mt-2 text-sm">
            Добавьте офлайн-клиента или отправьте приглашение по телефону
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {clients.map((client) => (
            <Link key={client.id} href={`/trainer/clients/${client.id}`} className="card block">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {client.firstName} {client.lastName}
                  </p>
                  {client.phone && (
                    <p className="text-sm text-slate-400">{client.phone}</p>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-1 text-xs ${rosterStatusColor(client)}`}
                >
                  {rosterStatusLabel(client)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {client.membershipStatus && (
                  <span
                    className={`rounded-full px-2 py-1 text-xs ${membershipStatusColor(client.membershipStatus)}`}
                  >
                    {membershipStatusLabel(client.membershipStatus)}
                  </span>
                )}
              </div>
              {client.membershipName && (
                <p className="mt-2 text-sm text-slate-300">{client.membershipName}</p>
              )}
              {client.lastVisit && (
                <p className="mt-1 text-sm text-slate-400">
                  Последний визит: {formatDate(client.lastVisit)}
                </p>
              )}
            </Link>
          ))}
        </ul>
      )}
    </div>
  );
}
