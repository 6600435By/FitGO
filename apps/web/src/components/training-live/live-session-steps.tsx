'use client';

import type { WorkoutSectionId, WorkoutSheet } from '@fitgo/shared-types';
import {
  WORKOUT_SECTION_LABELS,
  getSectionTimelineSummary,
  getSessionSectionIds,
} from '@fitgo/shared-types';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export function LiveSessionSteps({
  sheet,
  activeId,
  onSelect,
}: {
  sheet: WorkoutSheet;
  activeId: WorkoutSectionId | null;
  onSelect: (id: WorkoutSectionId) => void;
}) {
  const sections = getSessionSectionIds(sheet);
  if (sections.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {sections.map((id, index) => {
        const done = Boolean(sheet.blockProgress?.[id]?.summarySaved);
        const active = activeId === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            className={cn(
              'flex min-w-[7.5rem] shrink-0 flex-col rounded-2xl border px-3 py-2 text-left transition',
              active
                ? 'border-forma-500/50 bg-forma-500/10'
                : done
                  ? 'border-emerald-500/20 bg-emerald-500/5'
                  : 'border-white/10 bg-ink-raised/50',
            )}
          >
            <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-zinc-500">
              {done ? (
                <Check className="h-3 w-3 text-emerald-400" />
              ) : (
                <span className="tabular-nums">{index + 1}</span>
              )}
              {WORKOUT_SECTION_LABELS[id]}
            </span>
            <span className="mt-0.5 truncate text-xs text-zinc-400">
              {getSectionTimelineSummary(sheet, id)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
