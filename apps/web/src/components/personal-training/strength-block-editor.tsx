'use client';

import type {
  StrengthExerciseRow,
  StrengthSetEntry,
  StrengthSetFieldId,
} from '@fitgo/shared-types';
import {
  STRENGTH_MAX_EXERCISES,
  STRENGTH_MAX_SETS,
  STRENGTH_SET_FIELD_IDS,
  STRENGTH_SET_FIELD_LABELS,
  createEmptyStrengthExercise,
  createEmptyStrengthSet,
  syncStrengthSetLoad,
} from '@fitgo/shared-types';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { TrainerTip } from './trainer-tip';

interface StrengthBlockEditorProps {
  exercises: StrengthExerciseRow[];
  activeFields: StrengthSetFieldId[];
  readOnly: boolean;
  onChange: (exercises: StrengthExerciseRow[]) => void;
  onFieldsChange: (fields: StrengthSetFieldId[]) => void;
}

function formatSetDisplay(set: StrengthSetEntry): string {
  const w = set.weight?.trim();
  const r = set.reps?.trim();
  if (w && r) return `${w}×${r}`;
  return set.load?.trim() || '—';
}

export function StrengthBlockEditor({
  exercises,
  activeFields,
  readOnly,
  onChange,
  onFieldsChange,
}: StrengthBlockEditorProps) {
  const updateExercise = (
    rowIndex: number,
    patch: Partial<StrengthExerciseRow>,
  ) => {
    onChange(
      exercises.map((row, i) => (i === rowIndex ? { ...row, ...patch } : row)),
    );
  };

  const updateSet = (
    rowIndex: number,
    setIndex: number,
    patch: Partial<StrengthSetEntry>,
  ) => {
    const row = exercises[rowIndex];
    const sets = row.sets.map((set, i) =>
      i === setIndex ? syncStrengthSetLoad({ ...set, ...patch }) : set,
    );
    updateExercise(rowIndex, { sets });
  };

  const addSet = (rowIndex: number) => {
    const row = exercises[rowIndex];
    if (row.sets.length >= STRENGTH_MAX_SETS) return;
    updateExercise(rowIndex, { sets: [...row.sets, createEmptyStrengthSet()] });
  };

  const removeSet = (rowIndex: number, setIndex: number) => {
    const row = exercises[rowIndex];
    if (row.sets.length <= 1) return;
    updateExercise(rowIndex, {
      sets: row.sets.filter((_, i) => i !== setIndex),
    });
  };

  const addExercise = () => {
    if (exercises.length >= STRENGTH_MAX_EXERCISES) return;
    onChange([...exercises, createEmptyStrengthExercise()]);
  };

  const removeExercise = (rowIndex: number) => {
    if (exercises.length <= 1) return;
    onChange(exercises.filter((_, i) => i !== rowIndex));
  };

  const toggleField = (field: StrengthSetFieldId) => {
    if (readOnly) return;
    const enabled = activeFields.includes(field);
    if (enabled && activeFields.length <= 1) return;
    if (enabled) {
      onFieldsChange(activeFields.filter((f) => f !== field));
    } else {
      onFieldsChange([...activeFields, field]);
    }
  };

  const showWeightReps =
    activeFields.includes('weight') || activeFields.includes('reps');

  const visibleExercises = readOnly
    ? exercises.filter(
        (row) =>
          row.name ||
          row.sets.some(
            (s) => s.load || s.weight || s.reps || s.rpe || s.restSec || s.tempo,
          ),
      )
    : exercises;

  if (readOnly && visibleExercises.length === 0) {
    return <p className="text-sm text-slate-500">—</p>;
  }

  return (
    <div className="space-y-3">
      {!readOnly && (
        <div>
          <p className="mb-2 flex items-center gap-1 text-xs text-slate-500">
            Поля подхода
            <TrainerTip tipId="strength-rpe" />
          </p>
          <div className="flex flex-wrap gap-1.5">
            {STRENGTH_SET_FIELD_IDS.map((field) => {
              const enabled = activeFields.includes(field);
              return (
                <button
                  key={field}
                  type="button"
                  onClick={() => toggleField(field)}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    enabled
                      ? 'bg-fitgo-500 text-white'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {enabled ? '✓ ' : ''}
                  {STRENGTH_SET_FIELD_LABELS[field]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {readOnly && (
        <p className="flex items-center gap-1 text-xs text-slate-500">
          {activeFields.map((f) => STRENGTH_SET_FIELD_LABELS[f]).join(' · ')}
        </p>
      )}

      {visibleExercises.map((row, rowIndex) => (
        <div
          key={rowIndex}
          className="rounded-xl border border-slate-700/80 bg-slate-800/30 p-3"
        >
          <div className="mb-2 flex items-start gap-2">
            {readOnly ? (
              <p className="flex-1 font-medium text-slate-100">
                {row.name || '—'}
              </p>
            ) : (
              <input
                className="input flex-1 text-sm"
                placeholder="Упражнение"
                value={row.name}
                onChange={(e) => updateExercise(rowIndex, { name: e.target.value })}
              />
            )}
            {!readOnly && exercises.length > 1 && (
              <button
                type="button"
                onClick={() => removeExercise(rowIndex)}
                className="shrink-0 rounded-lg p-2 text-slate-500 hover:bg-red-500/10 hover:text-red-400"
                aria-label="Удалить упражнение"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="space-y-2">
            {row.sets.map((set, setIndex) => (
              <div
                key={setIndex}
                className="rounded-lg bg-slate-900/50 p-2"
              >
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-500">
                    Подход {setIndex + 1}
                  </span>
                  {!readOnly && row.sets.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSet(rowIndex, setIndex)}
                      className="rounded p-1 text-slate-600 hover:text-red-400"
                      aria-label="Удалить подход"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {readOnly ? (
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    {showWeightReps && (
                      <>
                        <span className="text-slate-400">Нагрузка</span>
                        <span className="text-slate-200">{formatSetDisplay(set)}</span>
                      </>
                    )}
                    {activeFields.includes('rpe') && (
                      <>
                        <span className="text-slate-400">RPE</span>
                        <span className="text-slate-200">{set.rpe ?? '—'}</span>
                      </>
                    )}
                    {activeFields.includes('restSec') && (
                      <>
                        <span className="text-slate-400">Отдых</span>
                        <span className="text-slate-200">
                          {set.restSec ? `${set.restSec} с` : '—'}
                        </span>
                      </>
                    )}
                    {activeFields.includes('tempo') && (
                      <>
                        <span className="text-slate-400">Темп</span>
                        <span className="text-slate-200">{set.tempo || '—'}</span>
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    {showWeightReps && (
                      <div className="mb-2 grid grid-cols-2 gap-2">
                        {activeFields.includes('weight') && (
                          <div>
                            <label className="mb-0.5 block text-[10px] uppercase text-slate-600">
                              кг
                            </label>
                            <input
                              className="input w-full px-2 py-1.5 text-sm"
                              inputMode="decimal"
                              placeholder="0"
                              value={set.weight ?? ''}
                              onChange={(e) =>
                                updateSet(rowIndex, setIndex, {
                                  weight: e.target.value,
                                })
                              }
                            />
                          </div>
                        )}
                        {activeFields.includes('reps') && (
                          <div>
                            <label className="mb-0.5 block text-[10px] uppercase text-slate-600">
                              повт
                            </label>
                            <input
                              className="input w-full px-2 py-1.5 text-sm"
                              inputMode="numeric"
                              placeholder="0"
                              value={set.reps ?? ''}
                              onChange={(e) =>
                                updateSet(rowIndex, setIndex, { reps: e.target.value })
                              }
                            />
                          </div>
                        )}
                      </div>
                    )}
                    {(activeFields.includes('rpe') ||
                      activeFields.includes('restSec') ||
                      activeFields.includes('tempo')) && (
                      <div
                        className={`grid gap-1.5 ${
                          [
                            activeFields.includes('rpe'),
                            activeFields.includes('restSec'),
                            activeFields.includes('tempo'),
                          ].filter(Boolean).length === 3
                            ? 'grid-cols-3'
                            : 'grid-cols-2'
                        }`}
                      >
                        {activeFields.includes('rpe') && (
                          <div>
                            <label className="mb-0.5 block text-[10px] uppercase text-slate-600">
                              RPE
                            </label>
                            <input
                              className="input w-full px-1.5 py-1.5 text-sm text-center"
                              type="number"
                              min={1}
                              max={10}
                              placeholder="—"
                              value={set.rpe ?? ''}
                              onChange={(e) =>
                                updateSet(rowIndex, setIndex, {
                                  rpe: e.target.value
                                    ? Number(e.target.value)
                                    : undefined,
                                })
                              }
                            />
                          </div>
                        )}
                        {activeFields.includes('restSec') && (
                          <div>
                            <label className="mb-0.5 block text-[10px] uppercase text-slate-600">
                              отдых
                            </label>
                            <input
                              className="input w-full px-1.5 py-1.5 text-sm text-center"
                              type="number"
                              min={0}
                              placeholder="с"
                              value={set.restSec ?? ''}
                              onChange={(e) =>
                                updateSet(rowIndex, setIndex, {
                                  restSec: e.target.value
                                    ? Number(e.target.value)
                                    : undefined,
                                })
                              }
                            />
                          </div>
                        )}
                        {activeFields.includes('tempo') && (
                          <div>
                            <label className="mb-0.5 block text-[10px] uppercase text-slate-600">
                              темп
                            </label>
                            <input
                              className="input w-full px-1.5 py-1.5 text-sm text-center"
                              placeholder="3-1-2"
                              value={set.tempo ?? ''}
                              onChange={(e) =>
                                updateSet(rowIndex, setIndex, { tempo: e.target.value })
                              }
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          {!readOnly && row.sets.length < STRENGTH_MAX_SETS && (
            <button
              type="button"
              onClick={() => addSet(rowIndex)}
              className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-slate-600 py-2 text-xs text-slate-400 hover:border-fitgo-500/50 hover:text-fitgo-400"
            >
              <Plus className="h-3.5 w-3.5" />
              Подход
            </button>
          )}
        </div>
      ))}

      {!readOnly && exercises.length < STRENGTH_MAX_EXERCISES && (
        <button
          type="button"
          onClick={addExercise}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-600 py-3 text-sm text-slate-400 hover:border-fitgo-500/50 hover:text-fitgo-400"
        >
          <Plus className="h-4 w-4" />
          Новое упражнение
        </button>
      )}
    </div>
  );
}
