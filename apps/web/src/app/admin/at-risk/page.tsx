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
      await api.adminSendReminder(token, client.userId);
      setMessage(`Напоминание отправлено: ${client.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setSending(null);
    }
  };

  if (error) return <p className="text-red-400">{error}</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Клиенты в зоне риска</h2>

      {message && (
        <p className="rounded-xl bg-fitgo-500/10 px-3 py-2 text-sm text-fitgo-400">
          {message}
        </p>
      )}

      {clients.length === 0 ? (
        <div className="card text-center text-slate-400">
          <p>Все клиенты активны</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {clients.map((client) => (
            <li key={`${client.id}-${client.reason}`} className="card">
              <div className="mb-2 flex items-start justify-between">
                <div>
                  <p className="font-semibold">{client.name}</p>
                  <p className="text-sm text-slate-400">{client.email}</p>
                  {client.membership && (
                    <p className="text-sm text-slate-400">{client.membership}</p>
                  )}
                </div>
                <span className="rounded-full bg-amber-400/10 px-2 py-1 text-xs text-amber-400">
                  {client.reason}
                </span>
              </div>
              {client.daysInactive !== undefined && (
                <p className="text-sm text-slate-400">
                  Не был {client.daysInactive} дн.
                </p>
              )}
              {client.daysUntilExpiry !== undefined && (
                <p className="text-sm text-slate-400">
                  Истекает через {client.daysUntilExpiry} дн.
                </p>
              )}
              <button
                onClick={() => sendReminder(client)}
                disabled={sending === client.userId}
                className="btn-primary mt-3 w-full"
              >
                Отправить напоминание
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
