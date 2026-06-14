import { LeagueTier } from '@prisma/client';

export const LEAGUE_TIER_ORDER: LeagueTier[] = [
  LeagueTier.BRONZE,
  LeagueTier.SILVER,
  LeagueTier.GOLD,
  LeagueTier.SAPPHIRE,
  LeagueTier.RUBY,
  LeagueTier.EMERALD,
  LeagueTier.DIAMOND,
  LeagueTier.OBSIDIAN,
];

export const LEAGUE_TIER_LABELS: Record<LeagueTier, string> = {
  [LeagueTier.BRONZE]: 'Бронза',
  [LeagueTier.SILVER]: 'Серебро',
  [LeagueTier.GOLD]: 'Золото',
  [LeagueTier.SAPPHIRE]: 'Сапфир',
  [LeagueTier.RUBY]: 'Рубин',
  [LeagueTier.EMERALD]: 'Изумруд',
  [LeagueTier.DIAMOND]: 'Алмаз',
  [LeagueTier.OBSIDIAN]: 'Обсидиан',
};

export function tierOrdinal(tier: LeagueTier): number {
  return LEAGUE_TIER_ORDER.indexOf(tier);
}

export function promoteTier(tier: LeagueTier): LeagueTier {
  const idx = tierOrdinal(tier);
  return idx < LEAGUE_TIER_ORDER.length - 1
    ? LEAGUE_TIER_ORDER[idx + 1]
    : tier;
}

export function demoteTier(tier: LeagueTier): LeagueTier {
  const idx = tierOrdinal(tier);
  return idx > 0 ? LEAGUE_TIER_ORDER[idx - 1] : tier;
}

export function maxTier(a: LeagueTier, b: LeagueTier): LeagueTier {
  return tierOrdinal(a) >= tierOrdinal(b) ? a : b;
}
