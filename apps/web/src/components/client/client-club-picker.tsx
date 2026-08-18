'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken, getUser, saveAuth } from '@/lib/auth';

interface ClubOption {
  id: string;
  name: string;
  slug: string;
  address?: string;
}

export function ClientClubPicker({
  onJoined,
  onCancel,
}: {
  onJoined: (club: { name: string; address?: string }) => void;
  onCancel?: () => void;
}) {
  const [clubs, setClubs] = useState<ClubOption[]>([]);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api.clientClubs(token).then(setClubs).catch(() => {});
  }, []);

  const join = async (club: ClubOption) => {
    const token = getToken();
    const user = getUser();
    if (!token) return;

    setBusySlug(club.slug);
    setError('');
    try {
      const result = await api.clientJoinClub(token, club.slug);
      if (user) {
        saveAuth(token, {
          ...user,
          clubId: result.club.id,
          club: result.club,
        });
      }
      onJoined(result.club);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выбрать клуб');
    } finally {
      setBusySlug(null);
    }
  };

  return (
    <div className="card space-y-3">
      <div>
        <p className="text-sm text-slate-400">Клуб не выбран</p>
        <p className="text-lg font-semibold">Выберите клуб</p>
        <p className="mt-1 text-sm text-slate-400">
          Он закрепится за вами, пока не смените его здесь.
        </p>
      </div>
      {clubs.length === 0 ? (
        <p className="text-sm text-slate-500">Клубы пока не добавлены</p>
      ) : (
        <ul className="space-y-2">
          {clubs.map((club) => (
            <li key={club.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-xl bg-slate-800/50 px-3 py-3 text-left transition hover:bg-slate-800"
                disabled={busySlug !== null}
                onClick={() => join(club)}
              >
                <span>
                  <span className="block font-medium">{club.name}</span>
                  {club.address && (
                    <span className="block text-sm text-slate-400">{club.address}</span>
                  )}
                </span>
                <span className="text-sm text-fitgo-400">
                  {busySlug === club.slug ? 'Сохранение...' : 'Выбрать'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {onCancel && (
        <button type="button" className="btn-secondary w-full" onClick={onCancel}>
          Отмена
        </button>
      )}
    </div>
  );
}
