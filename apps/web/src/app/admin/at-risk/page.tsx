'use client';

import type { AtRiskClient } from '@fitgo/shared-types';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export default function AdminAtRiskPage() {
  const [clients, setClients] = useState<AtRiskClient[]>([]);
  const [sending, setSending] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = () => {
    const token = getToken();
    if (!token) return;
    api
      .adminAtRisk(token)
      .then(setClients)
      .catch((err) => setError(err.message));
  };

  useEffect(() => {
    load();
  }, []);

  const sendReminder = async (client: AtRiskClient) => {
    const token = getToken();
    if (!token || !client.userId) return;

    setSending(client.userId);
    try {
      const result = await api.adminSendReminder(token, client.userId);
      const via =
        result.channel === 'sms'
          ? 'SMS'
          : result.channel === 'push'
            ? 'приложение'
            : 'кабинет';
      setMessage(`Напоминание ${client.name}: ${via}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setSending(null);
    }
  };

  if (error) return <p className="text-red-400">{error}</p>;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <p className="text-sm text-slate-400">
        Не были в клубе 3+ дней или абонемент истекает в ближайшие 14 дней.
      </p>

      {message && (
        <p className="rounded-xl bg-fitgo-500/10 px-3 py-2 text-sm text-fitgo-400">
          {message}
        </p>
      )}

      {clients.length === 0 ? (
        <p className="card py-3 text-sm text-slate-400">Все клиенты активны</p>
      ) : (
        <ul className="card divide-y divide-slate-800 !p-0 overflow-hidden">
          {clients.map((client) => (
            <li
              key={`${client.id}-${client.reason}`}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="font-semibold">{client.name}</p>
                <p className="text-sm text-slate-400">
                  {client.email}
                  {client.membership ? ` · ${client.membership}` : ''}
                  {client.daysInactive !== undefined
                    ? ` · не был ${client.daysInactive} дн.`
                    : ''}
                  {client.daysUntilExpiry !== undefined
                    ? ` · истекает через ${client.daysUntilExpiry} дн.`
                    : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-full bg-amber-400/10 px-2 py-1 text-xs text-amber-400">
                  {client.reason}
                </span>
                <button
                  onClick={() => sendReminder(client)}
                  disabled={sending === client.userId}
                  className="btn-primary px-3 py-2 text-xs"
                >
                  Напомнить
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
