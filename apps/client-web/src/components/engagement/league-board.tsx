'use client';

import type { LeagueGroupView } from '@fitgo/shared-types';

const TIER_COLORS: Record<string, string> = {
  BRONZE: 'text-amber-600',
  SILVER: 'text-slate-300',
  GOLD: 'text-yellow-400',
  SAPPHIRE: 'text-blue-400',
  RUBY: 'text-red-400',
  EMERALD: 'text-emerald-400',
  DIAMOND: 'text-cyan-300',
  OBSIDIAN: 'text-purple-300',
};

export function LeagueBoard({ league }: { league: LeagueGroupView }) {
  if (league.members.length === 0) {
    return (
      <div className="card text-center">
        <p className={`text-lg font-bold ${TIER_COLORS[league.tier] ?? 'text-fitgo-400'}`}>
          {league.tierLabel}
        </p>
        <p className="mt-2 text-sm text-slate-400">
          Группа лиги формируется по понедельникам. Ваш XP: {league.weeklyXp}
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-400">Ваша лига</p>
          <p className={`text-xl font-bold ${TIER_COLORS[league.tier] ?? 'text-fitgo-400'}`}>
            {league.tierLabel}
          </p>
        </div>
        {league.myRank && (
          <div className="text-right">
            <p className="text-sm text-slate-400">Позиция</p>
            <p className="text-2xl font-bold text-fitgo-400">#{league.myRank}</p>
          </div>
        )}
      </div>

      {league.weekEnd && (
        <p className="mb-3 text-xs text-slate-500">
          Итоги недели: {new Date(league.weekEnd).toLocaleDateString('ru-RU')}
        </p>
      )}

      <ul className="space-y-1">
        {league.members.map((m) => (
          <li
            key={m.userId}
            className={`flex items-center justify-between rounded-xl px-3 py-2 text-sm ${
              m.isMe
                ? 'bg-fitgo-500/20 ring-1 ring-fitgo-500/40'
                : m.zone === 'promotion'
                  ? 'bg-emerald-500/10'
                  : m.zone === 'relegation'
                    ? 'bg-red-500/10'
                    : 'bg-slate-800/50'
            }`}
          >
            <span>
              <span className="text-slate-400">#{m.rank}</span> {m.name}
              {m.isMe && <span className="ml-1 text-fitgo-400">(вы)</span>}
            </span>
            <span className="font-medium text-fitgo-400">{m.weeklyXp} XP</span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex justify-between text-xs text-slate-500">
        <span>↑ Топ-{league.promotionZone} — повышение</span>
        <span>↓ Нижние {league.relegationZone} — понижение</span>
      </div>
    </div>
  );
}
