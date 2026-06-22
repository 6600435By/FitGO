import type {
  CardioFieldId,
  MobilityFieldId,
  PrepFieldId,
  StrengthSetFieldId,
  WorkoutSectionId,
  WorkoutSheet,
} from '@fitgo/shared-types';
import {
  CARDIO_DEFAULT_FIELDS,
  CARDIO_FIELD_IDS,
  CARDIO_FIELD_LABELS,
  CIRCUIT_DEFAULT_STATION_FIELDS,
  COOLDOWN_DEFAULT_FIELDS,
  MOBILITY_DEFAULT_FIELDS,
  MOBILITY_FIELD_IDS,
  MOBILITY_FIELD_LABELS,
  PREP_FIELD_IDS,
  PREP_FIELD_LABELS,
  STRENGTH_DEFAULT_SET_FIELDS,
  STRENGTH_SET_FIELD_IDS,
  STRENGTH_SET_FIELD_LABELS,
  WARMUP_DEFAULT_FIELDS,
  createDefaultCircuit,
  getPrepSections,
  getWorkoutBlocks,
  isPrepSectionEnabled,
} from '@fitgo/shared-types';

export interface TimerFieldOption {
  id: string;
  label: string;
}

const CARDIO_TIMER_CAPTURE_IDS: CardioFieldId[] = [
  'hr',
  'rpe',
  'zone',
  'pace',
  'distance',
  'notes',
];

const PREP_TIMER_CAPTURE_IDS: PrepFieldId[] = ['zone', 'rpe', 'notes'];

const STRENGTH_TIMER_CAPTURE_IDS: StrengthSetFieldId[] = [
  'weight',
  'reps',
  'rpe',
  'tempo',
];

const MOBILITY_TIMER_CAPTURE_IDS: MobilityFieldId[] = ['rpe', 'comfort', 'notes'];

const CIRCUIT_TIMER_CAPTURE_IDS = ['hr', 'rpe', 'load'] as const;
export type CircuitTimerCaptureId = (typeof CIRCUIT_TIMER_CAPTURE_IDS)[number];

export function getTimerFieldOptions(
  blockId: WorkoutSectionId,
): TimerFieldOption[] {
  switch (blockId) {
    case 'warmup':
    case 'cooldown':
      return PREP_TIMER_CAPTURE_IDS.map((id) => ({
        id,
        label: PREP_FIELD_LABELS[id],
      }));
    case 'cardio':
      return CARDIO_TIMER_CAPTURE_IDS.map((id) => ({
        id,
        label: CARDIO_FIELD_LABELS[id],
      }));
    case 'strength':
      return STRENGTH_TIMER_CAPTURE_IDS.map((id) => ({
        id,
        label: STRENGTH_SET_FIELD_LABELS[id],
      }));
    case 'mobility':
      return MOBILITY_TIMER_CAPTURE_IDS.map((id) => ({
        id,
        label: MOBILITY_FIELD_LABELS[id],
      }));
    case 'circuit':
      return [
        { id: 'hr', label: 'ЧСС' },
        { id: 'rpe', label: 'RPE' },
        { id: 'load', label: 'Нагрузка' },
      ];
    default:
      return [];
  }
}

export function getActiveTimerFields(
  sheet: WorkoutSheet,
  blockId: WorkoutSectionId,
): string[] {
  switch (blockId) {
    case 'warmup':
      return (sheet.warmupFields ?? WARMUP_DEFAULT_FIELDS).filter((f) =>
        PREP_TIMER_CAPTURE_IDS.includes(f),
      );
    case 'cooldown':
      return (sheet.cooldownFields ?? COOLDOWN_DEFAULT_FIELDS).filter((f) =>
        PREP_TIMER_CAPTURE_IDS.includes(f),
      );
    case 'cardio':
      return (sheet.cardioFields ?? CARDIO_DEFAULT_FIELDS).filter((f) =>
        CARDIO_TIMER_CAPTURE_IDS.includes(f),
      );
    case 'strength':
      return (sheet.strengthSetFields ?? STRENGTH_DEFAULT_SET_FIELDS).filter(
        (f) => STRENGTH_TIMER_CAPTURE_IDS.includes(f),
      );
    case 'mobility':
      return (sheet.mobilityFields ?? MOBILITY_DEFAULT_FIELDS).filter((f) =>
        MOBILITY_TIMER_CAPTURE_IDS.includes(f),
      );
    case 'circuit':
      return sheet.circuit?.timerCaptureFields ?? ['hr'];
    default:
      return [];
  }
}

function mergePrepFields(
  current: PrepFieldId[] | undefined,
  defaults: PrepFieldId[],
  capture: PrepFieldId[],
): PrepFieldId[] {
  const base = current ?? defaults;
  const structural = base.filter((f) => f === 'type' || f === 'duration');
  const merged: PrepFieldId[] = [...structural];
  for (const field of capture) {
    if (PREP_FIELD_IDS.includes(field) && !merged.includes(field)) {
      merged.push(field);
    }
  }
  return merged.length > 0 ? merged : defaults;
}

function mergeCardioFields(
  current: CardioFieldId[] | undefined,
  capture: CardioFieldId[],
): CardioFieldId[] {
  const base = current ?? CARDIO_DEFAULT_FIELDS;
  const structural = base.filter((f) => f === 'modality' || f === 'duration');
  const merged: CardioFieldId[] = [...structural];
  for (const field of capture) {
    if (CARDIO_FIELD_IDS.includes(field) && !merged.includes(field)) {
      merged.push(field);
    }
  }
  return merged.length > 0 ? merged : CARDIO_DEFAULT_FIELDS;
}

