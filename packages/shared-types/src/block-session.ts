import type {
  PrepActivityRow,
  PrepSectionId,
  WorkoutSectionId,
  WorkoutSheet,
} from './workout-sheet';
import {
  WORKOUT_SECTION_LABELS,
  deriveSessionFactPatch,
  getWorkoutBlocks,
  isPrepSectionEnabled,
} from './workout-sheet';

/** Факт выполнения шага (этап / подход / строка) */
export interface SessionStepTiming {
  actualWorkSec: number;
  actualRestAfterSec: number;
  skipped?: boolean;
}

/** @deprecated alias */
export type PrepStepTiming = SessionStepTiming;

/** Парсит «5 мин», «30 сек», «5:30» → секунды */
export function parseDurationTextToSec(text?: string): number | undefined {
  const raw = text?.trim();
  if (!raw) return undefined;

  const clock = raw.match(/^(\d+):(\d{1,2})$/);
  if (clock) {
    const m = Number(clock[1]);
    const s = Number(clock[2]);
    if (s >= 60) return undefined;
    return m * 60 + s;
  }

  const min = raw.match(/(\d+)\s*(мин|min|м|m)\b/i);
  if (min) return Number(min[1]) * 60;

  const sec = raw.match(/(\d+)\s*(сек|sec|с|s)\b/i);
  if (sec) return Number(sec[1]);

  const num = raw.match(/^(\d+)$/);
  if (num) {
    const n = Number(num[1]);
    return n <= 30 ? n * 60 : n;
  }

  return undefined;
}

