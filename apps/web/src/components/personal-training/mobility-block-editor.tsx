'use client';

import type { MobilityExerciseRow, MobilityFieldId } from '@fitgo/shared-types';
import {
  MOBILITY_EXERCISE_TYPES,
  MOBILITY_FIELD_IDS,
  MOBILITY_FIELD_LABELS,
  MOBILITY_FIELD_PLACEHOLDERS,
  MOBILITY_FOCUS_AREAS,
  MOBILITY_EQUIPMENT_OPTIONS,
  MOBILITY_MAX_ROWS,
  MOBILITY_SIDE_OPTIONS,
  createEmptyMobilityExercise,
} from '@fitgo/shared-types';
import { Plus, Trash2 } from 'lucide-react';
import { TrainerTip } from './trainer-tip';

interface MobilityBlockEditorProps {
  exercises: MobilityExerciseRow[];
  activeFields: MobilityFieldId[];
  readOnly: boolean;
  onChange: (exercises: MobilityExerciseRow[]) => void;
  onFieldsChange: (fields: MobilityFieldId[]) => void;
}

export function MobilityBlockEditor({
  exercises,
  activeFields,
  readOnly,
  onChange,
  onFieldsChange,
}: MobilityBlockEditorProps) {
  const updateRow = (rowIndex: number, patch: Partial<MobilityExerciseRow>) => {
    onChange(
      exercises.map((row, i) => (i === rowIndex ? { ...row, ...patch } : row)),
    );
  };

  const addRow = () => {
    if (exercises.length >= MOBILITY_MAX_ROWS) return;
    onChange([...exercises, createEmptyMobilityExercise()]);
  };

  const removeRow = (rowIndex: number) => {
    if (exercises.length <= 1) return;
    onChange(exercises.filter((_, i) => i !== rowIndex));
  };

  const toggleField = (field: MobilityFieldId) => {
    if (readOnly) return;
    const enabled = activeFields.includes(field);
    if (enabled && activeFields.length <= 1) return;
    if (enabled) {
      onFieldsChange(activeFields.filter((f) => f !== field));
    } else {
      onFieldsChange([...activeFields, field]);
    }
  };

  const visibleRows = readOnly
    ? exercises.filter(
        (row) =>
          row.name?.trim() ||
          activeFields.some((field) => Boolean(row[field]?.trim())),
      )
    : exercises;

  if (readOnly && visibleRows.length === 0) {
    return <p className="text-sm text-slate-500">—</p>;
  }

  return (
    <div className="space-y-3">
      {!readOnly && (
        <div>
          <p className="mb-2 flex items-center gap-1 text-xs text-slate-500">
            Поля для записи
            <TrainerTip tipId="mobility" />
          </p>
          <div className="flex flex-wrap gap-1.5">
            {MOBILITY_FIELD_IDS.map((field) => {
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
                  {MOBILITY_FIELD_LABELS[field]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {readOnly && (
        <p className="text-xs text-slate-500">
          {activeFields.map((f) => MOBILITY_FIELD_LABELS[f]).join(' · ')}
        </p>
      )}

      <div className="space-y-2">
        {visibleRows.map((row, rowIndex) => (
          <div
            key={rowIndex}
            className="rounded-xl border border-slate-700/80 bg-slate-800/30 p-3"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-500">
                Упражнение {rowIndex + 1}
              </span>
              {!readOnly && exercises.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(rowIndex)}
                  className="rounded p-1 text-slate-600 hover:text-red-400"
                  aria-label="Удалить упражнение"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="mb-2">
              <label className="mb-0.5 block text-[10px] uppercase text-slate-600">
                Название
              </label>
              {readOnly ? (
                <p className="text-sm font-medium text-slate-100">
                  {row.name?.trim() || '—'}
                </p>
              ) : (
                <input
                  className="input w-full text-sm"
                  placeholder="Кошка-верблюд, планка на локте…"
                  value={row.name}
                  onChange={(e) => updateRow(rowIndex, { name: e.target.value })}
                />
              )}
            </div>

            {!readOnly && activeFields.includes('exerciseType') && (
              <div className="mb-2 flex flex-wrap gap-1">
                {MOBILITY_EXERCISE_TYPES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => updateRow(rowIndex, { exerciseType: t.label })}
                    className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                      row.exerciseType === t.label
                        ? 'bg-fitgo-500/30 text-fitgo-300 ring-1 ring-fitgo-500/50'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            {!readOnly && activeFields.includes('focusArea') && (
              <div className="mb-2 flex flex-wrap gap-1">
                {MOBILITY_FOCUS_AREAS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => updateRow(rowIndex, { focusArea: a.label })}
                    className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                      row.focusArea === a.label
                        ? 'bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}

            {!readOnly && activeFields.includes('equipment') && (
              <div className="mb-2 flex flex-wrap gap-1">
                {MOBILITY_EQUIPMENT_OPTIONS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => updateRow(rowIndex, { equipment: item.label })}
                    className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                      row.equipment === item.label
                        ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-2">
              {activeFields.map((field) => {
                if (
                  field === 'exerciseType' ||
                  field === 'focusArea' ||
                  field === 'equipment'
                ) {
                  if (readOnly) {
                    const value = row[field]?.trim();
                    if (!value) return null;
                    return (
                      <div key={field}>
                        <label className="mb-0.5 block text-[10px] uppercase text-slate-600">
                          {MOBILITY_FIELD_LABELS[field]}
                        </label>
                        <p className="text-sm text-slate-200">{value}</p>
                      </div>
                    );
                  }
                  return (
                    <div key={field}>
                      <label className="mb-0.5 block text-[10px] uppercase text-slate-600">
                        {MOBILITY_FIELD_LABELS[field]}
                      </label>
                      <input
                        className="input w-full px-2 py-1.5 text-sm"
                        placeholder={MOBILITY_FIELD_PLACEHOLDERS[field]}
                        value={row[field] ?? ''}
                        onChange={(e) =>
                          updateRow(rowIndex, { [field]: e.target.value })
                        }
                      />
                    </div>
                  );
                }

                if (field === 'side' && !readOnly) {
                  return (
                    <div key={field}>
                      <label className="mb-1 block text-[10px] uppercase text-slate-600">
                        {MOBILITY_FIELD_LABELS[field]}
                      </label>
                      <div className="mb-1 flex flex-wrap gap-1">
                        {MOBILITY_SIDE_OPTIONS.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => updateRow(rowIndex, { side: s.label })}
                            className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                              row.side === s.label
                                ? 'bg-fitgo-500/30 text-fitgo-300 ring-1 ring-fitgo-500/50'
                                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                            }`}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                      <input
                        className="input w-full px-2 py-1.5 text-sm"
                        placeholder={MOBILITY_FIELD_PLACEHOLDERS[field]}
                        value={row.side ?? ''}
                        onChange={(e) =>
                          updateRow(rowIndex, { side: e.target.value })
                        }
                      />
                    </div>
                  );
                }

                return (
                  <div key={field}>
                    <label className="mb-0.5 block text-[10px] uppercase text-slate-600">
                      {MOBILITY_FIELD_LABELS[field]}
                    </label>
                    {readOnly ? (
                      <p className="text-sm text-slate-200">
                        {row[field]?.trim() || '—'}
                      </p>
                    ) : field === 'notes' ? (
                      <textarea
                        className="input min-h-[60px] w-full px-2 py-1.5 text-sm"
                        placeholder={MOBILITY_FIELD_PLACEHOLDERS[field]}
                        value={row[field] ?? ''}
                        onChange={(e) =>
                          updateRow(rowIndex, { [field]: e.target.value })
                        }
                      />
                    ) : (
                      <input
                        className="input w-full px-2 py-1.5 text-sm"
                        placeholder={MOBILITY_FIELD_PLACEHOLDERS[field]}
                        inputMode={
                          field === 'rpe' || field === 'comfort' ? 'numeric' : 'text'
                        }
                        value={row[field] ?? ''}
                        onChange={(e) =>
                          updateRow(rowIndex, { [field]: e.target.value })
                        }
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {!readOnly && exercises.length < MOBILITY_MAX_ROWS && (
        <button
          type="button"
          onClick={addRow}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-600 py-3 text-sm text-slate-400 hover:border-fitgo-500/50 hover:text-fitgo-400"
        >
          <Plus className="h-4 w-4" />
          Новое упражнение
        </button>
      )}
    </div>
  );
}
