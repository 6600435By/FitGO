/** Дни недели как на бумажном бланке тренера */
export const WORKOUT_WEEKDAY_LABELS = [
  'ПН',
  'ВТ',
  'СР',
  'ЧТ',
  'ПТ',
  'СБ',
  'ВС',
] as const;

export const STRENGTH_SET_COUNT = 5;
export const STRENGTH_EXERCISE_ROWS = 6;
export const STRENGTH_MAX_EXERCISES = 12;
export const STRENGTH_MAX_SETS = 10;
export const CARDIO_EXERCISE_ROWS = 4;
export const CARDIO_MAX_ROWS = 12;

export type CardioFieldId =
  | 'modality'
  | 'duration'
  | 'distance'
  | 'pace'
  | 'hr'
  | 'rpe'
  | 'zone'
  | 'incline'
  | 'resistance'
  | 'intervals'
  | 'notes';

export const CARDIO_FIELD_IDS: CardioFieldId[] = [
  'modality',
  'duration',
  'distance',
  'pace',
  'hr',
  'rpe',
  'zone',
  'incline',
  'resistance',
  'intervals',
  'notes',
];

/** @deprecated Миграция старых cardioFields */
const LEGACY_CARDIO_FIELD_MAP: Record<string, CardioFieldId> = {
  loadType: 'modality',
  interval: 'duration',
  lap: 'intervals',
  distanceIncline: 'distance',
};

export const CARDIO_FIELD_LABELS: Record<CardioFieldId, string> = {
  modality: 'Тренажёр / вид',
  duration: 'Время',
  distance: 'Дистанция',
  pace: 'Темп / скорость',
  hr: 'ЧСС',
  rpe: 'RPE',
  zone: 'Зона',
  incline: 'Наклон',
  resistance: 'Сопротивление',
  intervals: 'Интервалы',
  notes: 'Заметка',
};

export const CARDIO_FIELD_PLACEHOLDERS: Record<CardioFieldId, string> = {
  modality: 'Дорожка, вело, гребля…',
  duration: '20 мин',
  distance: '3.5 км',
  pace: '6:30 / км',
  hr: '145',
  rpe: '7',
  zone: 'Z2 или 70%',
  incline: '5%',
  resistance: 'Ур. 8 / 180 Вт',
  intervals: '4×2 мин / 1 мин отдых',
  notes: 'Техника, самочувствие…',
};

/** Рекомендуемый набор по умолчанию (FITT + RPE) */
export const CARDIO_DEFAULT_FIELDS: CardioFieldId[] = [
  'modality',
  'duration',
  'hr',
  'rpe',
];

export const CIRCUIT_STATION_MIN = 1;
export const CIRCUIT_STATION_MAX = 12;
export const CIRCUIT_STATION_DEFAULT = 4;

export type CircuitStationType = 'cardio' | 'strength' | 'core' | 'other';

export const CIRCUIT_STATION_TYPE_LABELS: Record<CircuitStationType, string> = {
  cardio: 'Кардио',
  strength: 'Сила',
  core: 'Кор',
  other: 'Другое',
};

export type CircuitStationFieldId =
  | 'stationType'
  | 'workSec'
  | 'restSec'
  | 'load'
  | 'targetHr'
  | 'tempo';

export const CIRCUIT_STATION_FIELD_IDS: CircuitStationFieldId[] = [
  'stationType',
  'workSec',
  'restSec',
  'load',
  'targetHr',
  'tempo',
];

export const CIRCUIT_STATION_FIELD_LABELS: Record<CircuitStationFieldId, string> = {
  stationType: 'Тип',
  workSec: 'Работа, сек',
  restSec: 'Отдых, сек',
  load: 'Нагрузка',
  targetHr: 'Цел. ЧСС',
  tempo: 'Темп',
};

export const CIRCUIT_STATION_FIELD_PLACEHOLDERS: Record<CircuitStationFieldId, string> = {
  stationType: '',
  workSec: '45',
  restSec: '15',
  load: 'кг / уровень',
  targetHr: '150',
  tempo: '3-1-2-0',
};

export const CIRCUIT_DEFAULT_STATION_FIELDS: CircuitStationFieldId[] = [
  'stationType',
  'workSec',
  'restSec',
  'targetHr',
];

export type PrepFieldId = 'type' | 'duration' | 'zone' | 'rpe' | 'notes';

export const PREP_FIELD_IDS: PrepFieldId[] = [
  'type',
  'duration',
  'zone',
  'rpe',
  'notes',
];

export const PREP_FIELD_LABELS: Record<PrepFieldId, string> = {
  type: 'Тип',
  duration: 'Время',
  zone: 'Зона',
  rpe: 'RPE',
  notes: 'Заметка',
};

export const PREP_FIELD_PLACEHOLDERS: Record<PrepFieldId, string> = {
  type: '',
  duration: '5 мин',
  zone: 'Z1',
  rpe: '5–6',
  notes: 'Детали…',
};

export const WARMUP_DEFAULT_FIELDS: PrepFieldId[] = ['type', 'duration', 'zone'];
export const COOLDOWN_DEFAULT_FIELDS: PrepFieldId[] = ['type', 'duration', 'notes'];

export const WARMUP_ACTIVITY_TYPES = [
  { id: 'mobility', label: 'Суставная' },
  { id: 'dynamic', label: 'Динамика' },
  { id: 'activation', label: 'Активация' },
  { id: 'lightCardio', label: 'Легкое кардио' },
] as const;

export const COOLDOWN_ACTIVITY_TYPES = [
  { id: 'stretch', label: 'Растяжка' },
  { id: 'breathing', label: 'Дыхание' },
  { id: 'lightCardio', label: 'Легкое кардио' },
  { id: 'foamRoll', label: 'Ролл / релиз' },
] as const;

export const PREP_MAX_ROWS = 8;

export type StrengthSetFieldId = 'weight' | 'reps' | 'rpe' | 'restSec' | 'tempo';

export const STRENGTH_SET_FIELD_IDS: StrengthSetFieldId[] = [
  'weight',
  'reps',
  'rpe',
  'restSec',
  'tempo',
];

export const STRENGTH_SET_FIELD_LABELS: Record<StrengthSetFieldId, string> = {
  weight: 'кг',
  reps: 'повт',
  rpe: 'RPE',
  restSec: 'отдых, сек',
  tempo: 'темп',
};

export const STRENGTH_DEFAULT_SET_FIELDS: StrengthSetFieldId[] = [
  'weight',
  'reps',
  'rpe',
  'restSec',
];

export const MOBILITY_MAX_ROWS = 12;

