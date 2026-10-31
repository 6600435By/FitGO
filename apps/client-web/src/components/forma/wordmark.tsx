'use client';

import { cn } from '@/lib/utils';

export function FormaWordmark({
  className,
  size = 'md',
  showBadge = true,
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  showBadge?: boolean;
}) {
  const title =
    size === 'lg'
      ? 'text-3xl tracking-[0.14em]'
      : size === 'sm'
        ? 'text-base tracking-[0.12em]'
        : 'text-xl tracking-[0.14em]';
  const badge =
    size === 'lg'
      ? 'px-2 py-1.5 text-[9px] leading-tight'
      : size === 'sm'
        ? 'px-1.5 py-1 text-[7px] leading-tight'
        : 'px-1.5 py-1 text-[8px] leading-tight';

  return (
    <div className={cn('inline-flex items-center gap-2', className)}>
      <span
        className={cn(
          'font-display font-extrabold uppercase text-white',
          title,
        )}
      >
        Форма
      </span>
      {showBadge ? (
        <span
          className={cn(
            'shrink-0 rounded-sm bg-forma-500 font-display font-bold uppercase text-ink',
            badge,
          )}
        >
          Фитнес
          <br />
          студия
        </span>
      ) : null}
    </div>
  );
}
