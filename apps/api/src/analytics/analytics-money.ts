/**
 * One-pass club money aggregates from ClubRevenueEntry (+ manuals).
 * Minsk day bounds; business cut includes cashless + personal account.
 */
import type { PayrollSegmentSets } from '../admin-sales/admin-sales-segments';
import { classifySaleType } from '../admin-sales/admin-sales-segments';
import { preferredSaleBasisId } from '../admin-sales/payment-basis-products';
import { rangeBounds, weekBuckets } from './analytics-period';
import type {
  AnalyticsMoneyFilters,
  AnalyticsPaymentFilter,
  AnalyticsSegmentFilter,
} from './analytics-filters';

export const ANALYTICS_SEG_LABEL: Record<string, string> = {
  membership: 'Абонементы',
  training: 'ПТ / тренинги',
  spa: 'СПА',
  solarium: 'Солярий',
  shop: 'Магазин',
  corporate: 'Корпо',
  other: 'Прочее',
  unclassified: 'Не разнесено',
};

export type AnalyticsSegKey = keyof typeof ANALYTICS_SEG_LABEL;

export interface AnalyticsCreRow {
  externalId: string;
  documentId: string | null;
  operationType: string;
  occurredAt: Date;
  paidAt: Date | null;
  amount: number;
  cash: number;
  card: number;
  cashless: number;
  personalAccount: number;
  refundAmount: number;
  paidAmount: number;
  saleType: string | null;
  productName: string | null;
  productExternalId: string | null;
  clientName: string | null;
  clientExternalId: string | null;
  employeeExternalId: string | null;
  employeeName: string | null;
  performerExternalId: string | null;
  performerName: string | null;
}

export interface AnalyticsManualRow {
  kind: string;
  amountMinor: number;
  entryDate: Date;
}

export interface MoneyAggProduct {
  productExternalId: string | null;
  productName: string;
  segment: AnalyticsSegKey;
  amountMinor: number;
  lines: number;
  docs: Set<string>;
  sellers: Map<string, { name: string; minor: number }>;
}

export interface MoneyAggResult {
  revenueMinor: number;
  refundsMinor: number;
  avgCheckMinor: number;
  byPayment: {
    cashMinor: number;
    cardMinor: number;
    cashlessMinor: number;
    personalAccountMinor: number;
    corpoMinor: number;
    otherMinor: number;
  };
  bySegment: Array<{
    key: string;
    label: string;
    amountMinor: number;
    share: number;
  }>;
  segmentSumMinor: number;
  segmentGapMinor: number;
  revenueTrend: number[];
  products: MoneyAggProduct[];
  /** Author → segment minors (for staff). */
  byEmployee: Map<
    string,
    {
      name: string;
      membershipMinor: number;
      spaMinor: number;
      shopMinor: number;
      corporateMinor: number;
      trainingMinor: number;
      otherMinor: number;
      totalMinor: number;
    }
  >;
  /** Performer → spa/training minors. */
  byPerformer: Map<
    string,
    {
      name: string;
      spaMinor: number;
      trainingMinor: number;
      totalMinor: number;
    }
  >;
}

function toMinor(n: number): number {
  return Math.round((Number(n) || 0) * 100);
}

function minskDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Minsk',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function classifySeg(
  saleType: string | null | undefined,
  productName: string | null | undefined,
  productExternalId: string | null | undefined,
  segments: PayrollSegmentSets | null,
): AnalyticsSegKey {
  const bucket = classifySaleType(
    saleType ?? undefined,
    productName,
    segments,
    productExternalId,
  );
  switch (bucket) {
    case 'membership':
      return 'membership';
    case 'training':
      return 'training';
    case 'massage':
      return 'spa';
    case 'solarium':
      return 'solarium';
    case 'shop':
      return 'shop';
    default:
      return 'unclassified';
  }
}

function lineMoney(r: AnalyticsCreRow): {
  cash: number;
  card: number;
  cashless: number;
  pa: number;
  total: number;
} {
  const cash = toMinor(r.cash);
  const card = toMinor(r.card);
  const cashless = toMinor(r.cashless);
  const pa = toMinor(r.personalAccount);
  return { cash, card, cashless, pa, total: cash + card + cashless + pa };
}

