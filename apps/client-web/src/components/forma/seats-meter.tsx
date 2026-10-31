'use client';

import { cn } from '@/lib/utils';

export function SeatsMeter({
  booked,
  capacity,
  waitlistCount,
  className,
}: {
  booked: number;
  capacity: number;
  waitlistCount?: number;
  className?: string;
}) {
  const free = Math.max(0, capacity - booked);
  const pct = capacity > 0 ? Math.min(100, (booked / capacity) * 100) : 0;
  const tight = free > 0 && free <= 3;
  const full = free === 0;

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span
          className={cn(
            'font-medium',
            full
              ? 'text-zinc-400'
              : tight
                ? 'animate-pulse-soft text-amber-300'
                : 'text-zinc-400',
          )}
        >
          {full
            ? waitlistCount && waitlistCount > 0
              ? `Мест нет · в очереди ${waitlistCount}`
              : 'Мест нет'
            : tight
              ? `Осталось ${free}`
              : `Свободно ${free}`}
        </span>
        <span className="tabular-nums text-zinc-500">
          {booked}/{capacity}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            full
              ? 'bg-zinc-500'
              : tight
                ? 'bg-amber-400'
                : 'bg-forma-500',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
