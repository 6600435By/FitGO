'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export function AssignClientDialog({
  startAt,
  clients,
  onClose,
  onAssigned,
}: {
  startAt: string;
  clients: Array<{ id: string; firstName: string; lastName: string }>;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (clients[0]) setClientId(clients[0].id);
  }, [clients]);

  const handleAssign = async () => {
    const token = getToken();
    if (!token || !clientId) return;

    setSaving(true);
    setError('');
    try {
      await api.trainerAssignPersonalBooking(token, clientId, startAt);
      onAssigned();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка назначения');
    } finally {
      setSaving(false);
    }
  };

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

        {clients.length === 0 ? (
          <p className="text-sm text-amber-400">
            Нет клиентов в базе. Добавьте клиентов через раздел «Клиенты».
          </p>
        ) : (
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="input"
          >
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.firstName} {client.lastName}
              </option>
            ))}
          </select>
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
