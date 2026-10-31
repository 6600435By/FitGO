'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

function partsUntil(target: Date, now: Date) {
  const ms = Math.max(0, target.getTime() - now.getTime());
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  return { days, hours, minutes, seconds, ms };
}

export function Countdown({
  to,
  className,
  compact,
}: {
  to: string | Date;
  className?: string;
  compact?: boolean;
}) {
  const target = typeof to === 'string' ? new Date(to) : to;
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const { days, hours, minutes, seconds, ms } = partsUntil(target, now);
  if (ms <= 0) {
    return (
      <span className={cn('font-display text-sm font-semibold text-forma-400', className)}>
        Сейчас
      </span>
    );
  }

  if (compact) {
    if (days > 0) {
      return (
        <span className={cn('tabular-nums text-sm text-zinc-300', className)}>
          через {days} дн. {hours} ч
        </span>
      );
    }
    return (
      <span className={cn('font-display tabular-nums text-sm text-forma-400', className)}>
        {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:
        {String(seconds).padStart(2, '0')}
      </span>
    );
  }

  return (
    <div className={cn('flex gap-2', className)}>
      {(
        [
          days > 0 ? { label: 'дн', value: days } : null,
          { label: 'ч', value: hours },
          { label: 'м', value: minutes },
          days === 0 ? { label: 'с', value: seconds } : null,
        ] as Array<{ label: string; value: number } | null>
      )
        .filter(Boolean)
        .map((unit) => (
          <div
            key={unit!.label}
            className="flex min-w-[3rem] flex-col items-center rounded-xl bg-ink-raised px-2 py-1.5"
          >
            <span className="font-display text-lg font-bold tabular-nums text-white">
              {String(unit!.value).padStart(2, '0')}
            </span>
            <span className="text-[10px] uppercase text-zinc-500">{unit!.label}</span>
          </div>
        ))}
    </div>
  );
}
