'use client';

import type { CardioExerciseRow, CardioFieldId } from '@fitgo/shared-types';
import {
  CARDIO_FIELD_IDS,
  CARDIO_FIELD_LABELS,
  CARDIO_FIELD_PLACEHOLDERS,
  CARDIO_MAX_ROWS,
  createEmptyCardioRow,
} from '@fitgo/shared-types';
import { Plus, Trash2 } from 'lucide-react';

interface CardioBlockEditorProps {
  exercises: CardioExerciseRow[];
  activeFields: CardioFieldId[];
  readOnly: boolean;
  onChange: (exercises: CardioExerciseRow[]) => void;
  onFieldsChange: (fields: CardioFieldId[]) => void;
}

export function CardioBlockEditor({
  exercises,
  activeFields,
  readOnly,
  onChange,
  onFieldsChange,
}: CardioBlockEditorProps) {
  const updateRow = (rowIndex: number, patch: Partial<CardioExerciseRow>) => {
    onChange(
      exercises.map((row, i) => (i === rowIndex ? { ...row, ...patch } : row)),
    );
  };

  const addRow = () => {
    if (exercises.length >= CARDIO_MAX_ROWS) return;
    onChange([...exercises, createEmptyCardioRow()]);
  };

  const removeRow = (rowIndex: number) => {
    if (exercises.length <= 1) return;
    onChange(exercises.filter((_, i) => i !== rowIndex));
  };

  const toggleField = (field: CardioFieldId) => {
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
    ? exercises.filter((row) =>
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
          <p className="mb-2 text-xs text-slate-500">Поля для записи</p>
          <div className="flex flex-wrap gap-1.5">
            {CARDIO_FIELD_IDS.map((field) => {
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
                  {CARDIO_FIELD_LABELS[field]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {readOnly && (
        <p className="text-xs text-slate-500">
          {activeFields.map((f) => CARDIO_FIELD_LABELS[f]).join(' · ')}
        </p>
      )}

      <div className="space-y-2">
        {visibleRows.map((row, rowIndex) => (
          <div
            key={rowIndex}
            className="rounded-xl border border-slate-700/80 bg-slate-800/30 p-3"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">
                Строка {rowIndex + 1}
              </span>
              {!readOnly && exercises.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(rowIndex)}
                  className="rounded p-1 text-slate-600 hover:text-red-400"
                  aria-label="Удалить строку"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="space-y-2">
              {activeFields.map((field) => (
                <div key={field}>
                  <label className="mb-0.5 block text-[10px] uppercase text-slate-600">
                    {CARDIO_FIELD_LABELS[field]}
                  </label>
                  {readOnly ? (
                    <p className="text-sm text-slate-200">{row[field]?.trim() || '—'}</p>
                  ) : field === 'notes' ? (
                    <textarea
                      className="input min-h-[60px] w-full px-2 py-1.5 text-sm"
                      placeholder={CARDIO_FIELD_PLACEHOLDERS[field]}
                      value={row[field] ?? ''}
                      onChange={(e) =>
                        updateRow(rowIndex, { [field]: e.target.value })
                      }
                    />
                  ) : (
                    <input
                      className="input w-full px-2 py-1.5 text-sm"
                      placeholder={CARDIO_FIELD_PLACEHOLDERS[field]}
                      inputMode={
                        field === 'hr' || field === 'rpe' ? 'numeric' : 'text'
                      }
                      value={row[field] ?? ''}
                      onChange={(e) =>
                        updateRow(rowIndex, { [field]: e.target.value })
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {!readOnly && exercises.length < CARDIO_MAX_ROWS && (
        <button
          type="button"
          onClick={addRow}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-600 py-3 text-sm text-slate-400 hover:border-fitgo-500/50 hover:text-fitgo-400"
        >
          <Plus className="h-4 w-4" />
          Новая строка
        </button>
      )}
    </div>
  );
}
