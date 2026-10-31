'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Chip({
  children,
  active,
  onClick,
  className,
  count,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
  count?: number;
}) {
  const Comp = onClick ? 'button' : 'span';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition touch-manipulation',
        active
          ? 'border-forma-500/60 bg-forma-500 text-ink'
          : 'border-white/10 bg-ink-raised text-zinc-300 hover:border-white/20 hover:text-white',
        className,
      )}
    >
      {children}
      {typeof count === 'number' && count > 0 ? (
        <span
          className={cn(
            'rounded-full px-1.5 text-[11px] tabular-nums',
            active ? 'bg-ink/15 text-ink' : 'bg-white/10 text-zinc-400',
          )}
        >
          {count}
        </span>
      ) : null}
    </Comp>
  );
}
