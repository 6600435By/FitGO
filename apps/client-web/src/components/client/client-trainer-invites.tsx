'use client';

import type { TrainerInviteRequest } from '@fitgo/shared-types';
import { useCallback, useEffect, useState } from 'react';
import { Avatar } from '@/components/forma/avatar';
import { Button } from '@/components/forma/button';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { cn } from '@/lib/utils';

export function ClientTrainerInvites() {
  const [requests, setRequests] = useState<TrainerInviteRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const token = getToken();
    if (!token) return;
    api
      .clientTrainerInvites(token)
      .then(setRequests)
      .catch((err) => setError(err.message));
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
      <h3 className="font-display font-semibold text-white">
        Приглашения тренеров
      </h3>
      {error ? <p className="text-sm text-rose-400">{error}</p> : null}
      {requests.length === 0 ? (
        <p className="text-sm text-zinc-400">Нет новых приглашений</p>
      ) : (
        <ul className="space-y-3">
          {requests.map((req) => (
            <li
              key={req.trainerId}
              className={cn(
                'rounded-2xl border p-3',
                req.highlight
                  ? 'border-forma-500/40 bg-forma-500/5'
                  : 'border-white/10 bg-ink-raised/60',
              )}
            >
              <div className="flex items-center gap-3">
                <Avatar name={req.trainerName} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-white">{req.trainerName}</p>
                  {req.highlight ? (
                    <p className="text-xs text-forma-400">
                      Добавил вас по телефону
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  className="flex-1"
                  size="sm"
                  loading={busyId === req.trainerId}
                  onClick={() => void respond(req.trainerId, 'accept')}
                >
                  Принять
                </Button>
                <Button
                  className="flex-1"
                  size="sm"
                  variant="secondary"
                  disabled={busyId === req.trainerId}
                  onClick={() => void respond(req.trainerId, 'reject')}
                >
                  Отклонить
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
