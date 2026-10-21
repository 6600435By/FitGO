/**
 * Pure pricing / market analytics rules (season, promo, bridge, hints).
 * UI shows plain language; these helpers keep numbers consistent.
 */

import type {
  PricingBaselineKind,
  PricingHintAction,
  PricingSeasonMode,
  PricingSegmentKey,
} from '@fitgo/shared-types';

export const SHOP_TOP_N = 30;
export const CORE_REVENUE_SHARE = 0.8;
export const RAISE_PRICE_RATIO_MAX = 0.92;
export const PROMO_RATIO_MIN = 1.08;
export const DISCOUNT_REVIEW_SHARE_PCT = 8;

export const SEGMENT_LABELS: Record<PricingSegmentKey, string> = {
  membership: 'Абонементы',
  training: 'Тренировки',
  shop: 'Магазин',
  spa: 'СПА',
  solarium: 'Солярий',
  corporate: 'Корпо',
};

/** Map classifySaleType bucket → pricing segment. */
export function saleBucketToPricingSegment(
  bucket: string,
): Exclude<PricingSegmentKey, 'corporate'> | 'other' {
  switch (bucket) {
    case 'membership':
      return 'membership';
    case 'training':
      return 'training';
    case 'shop':
      return 'shop';
    case 'massage':
    case 'spa':
      return 'spa';
    case 'solarium':
      return 'solarium';
    default:
      return 'other';
  }
}

/** Month 1–12 → season tag for a single day. */
export function seasonForMonth(month: number): Exclude<
  PricingSeasonMode,
  'mixed' | 'promo'
> {
  if (month >= 5 && month <= 7) return 'low';
  if (month === 8) return 'august_sale';
  return 'high_inflow';
}

export function seasonForIsoDate(iso: string): Exclude<
  PricingSeasonMode,
  'mixed' | 'promo'
> {
  const month = Number(iso.slice(5, 7));
  return seasonForMonth(month);
}

export function seasonLabel(mode: PricingSeasonMode): string {
  switch (mode) {
    case 'low':
      return 'Низкий сезон';
    case 'august_sale':
      return 'Август — распродажа карт';
    case 'high_inflow':
      return 'С сентября смотрим, пришли ли люди';
    case 'promo':
      return 'Идёт распродажа абонементов';
    case 'mixed':
      return 'В периоде разные режимы';
    default:
      return 'Сезон';
  }
}

/** True if from..to crosses 1 May, 1 Aug, or 1 Sep (inclusive range). */
export function periodCrossesSeasonBoundary(from: string, to: string): boolean {
  const start = parseIso(from);
  const end = parseIso(to);
  if (end < start) return false;
  const modes = new Set<string>();
  for (let t = start; t <= end; t += 86400000) {
    const d = new Date(t);
    const iso = isoFromUtcNoon(d);
    modes.add(seasonForIsoDate(iso));
    if (modes.size > 1) return true;
  }
  return false;
}

export function dominantSeason(from: string, to: string): PricingSeasonMode {
  if (periodCrossesSeasonBoundary(from, to)) return 'mixed';
  return seasonForIsoDate(from);
}

export interface SaleWindowInput {
  from: string;
  to: string;
  segmentKey: PricingSegmentKey;
  builtin?: boolean;
}

/** Builtin August membership sale for a calendar year. */
export function builtinAugustWindow(year: number): SaleWindowInput {
  return {
    from: `${year}-08-01`,
    to: `${year}-08-31`,
    segmentKey: 'membership',
    builtin: true,
  };
}

export function windowsForYears(
  from: string,
  to: string,
  custom: SaleWindowInput[],
): SaleWindowInput[] {
  const y0 = Number(from.slice(0, 4));
  const y1 = Number(to.slice(0, 4));
  const out: SaleWindowInput[] = [...custom];
  for (let y = y0 - 1; y <= y1 + 1; y++) {
    out.push(builtinAugustWindow(y));
  }
  return out;
}

export function periodOverlapsWindow(
  from: string,
  to: string,
  win: SaleWindowInput,
): boolean {
  return from <= win.to && to >= win.from;
}

export function membershipPromoActive(
  from: string,
  to: string,
  windows: SaleWindowInput[],
): boolean {
  return windows.some(
    (w) =>
      w.segmentKey === 'membership' && periodOverlapsWindow(from, to, w),
  );
}

/**
 * Pick comparison baseline.
 * YoY preferred when history exists; prev only if same season and no promo mix.
 */
