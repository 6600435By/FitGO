/** Client self-filled training questionnaire (goals, experience, limits, prefs). */

export type ClientPrimaryGoal =
  | 'FAT_LOSS'
  | 'STRENGTH'
  | 'ENDURANCE'
  | 'MOBILITY'
  | 'GENERAL_FITNESS'
  | 'REHAB';

export type ExperienceLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';

export type PreferredModality = 'STRENGTH' | 'CARDIO' | 'GROUP' | 'PT';

export type BodyLimitationZone =
  | 'NONE'
  | 'KNEES'
  | 'BACK'
  | 'SHOULDERS'
  | 'NECK'
  | 'HIPS'
  | 'WRISTS'
  | 'ANKLES'
  | 'OTHER';

export type PreferredTimeOfDay =
  | 'MORNING'
  | 'DAY'
  | 'EVENING'
  | 'FLEXIBLE';

export type PreferredIntensity = 'EASY' | 'MODERATE' | 'HARD';

export type HomeEquipmentItem =
  | 'BODYWEIGHT'
  | 'MAT'
  | 'BANDS'
  | 'DUMBBELLS'
  | 'KETTLEBELL'
  | 'PULLUP_BAR'
  | 'BIKE'
  | 'TREADMILL'
  | 'OTHER';

export const CLIENT_PRIMARY_GOAL_LABELS: Record<ClientPrimaryGoal, string> = {
  FAT_LOSS: 'Похудение',
  STRENGTH: 'Сила',
  ENDURANCE: 'Выносливость',
  MOBILITY: 'Мобильность',
  GENERAL_FITNESS: 'Общий тонус',
  REHAB: 'Реабилитация',
};

export const EXPERIENCE_LEVEL_LABELS: Record<ExperienceLevel, string> = {
  BEGINNER: 'Новичок',
  INTERMEDIATE: 'Средний',
  ADVANCED: 'Продвинутый',
};

export const PREFERRED_MODALITY_LABELS: Record<PreferredModality, string> = {
  STRENGTH: 'Силовая',
  CARDIO: 'Кардио',
  GROUP: 'Групповые',
  PT: 'Персональные',
};

export const BODY_LIMITATION_LABELS: Record<BodyLimitationZone, string> = {
  NONE: 'Нет ограничений',
  KNEES: 'Колени',
  BACK: 'Спина',
  SHOULDERS: 'Плечи',
  NECK: 'Шея',
  HIPS: 'Таз / бёдра',
  WRISTS: 'Запястья',
  ANKLES: 'Голеностоп',
  OTHER: 'Другое',
};

export const PREFERRED_TIME_LABELS: Record<PreferredTimeOfDay, string> = {
  MORNING: 'Утро',
  DAY: 'День',
  EVENING: 'Вечер',
  FLEXIBLE: 'Гибко',
};

export const PREFERRED_INTENSITY_LABELS: Record<PreferredIntensity, string> = {
  EASY: 'Легко',
  MODERATE: 'Средне',
  HARD: 'Интенсивно',
};

export const HOME_EQUIPMENT_LABELS: Record<HomeEquipmentItem, string> = {
  BODYWEIGHT: 'Свой вес',
  MAT: 'Коврик',
  BANDS: 'Эспандеры',
  DUMBBELLS: 'Гантели',
  KETTLEBELL: 'Гиря',
  PULLUP_BAR: 'Турник',
  BIKE: 'Велотренажёр',
  TREADMILL: 'Беговая дорожка',
  OTHER: 'Другое',
};

export const GOAL_HORIZON_OPTIONS = [4, 8, 12] as const;

export interface ClientTrainingProfile {
  primaryGoals: ClientPrimaryGoal[];
  goalNotes?: string | null;
  goalHorizonWeeks?: number | null;
  experienceLevel?: ExperienceLevel | null;
  yearsTraining?: number | null;
  sessionsPerWeek?: number | null;
  preferredModalities: PreferredModality[];
  limitations: BodyLimitationZone[];
  limitationNotes?: string | null;
  pregnancyFlag?: boolean;
  bloodPressureFlag?: boolean;
  preferredSessionMin?: number | null;
  homeEquipment: HomeEquipmentItem[];
  preferredTimeOfDay?: PreferredTimeOfDay | null;
  preferredIntensity?: PreferredIntensity | null;
  updatedAt?: string | null;
}

export function emptyTrainingProfile(): ClientTrainingProfile {
  return {
    primaryGoals: [],
    preferredModalities: [],
    limitations: [],
    homeEquipment: [],
    pregnancyFlag: false,
    bloodPressureFlag: false,
  };
}

/** Rough completeness 0–100 for questionnaire (not account/gamification). */
export function trainingProfileCompleteness(p: ClientTrainingProfile): number {
  let score = 0;
  const checks = [
    p.primaryGoals.length > 0,
    !!p.experienceLevel,
    p.sessionsPerWeek != null && p.sessionsPerWeek > 0,
    p.limitations.length > 0,
    p.preferredModalities.length > 0,
    p.preferredSessionMin != null && p.preferredSessionMin > 0,
  ];
  for (const ok of checks) if (ok) score += 1;
  return Math.round((score / checks.length) * 100);
}