export type MobilityFieldId =
  | 'focusArea'
  | 'exerciseType'
  | 'equipment'
  | 'duration'
  | 'volume'
  | 'rpe'
  | 'side'
  | 'comfort'
  | 'notes';

export const MOBILITY_FIELD_IDS: MobilityFieldId[] = [
  'focusArea',
  'exerciseType',
  'equipment',
  'duration',
  'volume',
  'rpe',
  'side',
  'comfort',
  'notes',
];

export const MOBILITY_FIELD_LABELS: Record<MobilityFieldId, string> = {
  focusArea: 'Зона тела',
  exerciseType: 'Тип работы',
  equipment: 'Инвентарь',
  duration: 'Время',
  volume: 'Объём',
  rpe: 'RPE',
  side: 'Сторона',
  comfort: 'Самочувствие',
  notes: 'Заметка',
};

export const MOBILITY_FIELD_PLACEHOLDERS: Record<MobilityFieldId, string> = {
  focusArea: 'Колено, поясница…',
  exerciseType: 'Мобильность, стабилизация…',
  equipment: 'Коврик, эспандер, блок…',
  duration: '30 сек / 2 мин',
  volume: '3×10, 2×30 сек',
  rpe: '3–4',
  side: 'Левая / правая / обе',
  comfort: '1–10',
  notes: 'Техника, ощущения…',
};

/** FITT: тип + зона + время + объём + RPE */
export const MOBILITY_DEFAULT_FIELDS: MobilityFieldId[] = [
  'focusArea',
  'exerciseType',
  'duration',
  'volume',
  'rpe',
];

export const MOBILITY_EXERCISE_TYPES = [
  { id: 'mobility', label: 'Мобильность' },
  { id: 'stability', label: 'Стабилизация' },
  { id: 'stretch', label: 'Растяжка' },
  { id: 'activation', label: 'Активация' },
  { id: 'balance', label: 'Баланс' },
  { id: 'breathing', label: 'Дыхание' },
] as const;

export const MOBILITY_FOCUS_AREAS = [
  { id: 'spine', label: 'Позвоночник / кор' },
  { id: 'hip', label: 'Тазобедренный' },
  { id: 'knee', label: 'Колено' },
  { id: 'shoulder', label: 'Плечо' },
  { id: 'neck', label: 'Шея' },
  { id: 'ankle', label: 'Голеностоп' },
  { id: 'general', label: 'Общее' },
] as const;

export const MOBILITY_SIDE_OPTIONS = [
  { id: 'left', label: 'Левая' },
  { id: 'right', label: 'Правая' },
  { id: 'both', label: 'Обе' },
] as const;

/** Базовый инвентарь зала (ACSM corrective / Garmin Mobility) */
export const MOBILITY_EQUIPMENT_OPTIONS = [
  { id: 'bodyweight', label: 'Собственный вес' },
  { id: 'mat', label: 'Коврик' },
  { id: 'band', label: 'Эспандер / лента' },
  { id: 'ball', label: 'Фитбол / ролл' },
  { id: 'dumbbell', label: 'Гантель / гиря' },
  { id: 'block', label: 'Блок / стена' },
  { id: 'cable', label: 'Блок / кроссовер' },
  { id: 'machine', label: 'Тренажёр (базовый)' },
] as const;

export type PrepSectionId = 'warmup' | 'cooldown';

export const PREP_SECTION_IDS: PrepSectionId[] = ['warmup', 'cooldown'];

export type WorkoutMainBlock = 'strength' | 'cardio' | 'circuit' | 'mobility';

export type WorkoutSectionId =
  | 'warmup'
  | 'strength'
  | 'cardio'
  | 'circuit'
  | 'mobility'
  | 'cooldown';

export const WORKOUT_SECTION_LABELS: Record<WorkoutSectionId, string> = {
  warmup: 'Разминка',
  strength: 'Силовая',
  cardio: 'Кардио',
  circuit: 'Круговая',
  mobility: 'Биомеханика',
  cooldown: 'Заминка',
};

export interface WorkoutBlockProgress {
  /** Блок отмечен завершённым, открыт ввод итога */
  completed?: boolean;
  /** Итог сохранён — блок сворачивается */
  summarySaved?: boolean;
  collapsed?: boolean;
  /** Итог по блоку — виден клиенту в общей заметке */
  summaryNote?: string;
  completedAt?: string;
  summarySavedAt?: string;
}

export interface StrengthSetEntry {
  /** вес×повторы — синхронизируется из weight и reps */
  load: string;
  /** Вес, кг */
  weight?: string;
  /** Повторения */
  reps?: string;
  /** Субъективная нагрузка 1–10 */
  rpe?: number;
  /** Отдых после подхода, сек */
  restSec?: number;
  /** Темп, напр. 3-1-2-0 */
  tempo?: string;
}

export interface StrengthExerciseRow {
  name: string;
  sets: StrengthSetEntry[];
}

export interface CardioExerciseRow {
  modality?: string;
  duration?: string;
  distance?: string;
  pace?: string;
  hr?: string;
  rpe?: string;
  zone?: string;
  incline?: string;
  resistance?: string;
  intervals?: string;
  notes?: string;
}

export interface MobilityExerciseRow {
  name: string;
  focusArea?: string;
  exerciseType?: string;
  equipment?: string;
  duration?: string;
  volume?: string;
  rpe?: string;
  side?: string;
  comfort?: string;
  notes?: string;
}

export interface PrepActivityRow {
  type?: string;
  duration?: string;
  zone?: string;
  rpe?: string;
  notes?: string;
}

export interface CircuitStation {
  name: string;
  stationType?: CircuitStationType;
  /** Время работы на станции, сек */
  workSec?: number;
  /** Отдых после станции, сек */
  restSec?: number;
  tempo?: string;
  /** Целевая ЧСС */
  targetHr?: number;
  /** Сопротивление / вес / уровень */
  load?: string;
}

export interface CircuitStationResult {
  actualHr?: number;
  rpe?: number;
  notes?: string;
}

export interface CircuitRoundLog {
  round: number;
  stations: CircuitStationResult[];
  /** Отдых между кругами фактически, сек */
  roundRestSec?: number;
  avgHr?: number;
  maxHr?: number;
}

export interface CircuitWorkout {
  stations: CircuitStation[];
  stationFields?: CircuitStationFieldId[];
  /** Количество кругов */
  rounds: number;
  /** Отдых между кругами, сек */
  restBetweenRoundsSec?: number;
  /** Переход между станциями по умолчанию, сек */
  transitionSec?: number;
  /** Журнал выполненных кругов (для динамики) */
  roundLogs: CircuitRoundLog[];
}

