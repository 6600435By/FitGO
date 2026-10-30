import type { WorkoutSectionId, WorkoutSheet } from '@fitgo/shared-types';
import { ensureCircuitRoundLogs } from '@fitgo/shared-types';

export type TimerDockBlock = WorkoutSectionId | 'rest';

export interface TimerDockBlockOption {
  id: TimerDockBlock;
  label: string;
}

export type TimerMeasureKind = 'block' | 'set_rest' | 'row' | 'activity' | 'circuit';

export interface TimerApplyTarget {
  block: TimerDockBlock;
  kind: TimerMeasureKind;
  exerciseIndex?: number;
  setIndex?: number;
  rowIndex?: number;
  activityIndex?: number;
  circuitRound?: number;
  circuitStationIndex?: number;
}

export function formatElapsedMin(sec: number): number {
  if (sec <= 0) return 0;
  return Math.max(1, Math.round(sec / 60));
}

export function formatElapsedField(sec: number): string {
  if (sec <= 0) return '';
  if (sec >= 60) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m} мин ${s} сек` : `${m} мин`;
  }
  return `${sec} сек`;
}

export function getTimerApplyLabel(target: TimerApplyTarget): string {
  switch (target.kind) {
    case 'block':
      return 'время блока';
    case 'set_rest':
      return `отдых · подход ${(target.setIndex ?? 0) + 1}`;
    case 'row':
      return `строка ${(target.rowIndex ?? 0) + 1}`;
    case 'activity':
      return `этап ${(target.activityIndex ?? 0) + 1}`;
    case 'circuit':
      if (target.circuitRound && target.kind === 'circuit') {
        return `время круга ${target.circuitRound}`;
      }
      return target.circuitRound
        ? `отдых после круга ${target.circuitRound}`
        : 'круговая';
    default:
      return '';
  }
}

export function canApplyTimerHr(target: TimerApplyTarget): boolean {
  return getTimerHrApplyLabel(target) != null;
}

export function getTimerHrApplyLabel(target: TimerApplyTarget): string | null {
  switch (target.block) {
    case 'warmup':
      return target.kind === 'block' ? 'ЧСС в покое' : null;
    case 'cardio':
      if (target.kind === 'row') {
        return `ЧСС · строка ${(target.rowIndex ?? 0) + 1}`;
      }
      return 'ЧСС · кардио';
    case 'circuit':
      if (target.circuitStationIndex != null) {
        return `ЧСС · круг ${target.circuitRound ?? 1} · ст. ${target.circuitStationIndex + 1}`;
      }
      return `ЧСС · круг ${target.circuitRound ?? 1}`;
    case 'cooldown':
      return target.kind === 'block' ? 'макс. ЧСС' : null;
    default:
      return null;
  }
}

export function applyTimerHeartRate(
  sheet: WorkoutSheet,
  target: TimerApplyTarget,
  hr: number,
): WorkoutSheet {
  if (hr <= 0 || hr > 250) return sheet;

  switch (target.block) {
    case 'warmup':
      if (target.kind === 'block') {
        return { ...sheet, restingHr: hr };
      }
      return sheet;

    case 'cardio': {
      const rowIndex =
        target.kind === 'row' ? (target.rowIndex ?? 0) : (target.rowIndex ?? 0);
      const exercises = [...sheet.cardioExercises];
      const row = exercises[rowIndex];
      if (!row) return sheet;
      exercises[rowIndex] = { ...row, hr: String(hr) };
      return { ...sheet, cardioExercises: exercises };
    }

    case 'cooldown':
      if (target.kind === 'block') {
        return {
          ...sheet,
          maxHr: sheet.maxHr ? Math.max(sheet.maxHr, hr) : hr,
        };
      }
      return sheet;

    case 'circuit': {
      if (!sheet.circuit || target.circuitRound == null) return sheet;
      const roundIndex = target.circuitRound - 1;
      const stationIndex = target.circuitStationIndex ?? 0;
      const roundLogs = sheet.circuit.roundLogs.map((log, ri) => {
        if (ri !== roundIndex) return log;
        const stations = [...log.stations];
        while (stations.length <= stationIndex) {
          stations.push({});
        }
        stations[stationIndex] = {
          ...stations[stationIndex],
          actualHr: hr,
        };
        const stationHrs = stations
          .map((s) => s.actualHr)
          .filter((v): v is number => typeof v === 'number' && v > 0);
        const avgHr = stationHrs.length
          ? Math.round(stationHrs.reduce((a, b) => a + b, 0) / stationHrs.length)
          : log.avgHr;
        const maxHr = stationHrs.length ? Math.max(...stationHrs) : log.maxHr;
        return { ...log, stations, avgHr, maxHr };
      });
      return ensureCircuitRoundLogs({
        ...sheet,
        circuit: { ...sheet.circuit, roundLogs },
      });
    }

    default:
      return sheet;
  }
}

export function applyCircuitRoundWork(
  sheet: WorkoutSheet,
  round: number,
  workSec: number,
  hr?: number,
): WorkoutSheet {
  if (!sheet.circuit || workSec <= 0 || round < 1) return sheet;

  const base = ensureCircuitRoundLogs(sheet);
  const roundIndex = round - 1;
  const roundLogs = base.circuit!.roundLogs.map((log, i) => {
    if (i !== roundIndex) return log;
    const next = { ...log, roundWorkSec: workSec };
    if (hr && hr > 0) {
      next.avgHr = log.avgHr ? Math.round((log.avgHr + hr) / 2) : hr;
      next.maxHr = log.maxHr ? Math.max(log.maxHr, hr) : hr;
    }
    return next;
  });

  return {
    ...base,
    circuit: { ...base.circuit!, roundLogs },
  };
}

export function applyCircuitRoundRest(
  sheet: WorkoutSheet,
  round: number,
  restSec: number,
): WorkoutSheet {
  if (!sheet.circuit || restSec <= 0 || round < 1) return sheet;

  const base = ensureCircuitRoundLogs(sheet);
  const roundIndex = round - 1;
  const roundLogs = base.circuit!.roundLogs.map((log, i) =>
    i === roundIndex ? { ...log, roundRestSec: restSec } : log,
  );

  return {
    ...base,
    circuit: { ...base.circuit!, roundLogs },
  };
}

export function applyTimerElapsed(
  sheet: WorkoutSheet,
  target: TimerApplyTarget,
  elapsedSec: number,
): WorkoutSheet {
  if (elapsedSec <= 0) return sheet;

  switch (target.block) {
    case 'warmup': {
      if (target.kind === 'activity' && target.activityIndex != null) {
        const activities = [...(sheet.warmupActivities ?? [])];
        const row = activities[target.activityIndex];
        if (!row) return sheet;
        activities[target.activityIndex] = {
          ...row,
          duration: formatElapsedField(elapsedSec),
        };
        return { ...sheet, warmupActivities: activities };
      }
      return {
        ...sheet,
        warmupDurationMin: formatElapsedMin(elapsedSec),
      };
    }
    case 'cooldown': {
      if (target.kind === 'activity' && target.activityIndex != null) {
        const activities = [...(sheet.cooldownActivities ?? [])];
        const row = activities[target.activityIndex];
        if (!row) return sheet;
        activities[target.activityIndex] = {
          ...row,
          duration: formatElapsedField(elapsedSec),
        };
        return { ...sheet, cooldownActivities: activities };
      }
      return {
        ...sheet,
        cooldownDurationMin: formatElapsedMin(elapsedSec),
      };
    }
    case 'strength': {
      if (target.kind === 'set_rest') {
        const exIdx = target.exerciseIndex ?? 0;
        const setIdx = target.setIndex ?? 0;
        const exercises = sheet.strengthExercises.map((ex, i) => {
          if (i !== exIdx) return ex;
          return {
            ...ex,
            sets: ex.sets.map((set, si) =>
              si === setIdx ? { ...set, restSec: elapsedSec } : set,
            ),
          };
        });
        return { ...sheet, strengthExercises: exercises };
      }
      return {
        ...sheet,
        strengthDurationMin: formatElapsedMin(elapsedSec),
      };
    }
    case 'cardio': {
      if (target.kind === 'row' && target.rowIndex != null) {
        const exercises = [...sheet.cardioExercises];
        const row = exercises[target.rowIndex];
        if (!row) return sheet;
        exercises[target.rowIndex] = {
          ...row,
          duration: formatElapsedField(elapsedSec),
        };
        return { ...sheet, cardioExercises: exercises };
      }
      return {
        ...sheet,
        cardioTotalMin: formatElapsedMin(elapsedSec),
      };
    }
    case 'mobility': {
      if (target.kind === 'row' && target.rowIndex != null) {
        const exercises = [...sheet.mobilityExercises];
        const row = exercises[target.rowIndex];
        if (!row) return sheet;
        exercises[target.rowIndex] = {
          ...row,
          duration: formatElapsedField(elapsedSec),
        };
        return { ...sheet, mobilityExercises: exercises };
      }
      return {
        ...sheet,
        mobilityDurationMin: formatElapsedMin(elapsedSec),
      };
    }
    case 'circuit': {
      if (!sheet.circuit || target.circuitRound == null) return sheet;
      return applyCircuitRoundRest(sheet, target.circuitRound, elapsedSec);
    }
    default:
      return sheet;
  }
}

export const MEASURE_KIND_LABELS: Record<TimerMeasureKind, string> = {
  block: 'время блока',
  set_rest: 'отдых подхода',
  row: 'строка',
  activity: 'этап',
  circuit: 'круговая',
};

export type WorkoutTimerMode = 'circuit' | 'rest' | 'block' | 'round_lap';

export function resolveFullscreenTimerMode(
  block: TimerDockBlock,
  measureKind: TimerMeasureKind,
): WorkoutTimerMode {
  if (block === 'circuit') return 'round_lap';
  if (block === 'rest' || measureKind === 'set_rest') return 'rest';
  return 'block';
}

export function measureOptionsForBlock(block: TimerDockBlock): TimerMeasureKind[] {
  if (block === 'warmup' || block === 'cooldown') return ['block', 'activity'];
  if (block === 'strength' || block === 'rest') return ['set_rest', 'block'];
  if (block === 'cardio' || block === 'mobility') return ['block', 'row'];
  return ['block'];
}

export function defaultApplyTarget(
  block: TimerDockBlock,
  opts: {
    exerciseIndex?: number;
    setIndex?: number;
    rowIndex?: number;
    activityIndex?: number;
  },
): TimerApplyTarget {
  if (block === 'rest' || block === 'strength') {
    return {
      block: 'strength',
      kind: 'set_rest',
      exerciseIndex: opts.exerciseIndex ?? 0,
      setIndex: opts.setIndex ?? 0,
    };
  }
  if (block === 'warmup' || block === 'cooldown') {
    return {
      block,
      kind: 'activity',
      activityIndex: opts.activityIndex ?? 0,
    };
  }
  if (block === 'cardio' || block === 'mobility') {
    return {
      block,
      kind: 'row',
      rowIndex: opts.rowIndex ?? 0,
    };
  }
  if (block === 'circuit') {
    return { block: 'circuit', kind: 'circuit', circuitRound: 1 };
  }
  return { block, kind: 'block' };
}
