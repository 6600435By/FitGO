import type { SessionStepTiming, WorkoutSheet } from '@fitgo/shared-types';
import {
  CARDIO_FIELD_LABELS,
  formatBlockSessionClock,
  MOBILITY_FIELD_LABELS,
  PREP_FIELD_LABELS,
  STRENGTH_SET_FIELD_LABELS,
  type WorkoutSessionStep,
} from '@fitgo/shared-types';
import { getActiveTimerFields } from './workout-session-field-config';
import { getSessionCaptureValue } from './workout-session-sheet-patch';
import type { SessionCaptureKind } from './workout-session-step-context';

export interface PlanFactRow {
  id: string;
  label: string;
  plan: string;
  fact: string;
  hasPlan: boolean;
  hasFact: boolean;
}

function dash(value?: string | null): string {
  const v = value?.trim();
  return v ? v : '—';
}

export function getStepPlanFactRows(
  sheet: WorkoutSheet,
  step: WorkoutSessionStep,
  timing?: SessionStepTiming,
): PlanFactRow[] {
  const rows: PlanFactRow[] = [];
  const ref = step.ref;
  const activeFields = getActiveTimerFields(sheet, step.blockId);

  const pushTime = (
    label: string,
    planSec: number | undefined,
    factSec: number | undefined,
    id: string,
  ) => {
    const plan =
      planSec != null ? formatBlockSessionClock(planSec) : '—';
    const fact =
      factSec != null && factSec > 0 ? formatBlockSessionClock(factSec) : '—';
    rows.push({
      id,
      label,
      plan,
      fact,
      hasPlan: planSec != null,
      hasFact: factSec != null && factSec > 0,
    });
  };

  if (timing && !timing.skipped) {
    pushTime('Время работы', step.plannedWorkSec, timing.actualWorkSec, 'work');
    pushTime(
      'Отдых после',
      step.plannedRestSec,
      timing.actualRestAfterSec,
      'rest',
    );
  }

  if (ref.block === 'warmup' || ref.block === 'cooldown') {
    const row = (ref.block === 'warmup'
      ? sheet.warmupActivities
      : sheet.cooldownActivities)?.[ref.activityIndex];
    if (activeFields.includes('zone')) {
      rows.push({
        id: 'zone',
        label: PREP_FIELD_LABELS.zone,
        plan: dash(row?.zone),
        fact: dash(row?.actualZone),
        hasPlan: Boolean(row?.zone?.trim()),
        hasFact: Boolean(row?.actualZone?.trim()),
      });
    }
    if (activeFields.includes('hr')) {
      rows.push({
        id: 'hr',
        label: PREP_FIELD_LABELS.hr,
        plan: dash(row?.hr),
        fact: dash(row?.actualHr),
        hasPlan: Boolean(row?.hr?.trim()),
        hasFact: Boolean(row?.actualHr?.trim()),
      });
    }
    if (activeFields.includes('rpe')) {
      rows.push({
        id: 'rpe',
        label: PREP_FIELD_LABELS.rpe,
        plan: dash(row?.rpe),
        fact: dash(row?.actualRpe),
        hasPlan: Boolean(row?.rpe?.trim()),
        hasFact: Boolean(row?.actualRpe?.trim()),
      });
    }
    if (activeFields.includes('notes')) {
      rows.push({
        id: 'notes',
        label: PREP_FIELD_LABELS.notes,
        plan: dash(row?.notes),
        fact: dash(row?.actualNotes),
        hasPlan: Boolean(row?.notes?.trim()),
        hasFact: Boolean(row?.actualNotes?.trim()),
      });
    }
    return rows;
  }

  if (ref.block === 'cardio') {
    const row = sheet.cardioExercises[ref.exerciseIndex];
    const metrics: Array<{ field: string; kind: SessionCaptureKind; label: string; plan: string }> = [];
    if (activeFields.includes('hr')) {
      metrics.push({
        field: 'hr',
        kind: 'hr',
        label: CARDIO_FIELD_LABELS.hr,
        plan: dash(row?.hr),
      });
    }
    if (activeFields.includes('rpe')) {
      metrics.push({
        field: 'rpe',
        kind: 'rpe',
        label: CARDIO_FIELD_LABELS.rpe,
        plan: dash(row?.rpe),
      });
    }
    if (activeFields.includes('zone')) {
      metrics.push({
        field: 'zone',
        kind: 'zone',
        label: CARDIO_FIELD_LABELS.zone,
        plan: dash(row?.zone),
      });
    }
    if (activeFields.includes('pace')) {
      metrics.push({
        field: 'pace',
        kind: 'pace',
        label: CARDIO_FIELD_LABELS.pace,
        plan: dash(row?.pace),
      });
    }
    if (activeFields.includes('notes')) {
      metrics.push({
        field: 'notes',
        kind: 'notes',
        label: CARDIO_FIELD_LABELS.notes,
        plan: dash(row?.notes),
      });
    }
    for (const m of metrics) {
      const fact = getSessionCaptureValue(sheet, step, m.kind);
      rows.push({
        id: m.field,
        label: m.label,
        plan: m.plan,
        fact: dash(fact),
        hasPlan: m.plan !== '—',
        hasFact: fact.trim() !== '',
      });
    }
    return rows;
  }

  if (ref.block === 'mobility') {
    const row = sheet.mobilityExercises[ref.exerciseIndex];
    if (activeFields.includes('rpe')) {
      rows.push({
        id: 'rpe',
        label: MOBILITY_FIELD_LABELS.rpe,
        plan: dash(row?.rpe),
        fact: dash(row?.actualRpe),
        hasPlan: Boolean(row?.rpe?.trim()),
        hasFact: Boolean(row?.actualRpe?.trim()),
      });
    }
    if (activeFields.includes('comfort')) {
      rows.push({
        id: 'comfort',
        label: MOBILITY_FIELD_LABELS.comfort,
        plan: dash(row?.comfort),
        fact: dash(row?.actualComfort),
        hasPlan: Boolean(row?.comfort?.trim()),
        hasFact: Boolean(row?.actualComfort?.trim()),
      });
    }
    return rows;
  }

  if (ref.block === 'strength') {
    const set =
      sheet.strengthExercises[ref.exerciseIndex]?.sets[ref.setIndex];
    const planLoad =
      set?.load?.trim() || [set?.weight, set?.reps].filter(Boolean).join('×');
    if (
      activeFields.includes('weight') ||
      activeFields.includes('reps') ||
      activeFields.includes('rpe')
    ) {
      if (planLoad || activeFields.includes('weight') || activeFields.includes('reps')) {
        const factLoad =
          set?.actualLoad?.trim() ||
          [set?.actualWeight, set?.actualReps].filter(Boolean).join('×');
        rows.push({
          id: 'load',
          label: 'Нагрузка',
          plan: dash(planLoad),
          fact: dash(factLoad),
          hasPlan: Boolean(planLoad),
          hasFact: Boolean(factLoad),
        });
      }
    }
    if (activeFields.includes('rpe')) {
      rows.push({
        id: 'rpe',
        label: STRENGTH_SET_FIELD_LABELS.rpe,
        plan: set?.rpe != null ? String(set.rpe) : '—',
        fact: set?.actualRpe != null ? String(set.actualRpe) : '—',
        hasPlan: set?.rpe != null,
        hasFact: set?.actualRpe != null,
      });
    }
    return rows;
  }

  if (ref.block === 'circuit' && sheet.circuit) {
    const station = sheet.circuit.stations[ref.stationIndex];
    const capture = sheet.circuit.timerCaptureFields ?? ['hr'];
    if (capture.includes('hr')) {
      rows.push({
        id: 'hr',
        label: 'ЧСС',
        plan: station?.targetHr != null ? String(station.targetHr) : '—',
        fact: getSessionCaptureValue(sheet, step, 'circuit_hr') || '—',
        hasPlan: station?.targetHr != null,
        hasFact: Boolean(getSessionCaptureValue(sheet, step, 'circuit_hr')),
      });
    }
    if (capture.includes('rpe')) {
      rows.push({
        id: 'rpe',
        label: 'RPE',
        plan: '—',
        fact: getSessionCaptureValue(sheet, step, 'circuit_rpe') || '—',
        hasPlan: false,
        hasFact: Boolean(getSessionCaptureValue(sheet, step, 'circuit_rpe')),
      });
    }
    if (capture.includes('load')) {
      rows.push({
        id: 'load',
        label: 'Нагрузка',
        plan: dash(station?.load),
        fact: '—',
        hasPlan: Boolean(station?.load?.trim()),
        hasFact: false,
      });
    }
  }

  return rows;
}

export function getComparablePlanFactRows(rows: PlanFactRow[]): PlanFactRow[] {
  return rows.filter((r) => r.hasPlan || r.hasFact);
}