/** Структурированный лист тренировки */
export interface WorkoutSheet {
  /** Включённые блоки тренировки (можно несколько) */
  blocks?: WorkoutMainBlock[];
  /** Разминка и заминка; undefined = обе включены */
  prepSections?: PrepSectionId[];
  /** @deprecated Используйте blocks. Оставлено для миграции старых листов. */
  mainBlock?: WorkoutMainBlock;
  clientAge?: number;
  warmupDurationMin?: number;
  warmupNotes?: string;
  warmupActivities?: PrepActivityRow[];
  warmupFields?: PrepFieldId[];
  cooldownDurationMin?: number;
  cooldownNotes?: string;
  cooldownActivities?: PrepActivityRow[];
  cooldownFields?: PrepFieldId[];
  strengthDurationMin?: number;
  strengthSetFields?: StrengthSetFieldId[];
  strengthExercises: StrengthExerciseRow[];
  cardioTotalMin?: number;
  /** Включённые колонки кардио-блока */
  cardioFields?: CardioFieldId[];
  cardioExercises: CardioExerciseRow[];
  mobilityDurationMin?: number;
  mobilityFields?: MobilityFieldId[];
  mobilityExercises: MobilityExerciseRow[];
  circuit?: CircuitWorkout;
  restingHr?: number;
  maxHr?: number;
  /** RPE всей сессии (TrainingPeaks feel) */
  sessionRpe?: number;
  /** Прогресс и итоги по блокам */
  blockProgress?: Partial<Record<WorkoutSectionId, WorkoutBlockProgress>>;
  /** Собранная заметка из блоков (авто) */
  sessionSummaryNote?: string;
  sessionCompleted?: boolean;
  sessionCompletedAt?: string;
  /** Только для тренера — клиент не видит */
  trainerPrivateNotes?: string;
  notes?: string;
}

export interface CircuitHistoryPoint {
  bookingId: string;
  date: string;
  roundsPlanned: number;
  roundsLogged: number;
  stationsCount: number;
  avgRpe?: number;
  avgHr?: number;
  maxHr?: number;
  totalWorkSec?: number;
}

function parseLoadToWeightReps(load: string): { weight?: string; reps?: string } {
  const trimmed = load.trim();
  const match = trimmed.match(/^(\d+(?:[.,]\d+)?)\s*[×x*]\s*(\d+)/i);
  if (match) {
    return { weight: match[1].replace(',', '.'), reps: match[2] };
  }
  return {};
}

export function strengthSetHasData(set: StrengthSetEntry): boolean {
  return Boolean(
    set.load?.trim() ||
      set.weight?.trim() ||
      set.reps?.trim() ||
      set.rpe ||
      set.restSec ||
      set.tempo?.trim(),
  );
}

export function syncStrengthSetLoad(set: StrengthSetEntry): StrengthSetEntry {
  const weight = set.weight?.trim() ?? '';
  const reps = set.reps?.trim() ?? '';
  if (weight && reps) {
    return { ...set, weight, reps, load: `${weight}×${reps}` };
  }
  if (weight || reps) {
    return { ...set, weight: weight || undefined, reps: reps || undefined, load: weight || reps };
  }
  return { ...set, load: set.load?.trim() ?? '' };
}

export function createEmptyStrengthSet(): StrengthSetEntry {
  return { load: '', weight: '', reps: '' };
}

export function createEmptyStrengthExercise(): StrengthExerciseRow {
  return { name: '', sets: [createEmptyStrengthSet()] };
}

function normalizeSetEntry(raw: unknown): StrengthSetEntry {
  if (typeof raw === 'string') {
    const parsed = parseLoadToWeightReps(raw.trim());
    return syncStrengthSetLoad({
      load: raw.trim(),
      weight: parsed.weight,
      reps: parsed.reps,
    });
  }
  if (raw && typeof raw === 'object') {
    const entry = raw as Partial<StrengthSetEntry>;
    let weight = entry.weight?.trim() ?? '';
    let reps = entry.reps?.trim() ?? '';
    const load = entry.load?.trim() ?? '';
    if (!weight && !reps && load) {
      const parsed = parseLoadToWeightReps(load);
      weight = parsed.weight ?? '';
      reps = parsed.reps ?? '';
    }
    return syncStrengthSetLoad({
      load,
      weight: weight || undefined,
      reps: reps || undefined,
      rpe:
        typeof entry.rpe === 'number' && entry.rpe >= 1 && entry.rpe <= 10
          ? entry.rpe
          : undefined,
      restSec:
        typeof entry.restSec === 'number' && entry.restSec >= 0
          ? entry.restSec
          : undefined,
      tempo: entry.tempo?.trim() || undefined,
    });
  }
  return createEmptyStrengthSet();
}

function normalizeStrengthExercises(
  raw: StrengthExerciseRow[] | undefined,
): StrengthExerciseRow[] {
  const rows = (raw ?? []).map((row) => ({
    name: row.name?.trim() ?? '',
    sets: (row.sets ?? []).map(normalizeSetEntry),
  }));

  const withContent = rows.filter(
    (row) => row.name || row.sets.some(strengthSetHasData),
  );

  if (withContent.length === 0) {
    return [createEmptyStrengthExercise()];
  }

  return withContent.map((row) => {
    const sets = row.sets.filter(strengthSetHasData);
    return {
      name: row.name,
      sets: sets.length > 0 ? sets : [createEmptyStrengthSet()],
    };
  });
}

function normalizeCircuitStation(raw: unknown): CircuitStation {
  if (!raw || typeof raw !== 'object') {
    return { name: '' };
  }
  const row = raw as Partial<CircuitStation>;
  const stationType =
    row.stationType &&
    ['cardio', 'strength', 'core', 'other'].includes(row.stationType)
      ? row.stationType
      : undefined;
  return {
    name: row.name?.trim() ?? '',
    stationType,
    workSec:
      typeof row.workSec === 'number' && row.workSec >= 0 ? row.workSec : undefined,
    restSec:
      typeof row.restSec === 'number' && row.restSec >= 0 ? row.restSec : undefined,
    tempo: row.tempo?.trim() || undefined,
    targetHr:
      typeof row.targetHr === 'number' && row.targetHr > 0
        ? row.targetHr
        : undefined,
    load: row.load?.trim() || undefined,
  };
}

export function createEmptyPrepRow(): PrepActivityRow {
  return Object.fromEntries(
    PREP_FIELD_IDS.map((field) => [field, '']),
  ) as PrepActivityRow;
}

