'use client';

import type { GamificationProfile } from '@fitgo/shared-types';
import { cn } from '@/lib/utils';

export function BadgeGrid({ profile }: { profile: GamificationProfile }) {
  return (
    <div className="card">
      <h3 className="mb-3 font-display font-semibold text-white">Бейджи</h3>
      {profile.nextBadge ? (
        <div className="mb-4 rounded-2xl border border-forma-500/25 bg-forma-500/10 p-3">
          <p className="text-sm text-zinc-400">Следующий бейдж</p>
          <p className="font-display font-semibold text-forma-400">
            {profile.nextBadge.name}
          </p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-forma-500 transition-all"
              style={{ width: `${profile.nextBadge.progress}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {profile.nextBadge.current} / {profile.nextBadge.target}
          </p>
        </div>
      ) : null}

      {profile.badges.length === 0 && !profile.lockedBadges?.length ? (
        <p className="text-sm text-zinc-400">
          Пока нет бейджей — продолжайте тренироваться!
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {profile.badges.map((badge) => (
            <div
              key={badge.id}
              className="rounded-2xl border border-forma-500/35 bg-gradient-to-br from-forma-500/20 to-transparent p-3 shadow-forma-glow"
            >
              <p className="font-display font-semibold text-forma-400">
                {badge.name}
              </p>
              <p className="mt-1 text-xs text-zinc-400">{badge.description}</p>
            </div>
          ))}
          {profile.lockedBadges?.slice(0, 6).map((badge) => (
            <div
              key={badge.id}
              className={cn(
                'rounded-2xl border border-white/5 bg-ink-raised/60 p-3 opacity-45 grayscale',
              )}
            >
              <p className="font-medium text-zinc-400">{badge.name}</p>
              <p className="mt-1 text-xs text-zinc-600">{badge.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
