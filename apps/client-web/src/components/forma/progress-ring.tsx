'use client';

import { cn } from '@/lib/utils';

export function ProgressRing({
  value,
  max = 100,
  size = 72,
  stroke = 6,
  className,
  children,
  accent = 'forma',
}: {
  value: number;
  max?: number;
  size?: number;
  stroke?: number;
  className?: string;
  children?: React.ReactNode;
  accent?: 'forma' | 'success' | 'danger' | 'ink';
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));
  const offset = c * (1 - pct);
  const strokeColor =
    accent === 'success'
      ? '#34d399'
      : accent === 'danger'
        ? '#f87171'
        : accent === 'ink'
          ? '#0B0B0C'
          : '#ffd000';
  const trackColor =
    accent === 'ink' ? 'rgba(11,11,12,0.18)' : 'rgba(255,255,255,0.08)';

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={trackColor}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={strokeColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      {children ? (
        <div className="absolute inset-0 flex items-center justify-center">
          {children}
        </div>
      ) : null}
    </div>
  );
}
