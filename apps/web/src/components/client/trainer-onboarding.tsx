'use client';

import type { TrainerInviteRequest } from '@fitgo/shared-types';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

export function TrainerOnboarding({
  token,
  initialRequests,
  onComplete,
}: {
  token: string;
  initialRequests: TrainerInviteRequest[];
  onComplete: () => void;
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(() => {
    api.clientTrainerInvites(token).then(setRequests).catch(() => {});
  }, [token]);

  useEffect(() => {
    if (initialRequests.length === 0) refresh();
  }, [initialRequests.length, refresh]);

  const respond = async (trainerId: string, action: 'accept' | 'reject') => {
    setBusyId(trainerId);
    setError('');
    try {
      if (action === 'accept') {
        await api.clientAcceptTrainerInvite(token, trainerId);
      } else {
        await api.clientRejectTrainerInvite(token, trainerId);
      }
      setRequests((prev) => prev.filter((r) => r.trainerId !== trainerId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-lg space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Подтвердите тренеров</h1>
          <p className="mt-2 text-slate-400">
            Эти тренеры хотят вести вас. Подтвердите или отклоните каждого.
          </p>
        </div>

        {requests.length === 0 ? (
          <div className="card text-center text-slate-400">
            <p>Нет ожидающих приглашений</p>
            <button type="button" className="btn-primary mt-4" onClick={onComplete}>
              Продолжить
            </button>
          </div>
        ) : (
          <>
            <ul className="space-y-3">
              {requests.map((req) => (
                <li
                  key={req.trainerId}
                  className={`card ${req.highlight ? 'ring-1 ring-fitgo-500/50' : ''}`}
                >
                  <p className="font-medium">{req.trainerName}</p>
                  {req.highlight && (
                    <p className="mt-1 text-sm text-fitgo-400">
                      Тренер добавил вас по телефону — подтвердите связь
                    </p>
                  )}
                  <div className="mt-3 flex gap-2">
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
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button type="button" className="btn-secondary w-full" onClick={onComplete}>
              Пропустить и продолжить
            </button>
          </>
        )}
      </div>
    </div>
  );
}
