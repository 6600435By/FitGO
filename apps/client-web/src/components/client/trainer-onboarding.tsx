'use client';

import type { TrainerInviteRequest } from '@fitgo/shared-types';
import { useCallback, useEffect, useState } from 'react';
import { AuthError, AuthShell } from '@/components/forma/auth-shell';
import { Avatar } from '@/components/forma/avatar';
import { Button } from '@/components/forma/button';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

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
    <AuthShell
      title="Ваши тренеры"
      subtitle="Подтвердите или отклоните приглашения — можно сделать это позже в профиле"
    >
      {requests.length === 0 ? (
        <div className="card space-y-4 text-center">
          <p className="text-zinc-400">Нет ожидающих приглашений</p>
          <Button className="w-full" size="lg" onClick={onComplete}>
            В кабинет
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <ul className="space-y-3">
            {requests.map((req) => (
              <li
                key={req.trainerId}
                className={cn(
                  'card',
                  req.highlight && 'border-forma-500/40 shadow-forma-glow',
                )}
              >
                <div className="flex items-start gap-3">
                  <Avatar name={req.trainerName} size="lg" />
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-lg font-semibold text-white">
                      {req.trainerName}
                    </p>
                    {req.highlight ? (
                      <p className="mt-1 text-sm text-forma-400">
                        Добавил вас по телефону — подтвердите связь
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-zinc-400">
                        Хочет вести ваши тренировки
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button
                    className="flex-1"
                    loading={busyId === req.trainerId}
                    onClick={() => void respond(req.trainerId, 'accept')}
                  >
                    Принять
                  </Button>
                  <Button
                    variant="secondary"
                    className="flex-1"
                    disabled={busyId === req.trainerId}
                    onClick={() => void respond(req.trainerId, 'reject')}
                  >
                    Отклонить
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <AuthError>{error}</AuthError>
          <Button variant="ghost" className="w-full" onClick={onComplete}>
            Пропустить и продолжить
          </Button>
        </div>
      )}
    </AuthShell>
  );
}
