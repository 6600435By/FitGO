import type { WorkoutSheet } from '@fitgo/shared-types';
import {
  CARDIO_FIELD_LABELS,
  MOBILITY_FIELD_LABELS,
  PREP_FIELD_LABELS,
  STRENGTH_SET_FIELD_LABELS,
  parseDurationTextToSec,
  type WorkoutSessionStep,
} from '@fitgo/shared-types';
import type { TimerApplyTarget } from './workout-timer-apply';
import { getActiveTimerFields } from './workout-session-field-config';

export type SessionCaptureKind =
  | 'hr'
  | 'rpe'
  | 'zone'
  | 'load'
  | 'notes'
  | 'pace'
  | 'comfort'
  | 'circuit_hr'
  | 'circuit_rpe';

export interface SessionCaptureField {
  kind: SessionCaptureKind;
  label: string;
  hint?: string;
  planned?: string;
}

export interface SessionStepContext {
  captureFields: SessionCaptureField[];
  hrApplyTarget: TimerApplyTarget | null;
  targetHr?: number;
  targetZone?: string;
}

function stepToApplyTarget(step: WorkoutSessionStep): TimerApplyTarget {
  const ref = step.ref;
  switch (ref.block) {
    case 'warmup':
    case 'cooldown':
      return { block: ref.block, kind: 'activity', activityIndex: ref.activityIndex };
    case 'cardio':
      return { block: 'cardio', kind: 'row', rowIndex: ref.exerciseIndex };
    case 'mobility':
      return { block: 'mobility', kind: 'row', rowIndex: ref.exerciseIndex };
    case 'strength':
      return {
        block: 'strength',
        kind: 'set_rest',
        exerciseIndex: ref.exerciseIndex,
        setIndex: ref.setIndex,
      };
    case 'circuit':
      return {
        block: 'circuit',
        kind: 'circuit',
        circuitRound: ref.round,
        circuitStationIndex: ref.stationIndex,
      };
    default:
      return { block: 'warmup', kind: 'block' };
  }
}