function paymentSlice(
  split: ReturnType<typeof lineMoney>,
  payment: AnalyticsPaymentFilter | undefined,
): number {
  if (!payment || payment === 'all' || payment === 'corpo') {
    return split.total;
  }
  if (payment === 'cash') return split.cash;
  if (payment === 'card') return split.card;
  if (payment === 'cashless') return split.cashless;
  if (payment === 'personalAccount') return split.pa;
  return split.total;
}

function matchesPerson(
  filter: string | undefined,
  externalId: string | null | undefined,
): boolean {
  if (!filter) return true;
  if (filter === 'none') return !externalId?.trim();
  return (externalId ?? '').trim().toLowerCase() === filter.toLowerCase();
}

function matchesClient(
  q: string | undefined,
  clientName: string | null | undefined,
  clientExternalId: string | null | undefined,
): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  if ((clientName ?? '').toLowerCase().includes(needle)) return true;
  if ((clientExternalId ?? '').toLowerCase().includes(needle)) return true;
  return false;
}

function matchesProduct(
  product: string | undefined,
  productExternalId: string | null | undefined,
  productName: string | null | undefined,
): boolean {
  if (!product) return true;
  const id = (productExternalId ?? '').trim().toLowerCase();
  if (id && id === product.toLowerCase()) return true;
  const name = (productName ?? '').trim().toLowerCase();
  return name === product.toLowerCase() || name.includes(product.toLowerCase());
}

function matchesSegment(
  filter: AnalyticsSegmentFilter | undefined,
  seg: AnalyticsSegKey,
): boolean {
  if (!filter) return true;
  return seg === filter;
}

/**
 * Same operation window as moneyBlock / sales: payments by paidAt,
 * personal_* by occurredAt, sales with paidAmount by paidAt.
 */
export function creInPeriod(
  r: AnalyticsCreRow,
  start: Date,
  end: Date,
): boolean {
  if (
    r.operationType === 'payment' ||
    r.operationType === 'refund' ||
    (r.operationType === 'sale' && (Number(r.paidAmount) || 0) > 0)
  ) {
    const at = r.paidAt ?? r.occurredAt;
    return at >= start && at <= end;
  }
  if (
    r.operationType === 'personal_deposit' ||
    r.operationType === 'personal_credit' ||
    r.operationType === 'personal_burn'
  ) {
    return r.occurredAt >= start && r.occurredAt <= end;
  }
  return false;
}

