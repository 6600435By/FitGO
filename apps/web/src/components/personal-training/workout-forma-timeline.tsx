'use client';

import type { WorkoutSectionId, WorkoutSheet } from '@fitgo/shared-types';
import {
  WORKOUT_SECTION_LABELS,
  getSectionDurationMin,
  getSectionTimelineSummary,
  getSessionSectionIds,
} from '@fitgo/shared-types';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function WorkoutFormaTimeline({
  sheet,
  focusedId,
  onFocus,
  className,
}: {
  sheet: WorkoutSheet;
  focusedId: WorkoutSectionId | null;
  onFocus: (id: WorkoutSectionId) => void;
  className?: string;
}) {
  const sections = getSessionSectionIds(sheet);
  if (sections.length === 0) return null;

  return (
    <nav
      className={cn('space-y-1.5', className)}
      aria-label="Блоки тренировки"
    >
      {sections.map((id, index) => {
        const progress = sheet.blockProgress?.[id];
        const done = Boolean(progress?.summarySaved);
        const active = focusedId === id;
        const summary = getSectionTimelineSummary(sheet, id);
        const duration = getSectionDurationMin(sheet, id);

        return (
          <button
            key={id}
            type="button"
            onClick={() => onFocus(id)}
            className={cn(
              'flex w-full items-start gap-3 rounded-2xl border px-3 py-2.5 text-left transition',
              active
                ? 'border-forma-500/50 bg-forma-500/10'
                : done
                  ? 'border-emerald-500/20 bg-emerald-500/5'
                  : 'border-white/10 bg-ink-raised/60 hover:border-white/20',
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                done
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : active
                    ? 'bg-forma-500 text-ink'
                    : 'bg-white/5 text-zinc-500',
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span
                  className={cn(
                    'text-sm font-medium',
                    active ? 'text-white' : 'text-zinc-200',
                  )}
                >
                  {WORKOUT_SECTION_LABELS[id]}
                </span>
                {duration != null && duration > 0 ? (
                  <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">
                    {duration} мин
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 block truncate text-xs text-zinc-500">
                {summary}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

export function WorkoutFormaLayout({
  sheet,
  focusedId,
  onFocus,
  children,
}: {
  sheet: WorkoutSheet;
  focusedId: WorkoutSectionId | null;
  onFocus: (id: WorkoutSectionId) => void;
  children: ReactNode;
}) {
  const sections = getSessionSectionIds(sheet);
  if (sections.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-ink-raised/40 px-4 py-8 text-center">
        <p className="font-display text-base font-semibold text-white">
          Только заметка
        </p>
        <p className="mt-1 text-sm text-zinc-500">
          Блоков нет — ведите занятие по часам и зафиксируйте RPE в конце.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
      <WorkoutFormaTimeline
        sheet={sheet}
        focusedId={focusedId}
        onFocus={onFocus}
        className="lg:sticky lg:top-20 lg:w-56 lg:shrink-0"
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
