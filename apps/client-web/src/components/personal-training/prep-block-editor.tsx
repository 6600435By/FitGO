'use client';

import type { PrepActivityRow, PrepFieldId } from '@fitgo/shared-types';
import {
  COOLDOWN_ACTIVITY_TYPES,
  PREP_FIELD_IDS,
  PREP_FIELD_LABELS,
  PREP_FIELD_PLACEHOLDERS,
  PREP_MAX_ROWS,
  WARMUP_ACTIVITY_TYPES,
  createEmptyPrepRow,
} from '@fitgo/shared-types';
import { Plus, Trash2 } from 'lucide-react';

interface PrepBlockEditorProps {
  variant: 'warmup' | 'cooldown';
  activities: PrepActivityRow[];
  activeFields: PrepFieldId[];
  readOnly: boolean;
  onChange: (activities: PrepActivityRow[]) => void;
  onFieldsChange: (fields: PrepFieldId[]) => void;
}

export function PrepBlockEditor({
  variant,
  activities,
  activeFields,
  readOnly,
  onChange,
  onFieldsChange,
}: PrepBlockEditorProps) {
  const activityTypes =
    variant === 'warmup' ? WARMUP_ACTIVITY_TYPES : COOLDOWN_ACTIVITY_TYPES;

  const updateRow = (rowIndex: number, patch: Partial<PrepActivityRow>) => {
    onChange(
      activities.map((row, i) => (i === rowIndex ? { ...row, ...patch } : row)),
    );
  };

  const addRow = () => {
    if (activities.length >= PREP_MAX_ROWS) return;
    onChange([...activities, createEmptyPrepRow()]);
  };

  const removeRow = (rowIndex: number) => {
    if (activities.length <= 1) return;
    onChange(activities.filter((_, i) => i !== rowIndex));
  };

  const toggleField = (field: PrepFieldId) => {
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
    ? activities.filter((row) =>
        activeFields.some((field) => Boolean(row[field]?.trim())),
      )
    : activities;

  if (readOnly && visibleRows.length === 0) {
    return <p className="text-sm text-slate-500">—</p>;
  }

  return (
    <div className="space-y-3">
      {!readOnly && (
        <div>
          <p className="mb-2 text-xs text-slate-500">Поля для записи</p>
          <div className="flex flex-wrap gap-1.5">
            {PREP_FIELD_IDS.map((field) => {
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
                  {PREP_FIELD_LABELS[field]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {readOnly && (
        <p className="text-xs text-slate-500">
          {activeFields.map((f) => PREP_FIELD_LABELS[f]).join(' · ')}
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
                Этап {rowIndex + 1}
              </span>
              {!readOnly && activities.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(rowIndex)}
                  className="rounded p-1 text-slate-600 hover:text-red-400"
                  aria-label="Удалить этап"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {!readOnly && activeFields.includes('type') && (
              <div className="mb-2 flex flex-wrap gap-1">
                {activityTypes.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => updateRow(rowIndex, { type: t.label })}
                    className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                      row.type === t.label
                        ? 'bg-fitgo-500/30 text-fitgo-300 ring-1 ring-fitgo-500/50'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-2">
              {activeFields.map((field) => (
                <div key={field}>
                  <label className="mb-0.5 block text-[10px] uppercase text-slate-600">
                    {PREP_FIELD_LABELS[field]}
                  </label>
                  {readOnly ? (
                    <p className="text-sm text-slate-200">
                      {row[field]?.trim() || '—'}
                    </p>
                  ) : field === 'notes' ? (
                    <textarea
                      className="input min-h-[60px] w-full px-2 py-1.5 text-sm"
                      placeholder={PREP_FIELD_PLACEHOLDERS[field]}
                      value={row[field] ?? ''}
                      onChange={(e) =>
                        updateRow(rowIndex, { [field]: e.target.value })
                      }
                    />
                  ) : field === 'type' ? (
                    <input
                      className="input w-full px-2 py-1.5 text-sm"
                      placeholder="Тип активности"
                      value={row[field] ?? ''}
                      onChange={(e) =>
                        updateRow(rowIndex, { [field]: e.target.value })
                      }
                    />
                  ) : (
                    <input
                      className="input w-full px-2 py-1.5 text-sm"
                      placeholder={PREP_FIELD_PLACEHOLDERS[field]}
                      inputMode={field === 'rpe' || field === 'hr' ? 'numeric' : 'text'}
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

      {!readOnly && activities.length < PREP_MAX_ROWS && (
        <button
          type="button"
          onClick={addRow}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-600 py-3 text-sm text-slate-400 hover:border-fitgo-500/50 hover:text-fitgo-400"
        >
          <Plus className="h-4 w-4" />
          Новый этап
        </button>
      )}
    </div>
  );
}