export function prepRowHasData(
  row: PrepActivityRow,
  fields: PrepFieldId[] = PREP_FIELD_IDS,
): boolean {
  return fields.some((field) => Boolean(row[field]?.trim()));
}

function normalizePrepRow(raw: unknown): PrepActivityRow {
  if (!raw || typeof raw !== 'object') return createEmptyPrepRow();
  const row = raw as Partial<PrepActivityRow>;
  const result: PrepActivityRow = {};
  for (const field of PREP_FIELD_IDS) {
    result[field] = row[field]?.trim() ?? '';
  }
  return result;
}

export function normalizePrepFields(
  raw: PrepFieldId[] | undefined,
  defaults: PrepFieldId[],
): PrepFieldId[] {
  if (!Array.isArray(raw)) return [...defaults];
  const unique: PrepFieldId[] = [];
  for (const field of raw) {
    if (
      PREP_FIELD_IDS.includes(field as PrepFieldId) &&
      !unique.includes(field as PrepFieldId)
    ) {
      unique.push(field as PrepFieldId);
    }
  }
  return unique.length > 0 ? unique : [...defaults];
}

export function normalizePrepActivities(
  raw: PrepActivityRow[] | undefined,
  legacyNotes: string | undefined,
  fields: PrepFieldId[],
): PrepActivityRow[] {
  const rows = (raw ?? []).map(normalizePrepRow);
  const withContent = rows.filter((row) => prepRowHasData(row, PREP_FIELD_IDS));
  if (withContent.length === 0 && legacyNotes?.trim()) {
    const migrated = createEmptyPrepRow();
    migrated.notes = legacyNotes.trim();
    return [migrated];
  }
  if (withContent.length === 0) {
    return [createEmptyPrepRow()];
  }
  return withContent;
}

export function normalizeCircuitStationFields(
  raw: CircuitStationFieldId[] | undefined,
): CircuitStationFieldId[] {
  if (!Array.isArray(raw)) return [...CIRCUIT_DEFAULT_STATION_FIELDS];
  const unique: CircuitStationFieldId[] = [];
  for (const field of raw) {
    if (
      CIRCUIT_STATION_FIELD_IDS.includes(field as CircuitStationFieldId) &&
      !unique.includes(field as CircuitStationFieldId)
    ) {
      unique.push(field as CircuitStationFieldId);
    }
  }
  return unique.length > 0 ? unique : [...CIRCUIT_DEFAULT_STATION_FIELDS];
}

export function normalizeCircuitStations(
  raw: CircuitStation[] | undefined,
): CircuitStation[] {
  const stations = (raw ?? []).map(normalizeCircuitStation);
  const withContent = stations.filter(
    (s) =>
      s.name.trim() ||
      s.stationType ||
      s.workSec ||
      s.restSec ||
      s.tempo ||
      s.targetHr ||
      s.load,
  );
  if (withContent.length === 0) {
    return Array.from({ length: CIRCUIT_STATION_DEFAULT }, () => ({
      name: '',
      workSec: 45,
      restSec: 15,
    }));
  }
  return withContent;
}

export function createEmptyCircuitStation(): CircuitStation {
  return { name: '', workSec: 45, restSec: 15 };
}

export function normalizeStrengthSetFields(
  raw: StrengthSetFieldId[] | undefined,
): StrengthSetFieldId[] {
  if (!Array.isArray(raw)) return [...STRENGTH_DEFAULT_SET_FIELDS];
  const unique: StrengthSetFieldId[] = [];
  for (const field of raw) {
    if (
      STRENGTH_SET_FIELD_IDS.includes(field as StrengthSetFieldId) &&
      !unique.includes(field as StrengthSetFieldId)
    ) {
      unique.push(field as StrengthSetFieldId);
    }
  }
  return unique.length > 0 ? unique : [...STRENGTH_DEFAULT_SET_FIELDS];
}

/** Оценка макс. ЧСС по формуле 220 − возраст (Garmin / Polar baseline) */
export function estimatedMaxHr(age?: number): number | undefined {
  if (typeof age !== 'number' || age <= 0 || age > 120) return undefined;
  return 220 - age;
}

function normalizeRoundLog(
  raw: unknown,
  stationCount: number,
): CircuitRoundLog | null {
  if (!raw || typeof raw !== 'object') return null;
  const log = raw as Partial<CircuitRoundLog>;
  if (typeof log.round !== 'number' || log.round < 1) return null;

  const stations = Array.from({ length: stationCount }, (_, index) => {
    const result = log.stations?.[index];
    if (!result || typeof result !== 'object') return {};
    const r = result as CircuitStationResult;
    return {
      actualHr:
        typeof r.actualHr === 'number' && r.actualHr > 0 ? r.actualHr : undefined,
      rpe:
        typeof r.rpe === 'number' && r.rpe >= 1 && r.rpe <= 10 ? r.rpe : undefined,
      notes: r.notes?.trim() || undefined,
    };
  });

  return {
    round: log.round,
    stations,
    roundRestSec:
      typeof log.roundRestSec === 'number' && log.roundRestSec >= 0
        ? log.roundRestSec
        : undefined,
    avgHr:
      typeof log.avgHr === 'number' && log.avgHr > 0 ? log.avgHr : undefined,
    maxHr:
      typeof log.maxHr === 'number' && log.maxHr > 0 ? log.maxHr : undefined,
  };
}

export function createEmptyCardioRow(): CardioExerciseRow {
  return Object.fromEntries(
    CARDIO_FIELD_IDS.map((field) => [field, '']),
  ) as CardioExerciseRow;
}

export function cardioRowHasData(
  row: CardioExerciseRow,
  fields: CardioFieldId[] = CARDIO_FIELD_IDS,
): boolean {
  return fields.some((field) => Boolean(row[field]?.trim()));
}

