'use client';

import type { WorkoutBlockProgress, WorkoutSectionId } from '@fitgo/shared-types';
import { WORKOUT_SECTION_LABELS } from '@fitgo/shared-types';
import { Check, ChevronDown, ChevronUp, Pencil } from 'lucide-react';
import type { ReactNode } from 'react';
import type { WorkoutTipId } from './workout-trainer-tips';
import { SectionTitle } from './trainer-tip';

interface WorkoutSectionCardProps {
  sectionId: WorkoutSectionId;
  tipId?: WorkoutTipId;
  title?: string;
  headerExtra?: ReactNode;
  progress?: WorkoutBlockProgress;
  collapsed: boolean;
  summarizing: boolean;
  readOnly: boolean;
  isTrainer: boolean;
  onToggleCollapse: () => void;
  onComplete: () => void;
  onSaveSummary: () => void;
  onReopen: () => void;
  onSummaryNoteChange: (note: string) => void;
  children: ReactNode;
}

export function WorkoutSectionCard({
  sectionId,
  tipId,
  title,
  headerExtra,
  progress,
  collapsed,
  summarizing,
  readOnly,
  isTrainer,
  onToggleCollapse,
  onComplete,
  onSaveSummary,
  onReopen,
  onSummaryNoteChange,
  children,
}: WorkoutSectionCardProps) {
  const label = title ?? WORKOUT_SECTION_LABELS[sectionId];
  const summarySaved = Boolean(progress?.summarySaved);
  const completed = Boolean(progress?.completed);
  const summaryNote = progress?.summaryNote ?? '';
  const fullyCollapsed = summarySaved && collapsed;
  const showContent = !completed || (summarySaved && !collapsed);

  return (
    <div
      className={`rounded-2xl border bg-slate-900/40 transition-colors ${
        summarySaved
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : 'border-slate-700'
      }`}
    >
      <div className="flex items-center justify-between gap-2 p-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {summarySaved && (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
              <Check className="h-3.5 w-3.5" />
            </span>
          )}
          {tipId ? (
            <SectionTitle tipId={tipId}>{label.toUpperCase()}</SectionTitle>
          ) : (
            <h4 className="font-semibold">{label.toUpperCase()}</h4>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {!completed && headerExtra}
          {summarySaved && (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="rounded-lg p-1 text-slate-500 hover:bg-slate-800"
              aria-label={fullyCollapsed ? 'Развернуть блок' : 'Свернуть блок'}
            >
              {fullyCollapsed ? (
                <ChevronDown className="h-5 w-5" />
              ) : (
                <ChevronUp className="h-5 w-5" />
              )}
            </button>
          )}
        </div>
      </div>

      {summarizing && (
        <div className="border-t border-slate-700/50 px-4 pb-4 pt-2">
          <div className="space-y-3 rounded-xl bg-slate-800/40 p-3">
            <p className="text-xs font-medium uppercase text-slate-500">
              Итог по блоку
            </p>
            <textarea
              className="input min-h-[96px] w-full text-sm"
              placeholder="Самочувствие, техника, что улучшить…"
              value={summaryNote}
              onChange={(e) => onSummaryNoteChange(e.target.value)}
              autoFocus
            />
            {isTrainer && !readOnly && (
              <button
                type="button"
                onClick={onSaveSummary}
                className="btn-primary w-full text-sm"
              >
                Сохранить
              </button>
            )}
          </div>
        </div>
      )}

      {showContent && !summarizing && (
        <div className="border-t border-slate-700/50 px-4 pb-4 pt-2">
          {children}

          {summarySaved && (
            <div className="mt-4 space-y-3 rounded-xl bg-slate-800/40 p-3">
              <p className="text-xs font-medium uppercase text-slate-500">
                Итог по блоку
              </p>
              <p className="whitespace-pre-wrap text-sm text-slate-300">
                {summaryNote.trim() || '—'}
              </p>
              {isTrainer && !readOnly && (
                <button
                  type="button"
                  onClick={onReopen}
                  className="btn-secondary flex w-full items-center justify-center gap-1 text-sm"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Редактировать блок
                </button>
              )}
            </div>
          )}

          {!completed && isTrainer && !readOnly && (
            <button
              type="button"
              onClick={onComplete}
              className="btn-primary mt-4 w-full text-sm"
            >
              Завершить блок
            </button>
          )}
        </div>
      )}
    </div>
  );
}