export function aggregateAnalyticsMoney(input: {
  from: string;
  to: string;
  receipts: AnalyticsCreRow[];
  manuals: AnalyticsManualRow[];
  payrollSegs: PayrollSegmentSets | null;
  filters?: AnalyticsMoneyFilters;
}): MoneyAggResult {
  const { start, end } = rangeBounds(input.from, input.to);
  const f = input.filters ?? {};
  const paymentFilter = f.payment && f.payment !== 'all' ? f.payment : undefined;
  const onlyCorpo = paymentFilter === 'corpo';

  let cash = 0;
  let card = 0;
  let cashless = 0;
  let personalAccount = 0;
  let refunds = 0;
  const paymentDocs = new Set<string>();
  const byDay = new Map<string, number>();
  const segMinor: Record<string, number> = {
    membership: 0,
    training: 0,
    spa: 0,
    solarium: 0,
    shop: 0,
    corporate: 0,
    other: 0,
    unclassified: 0,
  };
  const products = new Map<string, MoneyAggProduct>();
  const byEmployee = new Map<
    string,
    {
      name: string;
      membershipMinor: number;
      spaMinor: number;
      shopMinor: number;
      corporateMinor: number;
      trainingMinor: number;
      otherMinor: number;
      totalMinor: number;
    }
  >();
  const byPerformer = new Map<
    string,
    {
      name: string;
      spaMinor: number;
      trainingMinor: number;
      totalMinor: number;
    }
  >();

  const bumpEmployee = (
    empId: string,
    name: string,
    seg: AnalyticsSegKey,
    minor: number,
  ) => {
    if (minor <= 0) return;
    const cur = byEmployee.get(empId) ?? {
      name,
      membershipMinor: 0,
      spaMinor: 0,
      shopMinor: 0,
      corporateMinor: 0,
      trainingMinor: 0,
      otherMinor: 0,
      totalMinor: 0,
    };
    cur.name = name || cur.name;
    if (seg === 'membership') cur.membershipMinor += minor;
    else if (seg === 'spa' || seg === 'solarium') cur.spaMinor += minor;
    else if (seg === 'shop') cur.shopMinor += minor;
    else if (seg === 'corporate') cur.corporateMinor += minor;
    else if (seg === 'training') cur.trainingMinor += minor;
    else cur.otherMinor += minor;
    cur.totalMinor += minor;
    byEmployee.set(empId, cur);
  };

  const bumpPerformer = (
    perfId: string,
    name: string,
    seg: AnalyticsSegKey,
    minor: number,
  ) => {
    if (minor <= 0) return;
    if (seg !== 'spa' && seg !== 'solarium' && seg !== 'training') return;
    const cur = byPerformer.get(perfId) ?? {
      name,
      spaMinor: 0,
      trainingMinor: 0,
      totalMinor: 0,
    };
    cur.name = name || cur.name;
    if (seg === 'training') cur.trainingMinor += minor;
    else cur.spaMinor += minor;
    cur.totalMinor += minor;
    byPerformer.set(perfId, cur);
  };

  for (const r of input.receipts) {
    if (!creInPeriod(r, start, end)) continue;
    if (!matchesPerson(f.employee, r.employeeExternalId)) continue;
    if (!matchesPerson(f.performer, r.performerExternalId)) continue;
    if (!matchesClient(f.q, r.clientName, r.clientExternalId)) continue;
    if (!matchesProduct(f.product, r.productExternalId, r.productName)) continue;

    const day = minskDay(r.paidAt ?? r.occurredAt);
    const seg = classifySeg(
      r.saleType,
      r.productName,
      r.productExternalId,
      input.payrollSegs,
    );
    if (!matchesSegment(f.segment, seg) && f.segment !== 'corporate') {
      // corporate is manuals-only; skip CRE when filtering corporate
      if (f.segment) continue;
    }
    if (f.segment === 'corporate') continue;

    if (r.operationType === 'refund') {
      if (onlyCorpo) continue;
      if (paymentFilter) {
        const split = lineMoney(r);
        const slice = paymentSlice(split, paymentFilter);
        if (slice <= 0) continue;
        refunds += slice;
        byDay.set(day, (byDay.get(day) ?? 0) - slice);
        continue;
      }
      const ref = Math.abs(
        toMinor(r.refundAmount) || toMinor(r.amount) || lineMoney(r).total,
      );
      refunds += ref;
      byDay.set(day, (byDay.get(day) ?? 0) - ref);
      continue;
    }

    if (
      r.operationType === 'personal_credit' ||
      r.operationType === 'personal_burn'
    ) {
      continue;
    }

    if (onlyCorpo) continue;

    const split = lineMoney(r);
    if (
      r.operationType === 'personal_deposit' ||
      r.operationType === 'payment' ||
      (r.operationType === 'sale' && (Number(r.paidAmount) || 0) > 0)
    ) {
      const slice = paymentSlice(split, paymentFilter);
      if (slice <= 0) continue;

      if (!paymentFilter) {
        cash += split.cash;
        card += split.card;
        cashless += split.cashless;
        personalAccount += split.pa;
      } else if (paymentFilter === 'cash') cash += split.cash;
      else if (paymentFilter === 'card') card += split.card;
      else if (paymentFilter === 'cashless') cashless += split.cashless;
      else if (paymentFilter === 'personalAccount')
        personalAccount += split.pa;

      if (slice > 0) {
        paymentDocs.add(
          preferredSaleBasisId({
            externalId: r.externalId,
            documentId: r.documentId,
          }),
        );
        byDay.set(day, (byDay.get(day) ?? 0) + slice);
        segMinor[seg] = (segMinor[seg] ?? 0) + slice;

        const pid =
          (r.productExternalId ?? '').trim().toLowerCase() ||
          `name:${(r.productName ?? '—').trim().toLowerCase()}`;
        const prod =
          products.get(pid) ??
          ({
            productExternalId: r.productExternalId?.trim() || null,
            productName: r.productName?.trim() || '—',
            segment: seg,
            amountMinor: 0,
            lines: 0,
            docs: new Set<string>(),
            sellers: new Map(),
          } satisfies MoneyAggProduct);
        prod.amountMinor += slice;
        prod.lines += 1;
        prod.docs.add(
          preferredSaleBasisId({
            externalId: r.externalId,
            documentId: r.documentId,
          }),
        );
        const empId = (r.employeeExternalId ?? '').trim() || 'none';
        const empName = r.employeeName?.trim() || 'Без автора';
        const seller = prod.sellers.get(empId) ?? {
          name: empName,
          minor: 0,
        };
        seller.minor += slice;
        seller.name = empName;
        prod.sellers.set(empId, seller);
        products.set(pid, prod);

        bumpEmployee(empId, empName, seg, slice);
        const perfId = (r.performerExternalId ?? '').trim();
        if (perfId) {
          bumpPerformer(
            perfId,
            r.performerName?.trim() || perfId,
            seg,
            slice,
          );
        }
      }
    }
  }

  let corpoMinor = 0;
  let otherMinor = 0;
  if (
    (!f.employee || f.employee === 'none') &&
    (!f.performer || f.performer === 'none') &&
    !f.product &&
    !f.q &&
    (!paymentFilter || paymentFilter === 'corpo')
  ) {
    for (const m of input.manuals) {
      if (m.entryDate < start || m.entryDate > end) continue;
      if (m.kind === 'corpo') {
        if (f.segment && f.segment !== 'corporate') continue;
        corpoMinor += m.amountMinor;
      } else if (m.kind === 'other') {
        if (f.segment && f.segment !== 'other') continue;
        if (paymentFilter === 'corpo') continue;
        otherMinor += m.amountMinor;
      }
    }
  }

  if (f.segment === 'corporate' || !f.segment) {
    segMinor.corporate += corpoMinor;
  }
  if (f.segment === 'other' || !f.segment) {
    segMinor.other += otherMinor;
  }

  if (corpoMinor > 0) {
    const dayKey = input.to;
    byDay.set(dayKey, (byDay.get(dayKey) ?? 0) + corpoMinor);
  }
  if (otherMinor > 0) {
    const dayKey = input.to;
    byDay.set(dayKey, (byDay.get(dayKey) ?? 0) + otherMinor);
  }

  const revenueMinor =
    cash + card + cashless + personalAccount + corpoMinor + otherMinor - refunds;
  const segmentSumMinor = Object.values(segMinor).reduce((s, n) => s + n, 0);
  // Segments are pre-refund allocation; gap vs revenue after refunds is expected
  // when refunds exist. Prefer reporting sum of positive segments vs money in.
  const moneyIn =
    cash + card + cashless + personalAccount + corpoMinor + otherMinor;
  const segmentGapMinor = moneyIn - segmentSumMinor;

  const prefer = new Set([
    'membership',
    'training',
    'spa',
    'solarium',
    'shop',
  ]);
  const bySegment = Object.entries(segMinor)
    .filter(([key, v]) => v > 0 || prefer.has(key))
    .map(([key, amountMinor]) => ({
      key,
      label: ANALYTICS_SEG_LABEL[key] ?? key,
      amountMinor,
      share: segmentSumMinor > 0 ? amountMinor / segmentSumMinor : 0,
    }));

  const paymentCount = paymentDocs.size;
  return {
    revenueMinor,
    refundsMinor: refunds,
    avgCheckMinor:
      paymentCount > 0 ? Math.round(revenueMinor / paymentCount) : 0,
    byPayment: {
      cashMinor: cash,
      cardMinor: card,
      cashlessMinor: cashless,
      personalAccountMinor: personalAccount,
      corpoMinor,
      otherMinor,
    },
    bySegment,
    segmentSumMinor,
    segmentGapMinor,
    revenueTrend: weekBuckets(input.from, input.to, byDay),
    products: [...products.values()],
    byEmployee,
    byPerformer,
  };
}