export function getSessionStepContext(
  sheet: WorkoutSheet,
  step: WorkoutSessionStep | undefined,
): SessionStepContext {
  if (!step) {
    return { captureFields: [], hrApplyTarget: null };
  }

  const ref = step.ref;
  const captureFields: SessionCaptureField[] = [];
  let hrApplyTarget: TimerApplyTarget | null = null;
  let targetHr: number | undefined;
  let targetZone: string | undefined;

  if (ref.block === 'warmup' || ref.block === 'cooldown') {
    const activeFields = getActiveTimerFields(sheet, ref.block);
    const row = (ref.block === 'warmup'
      ? sheet.warmupActivities
      : sheet.cooldownActivities)?.[ref.activityIndex];
    if (activeFields.includes('zone')) {
      captureFields.push({
        kind: 'zone',
        label: PREP_FIELD_LABELS.zone,
        planned: row?.zone?.trim(),
      });
    }
    if (activeFields.includes('hr')) {
      captureFields.push({
        kind: 'hr',
        label: PREP_FIELD_LABELS.hr,
        planned: row?.hr?.trim(),
        hint: 'уд/мин',
      });
      hrApplyTarget = stepToApplyTarget(step);
    }
    if (activeFields.includes('rpe')) {
      captureFields.push({
        kind: 'rpe',
        label: PREP_FIELD_LABELS.rpe,
        planned: row?.rpe?.trim(),
        hint: '1–10',
      });
    }
    if (activeFields.includes('notes')) {
      captureFields.push({
        kind: 'notes',
        label: PREP_FIELD_LABELS.notes,
        planned: row?.notes?.trim(),
      });
    }
    return {
      captureFields,
      hrApplyTarget,
      targetZone,
    };
  }

  if (ref.block === 'cardio') {
    const activeFields = getActiveTimerFields(sheet, 'cardio');
    const row = sheet.cardioExercises[ref.exerciseIndex];
    hrApplyTarget = stepToApplyTarget(step);
    if (activeFields.includes('hr')) {
      captureFields.push({
        kind: 'hr',
        label: CARDIO_FIELD_LABELS.hr,
        planned: row?.hr?.trim(),
        hint: 'уд/мин',
      });
    }
    if (activeFields.includes('rpe')) {
      captureFields.push({
        kind: 'rpe',
        label: CARDIO_FIELD_LABELS.rpe,
        planned: row?.rpe?.trim(),
        hint: '1–10',
      });
    }
    if (activeFields.includes('zone')) {
      const zone = row?.zone?.trim();
      if (zone) targetZone = zone;
      captureFields.push({
        kind: 'zone',
        label: CARDIO_FIELD_LABELS.zone,
        planned: zone,
      });
    }
    if (activeFields.includes('pace')) {
      captureFields.push({
        kind: 'pace',
        label: CARDIO_FIELD_LABELS.pace,
        planned: row?.pace?.trim(),
      });
    }
    if (activeFields.includes('notes')) {
      captureFields.push({
        kind: 'notes',
        label: CARDIO_FIELD_LABELS.notes,
        planned: row?.notes?.trim(),
      });
    }
    return {
      captureFields,
      hrApplyTarget,
      targetZone,
    };
  }

  if (ref.block === 'mobility') {
    const activeFields = getActiveTimerFields(sheet, 'mobility');
    const row = sheet.mobilityExercises[ref.exerciseIndex];
    if (activeFields.includes('rpe')) {
      captureFields.push({
        kind: 'rpe',
        label: MOBILITY_FIELD_LABELS.rpe,
        planned: row?.rpe?.trim(),
      });
    }
    if (activeFields.includes('comfort')) {
      captureFields.push({
        kind: 'comfort',
        label: MOBILITY_FIELD_LABELS.comfort,
        planned: row?.comfort?.trim(),
      });
    }
    if (activeFields.includes('notes')) {
      captureFields.push({
        kind: 'notes',
        label: MOBILITY_FIELD_LABELS.notes,
        planned: row?.notes?.trim(),
      });
    }
    return { captureFields, hrApplyTarget: null };
  }

  if (ref.block === 'strength') {
    const activeFields = getActiveTimerFields(sheet, 'strength');
    const set =
      sheet.strengthExercises[ref.exerciseIndex]?.sets[ref.setIndex];
    if (activeFields.includes('weight') || activeFields.includes('reps')) {
      const load =
        set?.load?.trim() || [set?.weight, set?.reps].filter(Boolean).join('×');
      captureFields.push({
        kind: 'load',
        label: 'Нагрузка',
        planned: load || undefined,
      });
    }
    if (activeFields.includes('rpe')) {
      captureFields.push({
        kind: 'rpe',
        label: STRENGTH_SET_FIELD_LABELS.rpe,
        planned: set?.rpe != null ? String(set.rpe) : undefined,
        hint: '1–10',
      });
    }
    return {
      captureFields,
      hrApplyTarget: null,
    };
  }

  if (ref.block === 'circuit' && sheet.circuit) {
    const station = sheet.circuit.stations[ref.stationIndex];
    const capture = getActiveTimerFields(sheet, 'circuit');
    hrApplyTarget = stepToApplyTarget(step);
    targetHr = station?.targetHr;
    if (capture.includes('hr')) {
      captureFields.push({
        kind: 'circuit_hr',
        label: 'ЧСС',
        planned: station?.targetHr ? `${station.targetHr}` : undefined,
        hint: 'уд/мин',
      });
    }
    if (capture.includes('rpe')) {
      captureFields.push({
        kind: 'circuit_rpe',
        label: 'RPE',
        hint: '1–10',
      });
    }
    if (capture.includes('load')) {
      captureFields.push({
        kind: 'load',
        label: 'Нагрузка',
        planned: station?.load?.trim() || undefined,
      });
    }
    return {
      captureFields,
      hrApplyTarget,
      targetHr: station?.targetHr,
    };
  }

  return { captureFields, hrApplyTarget };
}

export function getStepPlannedWorkSec(
  sheet: WorkoutSheet,
  step: WorkoutSessionStep,
): number | undefined {
  const ref = step.ref;
  if (ref.block === 'warmup' || ref.block === 'cooldown') {
    const row = (ref.block === 'warmup'
      ? sheet.warmupActivities
      : sheet.cooldownActivities)?.[ref.activityIndex];
    return parseDurationTextToSec(row?.duration) ?? step.plannedWorkSec;
  }
  if (ref.block === 'cardio') {
    return (
      parseDurationTextToSec(sheet.cardioExercises[ref.exerciseIndex]?.duration) ??
      step.plannedWorkSec
    );
  }
  if (ref.block === 'mobility') {
    return (
      parseDurationTextToSec(sheet.mobilityExercises[ref.exerciseIndex]?.duration) ??
      step.plannedWorkSec
    );
  }
  if (ref.block === 'circuit') {
    const station = sheet.circuit?.stations[ref.stationIndex];
    return station?.workSec ?? step.plannedWorkSec;
  }
  return step.plannedWorkSec;
}

export function getStepPlannedRestSec(
  sheet: WorkoutSheet,
  step: WorkoutSessionStep,
): number | undefined {
  const ref = step.ref;
  if (ref.block === 'strength') {
    const set =
      sheet.strengthExercises[ref.exerciseIndex]?.sets[ref.setIndex];
    if (typeof set?.restSec === 'number' && set.restSec > 0) return set.restSec;
  }
  if (ref.block === 'circuit' && sheet.circuit) {
    const stations = sheet.circuit.stations;
    const isLastStation = ref.stationIndex >= stations.length - 1;
    if (!isLastStation) {
      return stations[ref.stationIndex]?.restSec ?? sheet.circuit.transitionSec;
    }
    if (ref.round < sheet.circuit.rounds) {
      return sheet.circuit.restBetweenRoundsSec;
    }
  }
  return step.plannedRestSec;
}
