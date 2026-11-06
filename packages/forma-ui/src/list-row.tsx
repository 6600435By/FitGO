'use client';

import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from './cn';

export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  onClick,
  href,
  className,
  chevron,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  href?: string;
  className?: string;
  chevron?: boolean;
}) {
  const body = (
    <>
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium text-white">{title}</div>
        {subtitle ? (
          <div className="mt-0.5 truncate text-sm text-zinc-400">{subtitle}</div>
        ) : null}
      </div>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
      {chevron ? (
        <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />
      ) : null}
    </>
  );

  const classes = cn(
    'flex w-full items-center gap-3 px-4 py-3 text-left touch-manipulation transition hover:bg-white/[0.04]',
    className,
  );

  if (href) {
    return (
      <a href={href} className={classes}>
        {body}
      </a>
    );
  }

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {body}
      </button>
    );
  }

  return <div className={classes}>{body}</div>;
}

export function ListGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-3xl border border-white/[0.08] bg-ink-elevated/90 divide-y divide-white/[0.06]',
        className,
      )}
    >
      {children}
    </div>
  );
}