export function formatBlockSessionClock(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Поле ввода mm:ss или «5 мин» */
export function parseDurationInputToSec(input: string): number | undefined {
  const trimmed = input.trim();
  if (!trimmed) return 0;
  return parseDurationTextToSec(trimmed);
}

export function prepStepTimingFromRow(row: PrepActivityRow): PrepStepTiming {
  return {
    actualWorkSec: row.actualWorkSec ?? 0,
    actualRestAfterSec: row.actualRestAfterSec ?? 0,
    skipped: row.skipped,
  };
}

export function sumPrepStepWorkSec(timings: PrepStepTiming[]): number {
  return timings.reduce((sum, t) => sum + (t.skipped ? 0 : t.actualWorkSec), 0);
}

export function sumPrepStepRestSec(timings: PrepStepTiming[]): number {
  return timings.reduce((sum, t) => sum + t.actualRestAfterSec, 0);
}

export function mergePrepStepTimings(
  activities: PrepActivityRow[],
  timings: PrepStepTiming[],
): PrepActivityRow[] {
  return activities.map((row, i) => {
    const t = timings[i];
    if (!t) return row;
    return {
      ...row,
      actualWorkSec: t.skipped ? 0 : t.actualWorkSec,
      actualRestAfterSec: t.actualRestAfterSec,
      skipped: t.skipped,
    };
  });
}

export function markWorkoutSessionStarted(sheet: WorkoutSheet): WorkoutSheet {
  if (sheet.sessionStartedAt) return sheet;
  return { ...sheet, sessionStartedAt: new Date().toISOString() };
}

export function applyPrepBlockSessionToSheet(
  sheet: WorkoutSheet,
  variant: PrepSectionId,
  activities: PrepActivityRow[],
  timings: PrepStepTiming[],
  blockRestAfterSec?: number,
): WorkoutSheet {
  const merged = mergePrepStepTimings(activities, timings);
  const totalWorkSec = sumPrepStepWorkSec(timings);
  const actualMin = totalWorkSec > 0 ? Math.max(1, Math.round(totalWorkSec / 60)) : undefined;

  const patch: Partial<WorkoutSheet> = {
    sessionStartedAt: sheet.sessionStartedAt ?? new Date().toISOString(),
  };

  if (variant === 'warmup') {
    patch.warmupActivities = merged;
    if (actualMin != null) patch.warmupDurationMin = actualMin;
  } else {
    patch.cooldownActivities = merged;
    if (actualMin != null) patch.cooldownDurationMin = actualMin;
  }

  if (blockRestAfterSec != null && blockRestAfterSec > 0) {
    patch.blockRestAfterSec = {
      ...sheet.blockRestAfterSec,
      [variant]: blockRestAfterSec,
    };
  }

  return { ...sheet, ...patch };
}

export function prepActivityLabel(row: PrepActivityRow, index: number): string {
  return row.type?.trim() || `Этап ${index + 1}`;
}

const WORKOUT_SESSION_BLOCK_ORDER: WorkoutSectionId[] = [
  'warmup',
  'strength',
  'cardio',
  'circuit',
  'mobility',
  'cooldown',
];

export type WorkoutSessionStepRef =
  | { block: 'warmup' | 'cooldown'; activityIndex: number }
  | { block: 'cardio'; exerciseIndex: number }
  | { block: 'mobility'; exerciseIndex: number }
  | { block: 'strength'; exerciseIndex: number; setIndex: number }
  | { block: 'circuit'; round: number; stationIndex: number };

export interface WorkoutSessionStep {
  id: string;
  blockId: WorkoutSectionId;
  blockLabel: string;
  label: string;
  subtitle?: string;
  plannedWorkSec?: number;
  /** Отдых после шага до следующего (внутри блока), сек */
  plannedRestSec?: number;
  isLastInBlock: boolean;
  isLastInWorkout: boolean;
  ref: WorkoutSessionStepRef;
}

function pushPrepSteps(
  steps: WorkoutSessionStep[],
  blockId: 'warmup' | 'cooldown',
  activities: PrepActivityRow[],
) {
  const rows =
    activities.length > 0
      ? activities
      : [{ type: '', duration: '', zone: '', rpe: '', notes: '' }];
  rows.forEach((row, i) => {
    steps.push({
      id: `${blockId}-${i}`,
      blockId,
      blockLabel: WORKOUT_SECTION_LABELS[blockId],
      label: prepActivityLabel(row, i),
      subtitle: row.zone?.trim() || undefined,
      plannedWorkSec: parseDurationTextToSec(row.duration),
      isLastInBlock: false,
      isLastInWorkout: false,
      ref: { block: blockId, activityIndex: i },
    });
  });
}

export function buildWorkoutSessionPlan(sheet: WorkoutSheet): WorkoutSessionStep[] {
  const steps: WorkoutSessionStep[] = [];
  const mainBlocks = getWorkoutBlocks(sheet);

  for (const blockId of WORKOUT_SESSION_BLOCK_ORDER) {
    if (blockId === 'warmup' && !isPrepSectionEnabled(sheet, 'warmup')) continue;
    if (blockId === 'cooldown' && !isPrepSectionEnabled(sheet, 'cooldown')) continue;
    if (blockId === 'strength' && !mainBlocks.includes('strength')) continue;
    if (blockId === 'cardio' && !mainBlocks.includes('cardio')) continue;
    if (blockId === 'circuit' && !mainBlocks.includes('circuit')) continue;
    if (blockId === 'mobility' && !mainBlocks.includes('mobility')) continue;

    const startLen = steps.length;

    if (blockId === 'warmup') {
      pushPrepSteps(steps, 'warmup', sheet.warmupActivities ?? []);
    } else if (blockId === 'cooldown') {
      pushPrepSteps(steps, 'cooldown', sheet.cooldownActivities ?? []);
    } else if (blockId === 'cardio') {
      const rows =
        sheet.cardioExercises.length > 0
          ? sheet.cardioExercises
          : [{ modality: '', duration: '' }];
      rows.forEach((row, i) => {
        steps.push({
          id: `cardio-${i}`,
          blockId: 'cardio',
          blockLabel: WORKOUT_SECTION_LABELS.cardio,
          label: row.modality?.trim() || `Интервал ${i + 1}`,
          subtitle: row.zone?.trim() || undefined,
          plannedWorkSec: parseDurationTextToSec(row.duration),
          isLastInBlock: false,
          isLastInWorkout: false,
          ref: { block: 'cardio', exerciseIndex: i },
        });
      });
    } else if (blockId === 'mobility') {
      const rows =
        sheet.mobilityExercises.length > 0
          ? sheet.mobilityExercises
          : [{ name: '' }];
      rows.forEach((row, i) => {
        steps.push({
          id: `mobility-${i}`,
          blockId: 'mobility',
          blockLabel: WORKOUT_SECTION_LABELS.mobility,
          label: row.name?.trim() || `Упражнение ${i + 1}`,
          subtitle: row.focusArea?.trim() || undefined,
          plannedWorkSec: parseDurationTextToSec(row.duration),
          isLastInBlock: false,
          isLastInWorkout: false,
          ref: { block: 'mobility', exerciseIndex: i },
        });
      });
    } else if (blockId === 'strength') {
      const exercises =
        sheet.strengthExercises.length > 0
          ? sheet.strengthExercises
          : [{ name: 'Упражнение', sets: [{ load: '', restSec: 90 }] }];
      exercises.forEach((ex, ei) => {
        const sets = ex.sets.length > 0 ? ex.sets : [{ load: '' }];
        sets.forEach((set, si) => {
          const load = set.load?.trim() || [set.weight, set.reps].filter(Boolean).join('×');
          steps.push({
            id: `strength-${ei}-${si}`,
            blockId: 'strength',
            blockLabel: WORKOUT_SECTION_LABELS.strength,
            label: ex.name?.trim() || `Упражнение ${ei + 1}`,
            subtitle: load ? `Подход ${si + 1} · ${load}` : `Подход ${si + 1}`,
            plannedRestSec:
              typeof set.restSec === 'number' && set.restSec > 0
                ? set.restSec
                : undefined,
            isLastInBlock: false,
            isLastInWorkout: false,
            ref: { block: 'strength', exerciseIndex: ei, setIndex: si },
          });
        });
      });
    } else if (blockId === 'circuit' && sheet.circuit) {
      const { stations, rounds, restBetweenRoundsSec } = sheet.circuit;
      const stationList =
        stations.length > 0
          ? stations
          : [{ name: 'Станция 1', workSec: 45, restSec: 15 }];
      for (let r = 0; r < Math.max(1, rounds); r++) {
        stationList.forEach((station, si) => {
          const isLastStation = si === stationList.length - 1;
          const isLastRound = r === rounds - 1;
          steps.push({
            id: `circuit-${r}-${si}`,
            blockId: 'circuit',
            blockLabel: WORKOUT_SECTION_LABELS.circuit,
            label: station.name?.trim() || `Станция ${si + 1}`,
            subtitle: `Круг ${r + 1}/${rounds}`,
            plannedWorkSec: station.workSec,
            plannedRestSec: !isLastStation
              ? station.restSec
              : !isLastRound
                ? restBetweenRoundsSec
                : undefined,
            isLastInBlock: false,
            isLastInWorkout: false,
            ref: { block: 'circuit', round: r + 1, stationIndex: si },
          });
        });
      }
    }

    if (steps.length > startLen) {
      steps[steps.length - 1].isLastInBlock = true;
    }
  }

  if (steps.length > 0) {
    steps[steps.length - 1].isLastInWorkout = true;
  }

  return steps;
}

export function sessionStepTimingFromSheet(
  step: WorkoutSessionStep,
  sheet: WorkoutSheet,
): SessionStepTiming {
  const ref = step.ref;
  switch (ref.block) {
    case 'warmup': {
      const row = sheet.warmupActivities?.[ref.activityIndex];
      return prepStepTimingFromRow(row ?? {});
    }
    case 'cooldown': {
      const row = sheet.cooldownActivities?.[ref.activityIndex];
      return prepStepTimingFromRow(row ?? {});
    }
    case 'cardio': {
      const row = sheet.cardioExercises[ref.exerciseIndex];
      return {
        actualWorkSec: row?.actualWorkSec ?? 0,
        actualRestAfterSec: row?.actualRestAfterSec ?? 0,
        skipped: row?.skipped,
      };
    }
    case 'mobility': {
      const row = sheet.mobilityExercises[ref.exerciseIndex];
      return {
        actualWorkSec: row?.actualWorkSec ?? 0,
        actualRestAfterSec: row?.actualRestAfterSec ?? 0,
        skipped: row?.skipped,
      };
    }
    case 'strength': {
      const set = sheet.strengthExercises[ref.exerciseIndex]?.sets[ref.setIndex];
      return {
        actualWorkSec: set?.actualWorkSec ?? 0,
        actualRestAfterSec: set?.actualRestSec ?? 0,
      };
    }
    case 'circuit':
      return { actualWorkSec: 0, actualRestAfterSec: 0 };
    default:
      return { actualWorkSec: 0, actualRestAfterSec: 0 };
  }
}

export function applyWorkoutSessionToSheet(
  sheet: WorkoutSheet,
  steps: WorkoutSessionStep[],
  timings: SessionStepTiming[],
  blockRests: Partial<Record<WorkoutSectionId, number>>,
): WorkoutSheet {
  let next: WorkoutSheet = {
    ...sheet,
    sessionStartedAt: sheet.sessionStartedAt ?? new Date().toISOString(),
    sessionEndedAt: new Date().toISOString(),
    blockRestAfterSec: { ...sheet.blockRestAfterSec, ...blockRests },
  };

  const warmupActivities = [...(next.warmupActivities ?? [])];
  const cooldownActivities = [...(next.cooldownActivities ?? [])];
  const cardioExercises = [...next.cardioExercises];
  const mobilityExercises = [...next.mobilityExercises];
  const strengthExercises = next.strengthExercises.map((ex) => ({
    ...ex,
    sets: ex.sets.map((s) => ({ ...s })),
  }));

  steps.forEach((step, i) => {
    const t = timings[i];
    if (!t) return;
    const ref = step.ref;
    if (ref.block === 'warmup') {
      warmupActivities[ref.activityIndex] = {
        ...(warmupActivities[ref.activityIndex] ?? {}),
        actualWorkSec: t.skipped ? 0 : t.actualWorkSec,
        actualRestAfterSec: t.actualRestAfterSec,
        skipped: t.skipped,
      };
    } else if (ref.block === 'cooldown') {
      cooldownActivities[ref.activityIndex] = {
        ...(cooldownActivities[ref.activityIndex] ?? {}),
        actualWorkSec: t.skipped ? 0 : t.actualWorkSec,
        actualRestAfterSec: t.actualRestAfterSec,
        skipped: t.skipped,
      };
    } else if (ref.block === 'cardio') {
      cardioExercises[ref.exerciseIndex] = {
        ...cardioExercises[ref.exerciseIndex],
        actualWorkSec: t.skipped ? 0 : t.actualWorkSec,
        actualRestAfterSec: t.actualRestAfterSec,
        skipped: t.skipped,
      };
    } else if (ref.block === 'mobility') {
      mobilityExercises[ref.exerciseIndex] = {
        ...mobilityExercises[ref.exerciseIndex],
        actualWorkSec: t.skipped ? 0 : t.actualWorkSec,
        actualRestAfterSec: t.actualRestAfterSec,
        skipped: t.skipped,
      };
    } else if (ref.block === 'strength') {
      const ex = strengthExercises[ref.exerciseIndex];
      if (ex?.sets[ref.setIndex]) {
        ex.sets[ref.setIndex] = {
          ...ex.sets[ref.setIndex],
          actualWorkSec: t.skipped ? 0 : t.actualWorkSec,
          actualRestSec: t.actualRestAfterSec,
        };
      }
    }
  });

  next = {
    ...next,
    warmupActivities,
    cooldownActivities,
    cardioExercises,
    mobilityExercises,
    strengthExercises,
  };

  const blockIds = [...new Set(steps.map((s) => s.blockId))];
  for (const blockId of blockIds) {
    const blockSteps = steps.filter((s) => s.blockId === blockId);
    const blockTimings = blockSteps.map((s) => timings[steps.indexOf(s)]);
    const workSec = sumPrepStepWorkSec(blockTimings);
    const min = workSec > 0 ? Math.max(1, Math.round(workSec / 60)) : undefined;
    if (blockId === 'warmup' && min) next = { ...next, warmupDurationMin: min };
    if (blockId === 'cooldown' && min) next = { ...next, cooldownDurationMin: min };
    if (blockId === 'cardio' && min) next = { ...next, cardioTotalMin: min };
    if (blockId === 'mobility' && min) next = { ...next, mobilityDurationMin: min };
    if (blockId === 'strength' && min) next = { ...next, strengthDurationMin: min };
  }

  return { ...next, ...deriveSessionFactPatch(next) };
}

export function getUniqueSessionBlocks(
  steps: WorkoutSessionStep[],
): WorkoutSectionId[] {
  const seen = new Set<WorkoutSectionId>();
  const result: WorkoutSectionId[] = [];
  for (const s of steps) {
    if (!seen.has(s.blockId)) {
      seen.add(s.blockId);
      result.push(s.blockId);
    }
  }
  return result;
}
