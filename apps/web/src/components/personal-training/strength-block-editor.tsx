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
  createStrengthSetFromPrevious,
  syncStrengthSetLoad,
} from '@fitgo/shared-types';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface StrengthBlockEditorProps {
  exercises: StrengthExerciseRow[];
  activeFields: StrengthSetFieldId[];
  readOnly: boolean;
  onChange: (exercises: StrengthExerciseRow[]) => void;
  onFieldsChange: (fields: StrengthSetFieldId[]) => void;
  /** Forma: чипы полей скрыты (меню снаружи), компактная строка подхода */
  forma?: boolean;
  /** Forma: внешнее меню полей открыто */
  fieldsOpen?: boolean;
  onFieldsOpenChange?: (open: boolean) => void;
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
  forma = false,
  fieldsOpen,
  onFieldsOpenChange,
}: StrengthBlockEditorProps) {
  const [localFieldsOpen] = useState(false);
  const [expandedSet, setExpandedSet] = useState<string | null>(null);
  const showFieldsPanel = fieldsOpen ?? localFieldsOpen;

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
    const previous = row.sets[row.sets.length - 1];
    const nextSet = forma
      ? createStrengthSetFromPrevious(previous)
      : createEmptyStrengthSet();
    updateExercise(rowIndex, { sets: [...row.sets, nextSet] });
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

  // На строке не больше трёх значений; остальное — по нажатию на номер подхода
  const rowFields: StrengthSetFieldId[] = [];
  for (const f of ['weight', 'reps', 'rpe', 'restSec', 'tempo'] as StrengthSetFieldId[]) {
    if (activeFields.includes(f) && rowFields.length < 3) rowFields.push(f);
  }
  const detailFields = activeFields.filter((f) => !rowFields.includes(f));

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
    return (
      <p className={forma ? 'text-sm text-zinc-500' : 'text-sm text-slate-500'}>
        —
      </p>
    );
  }

  const fieldsPanel = !readOnly && showFieldsPanel ? (
    <div
      className={cn(
        'mb-3 rounded-2xl border p-3',
        forma ? 'border-white/10 bg-ink/40' : 'border-slate-700 bg-slate-800/40',
      )}
    >
      <p
        className={cn(
          'mb-2 text-xs',
          forma ? 'text-zinc-500' : 'text-slate-500',
        )}
      >
        Поля подхода
      </p>
      <div className="flex flex-wrap gap-1.5">
        {STRENGTH_SET_FIELD_IDS.map((field) => {
          const enabled = activeFields.includes(field);
          return (
            <button
              key={field}
              type="button"
              onClick={() => toggleField(field)}
              className={cn(
                'rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                enabled
                  ? forma
                    ? 'bg-forma-500 text-ink'
                    : 'bg-fitgo-500 text-white'
                  : forma
                    ? 'bg-white/5 text-zinc-400 hover:bg-white/10'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700',
              )}
            >
              {enabled ? '✓ ' : ''}
              {STRENGTH_SET_FIELD_LABELS[field]}
            </button>
          );
        })}
      </div>
    </div>
  ) : null;

  if (forma) {
    return (
      <div className="space-y-3">
        {fieldsPanel}

        {visibleExercises.map((row, rowIndex) => (
          <div
            key={rowIndex}
            className="rounded-2xl border border-white/10 bg-ink/30 p-3"
          >
            <div className="mb-3 flex items-start gap-2">
              {readOnly ? (
                <p className="flex-1 font-medium text-zinc-100">
                  {row.name || '—'}
                </p>
              ) : (
                <input
                  className="input flex-1 text-sm"
                  placeholder="Упражнение"
                  value={row.name}
                  onChange={(e) =>
                    updateExercise(rowIndex, { name: e.target.value })
                  }
                />
              )}
              {!readOnly && exercises.length > 1 ? (
                <button
                  type="button"
                  onClick={() => removeExercise(rowIndex)}
                  className="shrink-0 rounded-xl p-2 text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
                  aria-label="Удалить упражнение"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </div>

            <div className="space-y-2">
              {row.sets.map((set, setIndex) => {
                const key = `${rowIndex}:${setIndex}`;
                const expanded = expandedSet === key;
                const showDetails =
                  detailFields.length > 0 && (expanded || readOnly);

                return (
                  <div key={setIndex} className="space-y-1.5">
                    <div className="grid grid-cols-[2rem_1fr] items-center gap-2">
                      <button
                        type="button"
                        disabled={readOnly || detailFields.length === 0}
                        onClick={() =>
                          setExpandedSet(expanded ? null : key)
                        }
                        className={cn(
                          'flex h-9 w-8 items-center justify-center rounded-xl text-xs font-medium',
                          expanded
                            ? 'bg-forma-500/20 text-forma-400'
                            : 'bg-white/5 text-zinc-500',
                          !readOnly && detailFields.length > 0
                            ? 'hover:bg-white/10'
                            : '',
                        )}
                        aria-label={`Подход ${setIndex + 1}`}
                      >
                        {setIndex + 1}
                      </button>
                      <div className="flex min-w-0 items-center gap-2">
                        {readOnly ? (
                          <p className="flex-1 text-sm text-zinc-200">
                            {formatSetDisplay(set)}
                            {set.rpe != null ? ` · RPE ${set.rpe}` : ''}
                          </p>
                        ) : (
                          <div
                            className={cn(
                              'grid flex-1 gap-2',
                              rowFields.length >= 3
                                ? 'grid-cols-3'
                                : rowFields.length === 2
                                  ? 'grid-cols-2'
                                  : 'grid-cols-1',
                            )}
                          >
                            {rowFields.includes('weight') ? (
                              <input
                                className="input w-full px-2 py-1.5 text-center text-sm tabular-nums"
                                inputMode="decimal"
                                placeholder="кг"
                                value={set.weight ?? ''}
                                onChange={(e) =>
                                  updateSet(rowIndex, setIndex, {
                                    weight: e.target.value,
                                  })
                                }
                              />
                            ) : null}
                            {rowFields.includes('reps') ? (
                              <input
                                className="input w-full px-2 py-1.5 text-center text-sm tabular-nums"
                                inputMode="numeric"
                                placeholder="повт"
                                value={set.reps ?? ''}
                                onChange={(e) =>
                                  updateSet(rowIndex, setIndex, {
                                    reps: e.target.value,
                                  })
                                }
                              />
                            ) : null}
                            {rowFields.includes('rpe') ? (
                              <input
                                className="input w-full px-2 py-1.5 text-center text-sm tabular-nums"
                                type="number"
                                min={1}
                                max={10}
                                placeholder="RPE"
                                value={set.rpe ?? ''}
                                onChange={(e) =>
                                  updateSet(rowIndex, setIndex, {
                                    rpe: e.target.value
                                      ? Number(e.target.value)
                                      : undefined,
                                  })
                                }
                              />
                            ) : null}
                            {rowFields.includes('restSec') ? (
                              <input
                                className="input w-full px-2 py-1.5 text-center text-sm tabular-nums"
                                type="number"
                                min={0}
                                placeholder="отдых"
                                value={set.restSec ?? ''}
                                onChange={(e) =>
                                  updateSet(rowIndex, setIndex, {
                                    restSec: e.target.value
                                      ? Number(e.target.value)
                                      : undefined,
                                  })
                                }
                              />
                            ) : null}
                            {rowFields.includes('tempo') ? (
                              <input
                                className="input w-full px-2 py-1.5 text-center text-sm"
                                placeholder="темп"
                                value={set.tempo ?? ''}
                                onChange={(e) =>
                                  updateSet(rowIndex, setIndex, {
                                    tempo: e.target.value,
                                  })
                                }
                              />
                            ) : null}
                          </div>
                        )}
                        {!readOnly && row.sets.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => removeSet(rowIndex, setIndex)}
                            className="shrink-0 rounded-lg p-1.5 text-zinc-600 hover:text-red-400"
                            aria-label="Удалить подход"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {showDetails && !readOnly ? (
                      <div className="ml-10 grid grid-cols-2 gap-2">
                        {detailFields.includes('rpe') ? (
                          <input
                            className="input w-full px-2 py-1.5 text-center text-sm"
                            type="number"
                            min={1}
                            max={10}
                            placeholder="RPE"
                            value={set.rpe ?? ''}
                            onChange={(e) =>
                              updateSet(rowIndex, setIndex, {
                                rpe: e.target.value
                                  ? Number(e.target.value)
                                  : undefined,
                              })
                            }
                          />
                        ) : null}
                        {detailFields.includes('restSec') ? (
                          <input
                            className="input w-full px-2 py-1.5 text-center text-sm"
                            type="number"
                            min={0}
                            placeholder="отдых, сек"
                            value={set.restSec ?? ''}
                            onChange={(e) =>
                              updateSet(rowIndex, setIndex, {
                                restSec: e.target.value
                                  ? Number(e.target.value)
                                  : undefined,
                              })
                            }
                          />
                        ) : null}
                        {detailFields.includes('tempo') ? (
                          <input
                            className="input w-full px-2 py-1.5 text-center text-sm"
                            placeholder="темп 3-1-2-0"
                            value={set.tempo ?? ''}
                            onChange={(e) =>
                              updateSet(rowIndex, setIndex, {
                                tempo: e.target.value,
                              })
                            }
                          />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {!readOnly && row.sets.length < STRENGTH_MAX_SETS ? (
              <button
                type="button"
                onClick={() => addSet(rowIndex)}
                className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl border border-dashed border-white/15 py-2 text-xs text-zinc-400 hover:border-forma-500/40 hover:text-forma-400"
              >
                <Plus className="h-3.5 w-3.5" />
                Подход
              </button>
            ) : null}
          </div>
        ))}

        {!readOnly && exercises.length < STRENGTH_MAX_EXERCISES ? (
          <button
            type="button"
            onClick={addExercise}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 py-3 text-sm text-zinc-400 hover:border-forma-500/40 hover:text-forma-400"
          >
            <Plus className="h-4 w-4" />
            Новое упражнение
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!readOnly && (
        <div>
          <p className="mb-2 text-xs text-slate-500">Поля подхода</p>
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
                              placeholder="3-1-2-0"
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
