'use client';

import type { SessionStepTiming, WorkoutSectionId, WorkoutSheet } from '@fitgo/shared-types';
import {
  WORKOUT_SECTION_LABELS,
  formatBlockSessionClock,
  getUniqueSessionBlocks,
  parseDurationInputToSec,
  sumPrepStepRestSec,
  sumPrepStepWorkSec,
  type WorkoutSessionStep,
} from '@fitgo/shared-types';
import {
  getComparablePlanFactRows,
  getStepPlanFactRows,
} from './workout-session-plan-fact';

interface WorkoutSessionCompletionProps {
  sheet: WorkoutSheet;
  steps: WorkoutSessionStep[];
  timings: SessionStepTiming[];
  blockRests: Partial<Record<WorkoutSectionId, number>>;
  blockNotes: Partial<Record<WorkoutSectionId, string>>;
  onTimingsChange: (timings: SessionStepTiming[]) => void;
  onBlockRestChange: (blockId: WorkoutSectionId, sec: number) => void;
  onBlockNoteChange: (blockId: WorkoutSectionId, note: string) => void;
  onSave: () => void;
}

function DurationField({
  label,
  valueSec,
  planSec,
  onChange,
}: {
  label: string;
  valueSec: number;
  planSec?: number;
  onChange: (sec: number) => void;
}) {
  return (
    <div>
      <label className="mb-0.5 block text-[10px] uppercase text-slate-500">
        {label}
      </label>
      {planSec != null && (
        <p className="mb-1 text-xs text-slate-600">
          План: {formatBlockSessionClock(planSec)}
        </p>
      )}
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

function PlanFactTable({ rows }: { rows: ReturnType<typeof getStepPlanFactRows> }) {
  const comparable = getComparablePlanFactRows(rows);
  if (comparable.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-lg border border-slate-800">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-900/80 text-slate-500">
          <tr>
            <th className="px-2 py-1.5 font-medium">Показатель</th>
            <th className="px-2 py-1.5 font-medium">План</th>
            <th className="px-2 py-1.5 font-medium">Факт</th>
          </tr>
        </thead>
        <tbody>
          {comparable.map((row) => (
            <tr key={row.id} className="border-t border-slate-800">
              <td className="px-2 py-1.5 text-slate-400">{row.label}</td>
              <td className="px-2 py-1.5 font-mono text-slate-500">{row.plan}</td>
              <td
                className={`px-2 py-1.5 font-mono ${
                  row.hasFact && row.hasPlan && row.fact !== row.plan
                    ? 'text-amber-300'
                    : 'text-slate-200'
                }`}
              >
                {row.fact}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WorkoutSessionCompletion({
  sheet,
  steps,
  timings,
  blockRests,
  blockNotes,
  onTimingsChange,
  onBlockRestChange,
  onBlockNoteChange,
  onSave,
}: WorkoutSessionCompletionProps) {
  const blocks = getUniqueSessionBlocks(steps);
  const totalWork = sumPrepStepWorkSec(timings);
  const totalRest =
    sumPrepStepRestSec(timings) +
    Object.values(blockRests).reduce((sum, v) => sum + (v ?? 0), 0);

  const patchTiming = (index: number, patch: Partial<SessionStepTiming>) => {
    onTimingsChange(timings.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Итог тренировки</h2>
        <p className="text-sm text-slate-400">
          Сравнение плана (блок программы) и факта (таймер). Время можно
          исправить вручную.
        </p>
      </div>

      {blocks.map((blockId) => {
        const blockSteps = steps
          .map((step, index) => ({ step, index }))
          .filter(({ step }) => step.blockId === blockId);
        const blockWork = sumPrepStepWorkSec(
          blockSteps.map(
            ({ index }) => timings[index] ?? { actualWorkSec: 0, actualRestAfterSec: 0 },
          ),
        );

        return (
          <div
            key={blockId}
            className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/50 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-slate-200">
                {WORKOUT_SECTION_LABELS[blockId]}
              </p>
              <p className="font-mono text-xs text-slate-500">
                факт {formatBlockSessionClock(blockWork)}
              </p>
            </div>

            {blockSteps.map(({ step, index }, blockStepIndex) => {
              const t = timings[index] ?? {
                actualWorkSec: 0,
                actualRestAfterSec: 0,
              };
              const isLastInBlock = blockStepIndex === blockSteps.length - 1;
              const planFactRows = getStepPlanFactRows(sheet, step, t);

              return (
                <div
                  key={step.id}
                  className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/40 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm text-slate-200">{step.label}</p>
                      {step.subtitle && (
                        <p className="text-xs text-slate-500">{step.subtitle}</p>
                      )}
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

                  <PlanFactTable rows={planFactRows} />

                  {!t.skipped && (
                    <DurationField
                      label="Факт работы"
                      valueSec={t.actualWorkSec}
                      planSec={step.plannedWorkSec}
                      onChange={(sec) => patchTiming(index, { actualWorkSec: sec })}
                    />
                  )}

                  {!isLastInBlock && (
                    <DurationField
                      label="Отдых до след. этапа"
                      valueSec={t.actualRestAfterSec}
                      planSec={step.plannedRestSec}
                      onChange={(sec) =>
                        patchTiming(index, { actualRestAfterSec: sec })
                      }
                    />
                  )}
                </div>
              );
            })}

            {blocks.indexOf(blockId) < blocks.length - 1 && (
              <DurationField
                label="Отдых до следующего блока"
                valueSec={blockRests[blockId] ?? 0}
                onChange={(sec) => onBlockRestChange(blockId, sec)}
              />
            )}

            <div>
              <label className="mb-1 block text-xs uppercase text-slate-500">
                Итог по блоку
              </label>
              <textarea
                className="input min-h-[64px] w-full text-sm"
                placeholder="Самочувствие, техника…"
                value={blockNotes[blockId] ?? ''}
                onChange={(e) => onBlockNoteChange(blockId, e.target.value)}
              />
            </div>
          </div>
        );
      })}

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg bg-slate-800/50 p-3">
          <p className="text-xs text-slate-500">Работа (факт)</p>
          <p className="font-mono font-medium">{formatBlockSessionClock(totalWork)}</p>
        </div>
        <div className="rounded-lg bg-slate-800/50 p-3">
          <p className="text-xs text-slate-500">Отдых (факт)</p>
          <p className="font-mono font-medium">{formatBlockSessionClock(totalRest)}</p>
        </div>
      </div>

      <button type="button" onClick={onSave} className="btn-primary w-full">
        Сохранить тренировку
      </button>
    </div>
  );
}
