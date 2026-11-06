'use client';

import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import { cn } from './cn';

/**
 * Lightweight horizontal swipe reveal (iOS-style). Actions sit under the row.
 * Respects reduced motion by disabling drag.
 */
export function SwipeRow({
  children,
  actions,
  className,
  threshold = 72,
}: {
  children: ReactNode;
  actions: ReactNode;
  className?: string;
  threshold?: number;
}) {
  const startX = useRef(0);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);

  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const onPointerDown = (e: React.PointerEvent) => {
    if (reduced) return;
    startX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (reduced || !startX.current) return;
    const dx = e.clientX - startX.current;
    if (open) {
      setOffset(Math.min(0, Math.max(-threshold * 1.2, -threshold + dx)));
    } else if (dx < 0) {
      setOffset(Math.max(-threshold * 1.2, dx));
    }
  };

  const onPointerUp = () => {
    if (reduced) return;
    if (offset < -threshold / 2) {
      setOpen(true);
      setOffset(-threshold);
    } else {
      setOpen(false);
      setOffset(0);
    }
    startX.current = 0;
  };

  return (
    <div className={cn('relative overflow-hidden rounded-2xl', className)}>
      <div className="absolute inset-y-0 right-0 flex items-stretch">
        {actions}
      </div>
      <div
        className="relative bg-ink-elevated transition-transform"
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {children}
      </div>
    </div>
  );
}
