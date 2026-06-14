'use client';

import type { ChallengeView, GamificationProfile } from '@fitgo/shared-types';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { BadgeGrid } from '@/components/engagement/badge-grid';
import { LeagueBoard } from '@/components/engagement/league-board';
import { RatingDecayBanner } from '@/components/engagement/rating-decay-banner';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

const LOYALTY_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Активна',
  FROZEN: 'Заморожена',
  REACTIVATED: 'Восстановлена',
};

export default function ClientEngagementPage() {
  const [profile, setProfile] = useState<GamificationProfile | null>(null);
  const [challenges, setChallenges] = useState<ChallengeView[]>([]);
  const [error, setError] = useState('');
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [checkInMsg, setCheckInMsg] = useState('');

  const load = useCallback(() => {
    const token = getToken();
    if (!token) return;

    Promise.all([api.gamification(token), api.challenges(token)])
      .then(([gam, ch]) => {
        setProfile(gam);
        setChallenges(ch);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  const handleCheckIn = async () => {
    const token = getToken();
    if (!token) return;
    setCheckInLoading(true);
    setCheckInMsg('');
    try {
      const res = await api.checkIn(token) as { xpAwarded: number; newBadges: string[] };
      setCheckInMsg(
        res.xpAwarded > 0
          ? `Check-in успешен! +${res.xpAwarded} XP`
          : 'Вы уже отмечались сегодня',
      );
      load();
    } catch (e) {
      setCheckInMsg(e instanceof Error ? e.message : 'Ошибка check-in');
    } finally {
      setCheckInLoading(false);
    }
  };

  const handleDailyGoal = async () => {
    const token = getToken();
    if (!token) return;
    setDailyLoading(true);
    try {
      const res = await api.dailyGoal(token) as { awarded: boolean; xp?: number };
      if (res.awarded) load();
    } finally {
      setDailyLoading(false);
    }
  };

  if (error) return <p className="text-red-400">{error}</p>;

  if (!profile) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
      </div>
    );
  }

  if (!profile.activated) {
    return (
      <div className="card space-y-4 text-center">
        <h2 className="text-xl font-semibold">Достижения</h2>
        <p className="text-slate-400">
          Активируйте геймификацию в настройках профиля, чтобы участвовать в лигах и получать бейджи.
        </p>
        <Link href="/client/profile" className="btn-primary inline-block">
          Перейти в профиль
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Достижения</h2>

      {profile.decayWarning && (
        <RatingDecayBanner
          warning={profile.decayWarning}
          onDailyGoal={handleDailyGoal}
          loading={dailyLoading}
        />
      )}

      {profile.league && <LeagueBoard league={profile.league} />}

      {profile.loyalty && (
        <div className="card">
          <p className="text-sm text-slate-400">Лояльность клуба</p>
          <p className="text-lg font-bold text-fitgo-400">{profile.loyalty.tierLabel}</p>
          <p className="text-sm text-slate-400">
            {LOYALTY_STATUS_LABELS[profile.loyalty.status] ?? profile.loyalty.status} ·{' '}
            {profile.loyalty.continuityMonths} мес. непрерывности
          </p>
        </div>
      )}

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
          <p className="stat-label">XP</p>
        </div>
      </div>

      {profile.rank && (
        <div className="card text-center">
          <p className="text-sm text-slate-400">Рейтинг в клубе</p>
          <p className="text-3xl font-bold text-fitgo-400">#{profile.rank}</p>
        </div>
      )}

      <div className="card space-y-3">
        <button
          type="button"
          onClick={handleCheckIn}
          disabled={checkInLoading}
          className="btn-primary w-full"
        >
          {checkInLoading ? 'Отмечаем...' : 'Я в клубе (+50 XP)'}
        </button>
        {checkInMsg && <p className="text-center text-sm text-fitgo-400">{checkInMsg}</p>}
      </div>

      <BadgeGrid profile={profile} />

      {challenges.length > 0 && (
        <div className="card">
          <h3 className="mb-3 font-semibold">Челленджи</h3>
          <ul className="space-y-3">
            {challenges.map((c) => (
              <li key={c.id} className="rounded-xl bg-slate-800/50 p-3">
                <p className="font-medium">{c.title}</p>
                {c.description && (
                  <p className="text-sm text-slate-400">{c.description}</p>
                )}
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-700">
                  <div
                    className="h-full rounded-full bg-fitgo-500"
                    style={{
                      width: `${Math.min(100, (c.progress / c.targetVisits) * 100)}%`,
                    }}
                  />
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {c.progress} / {c.targetVisits} визитов
                  {c.completed && ' · Завершён!'}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Link href="/client/workouts" className="btn-secondary block text-center">
        Тренировки вне клуба
      </Link>

      <Link href="/client/referral" className="btn-secondary block text-center">
        Приведи друга
      </Link>
    </div>
  );
}
