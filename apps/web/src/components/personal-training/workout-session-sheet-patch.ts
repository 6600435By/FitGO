'use client';

import type { WorkoutSheet } from '@fitgo/shared-types';
import { ensureCircuitRoundLogs } from '@fitgo/shared-types';
import type { WorkoutSessionStep } from '@fitgo/shared-types';
import type { SessionCaptureKind } from './workout-session-step-context';

export function patchSessionCapture(
  sheet: WorkoutSheet,
  step: WorkoutSessionStep,
  kind: SessionCaptureKind,
  value: string,
): WorkoutSheet {
  const trimmed = value.trim();
  const ref = step.ref;

  if (kind === 'hr' && ref.block === 'cardio') {
    const exercises = [...sheet.cardioExercises];
    exercises[ref.exerciseIndex] = {
      ...exercises[ref.exerciseIndex],
      actualHr: trimmed || undefined,
    };
    return { ...sheet, cardioExercises: exercises };
  }

  if (kind === 'rpe') {
    if (ref.block === 'warmup' || ref.block === 'cooldown') {
      const key = ref.block === 'warmup' ? 'warmupActivities' : 'cooldownActivities';
      const rows = [...(sheet[key] ?? [])];
      rows[ref.activityIndex] = {
        ...rows[ref.activityIndex],
        actualRpe: trimmed || undefined,
      };
      return { ...sheet, [key]: rows };
    }
    if (ref.block === 'cardio') {
      const exercises = [...sheet.cardioExercises];
      exercises[ref.exerciseIndex] = {
        ...exercises[ref.exerciseIndex],
        actualRpe: trimmed || undefined,
      };
      return { ...sheet, cardioExercises: exercises };
    }
    if (ref.block === 'mobility') {
      const exercises = [...sheet.mobilityExercises];
      exercises[ref.exerciseIndex] = {
        ...exercises[ref.exerciseIndex],
        actualRpe: trimmed || undefined,
      };
      return { ...sheet, mobilityExercises: exercises };
    }
    if (ref.block === 'strength') {
      const num = Number(trimmed);
      const exercises = sheet.strengthExercises.map((ex, ei) =>
        ei === ref.exerciseIndex
          ? {
              ...ex,
              sets: ex.sets.map((set, si) =>
                si === ref.setIndex
                  ? {
                      ...set,
                      actualRpe:
                        trimmed && Number.isFinite(num) && num >= 1 && num <= 10
                          ? num
                          : undefined,
                    }
                  : set,
              ),
            }
          : ex,
      );
      return { ...sheet, strengthExercises: exercises };
    }
  }

  if (kind === 'zone') {
    if (ref.block === 'warmup' || ref.block === 'cooldown') {
      const key = ref.block === 'warmup' ? 'warmupActivities' : 'cooldownActivities';
      const rows = [...(sheet[key] ?? [])];
      rows[ref.activityIndex] = {
        ...rows[ref.activityIndex],
        actualZone: trimmed || undefined,
      };
      return { ...sheet, [key]: rows };
    }
    if (ref.block === 'cardio') {
      const exercises = [...sheet.cardioExercises];
      exercises[ref.exerciseIndex] = {
        ...exercises[ref.exerciseIndex],
        actualZone: trimmed || undefined,
      };
      return { ...sheet, cardioExercises: exercises };
    }
  }

  if (kind === 'notes') {
    if (ref.block === 'warmup' || ref.block === 'cooldown') {
      const key = ref.block === 'warmup' ? 'warmupActivities' : 'cooldownActivities';
      const rows = [...(sheet[key] ?? [])];
      rows[ref.activityIndex] = {
        ...rows[ref.activityIndex],
        actualNotes: trimmed || undefined,
      };
      return { ...sheet, [key]: rows };
    }
    if (ref.block === 'cardio') {
      const exercises = [...sheet.cardioExercises];
      exercises[ref.exerciseIndex] = {
        ...exercises[ref.exerciseIndex],
        actualNotes: trimmed || undefined,
      };
      return { ...sheet, cardioExercises: exercises };
    }
    if (ref.block === 'mobility') {
      const exercises = [...sheet.mobilityExercises];
      exercises[ref.exerciseIndex] = {
        ...exercises[ref.exerciseIndex],
        actualNotes: trimmed || undefined,
      };
      return { ...sheet, mobilityExercises: exercises };
    }
  }

  if (kind === 'pace' && ref.block === 'cardio') {
    const exercises = [...sheet.cardioExercises];
    exercises[ref.exerciseIndex] = {
      ...exercises[ref.exerciseIndex],
      actualPace: trimmed || undefined,
    };
    return { ...sheet, cardioExercises: exercises };
  }

  if (kind === 'comfort' && ref.block === 'mobility') {
    const exercises = [...sheet.mobilityExercises];
    exercises[ref.exerciseIndex] = {
      ...exercises[ref.exerciseIndex],
      actualComfort: trimmed || undefined,
    };
    return { ...sheet, mobilityExercises: exercises };
  }

  if (kind === 'load' && ref.block === 'strength') {
    const exercises = sheet.strengthExercises.map((ex, ei) =>
      ei === ref.exerciseIndex
        ? {
            ...ex,
            sets: ex.sets.map((set, si) =>
              si === ref.setIndex
                ? { ...set, actualLoad: trimmed || undefined }
                : set,
            ),
          }
        : ex,
    );
    return { ...sheet, strengthExercises: exercises };
  }

  if (kind === 'circuit_hr' && ref.block === 'circuit' && sheet.circuit) {
    const hr = Number(trimmed);
    if (!trimmed || !Number.isFinite(hr) || hr <= 0) {
      const base = ensureCircuitRoundLogs(sheet);
      const roundIndex = ref.round - 1;
      const roundLogs = base.circuit!.roundLogs.map((log, ri) => {
        if (ri !== roundIndex) return log;
        const stations = [...log.stations];
        while (stations.length <= ref.stationIndex) stations.push({});
        stations[ref.stationIndex] = {
          ...stations[ref.stationIndex],
          actualHr: undefined,
        };
        return { ...log, stations };
      });
      return { ...base, circuit: { ...base.circuit!, roundLogs } };
    }
    const base = ensureCircuitRoundLogs(sheet);
    const roundIndex = ref.round - 1;
    const roundLogs = base.circuit!.roundLogs.map((log, ri) => {
      if (ri !== roundIndex) return log;
      const stations = [...log.stations];
      while (stations.length <= ref.stationIndex) stations.push({});
      stations[ref.stationIndex] = {
        ...stations[ref.stationIndex],
        actualHr: hr,
      };
      return { ...log, stations };
    });
    return { ...base, circuit: { ...base.circuit!, roundLogs } };
  }

  if (kind === 'circuit_rpe' && ref.block === 'circuit' && sheet.circuit) {
    const rpe = Number(trimmed);
    const base = ensureCircuitRoundLogs(sheet);
    const roundIndex = ref.round - 1;
    const roundLogs = base.circuit!.roundLogs.map((log, ri) => {
      if (ri !== roundIndex) return log;
      const stations = [...log.stations];
      while (stations.length <= ref.stationIndex) stations.push({});
      stations[ref.stationIndex] = {
        ...stations[ref.stationIndex],
        rpe:
          trimmed && Number.isFinite(rpe) && rpe >= 1 && rpe <= 10
            ? rpe
            : undefined,
      };
      return { ...log, stations };
    });
    return { ...base, circuit: { ...base.circuit!, roundLogs } };
  }

  return sheet;
}

