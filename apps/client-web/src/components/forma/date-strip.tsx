'use client';

import { useEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';

export interface DateStripDay {
  key: string;
  /** Optional marker count under the day number */
  count?: number;
  /** Yellow dot — client has a booking that day */
  highlight?: boolean;
  disabled?: boolean;
}

const weekdayFmt = new Intl.DateTimeFormat('ru-RU', { weekday: 'short' });
const dayFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric' });

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function DateStrip({
  days,
  value,
  onChange,
  className,
}: {
  days: DateStripDay[];
  value: string | null;
  onChange: (key: string) => void;
  className?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const today = useMemo(() => todayKey(), []);

  useEffect(() => {
    if (!value) return;
    const el = scrollerRef.current?.querySelector<HTMLElement>(
      `[data-day="${value}"]`,
    );
    el?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [value]);

  return (
    <div
      ref={scrollerRef}
      className={cn(
        '-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-none',
        className,
      )}
      style={{ scrollbarWidth: 'none' }}
    >
      {days.map((day) => {
        const d = new Date(`${day.key}T12:00:00`);
        const active = day.key === value;
        const isToday = day.key === today;
        return (
          <button
            key={day.key}
            type="button"
            data-day={day.key}
            disabled={day.disabled}
            onClick={() => onChange(day.key)}
            className={cn(
              'relative flex w-[3.35rem] shrink-0 flex-col items-center rounded-2xl border px-1 py-2.5 text-center transition touch-manipulation disabled:opacity-35',
              active
                ? 'border-forma-500 bg-forma-500 text-ink shadow-forma-glow'
                : 'border-white/10 bg-ink-elevated text-zinc-300 hover:border-white/20',
            )}
          >
            <span
              className={cn(
                'text-[10px] font-medium uppercase tracking-wide',
                active ? 'text-ink/70' : 'text-zinc-500',
              )}
            >
              {isToday ? 'Сег' : weekdayFmt.format(d).replace('.', '')}
            </span>
            <span className="font-display text-lg font-bold leading-tight tabular-nums">
              {dayFmt.format(d)}
            </span>
            <span className="mt-0.5 flex h-3 items-center justify-center gap-0.5">
              {day.highlight ? (
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    active ? 'bg-ink' : 'bg-forma-500',
                  )}
                />
              ) : typeof day.count === 'number' && day.count > 0 ? (
                <span
                  className={cn(
                    'text-[10px] tabular-nums',
                    active ? 'text-ink/70' : 'text-zinc-500',
                  )}
                >
                  {day.count}
                </span>
              ) : (
                <span className="h-1.5 w-1.5" />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
