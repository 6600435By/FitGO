'use client';

import type { StrengthExerciseRow, StrengthSetEntry, WorkoutSheet } from '@fitgo/shared-types';
import { ResponsiveSheet } from '@fitgo/forma-ui';
import { Check, ChevronLeft, ChevronRight, List } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

function planWeight(set: StrengthSetEntry): string {
  return (set.weight ?? set.load ?? '').trim();
}

function planReps(set: StrengthSetEntry): string {
  return (set.reps ?? '').trim();
}

function isSetDone(set: StrengthSetEntry): boolean {
  return Boolean(
    (set.actualWeight ?? '').trim() ||
      (set.actualReps ?? '').trim() ||
      (set.actualLoad ?? '').trim(),
  );
}

function SetRow({
  index,
  set,
  onChange,
  onToggleDone,
}: {
  index: number;
  set: StrengthSetEntry;
  onChange: (patch: Partial<StrengthSetEntry>) => void;
  onToggleDone: () => void;
}) {
  const done = isSetDone(set);
  const weightValue = set.actualWeight ?? (done ? planWeight(set) : planWeight(set));
  const repsValue = set.actualReps ?? (done ? planReps(set) : planReps(set));

  return (
    <div
      className={cn(
        'grid grid-cols-[2rem_1fr_1fr_2.75rem] items-center gap-2 rounded-2xl border px-2 py-2',
        done
          ? 'border-forma-500/30 bg-forma-500/10'
          : 'border-white/10 bg-ink-raised/60',
      )}
    >
      <span className="text-center text-xs font-medium text-zinc-500">
        {index + 1}
      </span>
      <label className="block">
        <span className="sr-only">Вес</span>
        <input
          type="text"
          inputMode="decimal"
          placeholder={planWeight(set) || 'кг'}
          value={weightValue}
          onChange={(e) => onChange({ actualWeight: e.target.value })}
          className="w-full rounded-xl border border-white/10 bg-ink px-2 py-1.5 text-center text-sm tabular-nums text-white placeholder:text-zinc-600"
        />
      </label>
      <label className="block">
        <span className="sr-only">Повторы</span>
        <input
          type="text"
          inputMode="numeric"
          placeholder={planReps(set) || 'повт'}
          value={repsValue}
          onChange={(e) => onChange({ actualReps: e.target.value })}
          className="w-full rounded-xl border border-white/10 bg-ink px-2 py-1.5 text-center text-sm tabular-nums text-white placeholder:text-zinc-600"
        />
      </label>
      <button
        type="button"
        onClick={onToggleDone}
        aria-label={done ? 'Снять отметку' : 'Подход выполнен'}
        className={cn(
          'flex h-10 w-10 items-center justify-center rounded-xl',
          done
            ? 'bg-forma-500 text-ink'
            : 'border border-white/15 text-zinc-400',
        )}
      >
        <Check className="h-5 w-5" />
      </button>
    </div>
  );
}

