'use client';

import type { WorkoutSheet } from '@fitgo/shared-types';
import type { WorkoutSessionStep } from '@fitgo/shared-types';
import type { SessionCaptureField } from './workout-session-step-context';
import {
  getSessionCaptureValue,
  patchSessionCapture,
} from './workout-session-sheet-patch';

interface WorkoutSessionCaptureProps {
  sheet: WorkoutSheet;
  step: WorkoutSessionStep;
  fields: SessionCaptureField[];
  onSheetChange: (sheet: WorkoutSheet) => void;
}

export function WorkoutSessionCapture({
  sheet,
  step,
  fields,
  onSheetChange,
}: WorkoutSessionCaptureProps) {
  if (fields.length === 0) return null;

  return (
    <div className="w-full space-y-2 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
        Факт · показатели этапа
      </p>
      <div className="space-y-3">
        {fields.map((field) => {
          const value = getSessionCaptureValue(sheet, step, field.kind);
          const isHr = field.kind === 'hr' || field.kind === 'circuit_hr';
          const isRpe = field.kind.includes('rpe');

          return (
            <div key={field.kind} className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-slate-900/80 px-2 py-1.5">
                <p className="text-[10px] uppercase text-slate-600">План</p>
                <p className="font-mono text-sm text-slate-400">
                  {field.planned?.trim() || '—'}
                </p>
              </div>
              <div>
                <label className="mb-0.5 block text-[10px] uppercase text-fitgo-400/90">
                  Факт · {field.label}
                </label>
                <input
                  className="input w-full font-mono text-sm"
                  inputMode={isHr || isRpe ? 'numeric' : 'text'}
                  placeholder={field.hint ?? ''}
                  value={value}
                  onChange={(e) =>
                    onSheetChange(
                      patchSessionCapture(
                        sheet,
                        step,
                        field.kind,
                        e.target.value,
                      ),
                    )
                  }
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
