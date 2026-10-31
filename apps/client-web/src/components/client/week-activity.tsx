'use client';

import type { Visit } from '@fitgo/shared-types';
import { cn } from '@/lib/utils';

function toKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function visitKey(date: string) {
  return date.includes('T') ? date.slice(0, 10) : date.slice(0, 10);
}

const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' });

export function WeekActivity({ visits }: { visits: Visit[] }) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const visitDays = new Set(visits.map((v) => visitKey(v.date)));

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - i));
    const key = toKey(d);
    return {
      key,
      label: weekday.format(d).replace('.', ''),
      active: visitDays.has(key),
      isToday: key === toKey(today),
    };
  });

  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].active) streak += 1;
    else if (!days[i].isToday) break;
  }

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <p className="font-display text-base font-semibold text-white">
          Активность
        </p>
        {streak > 0 ? (
          <span className="rounded-full bg-forma-500/15 px-2.5 py-0.5 text-xs font-semibold text-forma-400">
            Серия {streak} дн.
          </span>
        ) : (
          <span className="text-xs text-zinc-500">За 7 дней</span>
        )}
      </div>
      <div className="flex justify-between gap-1">
        {days.map((day) => (
          <div key={day.key} className="flex flex-1 flex-col items-center gap-2">
            <span
              className={cn(
                'text-[10px] font-medium uppercase',
                day.isToday ? 'text-forma-400' : 'text-zinc-500',
              )}
            >
              {day.label}
            </span>
            <span
              className={cn(
                'h-3 w-3 rounded-full transition',
                day.active
                  ? 'bg-forma-500 shadow-forma-glow'
                  : day.isToday
                    ? 'border border-forma-500/50 bg-transparent'
                    : 'bg-white/10',
              )}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
