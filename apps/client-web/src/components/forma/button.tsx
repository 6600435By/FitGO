'use client';

import { motion, type HTMLMotionProps } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const variants: Record<Variant, string> = {
  primary:
    'bg-forma-500 text-ink hover:bg-forma-400 shadow-forma-glow/40 font-semibold',
  secondary:
    'border border-white/10 bg-ink-raised text-white hover:bg-white/[0.06] font-medium',
  ghost: 'text-zinc-400 hover:bg-white/[0.06] hover:text-white font-medium',
  danger:
    'bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25 font-semibold',
};

const sizes: Record<Size, string> = {
  sm: 'rounded-xl px-3 py-2 text-sm',
  md: 'rounded-2xl px-4 py-3.5 text-[15px]',
  lg: 'rounded-2xl px-5 py-4 text-base',
  icon: 'rounded-2xl p-3',
};

export function Button({
  children,
  className,
  variant = 'primary',
  size = 'md',
  loading,
  disabled,
  ...props
}: {
  children: ReactNode;
  className?: string;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
} & Omit<HTMLMotionProps<'button'>, 'children'>) {
  return (
    <motion.button
      whileTap={disabled || loading ? undefined : { scale: 0.98 }}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 transition touch-manipulation disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
      type="button"
      {...props}
    >
      {loading ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : null}
      {children}
    </motion.button>
  );
}
