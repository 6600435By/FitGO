import { membershipNameFromPaymentBasis } from './booking-control';

/** Visit paid from unlimited / guest / trial membership vs visit card / one-off. */
export type VisitMixBucket = 'ABON' | 'KP';

export interface VisitMixCounts {
  abonVisits: number;
  kpVisits: number;
  /** 0–100; null when no attended visits. */
  abonPct: number | null;
  /** Always `100 - abonPct` when abonPct is set. */
  kpPct: number | null;
}

function normalizeTitle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Package / membership title from 1C paymentBasis, or full string when unquoted. */
export function visitMixTitleFromBasis(
  basis: string | null | undefined,
): string {
  const raw = (basis ?? '').trim();
  if (!raw) return '';
  return (membershipNameFromPaymentBasis(raw) ?? raw).trim();
}

function isVipTitle(n: string): boolean {
  return /^vip\b/.test(n) || n.startsWith('vip(') || n.startsWith('vip ');
}

/**
 * Group-class attendance mix.
 * Абон: VIP, Единый, Лёгкий старт, гостевые, Безлимит, пробные, Все включено, empty.
 * КП: карты посещений, разовые, Allsports, реформер, АСД, GYM FIT, everything else.
 */
export function classifyGroupVisitMix(
  basis: string | null | undefined,
): VisitMixBucket {
  const title = visitMixTitleFromBasis(basis);
  if (!title) return 'ABON';
  const n = normalizeTitle(title);
  if (
    isVipTitle(n) ||
    n.includes('единый') ||
    n.includes('легкий старт') ||
    n.includes('гостев') ||
    n.includes('безлимит') ||
    n.includes('пробн') ||
    n.includes('все включено')
  ) {
    return 'ABON';
  }
  return 'KP';
}

/** SPA attendance: Абон = VIP + Все включено; everything else = КП. */
export function classifySpaVisitMix(
  basis: string | null | undefined,
): VisitMixBucket {
  const title = visitMixTitleFromBasis(basis);
  if (!title) return 'KP';
  const n = normalizeTitle(title);
  if (isVipTitle(n) || n.includes('все включено')) return 'ABON';
  return 'KP';
}

export function emptyVisitMix(): VisitMixCounts {
  return { abonVisits: 0, kpVisits: 0, abonPct: null, kpPct: null };
}

/** Round Абон %; КП % = 100 − Абон so the pair always sums to 100. */
export function visitMixFromCounts(
  abonVisits: number,
  kpVisits: number,
): VisitMixCounts {
  const total = abonVisits + kpVisits;
  if (total <= 0) return emptyVisitMix();
  const abonPct = Math.round((abonVisits / total) * 100);
  return {
    abonVisits,
    kpVisits,
    abonPct,
    kpPct: 100 - abonPct,
  };
}
