'use client';

import type { ReactNode } from 'react';
import { cn } from './cn';

export function BentoCard({
  children,
  className,
  title,
  action,
  span,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  action?: ReactNode;
  /** desktop grid span hint: 1 | 2 | 3 */
  span?: 1 | 2 | 3;
}) {
  return (
    <section
      className={cn(
        'rounded-3xl border border-white/[0.08] bg-ink-elevated/90 p-4 shadow-forma-card backdrop-blur-sm',
        span === 2 && 'desktop:col-span-2',
        span === 3 && 'desktop:col-span-3',
        className,
      )}
    >
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title ? (
            <h3 className="font-display text-sm font-semibold text-white">
              {title}
            </h3>
          ) : (
            <span />
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
