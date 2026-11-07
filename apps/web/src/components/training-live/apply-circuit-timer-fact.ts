import type { WorkoutSheet } from '@fitgo/shared-types';
import {
  applyCircuitRoundRest,
  applyCircuitRoundWork,
} from '@/components/personal-training/workout-timer-apply';
import {
  CIRCUIT_SHEET_PRESET_ID,
  type CircuitPhaseBinding,
} from '@/lib/training-timer';
import type { TimerEvent, TimerPersistedState } from '@/lib/training-timer';

/**
 * Writes circuit round work/rest into the sheet when a sheet-seeded timer
 * finishes a work or roundRest phase.
 */
export function applyCircuitTimerEvents(
  sheet: WorkoutSheet,
  events: TimerEvent[],
  state: TimerPersistedState,
  bindings: CircuitPhaseBinding[],
): WorkoutSheet {
  if (state.presetId !== CIRCUIT_SHEET_PRESET_ID || !sheet.circuit) {
    return sheet;
  }

  let next = sheet;
  const workByRound = new Map<number, number>();

  for (const ev of events) {
    // complete duplicates the last phase_end — apply once.
    if (ev.kind !== 'phase_end') continue;
    const binding = bindings[ev.phaseIndex];
    if (!binding) continue;

    const elapsedSec = Math.max(
      1,
      Math.round(
        (ev.elapsedMs ??
          (ev.phase.durationSec != null ? ev.phase.durationSec * 1000 : 0)) /
          1000,
      ),
    );

    if (binding.role === 'work') {
      const prev = workByRound.get(binding.round) ?? 0;
      const fromLog =
        next.circuit?.roundLogs?.[binding.round - 1]?.roundWorkSec ?? 0;
      const base = Math.max(prev, fromLog);
      workByRound.set(binding.round, base + elapsedSec);
    } else if (binding.role === 'roundRest') {
      next = applyCircuitRoundRest(next, binding.round, elapsedSec);
    }
  }

  for (const [round, workSec] of workByRound) {
    next = applyCircuitRoundWork(next, round, workSec);
  }

  return next;
}
