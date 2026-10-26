import type {
  AnalyticInsight,
  MembershipCostBreakdown,
  MembershipEconomicsSettings,
  MembershipFamilyConfig,
  MembershipPriceAllocation,
  MembershipUsageFacts,
  MembershipUtilizationSegment,
  MembershipVisitBucket,
  MembershipWaterfallStep,
} from '@fitgo/shared-types';
import { membershipNameFromPaymentBasis } from '@fitgo/shared-types';

export function toMinor(major: number): number {
  return Math.round((Number(major) || 0) * 100);
}

export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchFamily(
  productOrBasis: string | null | undefined,
  families: MembershipFamilyConfig[],
): MembershipFamilyConfig | null {
  const title =
    membershipNameFromPaymentBasis(productOrBasis) ??
    (productOrBasis ?? '').trim();
  if (!title) return null;
  const n = normalizeName(title);
  for (const f of families) {
    for (const p of f.namePatterns) {
      const pat = normalizeName(p);
      if (pat && n.includes(pat)) return f;
    }
  }
  return null;
}

/** Parse months from titles like «VIP 3 мес», «VIP(6)», «на 12 месяцев». */
export function parseMonthsFromTitle(
  title: string | null | undefined,
  fallback: number,
): number {
  const t = (title ?? '').toLowerCase();
  const m =
    t.match(/(\d+)\s*мес/) ||
    t.match(/(\d+)\s*месяц/) ||
    t.match(/\((\d+)\s*мес/) ||
    t.match(/на\s+(\d+)/) ||
    t.match(/vip\s*(\d+)\b/) ||
    t.match(/единый\s*(\d+)\b/);
  if (m?.[1]) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > 0 && n <= 36) return n;
  }
  return Math.max(1, fallback || 1);
}

