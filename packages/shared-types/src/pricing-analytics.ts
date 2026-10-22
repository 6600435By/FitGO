/** Market & pricing tab for /super-admin/analytics?tab=market */

export type PricingSegmentKey =
  | 'membership'
  | 'training'
  | 'shop'
  | 'spa'
  | 'solarium'
  | 'corporate';

export type PricingSeasonMode =
  | 'low'
  | 'august_sale'
  | 'high_inflow'
  | 'mixed'
  | 'promo';

export type PricingBaselineKind =
  | 'yoy'
  | 'prev_same_season'
  | 'pre_promo_14d'
  | 'none';

export type PricingHintAction =
  | 'raise_price'
  | 'promo_or_value'
  | 'review_discounts'
  | 'upsell'
  | 'sale_no_inflow'
  | 'watch_demand'
  | 'discount_stuck';

export interface PricingRevenueBridge {
  /** Human label of what drove the change. */
  summary: string;
  priceEffectMinor: number;
  volumeEffectMinor: number;
  mixEffectMinor: number;
}

export interface PricingCompetitorColumn {
  id: string;
  name: string;
  sortOrder: number;
  /** Club-level price list URL (one per competitor). */
  priceListUrl: string | null;
}

export interface PricingCompetitorCell {
  competitorId: string;
  priceMinor: number | null;
  observedAt: string | null;
  theirName: string | null;
  /** @deprecated Prefer competitor.priceListUrl; kept for old rows. */
  sourceUrl: string | null;
}

export type PricingMembershipFamilyKey =
  | 'one_time'
  | 'morning'
  | 'day'
  | 'weekend'
  | 'unlimited'
  | 'unified'
  | 'vip'
  | 'visit_card'
  | 'reformer'
  | 'promo'
  | 'other';

export interface PricingProductRow {
  productExternalId: string | null;
  productName: string;
  listPriceMinor: number | null;
  /** Average paid amount per sale document in period. */
  avgActualMinor: number | null;
  /** avgActual / listPrice; null if either missing. */
  avgToListRatio: number | null;
  salesCount: number;
  revenueMinor: number;
  compareRevenueMinor: number | null;
  deltaPct: number | null;
  /** True when row is in the ~80% revenue core of the segment. */
  isCore: boolean;
  discountMinor: number | null;
  discountSharePct: number | null;
  competitorCells: PricingCompetitorCell[];
  /** Median of filled competitor prices; null if none filled. */
  marketMedianMinor: number | null;
  /** our list / market median; null if no market. */
  marketRatio: number | null;
  marketLabel: string | null;
  hintAction: PricingHintAction | null;
  hintText: string | null;
  bridge: PricingRevenueBridge | null;
  /** Membership catalog family (UI group header). */
  familyKey?: PricingMembershipFamilyKey | null;
  familyLabel?: string | null;
}

export interface PricingSegmentBlock {
  key: PricingSegmentKey;
  label: string;
  revenueMinor: number;
  sharePct: number;
  compareRevenueMinor: number | null;
  deltaPct: number | null;
  bridge: PricingRevenueBridge | null;
  summaryLine: string;
  competitors: PricingCompetitorColumn[];
  products: PricingProductRow[];
  /** Shop only: prices kept for SKUs outside current top-30. */
  orphanPricedCount?: number;
  /** Shop header flag. */
  topN?: number;
}

export interface PricingHintCard {
  action: PricingHintAction;
  title: string;
  body: string;
  ignoredNote?: string;
  segmentKey: PricingSegmentKey;
  productName?: string;
  /** Revenue weight used for ranking. */
  weightMinor: number;
}

export interface PricingSaleWindow {
  id: string;
  name: string;
  from: string;
  to: string;
  segmentKey: PricingSegmentKey;
  /** Built-in August membership sale. */
  builtin: boolean;
}

export interface PricingDiscountStaffRow {
  employeeExternalId: string | null;
  employeeName: string;
  discountMinor: number;
}

export interface PricingDiscountTypeRow {
  discountName: string;
  discountMinor: number;
}

export type PricingDiscountsStatus =
  | 'ok'
  | 'partial'
  | 'loading'
  | 'error'
  | 'not_configured'
  | 'unavailable';

export interface PricingDiscountsBlock {
  available: boolean;
  status: PricingDiscountsStatus;
  message: string | null;
  totalDiscountMinor: number | null;
  /** Discount / (revenue + discount) — share of list before discount. */
  shareOfRevenuePct: number | null;
  compareTotalDiscountMinor: number | null;
  deltaPct: number | null;
  /** Client (non-staff) discounts. */
  clientsMinor: number | null;
  /** Staff / relatives discounts. */
  staffRelatedMinor: number | null;
  byType: PricingDiscountTypeRow[];
  byStaff: PricingDiscountStaffRow[];
  syncedAt: string | null;
  /** Months YYYY-MM still missing from cache. */
  missingMonths: string[];
}

export interface PricingCorporateBlock {
  revenueMinor: number;
  sharePct: number;
  compareRevenueMinor: number | null;
  deltaPct: number | null;
  entryCount: number;
  note: string;
}

export interface PricingModeBanner {
  mode: PricingSeasonMode;
  label: string;
  detail: string | null;
}

export interface PricingAnalyticsReport {
  from: string;
  to: string;
  compareFrom: string | null;
  compareTo: string | null;
  baselineKind: PricingBaselineKind;
  baselineLabel: string;
  currency: string;
  dataSince: string | null;
  hasFullYearHistory: boolean;
  mode: PricingModeBanner;
  /** Period crosses season boundary — do not show one delta. */
  mixedPeriod: boolean;
  mixedPeriodNote: string | null;
  revenueMinor: number;
  hints: PricingHintCard[];
  segments: PricingSegmentBlock[];
  corporate: PricingCorporateBlock;
  discounts: PricingDiscountsBlock;
  saleWindows: PricingSaleWindow[];
  priceListAsOf: string | null;
}

export interface UpsertSegmentCompetitorDto {
  segmentKey: Exclude<PricingSegmentKey, 'corporate'>;
  name: string;
  sortOrder?: number;
  priceListUrl?: string | null;
}

export interface PatchSegmentCompetitorDto {
  name?: string;
  priceListUrl?: string | null;
  sortOrder?: number;
}

export interface UpsertCompetitorPriceDto {
  competitorId: string;
  productExternalId: string;
  priceMinor: number;
  observedAt?: string;
  theirName?: string | null;
  sourceUrl?: string | null;
}

export interface BatchUpsertCompetitorPricesDto {
  competitorId: string;
  prices: Array<{
    productExternalId: string;
    priceMinor: number;
    theirName?: string | null;
  }>;
  observedAt?: string;
}

export interface UpsertSaleWindowDto {
  name: string;
  from: string;
  to: string;
  segmentKey?: PricingSegmentKey;
}
