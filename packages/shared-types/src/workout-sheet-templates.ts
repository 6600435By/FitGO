import type {
  CardioExerciseRow,
  CircuitStation,
  MobilityExerciseRow,
  PrepActivityRow,
  StrengthExerciseRow,
  StrengthSetEntry,
  WorkoutSheet,
} from './workout-sheet';
import {
  CARDIO_DEFAULT_FIELDS,
  CIRCUIT_DEFAULT_STATION_FIELDS,
  COOLDOWN_DEFAULT_FIELDS,
  MOBILITY_DEFAULT_FIELDS,
  STRENGTH_DEFAULT_SET_FIELDS,
  WARMUP_DEFAULT_FIELDS,
  createEmptyCardioRow,
  createEmptyMobilityExercise,
  createEmptyStrengthExercise,
  createEmptyWorkoutSheet,
  normalizeWorkoutSheet,
} from './workout-sheet';

export interface WorkoutSheetTemplate {
  id: string;
  title: string;
  description: string;
  /** Собрать чистый план без факта сессии */
  build: () => WorkoutSheet;
}

function plannedSets(count: number, reps = '10'): StrengthSetEntry[] {
  return Array.from({ length: count }, () => ({
    load: '',
    weight: '',
    reps,
  }));
}

function strengthEx(
  name: string,
  setCount = 3,
  reps = '10',
): StrengthExerciseRow {
  return { name, sets: plannedSets(setCount, reps) };
}

function prep(
  type: string,
  duration: string,
  zone = '',
): PrepActivityRow {
  return { type, duration, zone, hr: '', rpe: '', notes: '' };
}

function cardio(
  modality: string,
  duration: string,
  zone = 'Z2',
): CardioExerciseRow {
  return {
    modality,
    duration,
    hr: '',
    rpe: '',
    zone,
    distance: '',
    pace: '',
    incline: '',
    resistance: '',
    intervals: '',
    notes: '',
  };
}

function mobility(
  name: string,
  focusArea: string,
  duration: string,
): MobilityExerciseRow {
  return {
    name,
    focusArea,
    duration,
    volume: '',
    rpe: '',
    side: '',
    comfort: '',
    notes: '',
    exerciseType: '',
    equipment: '',
  };
}

function station(
  name: string,
  stationType: CircuitStation['stationType'],
  workSec: number,
  restSec: number,
  load = '',
): CircuitStation {
  return { name, stationType, workSec, restSec, load };
}

function baseSheet(partial: Partial<WorkoutSheet>): WorkoutSheet {
  const empty = createEmptyWorkoutSheet();
  return normalizeWorkoutSheet({
    ...empty,
    ...partial,
    strengthSetFields: partial.strengthSetFields ?? [
      ...STRENGTH_DEFAULT_SET_FIELDS,
    ],
    cardioFields: partial.cardioFields ?? [...CARDIO_DEFAULT_FIELDS],
    mobilityFields: partial.mobilityFields ?? [...MOBILITY_DEFAULT_FIELDS],
    warmupFields: partial.warmupFields ?? [...WARMUP_DEFAULT_FIELDS],
    cooldownFields: partial.cooldownFields ?? [...COOLDOWN_DEFAULT_FIELDS],
    notes: '',
  });
}