/** Extract start date YYYY-MM-DD from «… от 27.08.2026». */
export function parseStartFromBasis(
  basis: string | null | undefined,
): string | null {
  const m = (basis ?? '').match(/от\s+(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export function isoDay(raw: string | Date | null | undefined): string | null {
  if (!raw) return null;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return raw.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function monthsBetween(start: string, end: string): number {
  const a = new Date(`${start}T12:00:00Z`);
  const b = new Date(`${end}T12:00:00Z`);
  const days = Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
  return Math.max(1, Math.round((days / 30.44) * 10) / 10);
}

export interface SaleCandidate {
  productName: string | null;
  paidAmount: number;
  saleAmount: number;
  refundAmount: number;
  occurredAt: Date;
  clientExternalId: string | null;
  clientName: string | null;
}

/**
 * Pick best membership sale for a package instance.
 * Prefer same family + sale on/before start (or first visit), closest date.
 */
export function matchSaleToMembership(input: {
  clientExternalId: string;
  family: MembershipFamilyConfig;
  startDate: string | null;
  sales: SaleCandidate[];
}): { sale: SaleCandidate; estimated: boolean } | null {
  const clientSales = input.sales.filter(
    (s) => s.clientExternalId === input.clientExternalId,
  );
  if (!clientSales.length) return null;

  const familySales = clientSales.filter((s) =>
    matchFamily(s.productName, [input.family]),
  );
  const pool = familySales.length ? familySales : clientSales;

  const anchor = input.startDate;
  let best: SaleCandidate | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const s of pool) {
    const day = isoDay(s.occurredAt);
    if (!day) continue;
    let score: number;
    if (anchor) {
      const diff =
        (new Date(`${day}T12:00:00Z`).getTime() -
          new Date(`${anchor}T12:00:00Z`).getTime()) /
        86400000;
      // Prefer sales on/before start; penalize after.
      score = diff <= 0 ? Math.abs(diff) : 1000 + diff;
    } else {
      score = -s.occurredAt.getTime();
    }
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  if (!best) return null;
  return {
    sale: best,
    estimated: familySales.length === 0,
  };
}

export function netPaidMinor(sale: SaleCandidate): number {
  const paid = toMinor(sale.paidAmount || sale.saleAmount);
  const refund = toMinor(sale.refundAmount);
  return Math.max(0, paid - refund);
}

export function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const a = [...nums].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
}

export function allocateRetailPrice(input: {
  paidMinor: number;
  months: number;
  family: MembershipFamilyConfig;
  massageRetailMinor: number;
  solariumMinuteRetailMinor: number;
  gpVisits: number;
  gymVisits: number;
}): MembershipPriceAllocation {
  const pa =
    Math.round(
      input.family.personalAccountPerMonthMajor * input.months * 100,
    );
  const massageQuota = Math.round(
    input.family.massageQuotaPerMonth * input.months,
  );
  const solariumQuota = Math.round(
    input.family.solariumMinutesPerMonth * input.months,
  );
  const massage = massageQuota * input.massageRetailMinor;
  const solarium = solariumQuota * input.solariumMinuteRetailMinor;
  const reserved = pa + massage + solarium;
  const access = Math.max(0, input.paidMinor - reserved);
  const gp = input.family.includesGp ? input.gpVisits : 0;
  const gym = input.family.includesGym ? input.gymVisits : 0;
  const totalVisits = gp + gym;
  let accessGp = 0;
  let accessGym = 0;
  if (totalVisits > 0 && access > 0) {
    accessGp = Math.round((access * gp) / totalVisits);
    accessGym = access - accessGp;
  } else if (access > 0 && input.family.includesGp) {
    accessGp = access;
  } else if (access > 0) {
    accessGym = access;
  }
  return {
    paidMinor: input.paidMinor,
    personalAccountAllocatedMinor: Math.min(pa, input.paidMinor),
    massageAllocatedMinor: Math.min(massage, Math.max(0, input.paidMinor - pa)),
    solariumAllocatedMinor: Math.min(
      solarium,
      Math.max(0, input.paidMinor - pa - massage),
    ),
    accessMinor: access,
    accessGpMinor: accessGp,
    accessGymMinor: accessGym,
  };
}

export function computeCostBreakdown(input: {
  trainerMinor: number;
  massageUsed: number;
  massageCostMinor: number;
  solariumMinutesUsed: number;
  solariumMinuteCostMinor: number;
  personalAccountSpentMinor: number;
  personalAccountCogsShare: number;
  visitCount: number;
  overheadPerVisitMinor: number;
}): MembershipCostBreakdown {
  const massageMinor = input.massageUsed * input.massageCostMinor;
  const solariumMinor =
    input.solariumMinutesUsed * input.solariumMinuteCostMinor;
  const personalAccountCogsMinor = Math.round(
    input.personalAccountSpentMinor * input.personalAccountCogsShare,
  );
  const overheadMinor =
    input.visitCount * input.overheadPerVisitMinor;
  const totalMinor =
    input.trainerMinor +
    massageMinor +
    solariumMinor +
    personalAccountCogsMinor +
    overheadMinor;
  return {
    trainerMinor: input.trainerMinor,
    massageMinor,
    solariumMinor,
    personalAccountCogsMinor,
    overheadMinor,
    totalMinor,
  };
}

export function gpCostPerVisit(
  accessGpMinor: number,
  gpVisits: number,
): number | null {
  if (gpVisits <= 0) return null;
  return Math.round(accessGpMinor / gpVisits);
}

export function trainerPerVisit(
  trainerMinor: number,
  gpVisits: number,
): number | null {
  if (gpVisits <= 0) return null;
  return Math.round(trainerMinor / gpVisits);
}

/**
 * Visits after which cumulative trainer cost exceeds GP access share.
 * Uses average trainer-per-visit from the instance.
 */
export function breakevenVisits(
  accessGpMinor: number,
  avgTrainerPerVisitMinor: number | null,
): number | null {
  if (
    avgTrainerPerVisitMinor == null ||
    avgTrainerPerVisitMinor <= 0 ||
    accessGpMinor <= 0
  ) {
    return null;
  }
  return Math.max(1, Math.ceil(accessGpMinor / avgTrainerPerVisitMinor));
}

export function utilizationIndex(
  gpVisits: number,
  months: number,
  normVisitsPerWeek: number,
): number {
  const weeks = Math.max(1 / 7, months * (30.44 / 7));
  const perWeek = gpVisits / weeks;
  const norm = Math.max(0.1, normVisitsPerWeek);
  return perWeek / norm;
}

export function utilizationSegment(
  index: number,
  thresholds: MembershipEconomicsSettings['segmentThresholds'],
  daysSinceLastVisit: number | null,
  sleepingDays: number,
): MembershipUtilizationSegment {
  if (
    daysSinceLastVisit != null &&
    daysSinceLastVisit >= sleepingDays
  ) {
    return 'sleeping';
  }
  if (index >= thresholds.max) return 'max';
  if (index >= thresholds.normal) return 'normal';
  if (index >= thresholds.under) return 'under';
  return 'sleeping';
}

export function burnedValueMinor(input: {
  personalAccountBurnedMinor: number;
  massageQuota: number;
  massageUsed: number;
  massageRetailMinor: number;
  solariumMinutesQuota: number;
  solariumMinutesUsed: number;
  solariumMinuteRetailMinor: number;
}): number {
  const unusedMassage = Math.max(0, input.massageQuota - input.massageUsed);
  const unusedSol =
    Math.max(0, input.solariumMinutesQuota - input.solariumMinutesUsed);
  return (
    Math.max(0, input.personalAccountBurnedMinor) +
    unusedMassage * input.massageRetailMinor +
    unusedSol * input.solariumMinuteRetailMinor
  );
}

export function buildWaterfall(input: {
  paidMinor: number;
  trainerMinor: number;
  massageMinor: number;
  solariumMinor: number;
  personalAccountCogsMinor: number;
  overheadMinor: number;
}): MembershipWaterfallStep[] {
  const steps: MembershipWaterfallStep[] = [];
  let running = input.paidMinor;
  steps.push({
    key: 'paid',
    label: 'Оплачено',
    deltaMinor: input.paidMinor,
    runningMinor: running,
  });
  const deltas: Array<[string, string, number]> = [
    ['trainer', 'Тренеры ГП', -input.trainerMinor],
    ['massage', 'Массаж', -input.massageMinor],
    ['solarium', 'Солярий', -input.solariumMinor],
    ['pa', 'Себестоимость ЛС', -input.personalAccountCogsMinor],
    ['overhead', 'Накладные', -input.overheadMinor],
  ];
  for (const [key, label, delta] of deltas) {
    if (delta === 0 && key !== 'trainer') continue;
    running += delta;
    steps.push({ key, label, deltaMinor: delta, runningMinor: running });
  }
  steps.push({
    key: 'margin',
    label: 'Маржа клуба',
    deltaMinor: 0,
    runningMinor: running,
  });
  return steps;
}

export function visitDistributionBuckets(
  gpPerMonthValues: number[],
): MembershipVisitBucket[] {
  const defs: Array<{
    key: string;
    label: string;
    min: number;
    max: number | null;
  }> = [
    { key: '0', label: '0', min: 0, max: 0 },
    { key: '1-4', label: '1–4', min: 1, max: 4 },
    { key: '5-8', label: '5–8', min: 5, max: 8 },
    { key: '9-12', label: '9–12', min: 9, max: 12 },
    { key: '13+', label: '13+', min: 13, max: null },
  ];
  return defs.map((d) => ({
    key: d.key,
    label: d.label,
    minPerMonth: d.min,
    maxPerMonth: d.max,
    count: gpPerMonthValues.filter((v) => {
      if (d.max == null) return v >= d.min;
      if (d.min === 0 && d.max === 0) return v <= 0;
      return v >= d.min && v <= d.max;
    }).length,
  }));
}

export function familyStatus(
  marginPct: number | null,
  burnedPct: number | null,
): 'green' | 'yellow' | 'red' {
  if (marginPct != null && marginPct < 15) return 'red';
  if (burnedPct != null && burnedPct > 40) return 'yellow';
  if (marginPct != null && marginPct < 30) return 'yellow';
  return 'green';
}

export function buildMembershipInsights(input: {
  families: Array<{
    label: string;
    count: number;
    underOrSleepingShare: number;
    personalAccountBurnPct: number | null;
    marginPct: number | null;
  }>;
  lowFillClassTitles: string[];
  dataQualityWarning: string | null;
}): AnalyticInsight[] {
  const out: AnalyticInsight[] = [];
  if (input.dataQualityWarning) {
    out.push({
      severity: 'warning',
      title: 'Качество данных',
      body: input.dataQualityWarning,
    });
  }
  for (const f of input.families) {
    if (f.count < 3) continue;
    if (f.underOrSleepingShare >= 0.35) {
      out.push({
        severity: 'warning',
        title: `${f.label}: низкая активность`,
        body: `${Math.round(f.underOrSleepingShare * 100)}% клиентов ходят реже нормы — риск непродления.`,
        action: 'Открыть сегмент «Недогруз» / «Спящие»',
      });
    }
    if (
      f.personalAccountBurnPct != null &&
      f.personalAccountBurnPct >= 0.5
    ) {
      out.push({
        severity: 'info',
        title: `${f.label}: сгорает лицевой счёт`,
        body: `Сгорает ${Math.round(f.personalAccountBurnPct * 100)}% ЛС. Для клуба это доход, для клиента — сигнал снизить ЛС в цене или продвигать бар.`,
      });
    }
    if (f.marginPct != null && f.marginPct < 20) {
      out.push({
        severity: 'critical',
        title: `${f.label}: низкая маржа`,
        body: `Маржа ${Math.round(f.marginPct)}% после затрат на тренеров и услуги. Пересмотрите цену или квоты.`,
      });
    }
  }
  for (const title of input.lowFillClassTitles.slice(0, 3)) {
    out.push({
      severity: 'warning',
      title: 'Занятие ниже безубыточности',
      body: `«${title}» систематически ниже порога по марже абонементных посещений.`,
    });
  }
  if (!out.length) {
    out.push({
      severity: 'success',
      title: 'Картина в норме',
      body: 'Нет критичных отклонений по выбранным абонементам за период.',
    });
  }
  return out;
}

export function quotasForTerm(
  family: MembershipFamilyConfig,
  months: number,
): Pick<
  MembershipUsageFacts,
  'massageQuota' | 'solariumMinutesQuota' | 'personalAccountCreditedMinor'
> {
  return {
    massageQuota: Math.round(family.massageQuotaPerMonth * months),
    solariumMinutesQuota: Math.round(
      family.solariumMinutesPerMonth * months,
    ),
    personalAccountCreditedMinor: Math.round(
      family.personalAccountPerMonthMajor * months * 100,
    ),
  };
}

export function daysBetween(a: string, b: string): number {
  const x = new Date(`${a}T12:00:00Z`).getTime();
  const y = new Date(`${b}T12:00:00Z`).getTime();
  return Math.round((y - x) / 86400000);
}
