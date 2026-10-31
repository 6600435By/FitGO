'use client';

import type { LeagueGroupView } from '@fitgo/shared-types';
import { cn } from '@/lib/utils';

const TIER_COLORS: Record<string, string> = {
  BRONZE: 'text-amber-500',
  SILVER: 'text-zinc-300',
  GOLD: 'text-forma-400',
  SAPPHIRE: 'text-sky-400',
  RUBY: 'text-rose-400',
  EMERALD: 'text-emerald-400',
  DIAMOND: 'text-cyan-300',
  OBSIDIAN: 'text-violet-300',
};

export function LeagueBoard({ league }: { league: LeagueGroupView }) {
  if (league.members.length === 0) {
    return (
      <div className="card text-center">
        <p
          className={cn(
            'font-display text-2xl font-bold',
            TIER_COLORS[league.tier] ?? 'text-forma-400',
          )}
        >
          {league.tierLabel}
        </p>
        <p className="mt-2 text-sm text-zinc-400">
          Группа лиги формируется по понедельникам. Ваш XP: {league.weeklyXp}
        </p>
      </div>
    );
  }

  const podium = league.members.slice(0, 3);

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-zinc-500">Ваша лига</p>
          <p
            className={cn(
              'font-display text-2xl font-bold',
              TIER_COLORS[league.tier] ?? 'text-forma-400',
            )}
          >
            {league.tierLabel}
          </p>
        </div>
        {league.myRank ? (
          <div className="text-right">
            <p className="text-sm text-zinc-500">Позиция</p>
            <p className="font-display text-3xl font-bold text-forma-400">
              #{league.myRank}
            </p>
          </div>
        ) : null}
      </div>

      {podium.length >= 2 ? (
        <div className="flex items-end justify-center gap-2 pb-1">
          {[podium[1], podium[0], podium[2]].filter(Boolean).map((m, idx) => {
            const place = m === podium[0] ? 1 : m === podium[1] ? 2 : 3;
            const heights = { 1: 'h-24', 2: 'h-16', 3: 'h-12' } as const;
            return (
              <div
                key={m.userId}
                className="flex w-20 flex-col items-center gap-1"
              >
                <p className="truncate text-center text-xs font-medium text-white">
                  {m.isMe ? 'Вы' : m.name.split(' ')[0]}
                </p>
                <p className="text-[10px] text-forma-400">{m.weeklyXp} XP</p>
                <div
                  className={cn(
                    'flex w-full items-start justify-center rounded-t-2xl pt-2 font-display text-lg font-bold',
                    heights[place as 1 | 2 | 3],
                    place === 1
                      ? 'bg-forma-500 text-ink'
                      : place === 2
                        ? 'bg-zinc-500/40 text-white'
                        : 'bg-amber-700/40 text-amber-100',
                  )}
                >
                  {place}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {league.weekEnd ? (
        <p className="text-xs text-zinc-500">
          Итоги недели:{' '}
          {new Date(league.weekEnd).toLocaleDateString('ru-RU')}
        </p>
      ) : null}

      <ul className="space-y-1">
        {league.members.map((m) => (
          <li
            key={m.userId}
            className={cn(
              'flex items-center justify-between rounded-2xl px-3 py-2 text-sm',
              m.isMe
                ? 'bg-forma-500/15 ring-1 ring-forma-500/40'
                : m.zone === 'promotion'
                  ? 'bg-emerald-500/10'
                  : m.zone === 'relegation'
                    ? 'bg-rose-500/10'
                    : 'bg-ink-raised/70',
            )}
          >
            <span>
              <span className="text-zinc-500">#{m.rank}</span> {m.name}
              {m.isMe ? (
                <span className="ml-1 text-forma-400">(вы)</span>
              ) : null}
            </span>
            <span className="font-display font-semibold tabular-nums text-forma-400">
              {m.weeklyXp} XP
            </span>
          </li>
        ))}
      </ul>

      <div className="flex justify-between text-xs text-zinc-500">
        <span>↑ Топ-{league.promotionZone} — повышение</span>
        <span>↓ Нижние {league.relegationZone} — понижение</span>
      </div>
    </div>
  );
}