function mergeStrengthFields(
  current: StrengthSetFieldId[] | undefined,
  capture: StrengthSetFieldId[],
): StrengthSetFieldId[] {
  const base = current ?? STRENGTH_DEFAULT_SET_FIELDS;
  const structural = base.filter(
    (f) => f === 'weight' || f === 'reps' || f === 'restSec',
  );
  const merged: StrengthSetFieldId[] = [...structural];
  for (const field of capture) {
    if (STRENGTH_SET_FIELD_IDS.includes(field) && !merged.includes(field)) {
      merged.push(field);
    }
  }
  return merged.length > 0 ? merged : STRENGTH_DEFAULT_SET_FIELDS;
}

function mergeMobilityFields(
  current: MobilityFieldId[] | undefined,
  capture: MobilityFieldId[],
): MobilityFieldId[] {
  const merged: MobilityFieldId[] = [...(current ?? MOBILITY_DEFAULT_FIELDS)];
  for (const field of capture) {
    if (MOBILITY_FIELD_IDS.includes(field) && !merged.includes(field)) {
      merged.push(field);
    }
  }
  return merged;
}

export function getTimerFieldDefaults(blockId: WorkoutSectionId): string[] {
  switch (blockId) {
    case 'cardio':
      return ['hr'];
    case 'circuit':
      return ['hr'];
    case 'strength':
      return ['rpe'];
    case 'warmup':
    case 'cooldown':
      return ['zone'];
    default:
      return [];
  }
}

export function applyTimerFieldDefaults(sheet: WorkoutSheet): WorkoutSheet {
  if (sheet.sessionStartedAt) return sheet;

  let next: WorkoutSheet = { ...sheet };

  if (isPrepSectionEnabled(next, 'warmup')) {
    next = {
      ...next,
      warmupFields: mergePrepFields(
        next.warmupFields,
        WARMUP_DEFAULT_FIELDS,
        getTimerFieldDefaults('warmup') as PrepFieldId[],
      ),
    };
  }

  if (isPrepSectionEnabled(next, 'cooldown')) {
    next = {
      ...next,
      cooldownFields: mergePrepFields(
        next.cooldownFields,
        COOLDOWN_DEFAULT_FIELDS,
        getTimerFieldDefaults('cooldown') as PrepFieldId[],
      ),
    };
  }

  const blocks = getWorkoutBlocks(next);
  if (blocks.includes('cardio')) {
    next = {
      ...next,
      cardioFields: mergeCardioFields(
        next.cardioFields,
        getTimerFieldDefaults('cardio') as CardioFieldId[],
      ),
    };
  }

  if (blocks.includes('strength')) {
    next = {
      ...next,
      strengthSetFields: mergeStrengthFields(
        next.strengthSetFields,
        getTimerFieldDefaults('strength') as StrengthSetFieldId[],
      ),
    };
  }

  if (blocks.includes('circuit')) {
    const circuit = next.circuit ?? createDefaultCircuit();
    next = {
      ...next,
      circuit: {
        ...circuit,
        timerCaptureFields: (circuit.timerCaptureFields ??
          ['hr']) as CircuitTimerCaptureId[],
        stationFields:
          circuit.stationFields ?? [...CIRCUIT_DEFAULT_STATION_FIELDS],
      },
    };
  }

  return next;
}

export function toggleTimerField(
  sheet: WorkoutSheet,
  blockId: WorkoutSectionId,
  fieldId: string,
): WorkoutSheet {
  const active = getActiveTimerFields(sheet, blockId);
  const enabled = active.includes(fieldId);
  const nextCapture = enabled
    ? active.filter((f) => f !== fieldId)
    : [...active, fieldId];

  if (nextCapture.length === 0 && enabled) {
    return sheet;
  }

  switch (blockId) {
    case 'warmup':
      return {
        ...sheet,
        warmupFields: mergePrepFields(
          sheet.warmupFields,
          WARMUP_DEFAULT_FIELDS,
          nextCapture as PrepFieldId[],
        ),
      };
    case 'cooldown':
      return {
        ...sheet,
        cooldownFields: mergePrepFields(
          sheet.cooldownFields,
          COOLDOWN_DEFAULT_FIELDS,
          nextCapture as PrepFieldId[],
        ),
      };
    case 'cardio':
      return {
        ...sheet,
        cardioFields: mergeCardioFields(
          sheet.cardioFields,
          nextCapture as CardioFieldId[],
        ),
      };
    case 'strength':
      return {
        ...sheet,
        strengthSetFields: mergeStrengthFields(
          sheet.strengthSetFields,
          nextCapture as StrengthSetFieldId[],
        ),
      };
    case 'mobility':
      return {
        ...sheet,
        mobilityFields: mergeMobilityFields(
          sheet.mobilityFields,
          nextCapture as MobilityFieldId[],
        ),
      };
    case 'circuit': {
      const circuit = sheet.circuit ?? createDefaultCircuit();
      return {
        ...sheet,
        circuit: {
          ...circuit,
          timerCaptureFields: nextCapture.filter((f) =>
            CIRCUIT_TIMER_CAPTURE_IDS.includes(f as CircuitTimerCaptureId),
          ) as CircuitTimerCaptureId[],
        },
      };
    }
    default:
      return sheet;
  }
}

export function getEnabledSessionBlocks(sheet: WorkoutSheet): WorkoutSectionId[] {
  const blocks: WorkoutSectionId[] = [];
  for (const id of getPrepSections(sheet)) {
    blocks.push(id);
  }
  for (const id of getWorkoutBlocks(sheet)) {
    blocks.push(id);
  }
  return blocks;
}