export function LiveExerciseCard({
  sheet,
  onChangeSheet,
  onSetCompleted,
}: {
  sheet: WorkoutSheet;
  onChangeSheet: (next: WorkoutSheet) => void;
  /** Called after marking a set done; restSec from the set (or undefined). */
  onSetCompleted?: (restSec: number | undefined) => void;
}) {
  const exercises = useMemo(
    () =>
      (sheet.strengthExercises ?? []).filter(
        (ex) => ex.name?.trim() || ex.sets?.length,
      ),
    [sheet.strengthExercises],
  );
  const [exerciseIndex, setExerciseIndex] = useState(0);
  const [listOpen, setListOpen] = useState(false);

  if (exercises.length === 0) return null;

  const safeIndex = Math.min(exerciseIndex, exercises.length - 1);
  const exercise = exercises[safeIndex]!;

  const updateSet = (
    setIndex: number,
    patch: Partial<StrengthSetEntry>,
  ) => {
    const nextExercises = sheet.strengthExercises.map((ex, ei) => {
      if (ei !== safeIndex) return ex;
      return {
        ...ex,
        sets: ex.sets.map((s, si) => (si === setIndex ? { ...s, ...patch } : s)),
      };
    });
    onChangeSheet({ ...sheet, strengthExercises: nextExercises });
  };

  const toggleDone = (setIndex: number, set: StrengthSetEntry) => {
    if (isSetDone(set)) {
      updateSet(setIndex, {
        actualWeight: undefined,
        actualReps: undefined,
        actualLoad: undefined,
      });
      return;
    }
    const weight = (set.actualWeight ?? planWeight(set)).trim();
    const reps = (set.actualReps ?? planReps(set)).trim();
    updateSet(setIndex, {
      actualWeight: weight || undefined,
      actualReps: reps || undefined,
      actualLoad:
        weight && reps
          ? `${weight}×${reps}`
          : weight || reps || set.load || undefined,
    });
    onSetCompleted?.(set.restSec);
  };

  const doneCount = exercise.sets.filter(isSetDone).length;

  return (
    <div className="w-full max-w-md mx-auto space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          disabled={safeIndex <= 0}
          onClick={() => setExerciseIndex((i) => Math.max(0, i - 1))}
          className="rounded-full border border-white/10 p-2 text-zinc-300 disabled:opacity-30"
          aria-label="Предыдущее упражнение"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">
            Упражнение {safeIndex + 1}/{exercises.length}
          </p>
          <p className="truncate font-display text-lg font-semibold text-white">
            {exercise.name?.trim() || `Упражнение ${safeIndex + 1}`}
          </p>
          <p className="text-xs text-zinc-500">
            {doneCount}/{exercise.sets.length} подходов
          </p>
        </div>
        <button
          type="button"
          disabled={safeIndex >= exercises.length - 1}
          onClick={() =>
            setExerciseIndex((i) => Math.min(exercises.length - 1, i + 1))
          }
          className="rounded-full border border-white/10 p-2 text-zinc-300 disabled:opacity-30"
          aria-label="Следующее упражнение"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div className="grid grid-cols-[2rem_1fr_1fr_2.75rem] gap-2 px-2 text-[10px] uppercase tracking-wide text-zinc-500">
        <span className="text-center">#</span>
        <span className="text-center">Вес</span>
        <span className="text-center">Повт</span>
        <span className="text-center">✓</span>
      </div>

      <div className="space-y-2">
        {exercise.sets.map((set, i) => (
          <SetRow
            key={i}
            index={i}
            set={set}
            onChange={(patch) => updateSet(i, patch)}
            onToggleDone={() => toggleDone(i, set)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() => setListOpen(true)}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-2xl border border-white/10 px-3 py-2 text-sm text-zinc-300"
      >
        <List className="h-4 w-4" />
        Все упражнения
      </button>

      <ResponsiveSheet
        open={listOpen}
        onOpenChange={setListOpen}
        title="Упражнения"
        desktop="side"
      >
        <ul className="space-y-1">
          {exercises.map((ex, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => {
                  setExerciseIndex(i);
                  setListOpen(false);
                }}
                className={cn(
                  'flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-left text-sm',
                  i === safeIndex
                    ? 'bg-forma-500/15 text-forma-300'
                    : 'text-zinc-200 hover:bg-white/5',
                )}
              >
                <span className="truncate">
                  {ex.name?.trim() || `Упражнение ${i + 1}`}
                </span>
                <span className="shrink-0 text-xs text-zinc-500">
                  {ex.sets.filter(isSetDone).length}/{ex.sets.length}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </ResponsiveSheet>
    </div>
  );
}

export function hasLiveStrengthExercises(sheet: WorkoutSheet): boolean {
  return (sheet.strengthExercises ?? []).some(
    (ex: StrengthExerciseRow) => ex.name?.trim() || ex.sets?.length,
  );
}
