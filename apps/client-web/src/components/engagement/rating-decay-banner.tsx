'use client';

import type { DecayWarning } from '@fitgo/shared-types';
import { Button } from '@/components/forma/button';
import { cn } from '@/lib/utils';

export function RatingDecayBanner({
  warning,
  onDailyGoal,
  loading,
}: {
  warning: DecayWarning;
  onDailyGoal?: () => void;
  loading?: boolean;
}) {
  const colors = {
    info: 'border-white/10 bg-ink-raised/70',
    warning: 'border-amber-500/40 bg-amber-500/10',
    critical: 'border-rose-500/40 bg-rose-500/10',
  };

  return (
    <div className={cn('card border', colors[warning.urgency])}>
      <p className="font-display font-semibold text-white">{warning.message}</p>
      <p className="mt-1 text-sm text-zinc-400">
        День {warning.dayOfMonth} · до конца месяца {warning.daysLeftInMonth} дн.
      </p>
      {onDailyGoal ? (
        <Button
          className="mt-3 w-full"
          loading={loading}
          onClick={onDailyGoal}
        >
          Выполнить ежедневную цель (+5 XP)
        </Button>
      ) : null}
    </div>
  );
}
