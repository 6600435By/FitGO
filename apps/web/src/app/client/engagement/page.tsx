'use client';

import type { GamificationProfile } from '@fitgo/shared-types';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

export default function ClientEngagementPage() {
  const [profile, setProfile] = useState<GamificationProfile | null>(null);
  const [leaderboard, setLeaderboard] = useState<
    Array<{ rank: number; name: string; points: number }>
  >([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getToken();
    if (!token) return;

    Promise.all([
      api.gamification(token),
      api.leaderboard(token),
    ])
      .then(([gam, board]) => {
        setProfile(gam);
        setLeaderboard(board);
      })
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="text-red-400">{error}</p>;

  if (!profile) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Достижения</h2>

      <div className="grid grid-cols-3 gap-3">
        <div className="card text-center">
          <p className="stat-value">{profile.visitStreak}</p>
          <p className="stat-label">Streak</p>
        </div>
        <div className="card text-center">
          <p className="stat-value">{profile.totalVisits}</p>
          <p className="stat-label">Визитов</p>
        </div>
        <div className="card text-center">
          <p className="stat-value">{profile.points}</p>
          <p className="stat-label">Очков</p>
        </div>
      </div>

      {profile.rank && (
        <div className="card text-center">
          <p className="text-sm text-slate-400">Ваш рейтинг в клубе</p>
          <p className="text-3xl font-bold text-fitgo-400">#{profile.rank}</p>
        </div>
      )}

      <div className="card">
        <h3 className="mb-3 font-semibold">Бейджи</h3>
        {profile.badges.length === 0 ? (
          <p className="text-sm text-slate-400">Пока нет бейджей — продолжайте тренироваться!</p>
        ) : (
          <ul className="space-y-2">
            {profile.badges.map((badge) => (
              <li
                key={badge.id}
                className="rounded-xl bg-fitgo-500/10 px-3 py-2"
              >
                <p className="font-medium text-fitgo-400">{badge.name}</p>
                <p className="text-sm text-slate-400">{badge.description}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {leaderboard.length > 0 && (
        <div className="card">
          <h3 className="mb-3 font-semibold">Лидерборд</h3>
          <ul className="space-y-2">
            {leaderboard.map((entry) => (
              <li
                key={entry.rank}
                className="flex justify-between rounded-xl bg-slate-800/50 px-3 py-2 text-sm"
              >
                <span>
                  #{entry.rank} {entry.name}
                </span>
                <span className="text-fitgo-400">{entry.points} очк.</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Link href="/client/referral" className="btn-secondary block text-center">
        Приведи друга
      </Link>
    </div>
  );
}
