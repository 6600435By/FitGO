'use client';

import type { ReactNode } from 'react';
import { cn } from './cn';
import { Button } from './button';

export function InsightCard({
  title,
  body,
  actionLabel,
  onAction,
  onDismiss,
  icon,
  className,
}: {
  title: string;
  body?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <article
      className={cn(
        'rounded-3xl border border-forma-500/25 bg-gradient-to-br from-forma-500/10 via-ink-elevated to-ink-elevated p-4 shadow-forma-card',
        className,
      )}
    >
      <div className="flex gap-3">
        {icon ? (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-forma-500/15 text-forma-400">
            {icon}
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-sm font-semibold text-white">
            {title}
          </h3>
          {body ? (
            <div className="mt-1 text-sm leading-relaxed text-zinc-400">
              {body}
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {actionLabel && onAction ? (
              <Button size="sm" onClick={onAction}>
                {actionLabel}
              </Button>
            ) : null}
            {onDismiss ? (
              <Button size="sm" variant="ghost" onClick={onDismiss}>
                Позже
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