function migrateLegacyCardioRow(raw: Record<string, unknown>): CardioExerciseRow {
  const old = raw as CardioExerciseRow & {
    loadType?: string;
    interval?: string;
    lap?: string;
    distanceIncline?: string;
  };

  let modality = old.modality?.trim() ?? old.loadType?.trim() ?? '';
  let duration = old.duration?.trim() ?? '';
  let intervals = old.intervals?.trim() ?? '';

  if (!duration && old.interval?.trim()) {
    const interval = old.interval.trim();
    if (/[x×/]/.test(interval)) {
      intervals = intervals || interval;
    } else {
      duration = interval;
    }
  }

  if (!intervals && old.lap?.trim()) {
    intervals = old.lap.trim();
  }

  let distance = old.distance?.trim() ?? '';
  let incline = old.incline?.trim() ?? '';
  if (old.distanceIncline?.trim() && (!distance || !incline)) {
    const parts = old.distanceIncline.split(/[,/]/).map((s) => s.trim());
    if (parts[0] && !distance) distance = parts[0];
    if (parts[1] && !incline) incline = parts[1];
    if (!distance && !incline) distance = old.distanceIncline.trim();
  }

  return {
    modality,
    duration,
    distance,
    pace: old.pace?.trim() ?? '',
    hr: old.hr?.trim() ?? '',
    rpe: old.rpe?.trim() ?? '',
    zone: old.zone?.trim() ?? '',
    incline,
    resistance: old.resistance?.trim() ?? '',
    intervals,
    notes: old.notes?.trim() ?? '',
  };
}

function normalizeCardioRow(
  raw: Partial<CardioExerciseRow> | Record<string, unknown> | undefined,
): CardioExerciseRow {
  if (!raw || typeof raw !== 'object') return createEmptyCardioRow();
  const migrated = migrateLegacyCardioRow(raw as Record<string, unknown>);
  const row: CardioExerciseRow = {};
  for (const field of CARDIO_FIELD_IDS) {
    row[field] = migrated[field]?.trim() ?? '';
  }
  return row;
}

export function normalizeCardioFields(
  raw: CardioFieldId[] | undefined,
): CardioFieldId[] {
  if (!Array.isArray(raw)) return [...CARDIO_DEFAULT_FIELDS];
  const unique: CardioFieldId[] = [];
  let hadLegacyDistanceIncline = false;

  for (const field of raw) {
    const key = field as string;
    if (key === 'distanceIncline') hadLegacyDistanceIncline = true;
    const mapped = LEGACY_CARDIO_FIELD_MAP[key] ?? field;
    if (
      CARDIO_FIELD_IDS.includes(mapped as CardioFieldId) &&
      !unique.includes(mapped as CardioFieldId)
    ) {
      unique.push(mapped as CardioFieldId);
    }
  }

  if (hadLegacyDistanceIncline && !unique.includes('incline')) {
    unique.push('incline');
  }

  return unique.length > 0 ? unique : [...CARDIO_DEFAULT_FIELDS];
}

export function normalizeCardioExercises(
  raw: CardioExerciseRow[] | undefined,
  fields: CardioFieldId[],
): CardioExerciseRow[] {
  const rows = (raw ?? []).map(normalizeCardioRow);
  const withContent = rows.filter((row) => cardioRowHasData(row, CARDIO_FIELD_IDS));
  if (withContent.length === 0) {
    return [createEmptyCardioRow()];
  }
  return withContent;
}

export function toggleCardioField(
  fields: CardioFieldId[],
  field: CardioFieldId,
): CardioFieldId[] {
  const enabled = fields.includes(field);
  if (enabled) {
    const next = fields.filter((f) => f !== field);
    return next.length > 0 ? next : fields;
  }
  return [...fields, field];
}

export function createEmptyMobilityExercise(): MobilityExerciseRow {
  return {
    name: '',
    ...Object.fromEntries(
      MOBILITY_FIELD_IDS.map((field) => [field, '']),
    ),
  };
}

export function mobilityRowHasData(
  row: MobilityExerciseRow,
  fields: MobilityFieldId[] = MOBILITY_FIELD_IDS,
): boolean {
  return Boolean(
    row.name?.trim() || fields.some((field) => Boolean(row[field]?.trim())),
  );
}

function normalizeMobilityRow(raw: unknown): MobilityExerciseRow {
  if (!raw || typeof raw !== 'object') return createEmptyMobilityExercise();
  const row = raw as Partial<MobilityExerciseRow>;
  const result: MobilityExerciseRow = { name: row.name?.trim() ?? '' };
  for (const field of MOBILITY_FIELD_IDS) {
    result[field] = row[field]?.trim() ?? '';
  }
  return result;
}

export function normalizeMobilityFields(
  raw: MobilityFieldId[] | undefined,
): MobilityFieldId[] {
  if (!Array.isArray(raw)) return [...MOBILITY_DEFAULT_FIELDS];
  const unique: MobilityFieldId[] = [];
  for (const field of raw) {
    if (
      MOBILITY_FIELD_IDS.includes(field as MobilityFieldId) &&
      !unique.includes(field as MobilityFieldId)
    ) {
      unique.push(field as MobilityFieldId);
    }
  }
  return unique.length > 0 ? unique : [...MOBILITY_DEFAULT_FIELDS];
}

export function normalizeMobilityExercises(
  raw: MobilityExerciseRow[] | undefined,
): MobilityExerciseRow[] {
  const rows = (raw ?? []).map(normalizeMobilityRow);
  const withContent = rows.filter((row) => mobilityRowHasData(row, MOBILITY_FIELD_IDS));
  if (withContent.length === 0) {
    return [createEmptyMobilityExercise()];
  }
  return withContent;
}

export function createDefaultCircuit(
  stationCount = CIRCUIT_STATION_DEFAULT,
): CircuitWorkout {
  const count = Math.min(
    CIRCUIT_STATION_MAX,
    Math.max(CIRCUIT_STATION_MIN, stationCount),
  );
  return {
    rounds: 3,
    restBetweenRoundsSec: 90,
    transitionSec: 15,
    stationFields: [...CIRCUIT_DEFAULT_STATION_FIELDS],
    stations: Array.from({ length: count }, () => createEmptyCircuitStation()),
    roundLogs: [],
  };
}

export function createEmptyWorkoutSheet(): WorkoutSheet {
  return {
    blocks: ['strength'],
    strengthExercises: [createEmptyStrengthExercise()],
    strengthSetFields: [...STRENGTH_DEFAULT_SET_FIELDS],
    cardioExercises: [createEmptyCardioRow()],
    cardioFields: [...CARDIO_DEFAULT_FIELDS],
    mobilityExercises: [createEmptyMobilityExercise()],
    mobilityFields: [...MOBILITY_DEFAULT_FIELDS],
    warmupActivities: [createEmptyPrepRow()],
    warmupFields: [...WARMUP_DEFAULT_FIELDS],
    cooldownActivities: [createEmptyPrepRow()],
    cooldownFields: [...COOLDOWN_DEFAULT_FIELDS],
    notes: '',
  };
}