export function pickBaseline(params: {
  from: string;
  to: string;
  compareMode: 'prev' | 'yoy';
  compareFrom: string;
  compareTo: string;
  hasYoyData: boolean;
  windows: SaleWindowInput[];
}): {
  kind: PricingBaselineKind;
  useCompare: boolean;
  label: string;
  reasonDropped: string | null;
} {
  const { from, to, compareMode, compareFrom, compareTo, hasYoyData, windows } =
    params;
  const curSeason = dominantSeason(from, to);
  const cmpSeason = dominantSeason(compareFrom, compareTo);
  const curPromo = membershipPromoActive(from, to, windows);
  const cmpPromo = membershipPromoActive(compareFrom, compareTo, windows);

  if (curSeason === 'mixed' || periodCrossesSeasonBoundary(from, to)) {
    return {
      kind: 'none',
      useCompare: false,
      label: 'без единого сравнения',
      reasonDropped:
        'здесь разные режимы, они разделены — одной цифры плюс/минус нет',
    };
  }

  if (compareMode === 'yoy') {
    if (!hasYoyData) {
      return {
        kind: 'none',
        useCompare: false,
        label: 'сравниваем по календарю сезона, своего прошлого года ещё нет',
        reasonDropped: 'в кэше нет того же интервала год назад',
      };
    }
    return {
      kind: 'yoy',
      useCompare: true,
      label: `к ${compareFrom} — ${compareTo}`,
      reasonDropped: null,
    };
  }

  // prev mode — block cross-season and promo mix
  if (curSeason !== cmpSeason) {
    return {
      kind: 'none',
      useCompare: false,
      label: 'без сравнения с прошлым периодом',
      reasonDropped: `${seasonLabel(curSeason)} нельзя сравнивать с ${seasonLabel(cmpSeason)} как с просадкой`,
    };
  }
  if (curPromo !== cmpPromo) {
    return {
      kind: 'none',
      useCompare: false,
      label: 'без сравнения с прошлым периодом',
      reasonDropped: 'один период внутри акции, другой — нет',
    };
  }
  if (
    seasonForIsoDate(from) === 'high_inflow' &&
    seasonForIsoDate(compareFrom) === 'august_sale'
  ) {
    return {
      kind: 'none',
      useCompare: false,
      label: 'без сравнения кассы с августом',
      reasonDropped:
        'касса сентября ниже августа — так и задумано, карты продали в августе',
    };
  }

  return {
    kind: 'prev_same_season',
    useCompare: true,
    label: `к ${compareFrom} — ${compareTo}`,
    reasonDropped: null,
  };
}

/** September cash vs August is never a "revenue drop" signal. */
export function isFalseSeptemberCashDrop(
  from: string,
  to: string,
  compareFrom: string,
  compareTo: string,
): boolean {
  const cur = dominantSeason(from, to);
  const cmp = dominantSeason(compareFrom, compareTo);
  return cur === 'high_inflow' && cmp === 'august_sale';
}

/** May–Jul vs April is not a drop. */
export function isFalseSeasonTransitionDrop(
  from: string,
  to: string,
  compareFrom: string,
  compareTo: string,
): boolean {
  const cur = dominantSeason(from, to);
  const cmp = dominantSeason(compareFrom, compareTo);
  return cur === 'low' && cmp === 'high_inflow';
}

export function priceVolumeMixBridge(params: {
  revenueCur: number;
  revenueCmp: number;
  avgPriceCur: number;
  avgPriceCmp: number;
  qtyCur: number;
  qtyCmp: number;
}): {
  priceEffectMinor: number;
  volumeEffectMinor: number;
  mixEffectMinor: number;
  summary: string;
} {
  const {
    revenueCur,
    revenueCmp,
    avgPriceCur,
    avgPriceCmp,
    qtyCur,
    qtyCmp,
  } = params;
  const priceEffect = Math.round((avgPriceCur - avgPriceCmp) * qtyCur);
  const volumeEffect = Math.round((qtyCur - qtyCmp) * avgPriceCmp);
  const explained = priceEffect + volumeEffect;
  const mixEffect = Math.round(revenueCur - revenueCmp - explained);

  const absP = Math.abs(priceEffect);
  const absV = Math.abs(volumeEffect);
  const absM = Math.abs(mixEffect);
  let summary = 'без заметного изменения';
  if (absV >= absP && absV >= absM && absV > 0) {
    summary =
      qtyCur < qtyCmp ? 'меньше чеков' : 'больше чеков';
  } else if (absP >= absV && absP >= absM && absP > 0) {
    summary =
      avgPriceCur < avgPriceCmp ? 'дешевле продали' : 'дороже продали';
  } else if (absM > 0) {
    summary = 'ушли в более дешёвые';
  }
  return {
    priceEffectMinor: priceEffect,
    volumeEffectMinor: volumeEffect,
    mixEffectMinor: mixEffect,
    summary,
  };
}

