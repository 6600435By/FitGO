'use client';

import { cn } from './cn';

export function MiniBars({
  values,
  className,
  height = 36,
  barClassName,
}: {
  values: number[];
  className?: string;
  height?: number;
  barClassName?: string;
}) {
  const max = Math.max(...values, 1);
  return (
    <div
      className={cn('flex items-end gap-0.5', className)}
      style={{ height }}
      aria-hidden
    >
      {values.map((v, i) => (
        <div
          key={i}
          className={cn(
            'min-w-[3px] flex-1 rounded-sm bg-forma-500/80',
            barClassName,
          )}
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}
