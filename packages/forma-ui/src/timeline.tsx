'use client';

import type { ReactNode } from 'react';
import { cn } from './cn';

export type TimelineItemTone = 'pt' | 'gp' | 'muted' | 'accent';

const toneDot: Record<TimelineItemTone, string> = {
  pt: 'bg-forma-500',
  gp: 'bg-cyan-400',
  muted: 'bg-zinc-500',
  accent: 'bg-violet-400',
};

export function Timeline({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <ol className={cn('relative space-y-0', className)}>{children}</ol>
  );
}

export function TimelineItem({
  time,
  title,
  meta,
  tone = 'muted',
  action,
  className,
}: {
  time: string;
  title: ReactNode;
  meta?: ReactNode;
  tone?: TimelineItemTone;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <li className={cn('relative flex gap-3 pb-4 last:pb-0', className)}>
      <div className="flex w-12 shrink-0 flex-col items-end pt-0.5">
        <span className="font-display text-xs font-semibold tabular-nums text-zinc-400">
          {time}
        </span>
      </div>
      <div className="relative flex flex-col items-center">
        <span
          className={cn(
            'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-ink',
            toneDot[tone],
          )}
        />
        <span className="mt-1 w-px flex-1 bg-white/[0.08]" aria-hidden />
      </div>
      <div className="min-w-0 flex-1 rounded-2xl border border-white/[0.06] bg-ink-raised/60 px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{title}</p>
            {meta ? (
              <p className="mt-0.5 truncate text-xs text-zinc-500">{meta}</p>
            ) : null}
          </div>
          {action}
        </div>
      </div>
    </li>
  );
}
