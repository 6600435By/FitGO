'use client';

import { cn } from '@/lib/utils';

export function Skeleton({
  className,
}: {
  className?: string;
}) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-2xl bg-gradient-to-r from-ink-raised via-white/[0.06] to-ink-raised bg-[length:200%_100%] animate-shimmer',
        className,
      )}
    />
  );
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card space-y-3">
      <Skeleton className="h-5 w-2/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-3', i === lines - 1 ? 'w-1/2' : 'w-full')} />
      ))}
    </div>
  );
}
