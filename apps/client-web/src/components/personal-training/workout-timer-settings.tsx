'use client';

import type { WorkoutSheet } from '@fitgo/shared-types';
import type { TimerDockBlockOption } from './workout-timer-apply';
import type { TimerMeasureKind } from './workout-timer-apply';
import { MEASURE_KIND_LABELS } from './workout-timer-apply';
import type { TimerDockBlock } from './workout-timer-apply';

export interface WorkoutTimerSessionState {
  activeBlock: TimerDockBlock;
  measureKind: TimerMeasureKind;
  exerciseIndex: number;
  setIndex: number;
  rowIndex: number;
  activityIndex: number;
  restSec: number;
  heartRate?: number;
  circuitRound: number;
  circuitStationIndex: number;
}

interface WorkoutTimerSettingsProps {
  session: WorkoutTimerSessionState;
  blockOptions: TimerDockBlockOption[];
  sheet: WorkoutSheet;
  measureOptions: TimerMeasureKind[];
  onChange: (session: WorkoutTimerSessionState) => void;
}

export function WorkoutTimerSettings({
  session,
  blockOptions,
  sheet,
  measureOptions,
  onChange,
}: WorkoutTimerSettingsProps) {
  const patch = (p: Partial<WorkoutTimerSessionState>) =>
    onChange({ ...session, ...p });

  const strengthExerciseCount = sheet.strengthExercises.length;
  const strengthSetCount =
    sheet.strengthExercises[session.exerciseIndex]?.sets.length ?? 1;

  return (
    <div className="max-h-[32vh] space-y-2 overflow-y-auto border-b border-slate-800 px-3 py-2">
      <div className="flex flex-wrap gap-1">
        {blockOptions.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => {
              const next: WorkoutTimerSessionState = {
                ...session,
                activeBlock: b.id,
              };
              if (b.id === 'circuit') next.measureKind = 'circuit';
              else if (b.id === 'rest' || b.id === 'strength')
                next.measureKind = 'set_rest';
              else if (b.id === 'warmup' || b.id === 'cooldown')
                next.measureKind = 'activity';
              else if (b.id === 'cardio' || b.id === 'mobility')
                next.measureKind = 'row';
              else next.measureKind = 'block';
              onChange(next);
            }}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
              session.activeBlock === b.id
                ? 'bg-fitgo-500 text-white'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      {measureOptions.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {measureOptions.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => patch({ measureKind: kind })}
              className={`rounded-md px-2 py-0.5 text-[11px] ${
                session.measureKind === kind
                  ? 'bg-slate-700 text-slate-200'
                  : 'text-slate-500'
              }`}
            >
              {MEASURE_KIND_LABELS[kind]}
            </button>
          ))}
        </div>
      )}

      {(session.activeBlock === 'strength' || session.activeBlock === 'rest') &&
        session.measureKind === 'set_rest' && (
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
            <label className="flex items-center gap-1">
              Упр.
              <input
                type="number"
                min={1}
                max={strengthExerciseCount}
                className="input w-12 px-1 py-0.5 text-center text-xs"
                value={session.exerciseIndex + 1}
                onChange={(e) =>
                  patch({
                    exerciseIndex: Math.max(
                      0,
                      Math.min(
                        strengthExerciseCount - 1,
                        Number(e.target.value) - 1,
                      ),
                    ),
                  })
                }
              />
            </label>
            <label className="flex items-center gap-1">
              Подход
              <input
                type="number"
                min={1}
                max={strengthSetCount}
                className="input w-12 px-1 py-0.5 text-center text-xs"
                value={session.setIndex + 1}
                onChange={(e) =>
                  patch({
                    setIndex: Math.max(
                      0,
                      Math.min(strengthSetCount - 1, Number(e.target.value) - 1),
                    ),
                  })
                }
              />
            </label>
            <label className="flex items-center gap-1">
              Отдых, сек
              <input
                type="number"
                min={10}
                className="input w-14 px-1 py-0.5 text-center text-xs"
                value={session.restSec}
                onChange={(e) =>
                  patch({ restSec: Number(e.target.value) || 90 })
                }
              />
            </label>
          </div>
        )}

      {(session.activeBlock === 'warmup' || session.activeBlock === 'cooldown') &&
        session.measureKind === 'activity' && (
          <label className="flex items-center gap-1 text-xs text-slate-400">
            Этап
            <input
              type="number"
              min={1}
              max={8}
              className="input w-12 px-1 py-0.5 text-center text-xs"
              value={session.activityIndex + 1}
              onChange={(e) =>
                patch({ activityIndex: Math.max(0, Number(e.target.value) - 1) })
              }
            />
          </label>
        )}

      {(session.activeBlock === 'cardio' || session.activeBlock === 'mobility') &&
        session.measureKind === 'row' && (
          <label className="flex items-center gap-1 text-xs text-slate-400">
            Строка
            <input
              type="number"
              min={1}
              max={12}
              className="input w-12 px-1 py-0.5 text-center text-xs"
              value={session.rowIndex + 1}
              onChange={(e) =>
                patch({ rowIndex: Math.max(0, Number(e.target.value) - 1) })
              }
            />
          </label>
        )}

      {session.activeBlock === 'circuit' && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
          <label className="flex items-center gap-1">
            Круг
            <input
              type="number"
              min={1}
              max={sheet.circuit?.rounds ?? 8}
              className="input w-12 px-1 py-0.5 text-center text-xs"
              value={session.circuitRound}
              onChange={(e) =>
                patch({ circuitRound: Math.max(1, Number(e.target.value) || 1) })
              }
            />
          </label>
          <label className="flex items-center gap-1">
            Станция
            <input
              type="number"
              min={1}
              max={sheet.circuit?.stations.length ?? 8}
              className="input w-12 px-1 py-0.5 text-center text-xs"
              value={session.circuitStationIndex + 1}
              onChange={(e) =>
                patch({
                  circuitStationIndex: Math.max(0, Number(e.target.value) - 1),
                })
              }
            />
          </label>
        </div>
      )}
    </div>
  );
}
