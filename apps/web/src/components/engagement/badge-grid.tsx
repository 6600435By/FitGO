'use client';

import type { GamificationProfile } from '@fitgo/shared-types';

export function BadgeGrid({ profile }: { profile: GamificationProfile }) {
  const earnedSlugs = new Set(profile.badges.map((b) => b.slug ?? b.id));

  return (
    <div className="card">
      <h3 className="mb-3 font-semibold">Бейджи</h3>
      {profile.nextBadge && (
        <div className="mb-4 rounded-xl bg-slate-800/50 p-3">
          <p className="text-sm text-slate-400">Следующий бейдж</p>
          <p className="font-medium text-fitgo-400">{profile.nextBadge.name}</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-700">
            <div
              className="h-full rounded-full bg-fitgo-500 transition-all"
              style={{ width: `${profile.nextBadge.progress}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {profile.nextBadge.current} / {profile.nextBadge.target}
          </p>
        </div>
      )}

      {profile.badges.length === 0 && !profile.lockedBadges?.length ? (
        <p className="text-sm text-slate-400">Пока нет бейджей — продолжайте тренироваться!</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {profile.badges.map((badge) => (
            <div
              key={badge.id}
              className="rounded-xl bg-fitgo-500/15 p-3 ring-1 ring-fitgo-500/30"
            >
              <p className="font-medium text-fitgo-400">{badge.name}</p>
              <p className="text-xs text-slate-400">{badge.description}</p>
            </div>
          ))}
          {profile.lockedBadges?.slice(0, 6).map((badge) => (
            <div
              key={badge.id}
              className="rounded-xl bg-slate-800/50 p-3 opacity-50"
            >
              <p className="font-medium text-slate-400">{badge.name}</p>
              <p className="text-xs text-slate-500">{badge.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
