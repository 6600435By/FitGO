'use client';

import type { CircuitHistoryPoint } from '@fitgo/shared-types';

interface CircuitDynamicsProps {
  history: CircuitHistoryPoint[];
  current?: CircuitHistoryPoint | null;
}

export function CircuitDynamics({ history, current }: CircuitDynamicsProps) {
  const points = [...history, ...(current ? [current] : [])].slice(-8);
  if (points.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Динамика появится после нескольких круговых тренировок с заполненным журналом.
      </p>
    );
  }

  const maxRpe = Math.max(
    10,
    ...points.map((p) => p.avgRpe ?? 0),
  );
  const maxHr = Math.max(
    120,
    ...points.map((p) => p.maxHr ?? p.avgHr ?? 0),
  );

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs uppercase text-slate-500">Средний RPE по сессиям</p>
        <div className="flex items-end gap-2 h-24">
          {points.map((point) => {
            const value = point.avgRpe ?? 0;
            const height = value ? `${(value / maxRpe) * 100}%` : '4px';
            return (
              <div key={point.bookingId} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-20 w-full items-end justify-center">
                  <div
                    className="w-full max-w-[32px] rounded-t bg-fitgo-500/80"
                    style={{ height }}
                    title={value ? `RPE ${value}` : 'нет данных'}
                  />
                </div>
                <span className="text-[10px] text-slate-500">
                  {new Date(point.date).toLocaleDateString('ru-RU', {
                    day: 'numeric',
                    month: 'short',
                  })}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs uppercase text-slate-500">Пульс (макс / ср.)</p>
        <div className="flex items-end gap-2 h-24">
          {points.map((point) => {
            const value = point.maxHr ?? point.avgHr ?? 0;
            const height = value ? `${(value / maxHr) * 100}%` : '4px';
            return (
              <div key={`hr-${point.bookingId}`} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-20 w-full items-end justify-center">
                  <div
                    className="w-full max-w-[32px] rounded-t bg-rose-500/70"
                    style={{ height }}
                    title={value ? `${value} уд/мин` : 'нет данных'}
                  />
                </div>
                <span className="text-[10px] text-slate-500">
                  {point.roundsLogged}/{point.roundsPlanned} кр.
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-xs">
          <thead>
            <tr className="border-b border-slate-700 text-left text-slate-500">
              <th className="py-2 pr-2">Дата</th>
              <th className="py-2 pr-2">Круги</th>
              <th className="py-2 pr-2">Станции</th>
              <th className="py-2 pr-2">RPE</th>
              <th className="py-2 pr-2">ЧСС</th>
              <th className="py-2">Работа</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={`row-${point.bookingId}`} className="border-b border-slate-800/60">
                <td className="py-2 pr-2">
                  {new Date(point.date).toLocaleDateString('ru-RU')}
                </td>
                <td className="py-2 pr-2">
                  {point.roundsLogged}/{point.roundsPlanned}
                </td>
                <td className="py-2 pr-2">{point.stationsCount}</td>
                <td className="py-2 pr-2">{point.avgRpe ?? '—'}</td>
                <td className="py-2 pr-2">
                  {point.avgHr ? `${point.avgHr}` : '—'}
                  {point.maxHr ? ` / ${point.maxHr}` : ''}
                </td>
                <td className="py-2">
                  {point.totalWorkSec
                    ? `${Math.round(point.totalWorkSec / 60)} мин`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
