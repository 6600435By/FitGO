'use client';

import type { LucideIcon } from 'lucide-react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

type Props = {
  open: boolean;
  onToggle: () => void;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  badge?: ReactNode;
  children?: ReactNode;
};

export function PayrollFold({
  open,
  onToggle,
  title,
  subtitle,
  icon: Icon,
  badge,
  children,
}: Props) {
  return (
    <section
      className={
        open
          ? 'overflow-hidden rounded-2xl border border-fitgo-500/35 bg-slate-900 shadow-lg shadow-black/20'
          : 'overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900 shadow-lg shadow-black/20'
      }
    >
      <button
        type="button"
        className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-white/[0.02] md:px-4"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-fitgo-500/15 text-fitgo-400">
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <p className="truncate text-[11px] text-slate-500">{subtitle}</p>
        </div>
        {!open && badge ? (
          <span className="hidden max-w-[12rem] truncate rounded-full border border-slate-700/80 bg-slate-950 px-2.5 py-1 text-[11px] text-slate-400 sm:inline">
            {badge}
          </span>
        ) : null}
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-950 text-slate-400">
          {open ? (
            <ChevronDown className="h-4 w-4" aria-hidden />
          ) : (
            <ChevronRight className="h-4 w-4" aria-hidden />
          )}
        </span>
      </button>

      {open && children != null ? (
        <div className="space-y-3 border-t border-slate-800 bg-slate-950/50 px-3 pb-3 pt-3 md:px-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}
