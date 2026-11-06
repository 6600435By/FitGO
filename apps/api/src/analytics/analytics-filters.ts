/**
 * Shared analytics filter query (same vocabulary as club revenue / sales UI).
 */
export type AnalyticsPaymentFilter =
  | 'cash'
  | 'card'
  | 'cashless'
  | 'personalAccount'
  | 'corpo'
  | 'all';

export type AnalyticsSegmentFilter =
  | 'membership'
  | 'training'
  | 'spa'
  | 'solarium'
  | 'shop'
  | 'corporate'
  | 'other'
  | 'unclassified'
  | '';

export interface AnalyticsMoneyFilters {
  segment?: AnalyticsSegmentFilter;
  /** Author of the sale document (1C employee). Special: `none` = no author. */
  employee?: string;
  /** Service performer (1C Запасы.Сотрудник). Special: `none` = no performer. */
  performer?: string;
  /** Exact product UUID (preferred) or empty. */
  product?: string;
  payment?: AnalyticsPaymentFilter;
  /** Client name / fragment (case-insensitive contains). */
  q?: string;
}

export interface AppliedAnalyticsFilters {
  segment: string | null;
  employee: string | null;
  performer: string | null;
  product: string | null;
  payment: string | null;
  q: string | null;
  /** True when any money-affecting filter is set. */
  active: boolean;
}

export function parseAnalyticsFilters(raw: {
  segment?: string;
  employee?: string;
  performer?: string;
  product?: string;
  productId?: string;
  payment?: string;
  q?: string;
}): AnalyticsMoneyFilters {
  const segment = (raw.segment ?? '').trim().toLowerCase();
  const payment = (raw.payment ?? '').trim().toLowerCase();
  const allowedSeg = new Set([
    'membership',
    'training',
    'spa',
    'solarium',
    'shop',
    'corporate',
    'other',
    'unclassified',
  ]);
  const allowedPay = new Set([
    'cash',
    'card',
    'cashless',
    'personalaccount',
    'corpo',
  ]);
  return {
    segment: allowedSeg.has(segment)
      ? (segment as AnalyticsSegmentFilter)
      : '',
    employee: raw.employee?.trim() || undefined,
    performer: raw.performer?.trim() || undefined,
    product: (raw.product ?? raw.productId)?.trim() || undefined,
    payment: allowedPay.has(payment)
      ? ((payment === 'personalaccount'
          ? 'personalAccount'
          : payment) as AnalyticsPaymentFilter)
      : 'all',
    q: raw.q?.trim() || undefined,
  };
}

export function appliedFilters(
  f: AnalyticsMoneyFilters,
): AppliedAnalyticsFilters {
  const segment = f.segment || null;
  const employee = f.employee || null;
  const performer = f.performer || null;
  const product = f.product || null;
  const payment =
    f.payment && f.payment !== 'all' ? f.payment : null;
  const q = f.q || null;
  return {
    segment,
    employee,
    performer,
    product,
    payment,
    q,
    active: Boolean(
      segment || employee || performer || product || payment || q,
    ),
  };
}

export function filtersCacheKey(f: AnalyticsMoneyFilters): string {
  return [
    f.segment || '',
    f.employee || '',
    f.performer || '',
    f.product || '',
    f.payment && f.payment !== 'all' ? f.payment : '',
    f.q || '',
  ].join('|');
}
