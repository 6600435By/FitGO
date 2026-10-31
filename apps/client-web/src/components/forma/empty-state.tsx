'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Button } from './button';

export function EmptyState({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'card flex flex-col items-center px-6 py-10 text-center',
        className,
      )}
    >
      {icon ? (
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-forma-500/15 text-forma-400">
          {icon}
        </div>
      ) : null}
      <p className="font-display text-lg font-semibold text-white">{title}</p>
      {description ? (
        <p className="mt-2 max-w-xs text-sm text-zinc-400">{description}</p>
      ) : null}
      {actionLabel && onAction ? (
        <Button className="mt-5" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
