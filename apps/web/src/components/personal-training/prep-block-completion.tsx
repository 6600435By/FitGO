'use client';

import type { PrepActivityRow } from '@fitgo/shared-types';
import {
  formatBlockSessionClock,
  parseDurationInputToSec,
  prepActivityLabel,
  type PrepStepTiming,
  sumPrepStepRestSec,
  sumPrepStepWorkSec,
} from '@fitgo/shared-types';

interface PrepBlockCompletionProps {
  variant: 'warmup' | 'cooldown';
  activities: PrepActivityRow[];
  timings: PrepStepTiming[];
  blockRestSec: number;
  summaryNote: string;
  onTimingsChange: (timings: PrepStepTiming[]) => void;
  onBlockRestChange: (sec: number) => void;
  onSummaryNoteChange: (note: string) => void;
  onBack: () => void;
  onSave: () => void;
}

function DurationField({
  label,
  valueSec,
  onChange,
}: {
  label: string;
  valueSec: number;
  onChange: (sec: number) => void;
}) {
  return (
    <div>
      <label className="mb-0.5 block text-[10px] uppercase text-slate-500">
        {label}
      </label>
      <input
        className="input w-full font-mono text-sm"
        placeholder="мм:сс"
        defaultValue={formatBlockSessionClock(valueSec)}
        key={`${label}-${valueSec}`}
        onBlur={(e) => {
          const parsed = parseDurationInputToSec(e.target.value);
          if (parsed != null) onChange(parsed);
          else e.target.value = formatBlockSessionClock(valueSec);
        }}
      />
    </div>
  );
}

export function PrepBlockCompletion({
  variant,
  activities,
  timings,
  blockRestSec,
  summaryNote,
  onTimingsChange,
  onBlockRestChange,
  onSummaryNoteChange,
  onBack,
  onSave,
}: PrepBlockCompletionProps) {
  const title = variant === 'warmup' ? 'Разминка' : 'Заминка';
  const totalWork = sumPrepStepWorkSec(timings);
  const totalRest = sumPrepStepRestSec(timings) + blockRestSec;

  const patchTiming = (index: number, patch: Partial<PrepStepTiming>) => {
    onTimingsChange(
      timings.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <div>
          <h2 className="text-lg font-semibold">Итог: {title}</h2>
          <p className="text-sm text-slate-400">
            Проверьте время. Можно исправить, если таймер не нажимали.
          </p>
        </div>

        {activities.map((row, index) => {
          const t = timings[index] ?? { actualWorkSec: 0, actualRestAfterSec: 0 };
          const label = prepActivityLabel(row, index);
          const planned = row.duration?.trim() || '—';

          return (
            <div
              key={index}
              className="space-y-2 rounded-xl border border-slate-700 bg-slate-900/50 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-slate-200">
                    Этап {index + 1} · {label}
                  </p>
                  <p className="text-xs text-slate-500">План: {planned}</p>
                </div>
                <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={Boolean(t.skipped)}
                    onChange={(e) =>
                      patchTiming(index, {
                        skipped: e.target.checked,
                        actualWorkSec: e.target.checked ? 0 : t.actualWorkSec,
                      })
                    }
                    className="rounded"
                  />
                  Пропуск
                </label>
              </div>

              {!t.skipped && (
                <DurationField
                  label="Факт работы"
                  valueSec={t.actualWorkSec}
                  onChange={(sec) => patchTiming(index, { actualWorkSec: sec })}
                />
              )}

              {index < activities.length - 1 && (
                <DurationField
                  label="Отдых до след. этапа"
                  valueSec={t.actualRestAfterSec}
                  onChange={(sec) =>
                    patchTiming(index, { actualRestAfterSec: sec })
                  }
                />
              )}
            </div>
          );
        })}

        <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-3">
          <DurationField
            label="Отдых до следующего блока"
            valueSec={blockRestSec}
            onChange={onBlockRestChange}
          />
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg bg-slate-800/50 p-3">
            <p className="text-xs text-slate-500">Работа</p>
            <p className="font-mono font-medium">{formatBlockSessionClock(totalWork)}</p>
          </div>
          <div className="rounded-lg bg-slate-800/50 p-3">
            <p className="text-xs text-slate-500">Отдых</p>
            <p className="font-mono font-medium">{formatBlockSessionClock(totalRest)}</p>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs uppercase text-slate-500">
            Итог по блоку
          </label>
          <textarea
            className="input min-h-[80px] w-full text-sm"
            placeholder="Самочувствие, техника…"
            value={summaryNote}
            onChange={(e) => onSummaryNoteChange(e.target.value)}
          />
        </div>
      </div>

      <div className="flex gap-2 border-t border-slate-800 p-4">
        <button type="button" onClick={onBack} className="btn-secondary flex-1">
          Назад
        </button>
        <button type="button" onClick={onSave} className="btn-primary flex-1">
          Сохранить блок
        </button>
      </div>
    </div>
  );
}
