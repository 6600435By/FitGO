'use client';

import { cn } from '@/lib/utils';
import { FormaLogo } from './forma-logo';

const SIZE = {
  sm: 'h-7',
  md: 'h-9',
  lg: 'h-12',
} as const;

export function FormaWordmark({
  className,
  size = 'md',
  showBadge = true,
  fluid = false,
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showBadge?: boolean;
  /** Width follows the parent; height comes from the lockup ratio. */
  fluid?: boolean;
}) {
  const ratio = showBadge ? '714 / 100' : '474 / 100';

  if (fluid) {
    return (
      <span className={cn('block w-full', className)} style={{ aspectRatio: ratio }}>
        <FormaLogo showBadge={showBadge} className="h-full w-full" />
      </span>
    );
  }

  return (
    <span
      className={cn('inline-block max-w-full align-middle', SIZE[size], className)}
      style={{ aspectRatio: ratio }}
    >
      <FormaLogo showBadge={showBadge} className="h-full w-full" />
    </span>
  );
}
