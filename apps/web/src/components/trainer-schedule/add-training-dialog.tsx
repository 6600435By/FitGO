'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export function AddTrainingDialog({
  clients,
  defaultDate,
  onClose,
  onAdded,
}: {
  clients: Array<{ id: string; firstName: string; lastName: string }>;
  defaultDate?: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [clientId, setClientId] = useState(clients[0]?.id ?? '');
  const [date, setDate] = useState(
    defaultDate ?? new Date().toLocaleDateString('fr-CA'),
  );
  const [time, setTime] = useState('10:00');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (clients[0]) setClientId(clients[0].id);
  }, [clients]);

  const handleSubmit = async () => {
    const token = getToken();
    if (!token || !clientId) return;

    const startAt = new Date(`${date}T${time}:00`);
    if (Number.isNaN(startAt.getTime())) {
      setError('Некорректная дата или время');
      return;
    }

    setSaving(true);
    setError('');
    try {
      await api.trainerAssignPersonalBooking(token, clientId, startAt.toISOString());
      onAdded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="card w-full max-w-md space-y-4">
        <h3 className="text-lg font-semibold">Добавить тренировку</h3>
        <p className="text-sm text-slate-400">
          Персональная тренировка с клиентом из вашей базы
        </p>

        {clients.length === 0 ? (
          <p className="text-sm text-amber-400">
            Нет подтверждённых клиентов. Добавьте клиента в разделе «Клиенты».
          </p>
        ) : (
          <>
            <div>
              <label className="mb-2 block text-sm text-slate-400">Клиент</label>
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
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-2 block text-sm text-slate-400">Дата</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-400">Время</label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="input"
                />
              </div>
            </div>
          </>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || !clientId}
            className="btn-primary flex-1 disabled:opacity-50"
          >
            {saving ? 'Сохранение...' : 'Создать'}
          </button>
        </div>
      </div>
    </div>
  );
}
