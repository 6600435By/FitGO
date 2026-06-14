import { BadgeDataScope } from '@prisma/client';

export interface BadgeDef {
  slug: string;
  name: string;
  description: string;
  threshold?: number;
  category: string;
  tier?: string;
  dataScope: BadgeDataScope;
  streak?: boolean;
}

export const BADGE_DEFINITIONS: BadgeDef[] = [
  { slug: 'visit-1', name: 'Первый шаг', description: '1 визит', threshold: 1, category: 'visits', tier: 'bronze', dataScope: BadgeDataScope.SINCE_INSTALL },
  { slug: 'visit-10', name: 'Постоянный гость', description: '10 визитов', threshold: 10, category: 'visits', tier: 'bronze', dataScope: BadgeDataScope.SINCE_INSTALL },
  { slug: 'visit-25', name: 'Фанат фитнеса', description: '25 визитов', threshold: 25, category: 'visits', tier: 'silver', dataScope: BadgeDataScope.SINCE_INSTALL },
  { slug: 'visit-50', name: 'Полтинник', description: '50 визитов', threshold: 50, category: 'visits', tier: 'silver', dataScope: BadgeDataScope.SINCE_INSTALL },
  { slug: 'visit-100', name: 'Сотня', description: '100 визитов', threshold: 100, category: 'visits', tier: 'gold', dataScope: BadgeDataScope.SINCE_INSTALL },
  { slug: 'streak-3', name: 'Разгон', description: '3 дня подряд', threshold: 3, category: 'streak', tier: 'bronze', dataScope: BadgeDataScope.SINCE_INSTALL, streak: true },
  { slug: 'streak-7', name: 'Неделя силы', description: '7 дней подряд', threshold: 7, category: 'streak', tier: 'silver', dataScope: BadgeDataScope.SINCE_INSTALL, streak: true },
  { slug: 'streak-14', name: 'Две недели', description: '14 дней подряд', threshold: 14, category: 'streak', tier: 'gold', dataScope: BadgeDataScope.SINCE_INSTALL, streak: true },
  { slug: 'outdoor-first', name: 'Первый выход', description: '1 тренировка вне клуба', threshold: 1, category: 'outdoor', tier: 'bronze', dataScope: BadgeDataScope.SINCE_INSTALL },
  { slug: 'outdoor-10', name: 'Домашний атлет', description: '10 тренировок вне клуба', threshold: 10, category: 'outdoor', tier: 'silver', dataScope: BadgeDataScope.SINCE_INSTALL },
  { slug: 'loyalty-1y', name: 'Верный друг', description: '1 год непрерывности', threshold: 12, category: 'loyalty', tier: 'bronze', dataScope: BadgeDataScope.HISTORICAL },
  { slug: 'loyalty-2y', name: 'Клубный житель', description: '2 года непрерывности', threshold: 24, category: 'loyalty', tier: 'silver', dataScope: BadgeDataScope.HISTORICAL },
  { slug: 'loyalty-3y', name: 'Старожил', description: '3 года непрерывности', threshold: 36, category: 'loyalty', tier: 'gold', dataScope: BadgeDataScope.HISTORICAL },
  { slug: 'loyalty-5y', name: 'Столп клуба', description: '5 лет непрерывности', threshold: 60, category: 'loyalty', tier: 'platinum', dataScope: BadgeDataScope.HISTORICAL },
  { slug: 'loyalty-6y', name: 'Клубная легенда', description: '6+ лет непрерывности', threshold: 72, category: 'loyalty', tier: 'diamond', dataScope: BadgeDataScope.HISTORICAL },
];

export const XP_BY_ACTION = {
  CLUB_VISIT: 50,
  GROUP_PT: 40,
  WORKOUT_VERIFIED: 30,
  WORKOUT_MANUAL: 15,
  CHALLENGE_STEP: 20,
  CHALLENGE_COMPLETE: 100,
  BADGE: 150,
  STREAK_DAY: 10,
  DAILY_GOAL: 5,
} as const;

export const TIER_POINTS: Record<string, number> = {
  bronze: 50,
  silver: 100,
  gold: 200,
  platinum: 500,
  diamond: 500,
};
