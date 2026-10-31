'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function StatTile({
  label,
  value,
  hint,
  icon,
  className,
  accent,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  className?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-white/[0.08] p-3',
        accent
          ? 'bg-forma-500/10 border-forma-500/25'
          : 'bg-ink-raised/80',
        className,
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <p className="stat-label">{label}</p>
        {icon ? <span className="text-forma-400">{icon}</span> : null}
      </div>
      <p className="stat-value text-xl">{value}</p>
      {hint ? <p className="mt-1 text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}