export function normalizeWorkoutSheet(raw: unknown): WorkoutSheet {
  const empty = createEmptyWorkoutSheet();
  if (!raw || typeof raw !== 'object') return empty;

  const data = raw as Partial<WorkoutSheet>;

  const strengthExercises = normalizeStrengthExercises(data.strengthExercises);
  const strengthSetFields = normalizeStrengthSetFields(data.strengthSetFields);

  const cardioFields = normalizeCardioFields(data.cardioFields);
  const cardioExercises = normalizeCardioExercises(data.cardioExercises, cardioFields);

  const mobilityFields = normalizeMobilityFields(data.mobilityFields);
  const mobilityExercises = normalizeMobilityExercises(data.mobilityExercises);

  const warmupFields = normalizePrepFields(data.warmupFields, WARMUP_DEFAULT_FIELDS);
  const warmupActivities = normalizePrepActivities(
    data.warmupActivities,
    data.warmupNotes,
    warmupFields,
  );

  const cooldownFields = normalizePrepFields(
    data.cooldownFields,
    COOLDOWN_DEFAULT_FIELDS,
  );
  const cooldownActivities = normalizePrepActivities(
    data.cooldownActivities,
    data.cooldownNotes,
    cooldownFields,
  );

  let circuit: CircuitWorkout | undefined;
  if (data.circuit && typeof data.circuit === 'object') {
    const rawCircuit = data.circuit as Partial<CircuitWorkout>;
    const stationFields = normalizeCircuitStationFields(rawCircuit.stationFields);
    const stations = normalizeCircuitStations(rawCircuit.stations);
    const stationCount = stations.length;
    const roundLogs = (rawCircuit.roundLogs ?? [])
      .map((log) => normalizeRoundLog(log, stationCount))
      .filter((log): log is CircuitRoundLog => log !== null);

    circuit = {
      rounds:
        typeof rawCircuit.rounds === 'number' && rawCircuit.rounds >= 1
          ? rawCircuit.rounds
          : 3,
      restBetweenRoundsSec:
        typeof rawCircuit.restBetweenRoundsSec === 'number'
          ? rawCircuit.restBetweenRoundsSec
          : undefined,
      transitionSec:
        typeof rawCircuit.transitionSec === 'number'
          ? rawCircuit.transitionSec
          : undefined,
      stationFields,
      stations,
      roundLogs,
    };
  }

  const blocks = normalizeWorkoutBlocks(data);

  const prepSections = normalizePrepSections(data.prepSections);

  const blockProgress = normalizeBlockProgress(data.blockProgress);

  return {
    blocks,
    prepSections,
    mainBlock: blocks[0],
    clientAge:
      typeof data.clientAge === 'number' && data.clientAge > 0
        ? data.clientAge
        : undefined,
    warmupDurationMin:
      typeof data.warmupDurationMin === 'number' && data.warmupDurationMin >= 0
        ? data.warmupDurationMin
        : undefined,
    warmupNotes: data.warmupNotes?.trim() || undefined,
    warmupActivities,
    warmupFields,
    cooldownDurationMin:
      typeof data.cooldownDurationMin === 'number' && data.cooldownDurationMin >= 0
        ? data.cooldownDurationMin
        : undefined,
    cooldownNotes: data.cooldownNotes?.trim() || undefined,
    cooldownActivities,
    cooldownFields,
    strengthDurationMin:
      typeof data.strengthDurationMin === 'number' && data.strengthDurationMin >= 0
        ? data.strengthDurationMin
        : undefined,
    strengthSetFields,
    strengthExercises,
    cardioTotalMin:
      typeof data.cardioTotalMin === 'number' && data.cardioTotalMin >= 0
        ? data.cardioTotalMin
        : undefined,
    cardioFields,
    cardioExercises,
    mobilityDurationMin:
      typeof data.mobilityDurationMin === 'number' && data.mobilityDurationMin >= 0
        ? data.mobilityDurationMin
        : undefined,
    mobilityFields,
    mobilityExercises,
    circuit,
    restingHr:
      typeof data.restingHr === 'number' && data.restingHr > 0
        ? data.restingHr
        : undefined,
    maxHr:
      typeof data.maxHr === 'number' && data.maxHr > 0 ? data.maxHr : undefined,
    sessionRpe:
      typeof data.sessionRpe === 'number' &&
      data.sessionRpe >= 1 &&
      data.sessionRpe <= 10
        ? data.sessionRpe
        : undefined,
    blockProgress,
    sessionSummaryNote: data.sessionSummaryNote?.trim() || undefined,
    sessionCompleted: data.sessionCompleted === true ? true : undefined,
    sessionCompletedAt:
      typeof data.sessionCompletedAt === 'string'
        ? data.sessionCompletedAt
        : undefined,
    trainerPrivateNotes: data.trainerPrivateNotes?.trim() || undefined,
    notes: data.notes?.trim() || undefined,
  };
}

