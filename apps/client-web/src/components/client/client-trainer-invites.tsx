'use client';

import type { TrainerInviteRequest } from '@fitgo/shared-types';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export function ClientTrainerInvites() {
  const [requests, setRequests] = useState<TrainerInviteRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const token = getToken();
    if (!token) return;
    api.clientTrainerInvites(token).then(setRequests).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const respond = async (trainerId: string, action: 'accept' | 'reject') => {
    const token = getToken();
    if (!token) return;

    setBusyId(trainerId);
    setError('');
    try {
      if (action === 'accept') {
        await api.clientAcceptTrainerInvite(token, trainerId);
      } else {
        await api.clientRejectTrainerInvite(token, trainerId);
      }
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusyId(null);
    }
  };

  if (requests.length === 0 && !error) return null;

  return (
    <section className="card space-y-3">
      <h3 className="font-medium">Приглашения тренеров</h3>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {requests.length === 0 ? (
        <p className="text-sm text-slate-400">Нет новых приглашений</p>
      ) : (
        <ul className="space-y-3">
          {requests.map((req) => (
            <li
              key={req.trainerId}
              className={`rounded-xl border p-3 ${
                req.highlight
                  ? 'border-fitgo-500/40 bg-fitgo-500/5'
                  : 'border-slate-800'
              }`}
            >
              <p className="font-medium">{req.trainerName}</p>
              {req.highlight && (
                <p className="mt-1 text-sm text-fitgo-400">
                  Тренер добавил вас по телефону — подтвердите, чтобы видеть историю
                  тренировок
                </p>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="btn-primary flex-1 text-sm"
                  disabled={busyId === req.trainerId}
                  onClick={() => respond(req.trainerId, 'accept')}
                >
                  Принять
                </button>
                <button
                  type="button"
                  className="btn-secondary flex-1 text-sm"
                  disabled={busyId === req.trainerId}
                  onClick={() => respond(req.trainerId, 'reject')}
                >
                  Отклонить
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
