'use client';

import type { WorkoutSheet } from '@fitgo/shared-types';
import {
  CARDIO_FIELD_LABELS,
  MOBILITY_FIELD_LABELS,
  PREP_FIELD_LABELS,
  STRENGTH_SET_FIELD_LABELS,
  type WorkoutSessionStep,
} from '@fitgo/shared-types';
import type { SessionStepContext } from './workout-session-step-context';

interface WorkoutSessionPlanPreviewProps {
  sheet: WorkoutSheet;
  step: WorkoutSessionStep;
  context: SessionStepContext;
}

function PlanLine({ label, value }: { label: string; value?: string }) {
  if (!value?.trim()) return null;
  return (
    <p className="text-sm text-slate-300">
      <span className="text-slate-500">{label}: </span>
      {value}
    </p>
  );
}

export function WorkoutSessionPlanPreview({
  sheet,
  step,
  context,
}: WorkoutSessionPlanPreviewProps) {
  const ref = step.ref;

  if (ref.block === 'warmup' || ref.block === 'cooldown') {
    const row = (ref.block === 'warmup'
      ? sheet.warmupActivities
      : sheet.cooldownActivities)?.[ref.activityIndex];
    return (
      <div className="w-full rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <p className="mb-2 text-[10px] font-medium uppercase text-slate-500">
          План этапа
        </p>
        <PlanLine label={PREP_FIELD_LABELS.type} value={row?.type} />
        <PlanLine label={PREP_FIELD_LABELS.duration} value={row?.duration} />
        <PlanLine label={PREP_FIELD_LABELS.zone} value={row?.zone} />
        <PlanLine label={PREP_FIELD_LABELS.hr} value={row?.hr} />
        <PlanLine label={PREP_FIELD_LABELS.rpe} value={row?.rpe} />
      </div>
    );
  }

  if (ref.block === 'cardio') {
    const row = sheet.cardioExercises[ref.exerciseIndex];
    return (
      <div className="w-full rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <p className="mb-2 text-[10px] font-medium uppercase text-slate-500">
          План этапа
        </p>
        <PlanLine label={CARDIO_FIELD_LABELS.modality} value={row?.modality} />
        <PlanLine label={CARDIO_FIELD_LABELS.duration} value={row?.duration} />
        <PlanLine label={CARDIO_FIELD_LABELS.hr} value={row?.hr} />
        <PlanLine label={CARDIO_FIELD_LABELS.zone} value={row?.zone} />
        <PlanLine label={CARDIO_FIELD_LABELS.rpe} value={row?.rpe} />
      </div>
    );
  }

  if (ref.block === 'strength') {
    const ex = sheet.strengthExercises[ref.exerciseIndex];
    const set = ex?.sets[ref.setIndex];
    return (
      <div className="w-full rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <p className="mb-2 text-[10px] font-medium uppercase text-slate-500">
          План подхода
        </p>
        <PlanLine label="Упражнение" value={ex?.name} />
        <PlanLine
          label="Нагрузка"
          value={
            set?.load?.trim() ||
            [set?.weight, set?.reps].filter(Boolean).join('×')
          }
        />
        <PlanLine
          label={STRENGTH_SET_FIELD_LABELS.rpe}
          value={set?.rpe != null ? String(set.rpe) : undefined}
        />
        <PlanLine
          label={STRENGTH_SET_FIELD_LABELS.restSec}
          value={set?.restSec != null ? `${set.restSec} сек` : undefined}
        />
      </div>
    );
  }

  if (ref.block === 'circuit' && sheet.circuit) {
    const station = sheet.circuit.stations[ref.stationIndex];
    return (
      <div className="w-full rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <p className="mb-2 text-[10px] font-medium uppercase text-slate-500">
          План станции
        </p>
        <PlanLine label="Станция" value={station?.name} />
        <PlanLine
          label="Работа"
          value={
            station?.workSec != null ? `${station.workSec} сек` : undefined
          }
        />
        <PlanLine
          label="Цел. ЧСС"
          value={station?.targetHr != null ? String(station.targetHr) : undefined}
        />
        <PlanLine label="Нагрузка" value={station?.load} />
      </div>
    );
  }

  if (ref.block === 'mobility') {
    const row = sheet.mobilityExercises[ref.exerciseIndex];
    return (
      <div className="w-full rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <p className="mb-2 text-[10px] font-medium uppercase text-slate-500">
          План этапа
        </p>
        <PlanLine label="Упражнение" value={row?.name} />
        <PlanLine label={MOBILITY_FIELD_LABELS.duration} value={row?.duration} />
        <PlanLine label={MOBILITY_FIELD_LABELS.rpe} value={row?.rpe} />
      </div>
    );
  }

  return null;
}