export function markCoreProducts<T extends { revenueMinor: number }>(
  rows: T[],
  share = CORE_REVENUE_SHARE,
): Array<T & { isCore: boolean }> {
  const sorted = [...rows].sort((a, b) => b.revenueMinor - a.revenueMinor);
  const total = sorted.reduce((s, r) => s + r.revenueMinor, 0);
  let cum = 0;
  const coreIds = new Set<T>();
  for (const r of sorted) {
    if (total <= 0) break;
    if (cum / total < share) {
      coreIds.add(r);
      cum += r.revenueMinor;
    } else break;
  }
  return rows.map((r) => ({ ...r, isCore: coreIds.has(r) }));
}

export function takeTopByRevenue<T extends { revenueMinor: number }>(
  rows: T[],
  n = SHOP_TOP_N,
): T[] {
  return [...rows]
    .sort((a, b) => b.revenueMinor - a.revenueMinor)
    .slice(0, n);
}

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid]! : Math.round((v[mid - 1]! + v[mid]!) / 2);
}

export function marketRatio(
  ourPriceMinor: number | null,
  competitorPrices: number[],
): { medianMinor: number | null; ratio: number | null; label: string | null } {
  const med = median(competitorPrices);
  if (ourPriceMinor == null || med == null || med <= 0) {
    return { medianMinor: med, ratio: null, label: null };
  }
  const ratio = Math.round((ourPriceMinor / med) * 1000) / 1000;
  const our = Math.round(ourPriceMinor / 100);
  const them = Math.round(med / 100);
  return {
    medianMinor: med,
    ratio,
    label: `наша ${our}, у них около ${them}`,
  };
}

export interface HintContext {
  segmentKey: PricingSegmentKey;
  productName: string;
  revenueMinor: number;
  listPriceMinor: number | null;
  marketRatio: number | null;
  marketLabel: string | null;
  volumeDown: boolean;
  volumeFlatOrUp: boolean;
  discountSharePct: number | null;
  inMembershipPromo: boolean;
  season: PricingSeasonMode;
  /** September visits did not rise after August sale. */
  saleNoInflow?: boolean;
  /** Discount share still high 7d after promo ended. */
  discountStuck?: boolean;
  /** Membership stable, cross-sell low. */
  upsellGap?: boolean;
  baselineLabel: string;
  ignoredNote?: string | null;
}

export interface BuiltHint {
  action: PricingHintAction;
  title: string;
  body: string;
  ignoredNote?: string;
  segmentKey: PricingSegmentKey;
  productName?: string;
  weightMinor: number;
}

export function buildProductHint(ctx: HintContext): BuiltHint | null {
  const {
    segmentKey,
    productName,
    revenueMinor,
    marketRatio: ratio,
    marketLabel,
    volumeDown,
    volumeFlatOrUp,
    discountSharePct,
    inMembershipPromo,
    season,
    saleNoInflow,
    discountStuck,
    upsellGap,
    baselineLabel,
    ignoredNote,
  } = ctx;

  if (saleNoInflow && segmentKey === 'membership') {
    return {
      action: 'sale_no_inflow',
      title: 'Распродажа не привела приток',
      body: `${productName}: посещения после августа не выросли. Сравниваем с маем–июлем и прошлым сентябрём.`,
      ignoredNote:
        ignoredNote ??
        'Касса сентября ниже августа — так и задумано, карты продали в августе.',
      segmentKey,
      productName,
      weightMinor: revenueMinor,
    };
  }

  if (discountStuck) {
    return {
      action: 'discount_stuck',
      title: 'Скидка без роста объёма',
      body: `${productName}: скидки ≥15% от суммы до скидки, а объём не растёт (${baselineLabel}).`,
      segmentKey,
      productName,
      weightMinor: revenueMinor,
    };
  }

  if (inMembershipPromo && segmentKey === 'membership') {
    return null; // no raise_price / review_discounts during promo
  }

  const isRaiseSeason =
    season !== 'low' && season !== 'august_sale' && season !== 'promo';

  if (
    ratio != null &&
    ratio <= RAISE_PRICE_RATIO_MAX &&
    volumeFlatOrUp &&
    isRaiseSeason
  ) {
    return {
      action: 'raise_price',
      title: 'Поднять цену',
      body: `${productName}: ${marketLabel ?? 'мы дешевле рынка'}, чеков не меньше (${baselineLabel}).`,
      ignoredNote: ignoredNote ?? undefined,
      segmentKey,
      productName,
      weightMinor: revenueMinor,
    };
  }

  if (ratio != null && ratio >= PROMO_RATIO_MIN && volumeDown) {
    return {
      action: 'promo_or_value',
      title: 'Акция или ценность',
      body: `${productName}: ${marketLabel ?? 'мы дороже рынка'}, спрос ниже (${baselineLabel}).`,
      ignoredNote: ignoredNote ?? undefined,
      segmentKey,
      productName,
      weightMinor: revenueMinor,
    };
  }

  if (
    !inMembershipPromo &&
    discountSharePct != null &&
    discountSharePct >= DISCOUNT_REVIEW_SHARE_PCT &&
    (ratio == null ||
      (ratio > RAISE_PRICE_RATIO_MAX && ratio < PROMO_RATIO_MIN))
  ) {
    return {
      action: 'review_discounts',
      title: 'Разобрать скидки',
      body: `${productName}: скидки забирают ${Math.round(discountSharePct)}% выручки позиции. Прайс не трогаем.`,
      segmentKey,
      productName,
      weightMinor: revenueMinor,
    };
  }

  if (upsellGap && segmentKey === 'membership') {
    return {
      action: 'upsell',
      title: 'Допродажа',
      body: `Абонементы держатся (${baselineLabel}), допродажи в тренировки / СПА / магазин низкие.`,
      segmentKey,
      productName,
      weightMinor: revenueMinor,
    };
  }

  if (
    volumeDown &&
    (ratio == null ||
      (ratio > RAISE_PRICE_RATIO_MAX && ratio < PROMO_RATIO_MIN))
  ) {
    return {
      action: 'watch_demand',
      title: 'Смотреть спрос',
      body: `${productName}: объём ниже (${baselineLabel}), цена к рынку в норме — смотрим спрос, не цену.`,
      ignoredNote: ignoredNote ?? undefined,
      segmentKey,
      productName,
      weightMinor: revenueMinor,
    };
  }

  return null;
}