export const WORKOUT_SHEET_TEMPLATES: WorkoutSheetTemplate[] = [
  {
    id: 'full-body',
    title: 'Силовая: всё тело',
    description: 'Разминка, 5 базовых упражнений, заминка',
    build: () =>
      baseSheet({
        blocks: ['strength'],
        prepSections: ['warmup', 'cooldown'],
        warmupActivities: [
          prep('Суставы / динамика', '8 мин'),
          prep('Лёгкое кардио', '5 мин', 'Z1'),
        ],
        strengthExercises: [
          strengthEx('Присед / жим ногами', 4, '8'),
          strengthEx('Жим лёжа / гантели', 3, '8'),
          strengthEx('Тяга в наклоне / блок', 3, '10'),
          strengthEx('Жим стоя / гантели', 3, '10'),
          strengthEx('Планка / кор', 3, '40 сек'),
        ],
        cooldownActivities: [prep('Растяжка', '5 мин')],
        cardioExercises: [createEmptyCardioRow()],
        mobilityExercises: [createEmptyMobilityExercise()],
      }),
  },
  {
    id: 'upper',
    title: 'Силовая: верх',
    description: 'Жим / тяга / плечи / руки',
    build: () =>
      baseSheet({
        blocks: ['strength'],
        prepSections: ['warmup', 'cooldown'],
        warmupActivities: [prep('Плечи и грудной отдел', '8 мин')],
        strengthExercises: [
          strengthEx('Жим лёжа', 4, '6–8'),
          strengthEx('Тяга верхнего блока', 4, '8–10'),
          strengthEx('Жим гантелей сидя', 3, '10'),
          strengthEx('Тяга гантели в упоре', 3, '10'),
          strengthEx('Бицепс / трицепс', 3, '12'),
        ],
        cooldownActivities: [prep('Растяжка груди и спины', '5 мин')],
        cardioExercises: [createEmptyCardioRow()],
        mobilityExercises: [createEmptyMobilityExercise()],
      }),
  },
  {
    id: 'lower',
    title: 'Силовая: низ',
    description: 'Квадрицепс, задняя цепь, ягодицы',
    build: () =>
      baseSheet({
        blocks: ['strength'],
        prepSections: ['warmup', 'cooldown'],
        warmupActivities: [prep('Таз и голеностоп', '8 мин')],
        strengthExercises: [
          strengthEx('Присед', 4, '6–8'),
          strengthEx('Румынская тяга', 4, '8'),
          strengthEx('Выпады / болгарские', 3, '10'),
          strengthEx('Ягодичный мост / hip thrust', 3, '12'),
          strengthEx('Икры', 3, '15'),
        ],
        cooldownActivities: [prep('Растяжка ног', '5 мин')],
        cardioExercises: [createEmptyCardioRow()],
        mobilityExercises: [createEmptyMobilityExercise()],
      }),
  },
  {
    id: 'cardio',
    title: 'Кардио-выносливость',
    description: 'Зона 2 + короткая заминка',
    build: () =>
      baseSheet({
        blocks: ['cardio'],
        prepSections: ['warmup', 'cooldown'],
        warmupActivities: [prep('Лёгкий старт', '5 мин', 'Z1')],
        strengthExercises: [createEmptyStrengthExercise()],
        cardioExercises: [
          cardio('Дорожка / вело / гребля', '25 мин', 'Z2'),
          cardio('Интервалы (по желанию)', '8 мин', 'Z3–Z4'),
        ],
        cardioFields: ['modality', 'duration', 'hr', 'rpe', 'zone', 'intervals'],
        cooldownActivities: [prep('Ходьба + дыхание', '5 мин', 'Z1')],
        mobilityExercises: [createEmptyMobilityExercise()],
      }),
  },
  {
    id: 'circuit',
    title: 'Круговая / HIIT',
    description: '4 станции, 3–4 круга',
    build: () =>
      baseSheet({
        blocks: ['circuit'],
        prepSections: ['warmup', 'cooldown'],
        warmupActivities: [prep('Динамика + пульс', '6 мин', 'Z1–Z2')],
        strengthExercises: [createEmptyStrengthExercise()],
        cardioExercises: [createEmptyCardioRow()],
        mobilityExercises: [createEmptyMobilityExercise()],
        circuit: {
          rounds: 4,
          restBetweenRoundsSec: 90,
          transitionSec: 15,
          stationFields: [...CIRCUIT_DEFAULT_STATION_FIELDS, 'load'],
          stations: [
            station('Гребля / байк', 'cardio', 45, 15),
            station('Гоблет-присед', 'strength', 45, 15),
            station('Отжимания / жим', 'strength', 45, 15),
            station('Планка / mountain climbers', 'core', 40, 20),
          ],
          roundLogs: [],
        },
        cooldownActivities: [prep('Растяжка', '5 мин')],
      }),
  },
  {
    id: 'mobility',
    title: 'Мобильность / восстановление',
    description: 'Мягкая нагрузка и биомеханика',
    build: () =>
      baseSheet({
        blocks: ['mobility'],
        prepSections: ['warmup', 'cooldown'],
        warmupActivities: [prep('Дыхание и суставы', '5 мин')],
        strengthExercises: [createEmptyStrengthExercise()],
        cardioExercises: [createEmptyCardioRow()],
        mobilityExercises: [
          mobility('Грудной отдел / лопатки', 'Спина / плечи', '5 мин'),
          mobility('Тазобедренные', 'Таз', '6 мин'),
          mobility('Голеностоп и стопа', 'Низ', '4 мин'),
          mobility('Растяжка задней цепи', 'Задняя цепь', '5 мин'),
        ],
        cooldownActivities: [prep('Релакс / дыхание', '3 мин')],
      }),
  },
  {
    id: 'blank',
    title: 'Пустой бланк',
    description: 'Очистить лист и начать с нуля',
    build: () => createEmptyWorkoutSheet(),
  },
];

/** Применить шаблон, сохранив возраст и ЧСС клиента из текущего листа. */
export function applyWorkoutSheetTemplate(
  current: WorkoutSheet,
  templateId: string,
): WorkoutSheet {
  const template =
    WORKOUT_SHEET_TEMPLATES.find((item) => item.id === templateId) ??
    WORKOUT_SHEET_TEMPLATES.find((item) => item.id === 'blank');
  const next = template ? template.build() : createEmptyWorkoutSheet();
  return {
    ...next,
    clientAge: current.clientAge,
    restingHr: current.restingHr,
    maxHr: current.maxHr,
  };
}
