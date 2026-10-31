'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { FormaWordmark } from './wordmark';
import { cn } from '@/lib/utils';

export function AuthShell({
  children,
  title,
  subtitle,
  footer,
  className,
  wide,
}: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  footer?: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <div className="relative flex min-h-dvh flex-col">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -left-24 top-0 h-72 w-72 rounded-full bg-forma-500/15 blur-3xl" />
        <div className="absolute -right-16 top-40 h-64 w-64 rounded-full bg-forma-500/10 blur-3xl" />
        <div className="absolute bottom-0 left-1/2 h-48 w-[120%] -translate-x-1/2 bg-gradient-to-t from-ink via-transparent to-transparent" />
      </div>

      <div
        className={cn(
          'relative z-10 mx-auto flex w-full flex-1 flex-col px-4 pb-8 pt-[max(1.5rem,env(safe-area-inset-top))]',
          wide ? 'max-w-lg' : 'max-w-md',
        )}
      >
        <Link href="/" className="mb-8 self-start touch-manipulation">
          <FormaWordmark size="md" />
        </Link>

        {(title || subtitle) && (
          <div className="mb-6">
            {title ? (
              <h1 className="font-display text-3xl font-bold tracking-tight text-white">
                {title}
              </h1>
            ) : null}
            {subtitle ? (
              <p className="mt-2 text-[15px] leading-relaxed text-zinc-400">
                {subtitle}
              </p>
            ) : null}
          </div>
        )}

        <div className={cn('flex flex-1 flex-col', className)}>{children}</div>

        {footer ? (
          <div className="mt-6 text-center text-sm text-zinc-500">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

export function AuthStepBar({
  step,
  total,
}: {
  step: number;
  total: number;
}) {
  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center justify-between text-xs text-zinc-500">
        <span>
          Шаг {step} из {total}
        </span>
        <span className="tabular-nums">{Math.round((step / total) * 100)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className="h-full rounded-full bg-forma-500 transition-all duration-500 ease-out"
          style={{ width: `${(step / total) * 100}%` }}
        />
      </div>
    </div>
  );
}

export function AuthError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
      {children}
    </p>
  );
}

export function AuthSuccess({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p className="rounded-2xl border border-forma-500/30 bg-forma-500/10 px-4 py-3 text-sm text-forma-300">
      {children}
    </p>
  );
}

export function FieldLabel({
  children,
  htmlFor,
}: {
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-2 block text-sm font-medium text-zinc-400"
    >
      {children}
    </label>
  );
}
