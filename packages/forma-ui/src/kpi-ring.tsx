'use client';

import { cn } from './cn';
import { ProgressRing } from './progress-ring';

export function KpiRing({
  value,
  max = 100,
  label,
  sublabel,
  className,
  size = 72,
}: {
  value: number;
  max?: number;
  label: string;
  sublabel?: string;
  className?: string;
  size?: number;
}) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <ProgressRing value={value} max={max} size={size} stroke={6}>
        <span className="font-display text-sm font-bold tabular-nums text-white">
          {value}
        </span>
      </ProgressRing>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-white">{label}</p>
        {sublabel ? (
          <p className="mt-0.5 truncate text-xs text-zinc-500">{sublabel}</p>
        ) : null}
      </div>
    </div>
  );
}