export function getSessionCaptureValue(
  sheet: WorkoutSheet,
  step: WorkoutSessionStep,
  kind: SessionCaptureKind,
): string {
  const ref = step.ref;
  if (kind === 'hr' && ref.block === 'cardio') {
    return sheet.cardioExercises[ref.exerciseIndex]?.actualHr?.trim() ?? '';
  }
  if (kind === 'rpe') {
    if (ref.block === 'warmup' || ref.block === 'cooldown') {
      const row = (ref.block === 'warmup'
        ? sheet.warmupActivities
        : sheet.cooldownActivities)?.[ref.activityIndex];
      return row?.actualRpe?.trim() ?? '';
    }
    if (ref.block === 'cardio') {
      return sheet.cardioExercises[ref.exerciseIndex]?.actualRpe?.trim() ?? '';
    }
    if (ref.block === 'mobility') {
      return sheet.mobilityExercises[ref.exerciseIndex]?.actualRpe?.trim() ?? '';
    }
    if (ref.block === 'strength') {
      const rpe =
        sheet.strengthExercises[ref.exerciseIndex]?.sets[ref.setIndex]?.actualRpe;
      return rpe != null ? String(rpe) : '';
    }
  }
  if (kind === 'zone') {
    if (ref.block === 'warmup' || ref.block === 'cooldown') {
      const row = (ref.block === 'warmup'
        ? sheet.warmupActivities
        : sheet.cooldownActivities)?.[ref.activityIndex];
      return row?.actualZone?.trim() ?? '';
    }
    if (ref.block === 'cardio') {
      return sheet.cardioExercises[ref.exerciseIndex]?.actualZone?.trim() ?? '';
    }
  }
  if (kind === 'notes') {
    if (ref.block === 'warmup' || ref.block === 'cooldown') {
      const row = (ref.block === 'warmup'
        ? sheet.warmupActivities
        : sheet.cooldownActivities)?.[ref.activityIndex];
      return row?.actualNotes?.trim() ?? '';
    }
    if (ref.block === 'cardio') {
      return sheet.cardioExercises[ref.exerciseIndex]?.actualNotes?.trim() ?? '';
    }
    if (ref.block === 'mobility') {
      return sheet.mobilityExercises[ref.exerciseIndex]?.actualNotes?.trim() ?? '';
    }
  }
  if (kind === 'pace' && ref.block === 'cardio') {
    return sheet.cardioExercises[ref.exerciseIndex]?.actualPace?.trim() ?? '';
  }
  if (kind === 'comfort' && ref.block === 'mobility') {
    return sheet.mobilityExercises[ref.exerciseIndex]?.actualComfort?.trim() ?? '';
  }
  if (kind === 'load' && ref.block === 'strength') {
    const set = sheet.strengthExercises[ref.exerciseIndex]?.sets[ref.setIndex];
    if (set?.actualLoad?.trim()) return set.actualLoad.trim();
    const parts = [set?.actualWeight, set?.actualReps].filter(Boolean);
    return parts.length ? parts.join('×') : '';
  }
  if (kind === 'circuit_hr' && ref.block === 'circuit') {
    const log = sheet.circuit?.roundLogs[ref.round - 1];
    return log?.stations[ref.stationIndex]?.actualHr != null
      ? String(log.stations[ref.stationIndex].actualHr)
      : '';
  }
  if (kind === 'circuit_rpe' && ref.block === 'circuit') {
    const log = sheet.circuit?.roundLogs[ref.round - 1];
    const rpe = log?.stations[ref.stationIndex]?.rpe;
    return rpe != null ? String(rpe) : '';
  }
  return '';
}
