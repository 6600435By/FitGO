'use client';

import { useEffect, useId, useRef, useState } from 'react';

function bandDotClass(band: string) {
  if (band === 'GREEN') return 'bg-emerald-400';
  if (band === 'RED') return 'bg-red-400';
  return 'bg-amber-300';
}

type Props = {
  trustBand: string;
  trustHints?: string[];
  className?: string;
};

/**
 * Compact Trust cell: colour dot + hint (hover / focus / tap).
 * Does not render GREEN / AMBER / RED labels.
 */
export function TrustBandDot({ trustBand, trustHints, className }: Props) {
  const tip =
    trustHints?.filter(Boolean).join(' · ') ||
    (trustBand === 'GREEN' ? 'В расчёте' : 'Проверьте контроль');
  const tipId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('touchstart', onDoc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('touchstart', onDoc);
    };
  }, [open]);

  return (
    <span
      ref={rootRef}
      className={`relative inline-flex items-center ${className ?? ''}`}
    >
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
        title={tip}
        aria-label={tip}
        aria-describedby={open ? tipId : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onBlur={() => {
          // Keep tip if focus moves into the tip itself (none); close shortly.
          window.setTimeout(() => setOpen(false), 120);
        }}
      >
        <i
          className={`block h-2.5 w-2.5 rounded-full ${bandDotClass(trustBand)}`}
          aria-hidden
        />
      </button>
      {open ? (
        <span
          id={tipId}
          role="tooltip"
          className="absolute left-1/2 top-full z-20 mt-1 w-max max-w-[14rem] -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-left text-[11px] leading-snug text-slate-200 shadow-lg"
        >
          {tip}
        </span>
      ) : null}
    </span>
  );
}