export function rankHints(hints: BuiltHint[], limit = 5): BuiltHint[] {
  return [...hints]
    .sort((a, b) => b.weightMinor - a.weightMinor)
    .slice(0, limit);
}

function parseIso(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getTime();
}

function isoFromUtcNoon(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function deltaPct(
  current: number,
  previous: number | null | undefined,
): number | null {
  if (previous == null || previous === 0) {
    return current === 0 ? 0 : null;
  }
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/** Discount share of list price: discount / (revenue + discount). */
export function discountShareOfListPct(
  discountMinor: number,
  revenueMinor: number,
): number | null {
  const list = revenueMinor + discountMinor;
  if (list <= 0 || discountMinor <= 0) return null;
  return Math.round((discountMinor / list) * 1000) / 10;
}

/** avgActual / listPrice (1.0 = sold at list). */
export function avgToListRatio(
  avgActualMinor: number | null | undefined,
  listPriceMinor: number | null | undefined,
): number | null {
  if (
    avgActualMinor == null ||
    listPriceMinor == null ||
    listPriceMinor <= 0
  ) {
    return null;
  }
  return Math.round((avgActualMinor / listPriceMinor) * 1000) / 1000;
}

/**
 * Parse 1C occurredAt. Bare local datetimes (no offset) are treated as +03:00.
 */
export function parseDiscountOccurredAt(
  raw: string | undefined | null,
  fallback: Date,
): Date {
  if (!raw || !String(raw).trim()) return fallback;
  const s = String(raw).trim();
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? fallback : d;
  }
  const withOffset = s.includes('T') ? `${s}+03:00` : `${s}T12:00:00+03:00`;
  const d = new Date(withOffset);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

/** YYYY-MM months inclusive between from/to (ISO dates). */
export function monthsInRange(from: string, to: string): string[] {
  const start = from.slice(0, 7);
  const end = to.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(start) || !/^\d{4}-\d{2}$/.test(end)) return [];
  const out: string[] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const endY = Number(end.slice(0, 4));
  const endM = Number(end.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** First/last calendar day of YYYY-MM. */
export function monthBounds(month: string): { from: string; to: string } {
  const [ys, ms] = month.split('-');
  const y = Number(ys);
  const m = Number(ms);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function normalizeDiscountName(name: string | null | undefined): string {
  const t = (name ?? '').trim();
  return t || 'Ручная скидка';
}

/**
 * Staff / relatives: client marked as employee, or discount name mentions staff.
 */
export function isStaffRelatedDiscount(opts: {
  clientName?: string | null;
  discountName?: string | null;
}): boolean {
  const client = (opts.clientName ?? '').toLowerCase();
  if (client.includes('(сотрудник)')) return true;
  const disc = (opts.discountName ?? '').toLowerCase();
  if (disc.includes('штат')) return true;
  if (disc.includes('сотрудник')) return true;
  if (disc.includes('родственник')) return true;
  if (disc.includes('мужа') || disc.includes('жены')) return true;
  return false;
}

/** High discount share while volume is not growing → stuck discount signal. */
export function isDiscountStuck(opts: {
  discountSharePct: number | null;
  /** True when qty is strictly higher than baseline. */
  volumeGrowing: boolean;
  thresholdPct?: number;
}): boolean {
  const thr = opts.thresholdPct ?? 15;
  return (
    opts.discountSharePct != null &&
    opts.discountSharePct >= thr &&
    !opts.volumeGrowing
  );
}
