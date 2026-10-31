'use client';

import { cn } from '@/lib/utils';

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

const gradients = [
  'from-forma-500/80 to-amber-700/80',
  'from-zinc-500 to-zinc-700',
  'from-emerald-500/70 to-teal-800/80',
  'from-violet-500/70 to-indigo-800/80',
  'from-rose-500/70 to-orange-800/80',
];

function hashHue(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % gradients.length;
}

export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  const sizes = {
    sm: 'h-8 w-8 text-[10px]',
    md: 'h-10 w-10 text-xs',
    lg: 'h-14 w-14 text-sm',
    xl: 'h-20 w-20 text-lg',
  };
  return (
    <div
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br font-display font-bold text-white',
        sizes[size],
        gradients[hashHue(name)],
        className,
      )}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}
