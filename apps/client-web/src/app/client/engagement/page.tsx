'use client';

import type { ChallengeView, GamificationProfile } from '@fitgo/shared-types';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { BadgeGrid } from '@/components/engagement/badge-grid';
import { LeagueBoard } from '@/components/engagement/league-board';
import { RatingDecayBanner } from '@/components/engagement/rating-decay-banner';
import { Button } from '@/components/forma/button';
import { PageHeader } from '@/components/forma/page-header';
import { SkeletonCard } from '@/components/forma/skeleton';
import { StatTile } from '@/components/forma/stat-tile';
import { ModuleGate } from '@/components/module-gate';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

const LOYALTY_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Активна',
  FROZEN: 'Заморожена',
  REACTIVATED: 'Восстановлена',
};

export default function ClientEngagementPage() {
  return (
    <ModuleGate module="engagement">
      <ClientEngagementPageInner />
    </ModuleGate>
  );
}

function ClientEngagementPageInner() {
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
      const res = (await api.checkIn(token)) as {
        xpAwarded: number;
        newBadges: string[];
        accepted?: boolean;
        message?: string;
      };
      setCheckInMsg(
        res.message ??
          (res.xpAwarded > 0
            ? `Check-in успешен! +${res.xpAwarded} XP`
            : 'Визит в зал засчитывается через 1С'),
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
      const res = (await api.dailyGoal(token)) as {
        awarded: boolean;
        xp?: number;
      };
      if (res.awarded) load();
    } finally {
      setDailyLoading(false);
    }
  };

  if (error) return <p className="text-rose-400">{error}</p>;

  if (!profile) {
    return (
      <div className="space-y-3">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (!profile.activated) {
    return (
      <div className="card space-y-4 text-center">
        <PageHeader title="Достижения" />
        <p className="text-zinc-400">
          Активируйте геймификацию в профиле, чтобы участвовать в лигах и
          получать бейджи.
        </p>
        <Link href="/client/profile" className="btn-primary inline-block">
          Перейти в профиль
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Достижения"
        subtitle="Лиги, бейджи и челленджи Forma"
      />

      {profile.decayWarning ? (
        <RatingDecayBanner
          warning={profile.decayWarning}
          onDailyGoal={handleDailyGoal}
          loading={dailyLoading}
        />
      ) : null}

      {profile.league ? <LeagueBoard league={profile.league} /> : null}

      {profile.loyalty ? (
        <div className="overflow-hidden rounded-[1.75rem] border border-forma-500/30 bg-gradient-to-br from-forma-500 via-forma-400 to-amber-500 p-5 text-ink shadow-forma-glow">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink/55">
            Лояльность клуба
          </p>
          <p className="mt-1 font-display text-2xl font-bold">
            {profile.loyalty.tierLabel}
          </p>
          <p className="mt-1 text-sm text-ink/70">
            {LOYALTY_STATUS_LABELS[profile.loyalty.status] ??
              profile.loyalty.status}{' '}
            · {profile.loyalty.continuityMonths} мес. непрерывности
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Streak" value={profile.visitStreak} accent />
        <StatTile label="Визитов" value={profile.totalVisits} />
        <StatTile label="XP" value={profile.points} />
      </div>

      {profile.rank ? (
        <div className="card text-center">
          <p className="text-sm text-zinc-500">Рейтинг в клубе</p>
          <p className="font-display text-4xl font-bold text-forma-400">
            #{profile.rank}
          </p>
        </div>
      ) : null}

      <div className="card space-y-3">
        <Button
          className="w-full"
          loading={checkInLoading}
          onClick={() => void handleCheckIn()}
        >
          Как засчитывается визит
        </Button>
        {checkInMsg ? (
          <p className="text-center text-sm text-forma-400">{checkInMsg}</p>
        ) : null}
      </div>

      <BadgeGrid profile={profile} />

      {challenges.length > 0 ? (
        <div className="card">
          <h3 className="mb-3 font-display font-semibold">Челленджи</h3>
          <ul className="space-y-3">
            {challenges.map((c) => (
              <li
                key={c.id}
                className="rounded-2xl border border-white/10 bg-ink-raised/70 p-3"
              >
                <p className="font-medium text-white">{c.title}</p>
                {c.description ? (
                  <p className="text-sm text-zinc-400">{c.description}</p>
                ) : null}
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-forma-500"
                    style={{
                      width: `${Math.min(100, (c.progress / c.targetVisits) * 100)}%`,
                    }}
                  />
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {c.progress} / {c.targetVisits} визитов
                  {c.completed ? ' · Завершён!' : ''}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Link href="/client/workouts" className="btn-secondary block text-center">
        Тренировки вне клуба
      </Link>

      <Link href="/client/referral" className="btn-secondary block text-center">
        Приведи друга
      </Link>
    </div>
  );
}
