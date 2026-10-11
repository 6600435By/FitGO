/** Super-admin «Нестыковки» — shared DTOs. */

export type DiscrepancyTab = 'segments' | 'sales' | 'spa' | 'gp' | 'pt';

export type DiscrepancyProductStatus =
  | 'OK'
  | 'GUESSED'
  | 'UNASSIGNED'
  | 'CONFLICT';

export type DiscrepancySegmentKey =
  | 'membership'
  | 'spa'
  | 'shop'
  | 'solarium'
  | 'training';

export type BookingControlFlag = 'EXPIRING_PACKAGE' | 'LATE_ADD';

export interface DiscrepancyEmployeeOption {
  id: string;
  name: string;
  count: number;
}

export interface DiscrepancySummary {
  from: string;
  to: string;
  segments: number;
  sales: number;
  spa: number;
  gp: number;
  pt: number;
}

export interface DiscrepancySegmentBucket {
  key: DiscrepancySegmentKey;
  title: string;
  items: number;
  salesCount: number;
  amount: number;
}

export interface DiscrepancySegmentProduct {
  itemKey: string;
  fingerprint: string;
  name: string;
  uuid?: string | null;
  code?: string | null;
  groupName?: string | null;
  oneCSaleType?: string | null;
  status: DiscrepancyProductStatus;
  currentBucket: string;
  matchedSegments: DiscrepancySegmentKey[];
  suggestedSegment?: DiscrepancySegmentKey | null;
  salesCount: number;
  amount: number;
  sellers: Array<{ id: string; name: string; count: number }>;
  lastSoldAt: string | null;
  acked?: boolean;
  ackNote?: string | null;
}

export interface DiscrepancyMissingEmployee {
  externalId: string;
  name: string;
  salesCount: number;
  sessionsCount: number;
}

export interface DiscrepancySegmentsResponse {
  from: string;
  to: string;
  segments: DiscrepancySegmentBucket[];
  problems: {
    unassigned: number;
    guessed: number;
    conflict: number;
  };
  products: DiscrepancySegmentProduct[];
  missingEmployees: DiscrepancyMissingEmployee[];
  employees: DiscrepancyEmployeeOption[];
}

export interface DiscrepancySalesDay {
  date: string;
  kassaCash: number;
  oneCCash: number;
  kassaCard: number;
  oneCCard: number;
  diffCash: number;
  diffCard: number;
}

/** One nomenclature line of a 1C sale document (mixed sales have several). */
export interface DiscrepancySaleLine {
  productName: string;
  segment: DiscrepancySegmentKey | null;
  amount: number;
}

export interface DiscrepancyNearestOneC {
  documentId: string | null;
  occurredAt: string;
  amount: number;
  diff: number;
  lines: DiscrepancySaleLine[];
}

export interface DiscrepancyUnmatchedKassa {
  itemKey: string;
  fingerprint: string;
  receiptId: string;
  occurredAt: string;
  amount: number;
  cash: number;
  cashless: number;
  cashier?: string | null;
  receiptType: string;
  /** Closest unmatched 1C payment in the time window (hint for manual check). */
  nearestOneC?: DiscrepancyNearestOneC | null;
  acked?: boolean;
}

export interface DiscrepancyUnmatchedOneC {
  itemKey: string;
  fingerprint: string;
  externalId: string;
  documentId?: string | null;
  occurredAt: string;
  amount: number;
  cash: number;
  card: number;
  /** Joined line names (back-compat). */
  productName?: string | null;
  lines: DiscrepancySaleLine[];
  clientName?: string | null;
  employeeName?: string | null;
  acked?: boolean;
}

export interface DiscrepancySalesResponse {
  from: string;
  to: string;
  days: DiscrepancySalesDay[];
  unmatchedKassa: DiscrepancyUnmatchedKassa[];
  unmatchedOneC: DiscrepancyUnmatchedOneC[];
  oneCCashless: number;
  oneCPersonalAccount: number;
  problemDays: number;
  matchedCount: number;
  /** Matched cheques whose 1C document has 2+ nomenclature lines. */
  mixedMatched: number;
  /** Matched by combining several 1C payments / several cheques. */
  combinedMatched: number;
  webkassa: {
    lastSuccessAt: string | null;
    lastStatus: string | null;
    lastError: string | null;
    lastCount: number;
  };
  employees: DiscrepancyEmployeeOption[];
}

export interface DiscrepancyPerformerRow {
  /** Stable key (1C employee code or name) — used by the employee filter. */
  performerId: string;
  /** FitGO user id for review-queue deep links; null when staff not linked. */
  performerUserId?: string | null;
  performerName: string;
  count: number;
  redCount: number;
  approximate?: boolean;
}

export interface DiscrepancySpaPtResponse {
  from: string;
  to: string;
  performers: DiscrepancyPerformerRow[];
  total: number;
  redTotal: number;
  employees: DiscrepancyEmployeeOption[];
}

export interface DiscrepancyGroupSessionRow {
  sessionKey: string;
  startAt: string;
  title: string;
  bookedAtStart: number;
  confirmed: number;
  lateAdds: number;
  duringAdds: number;
  approximate?: boolean;
}

export interface DiscrepancyGroupPerformer {
  performerId: string;
  performerUserId?: string | null;
  performerName: string;
  lateAddCount: number;
  sessions: DiscrepancyGroupSessionRow[];
}

export interface DiscrepancyTrustException {
  id: string;
  title: string;
  performerName: string;
  startAt: string;
  trustBand: string;
  baselineCount: number;
  attendedCount: number;
  trustReasons: string[];
}

export interface DiscrepancyGroupResponse {
  from: string;
  to: string;
  performers: DiscrepancyGroupPerformer[];
  lateAddTotal: number;
  trustExceptions: DiscrepancyTrustException[];
  employees: DiscrepancyEmployeeOption[];
}

export const DISCREPANCY_SEGMENT_TITLES: Record<DiscrepancySegmentKey, string> =
  {
    membership: 'Абонементы',
    spa: 'SPA',
    shop: 'Магазин',
    solarium: 'Солярий',
    training: 'Тренировки',
  };

export const DISCREPANCY_RETENTION_DAYS = 92;
export const DISCREPANCY_EXPIRING_PACKAGE_DAYS = 7;
export const DISCREPANCY_SALES_MATCH_WINDOW_MIN = 10;
