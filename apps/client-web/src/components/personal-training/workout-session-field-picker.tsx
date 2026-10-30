'use client';

import type { WorkoutSectionId, WorkoutSheet } from '@fitgo/shared-types';
import { WORKOUT_SECTION_LABELS } from '@fitgo/shared-types';
import {
  getActiveTimerFields,
  getTimerFieldOptions,
  toggleTimerField,
} from './workout-session-field-config';

interface WorkoutSessionFieldPickerProps {
  sheet: WorkoutSheet;
  blockId: WorkoutSectionId;
  onSheetChange: (sheet: WorkoutSheet) => void;
}

export function WorkoutSessionFieldPicker({
  sheet,
  blockId,
  onSheetChange,
}: WorkoutSessionFieldPickerProps) {
  const options = getTimerFieldOptions(blockId);
  const active = getActiveTimerFields(sheet, blockId);

  if (options.length === 0) return null;

  return (
    <div className="w-full space-y-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
        Поля записи · {WORKOUT_SECTION_LABELS[blockId]}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const enabled = active.includes(option.id);
          return (
            <button
              key={option.id}
              type="button"
              onClick={() =>
                onSheetChange(toggleTimerField(sheet, blockId, option.id))
              }
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                enabled
                  ? 'bg-fitgo-500 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {enabled ? '✓ ' : ''}
              {option.label}
            </button>
          );
        })}
      </div>
      <p className="text-[10px] text-slate-600">
        Соответствует полям, выбранным в блоке программы
      </p>
    </div>
  );
}
