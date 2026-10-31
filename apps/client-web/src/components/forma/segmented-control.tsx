'use client';

import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  size = 'md',
  layoutId = 'forma-segment',
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: 'sm' | 'md';
  layoutId?: string;
}) {
  return (
    <div
      className={cn(
        'relative flex gap-1 rounded-2xl border border-white/[0.08] bg-ink-raised/80 p-1',
        className,
      )}
      role="tablist"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              'relative z-10 flex-1 touch-manipulation font-medium transition disabled:opacity-40',
              size === 'sm' ? 'rounded-xl px-2 py-2 text-xs' : 'rounded-xl px-3 py-2.5 text-sm',
              active ? 'text-ink' : 'text-zinc-400 hover:text-white',
            )}
          >
            {active ? (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 -z-10 rounded-xl bg-forma-500 shadow-forma-glow"
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              />
            ) : null}
            <span className="relative">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