function normalizeBlockProgress(
  raw: WorkoutSheet['blockProgress'],
): WorkoutSheet['blockProgress'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const result: NonNullable<WorkoutSheet['blockProgress']> = {};
  const ids: WorkoutSectionId[] = [
    'warmup',
    'strength',
    'cardio',
    'circuit',
    'mobility',
    'cooldown',
  ];
  for (const id of ids) {
    const entry = raw[id];
    if (!entry || typeof entry !== 'object') continue;
    const summaryNote = entry.summaryNote?.trim();
    const completed = entry.completed === true ? true : undefined;
    const summarySaved =
      entry.summarySaved === true
        ? true
        : completed && summaryNote
          ? true
          : undefined;
    result[id] = {
      completed,
      summarySaved,
      collapsed: entry.collapsed === true ? true : undefined,
      summaryNote: summaryNote || undefined,
      completedAt:
        typeof entry.completedAt === 'string' ? entry.completedAt : undefined,
      summarySavedAt:
        typeof entry.summarySavedAt === 'string' ? entry.summarySavedAt : undefined,
    };
    if (
      !result[id]!.completed &&
      !result[id]!.summarySaved &&
      !result[id]!.collapsed &&
      !result[id]!.summaryNote &&
      !result[id]!.completedAt &&
      !result[id]!.summarySavedAt
    ) {
      delete result[id];
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

const SESSION_SECTION_ORDER: WorkoutSectionId[] = [
  'warmup',
  'strength',
  'cardio',
  'circuit',
  'mobility',
  'cooldown',
];

export function compileSessionSummary(sheet: WorkoutSheet): string {
  const blocks = getWorkoutBlocks(sheet);
  const parts: string[] = [];

  for (const id of SESSION_SECTION_ORDER) {
    if (id === 'strength' && !blocks.includes('strength')) continue;
    if (id === 'cardio' && !blocks.includes('cardio')) continue;
    if (id === 'circuit' && !blocks.includes('circuit')) continue;
    if (id === 'mobility' && !blocks.includes('mobility')) continue;
    if (id === 'warmup' && !isPrepSectionEnabled(sheet, 'warmup')) continue;
    if (id === 'cooldown' && !isPrepSectionEnabled(sheet, 'cooldown')) continue;

    const progress = sheet.blockProgress?.[id];
    const note = progress?.summaryNote?.trim();
    if (progress?.summarySaved && note) {
      parts.push(`【${WORKOUT_SECTION_LABELS[id]}】\n${note}`);
    }
  }

  return parts.join('\n\n');
}

export function completeWorkoutSection(
  sheet: WorkoutSheet,
  sectionId: WorkoutSectionId,
): WorkoutSheet {
  const now = new Date().toISOString();
  return {
    ...sheet,
    sessionCompleted: undefined,
    sessionCompletedAt: undefined,
    blockProgress: {
      ...sheet.blockProgress,
      [sectionId]: {
        ...sheet.blockProgress?.[sectionId],
        completed: true,
        summarySaved: undefined,
        collapsed: undefined,
        completedAt: now,
        summaryNote: sheet.blockProgress?.[sectionId]?.summaryNote ?? '',
      },
    },
  };
}

export function saveBlockSummary(
  sheet: WorkoutSheet,
  sectionId: WorkoutSectionId,
): WorkoutSheet {
  const now = new Date().toISOString();
  const note = sheet.blockProgress?.[sectionId]?.summaryNote?.trim() ?? '';
  const withProgress: WorkoutSheet = {
    ...sheet,
    sessionCompleted: undefined,
    sessionCompletedAt: undefined,
    blockProgress: {
      ...sheet.blockProgress,
      [sectionId]: {
        ...sheet.blockProgress?.[sectionId],
        completed: true,
        summarySaved: true,
        collapsed: true,
        summaryNote: note,
        summarySavedAt: now,
      },
    },
  };
  const sessionSummaryNote = compileSessionSummary(withProgress);
  return {
    ...withProgress,
    sessionSummaryNote: sessionSummaryNote || undefined,
    notes: sessionSummaryNote || undefined,
  };
}

export function reopenWorkoutSection(
  sheet: WorkoutSheet,
  sectionId: WorkoutSectionId,
): WorkoutSheet {
  const blockProgress = { ...sheet.blockProgress };
  delete blockProgress[sectionId];
  const next: WorkoutSheet = {
    ...sheet,
    sessionCompleted: undefined,
    sessionCompletedAt: undefined,
    blockProgress:
      Object.keys(blockProgress).length > 0 ? blockProgress : undefined,
  };
  const sessionSummaryNote = compileSessionSummary(next);
  return {
    ...next,
    sessionSummaryNote: sessionSummaryNote || undefined,
    notes: sessionSummaryNote || undefined,
  };
}

export function toggleSectionCollapsed(
  sheet: WorkoutSheet,
  sectionId: WorkoutSectionId,
): WorkoutSheet {
  const current = sheet.blockProgress?.[sectionId];
  if (!current?.summarySaved) return sheet;
  return {
    ...sheet,
    blockProgress: {
      ...sheet.blockProgress,
      [sectionId]: {
        ...current,
        collapsed: current.collapsed === false,
      },
    },
  };
}

export function updateSectionSummaryNote(
  sheet: WorkoutSheet,
  sectionId: WorkoutSectionId,
  summaryNote: string,
): WorkoutSheet {
  return {
    ...sheet,
    blockProgress: {
      ...sheet.blockProgress,
      [sectionId]: {
        ...sheet.blockProgress?.[sectionId],
        summaryNote,
      },
    },
  };
}

export function completeWorkoutSession(sheet: WorkoutSheet): WorkoutSheet {
  const sessionSummaryNote = compileSessionSummary(sheet);
  const now = new Date().toISOString();
  return {
    ...sheet,
    sessionCompleted: true,
    sessionCompletedAt: now,
    sessionSummaryNote: sessionSummaryNote || undefined,
    notes: sessionSummaryNote || sheet.notes,
  };
}

/** Убирает поля, недоступные клиенту */
export function workoutSheetForClient(sheet: WorkoutSheet): WorkoutSheet {
  const normalized = normalizeWorkoutSheet(sheet);
  const { trainerPrivateNotes: _private, ...publicSheet } = normalized;
  return publicSheet;
}

export function isSectionCollapsed(
  sheet: WorkoutSheet,
  sectionId: WorkoutSectionId,
): boolean {
  const progress = sheet.blockProgress?.[sectionId];
  if (!progress?.summarySaved) return false;
  return progress.collapsed !== false;
}

export function isSectionSummarizing(
  sheet: WorkoutSheet,
  sectionId: WorkoutSectionId,
): boolean {
  const progress = sheet.blockProgress?.[sectionId];
  return Boolean(progress?.completed && !progress.summarySaved);
}

export function isSectionCompleted(
  sheet: WorkoutSheet,
  sectionId: WorkoutSectionId,
): boolean {
  return Boolean(sheet.blockProgress?.[sectionId]?.completed);
}

export function workoutSheetHasData(sheet: WorkoutSheet): boolean {
  const strengthFilled = sheet.strengthExercises.some(
    (row) =>
      row.name ||
      row.sets.some(
        (s) =>
          s.load ||
          s.weight ||
          s.reps ||
          s.rpe ||
          s.restSec ||
          s.tempo,
      ),
  );
  const cardioFilled = sheet.cardioExercises.some((row) =>
    cardioRowHasData(row, sheet.cardioFields ?? CARDIO_DEFAULT_FIELDS),
  );
  const circuitFilled = Boolean(
    sheet.circuit?.stations.some((s) => s.name) ||
      sheet.circuit?.roundLogs.length,
  );
  return Boolean(
    strengthFilled ||
      cardioFilled ||
      circuitFilled ||
      sheet.warmupNotes ||
      sheet.cooldownNotes ||
      sheet.notes ||
      sheet.warmupDurationMin ||
      sheet.cooldownDurationMin ||
      sheet.strengthDurationMin ||
      sheet.cardioTotalMin ||
      sheet.restingHr ||
      sheet.maxHr ||
      sheet.sessionCompleted ||
      sheet.trainerPrivateNotes,
  );
}

export function ageFromDateOfBirth(
  dateOfBirth: string,
  onDate = new Date(),
): number | undefined {
  const born = new Date(dateOfBirth);
  if (Number.isNaN(born.getTime())) return undefined;
  let age = onDate.getFullYear() - born.getFullYear();
  const monthDiff = onDate.getMonth() - born.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && onDate.getDate() < born.getDate())) {
    age -= 1;
  }
  return age > 0 && age < 120 ? age : undefined;
}

/** Сводка круговой для графика динамики */
export function summarizeCircuitSession(
  bookingId: string,
  date: string,
  sheet: WorkoutSheet,
): CircuitHistoryPoint | null {
  const circuit = sheet.circuit;
  if (!circuit || !getWorkoutBlocks(sheet).includes('circuit')) return null;

  const stationsCount = circuit.stations.filter((s) => s.name).length;
  if (!stationsCount && !circuit.roundLogs.length) return null;

  let rpeSum = 0;
  let rpeCount = 0;
  let hrSum = 0;
  let hrCount = 0;
  let maxHr: number | undefined;

  for (const log of circuit.roundLogs) {
    if (typeof log.avgHr === 'number') {
      hrSum += log.avgHr;
      hrCount += 1;
    }
    if (typeof log.maxHr === 'number') {
      maxHr = maxHr ? Math.max(maxHr, log.maxHr) : log.maxHr;
    }
    for (const station of log.stations) {
      if (typeof station.rpe === 'number') {
        rpeSum += station.rpe;
        rpeCount += 1;
      }
      if (typeof station.actualHr === 'number') {
        hrSum += station.actualHr;
        hrCount += 1;
        maxHr = maxHr ? Math.max(maxHr, station.actualHr) : station.actualHr;
      }
    }
  }

  const totalWorkSec = circuit.stations.reduce(
    (sum, station) => sum + (station.workSec ?? 0),
    0,
  ) * (circuit.roundLogs.length || circuit.rounds);

  return {
    bookingId,
    date,
    roundsPlanned: circuit.rounds,
    roundsLogged: circuit.roundLogs.length,
    stationsCount: stationsCount || circuit.stations.length,
    avgRpe: rpeCount ? Math.round((rpeSum / rpeCount) * 10) / 10 : undefined,
    avgHr: hrCount ? Math.round(hrSum / hrCount) : undefined,
    maxHr,
    totalWorkSec: totalWorkSec || undefined,
  };
}

export function normalizeWorkoutBlocks(
  data: Pick<WorkoutSheet, 'blocks' | 'mainBlock'> & { circuit?: CircuitWorkout },
): WorkoutMainBlock[] {
  const valid = (b: unknown): b is WorkoutMainBlock =>
    b === 'strength' || b === 'cardio' || b === 'circuit' || b === 'mobility';

  if (Array.isArray(data.blocks)) {
    const unique: WorkoutMainBlock[] = [];
    for (const block of data.blocks) {
      if (valid(block) && !unique.includes(block)) unique.push(block);
    }
    if (unique.length > 0) return unique;
  }

  if (valid(data.mainBlock)) return [data.mainBlock];
  if (data.circuit) return ['circuit'];
  return ['strength'];
}

export function getWorkoutBlocks(sheet: WorkoutSheet): WorkoutMainBlock[] {
  return normalizeWorkoutBlocks(sheet);
}

export function normalizePrepSections(
  raw: PrepSectionId[] | undefined,
): PrepSectionId[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const unique: PrepSectionId[] = [];
  for (const id of raw) {
    if (id === 'warmup' || id === 'cooldown') {
      if (!unique.includes(id)) unique.push(id);
    }
  }
  return unique.sort(
    (a, b) => PREP_SECTION_IDS.indexOf(a) - PREP_SECTION_IDS.indexOf(b),
  );
}

/** По умолчанию разминка и заминка включены */
export function getPrepSections(sheet: WorkoutSheet): PrepSectionId[] {
  const normalized = normalizePrepSections(sheet.prepSections);
  if (normalized === undefined) return [...PREP_SECTION_IDS];
  return normalized;
}

export function isPrepSectionEnabled(
  sheet: WorkoutSheet,
  section: PrepSectionId,
): boolean {
  return getPrepSections(sheet).includes(section);
}

export function togglePrepSection(
  sheet: WorkoutSheet,
  section: PrepSectionId,
): WorkoutSheet {
  const current = getPrepSections(sheet);
  const enabled = current.includes(section);
  const next = enabled
    ? current.filter((s) => s !== section)
    : [...current, section].sort(
        (a, b) => PREP_SECTION_IDS.indexOf(a) - PREP_SECTION_IDS.indexOf(b),
      );
  return {
    ...sheet,
    prepSections: next.length === PREP_SECTION_IDS.length ? undefined : next,
  };
}

export function isWorkoutBlockEnabled(
  sheet: WorkoutSheet,
  block: WorkoutMainBlock,
): boolean {
  return getWorkoutBlocks(sheet).includes(block);
}

export function toggleWorkoutBlock(
  sheet: WorkoutSheet,
  block: WorkoutMainBlock,
): WorkoutSheet {
  const current = getWorkoutBlocks(sheet);
  const enabled = current.includes(block);
  let blocks: WorkoutMainBlock[];

  if (enabled) {
    blocks = current.filter((b) => b !== block);
    if (blocks.length === 0) blocks = ['strength'];
  } else {
    blocks = [...current, block];
  }

  let next: WorkoutSheet = { ...sheet, blocks, mainBlock: blocks[0] };
  if (block === 'circuit' && !enabled && !next.circuit) {
    next = { ...next, circuit: createDefaultCircuit() };
  }
  if (block === 'mobility' && !enabled) {
    next = {
      ...next,
      mobilityExercises: next.mobilityExercises?.length
        ? next.mobilityExercises
        : [createEmptyMobilityExercise()],
      mobilityFields: next.mobilityFields ?? [...MOBILITY_DEFAULT_FIELDS],
    };
  }
  if (blocks.includes('circuit') && next.circuit) {
    next = ensureCircuitRoundLogs(next);
  }
  return next;
}

export function ensureCircuitRoundLogs(sheet: WorkoutSheet): WorkoutSheet {
  if (!sheet.circuit) return sheet;
  const stationCount = sheet.circuit.stations.length;
  const roundLogs = Array.from({ length: sheet.circuit.rounds }, (_, index) => {
    const existing = sheet.circuit!.roundLogs.find((l) => l.round === index + 1);
    if (existing) {
      const stations = Array.from({ length: stationCount }, (_, si) =>
        existing.stations[si] ?? {},
      );
      return { ...existing, stations };
    }
    return {
      round: index + 1,
      stations: Array.from({ length: stationCount }, () => ({})),
    };
  });
  return {
    ...sheet,
    circuit: { ...sheet.circuit, roundLogs },
  };
}
