/** Work units, rates, and payroll period package. */

import type { TrustBand, TrustResolution } from './trust';

export type WorkUnitKind = 'SPA' | 'PT' | 'GROUP' | 'SHIFT';

export type MotivationRateKind =
  | 'SPA_SERVICE'
  | 'SPA_KIND'
  | 'PT'
  | 'GROUP';

export type MotivationRateType =
  | 'PERCENT_OF_PRICE'
  | 'FIXED_PER_SESSION'
  | 'FIXED_PER_ATTENDEE';

export interface WorkUnit {
  id: string;
  kind: WorkUnitKind;
  performerId: string;
  title: string;
  occurredAt: string;
  quantity: number;
  priceMinor?: number;
  /** Gift PT: counts toward volume tiers, not paid. */
  isComplimentary?: boolean;
  trustBand: TrustBand;
  trustResolution: TrustResolution;
  payrollTrusted: boolean;
  clientName?: string;
  serviceId?: string;
  sessionId?: string;
  /** Forma / 1C room title for GROUP units. */
  roomTitle?: string;
  roomKey?: import('./staff-pay').GroupRoomKey;
  /** SPA partner channel, e.g. ALLSPORTS. */
  partnerSource?: string;
}

export interface StaffCompensationDto {
  id: string;
  userId: string;
  userName: string;
  baseSalaryMinor: number;
  currency: string;
  effectiveFrom: string;
  payProfile?: import('./staff-pay').StaffPayProfile;
  payChips?: string[];
}

export interface StaffPaySummary {
  userId: string;
  name: string;
  roles: string[];
  track?: import('./staff-pay').StaffPayTrack;
  payChips: string[];
  baseSalaryMinor: number;
  currency: string;
  employmentKind?: import('./staff-pay').StaffEmploymentKind;
}

export interface MotivationRateDto {
  id: string;
  kind: MotivationRateKind;
  serviceId?: string;
  rateType: MotivationRateType;
  rateValue: number;
  currency: string;
  effectiveFrom: string;
}

export interface PayrollAdjustmentDto {
  id: string;
  userId: string;
  amountMinor: number;
  reason: string;
  periodFrom: string;
  periodTo: string;
  createdAt: string;
  /** Set when original period was locked and adjustment moved to open period. */
  redirectedFrom?: string;
}

export interface PayrollPeriodSummary {
  from: string;
  to: string;
  performerId: string;
  performerName: string;
  openExceptions: number;
  greenCount: number;
  resolvedCount: number;
  workUnits: WorkUnit[];
  baseSalaryMinor: number;
  motivationMinor: number;
  adjustmentsMinor: number;
  /** Premia / fines for the period. */
  adjustments: PayrollAdjustmentDto[];
  /** Motivation scheme chips for payslip. */
  payChips: string[];
  totalMinor: number;
  currency: string;
  canLock: boolean;
  locked: boolean;
  anomalyHints: string[];
}

/** 25th: advance for days 1–15; 15th: settlement for previous month. */
export type PayrollPayoutKind = 'ADVANCE_HALF' | 'MONTH_SETTLEMENT';

export type PayrollPayoutStatus = 'DRAFT' | 'PAID' | 'VOID';

export interface PayrollPayoutDto {
  id: string;
  userId: string;
  userName: string;
  kind: PayrollPayoutKind;
  periodFrom: string;
  periodTo: string;
  earnedMinor: number;
  priorPaidMinor: number;
  totalMinor: number;
  cardTransferMinor: number;
  cashMinor: number;
  actualCashMinor: number;
  carryInMinor: number;
  carryOutMinor: number;
  currency: string;
  status: PayrollPayoutStatus;
  paidAt?: string;
  note?: string;
  createdAt: string;
}

export interface PayrollPayoutPreview {
  kind: PayrollPayoutKind;
  periodFrom: string;
  periodTo: string;
  performerId: string;
  performerName: string;
  /** Roles that use fixed advance on 25th. */
  usesFixedAdvance: boolean;
  fixedAdvanceMinor: number;
  earnedMinor: number;
  priorPaidMinor: number;
  /** Accrued for wave (earned − prior), before carry. */
  totalMinor: number;
  /** Balance from previous rounding (+ underpay / − overpay). */
  carryInMinor: number;
  carryHint?: string;
  /** totalMinor + carryIn — amount to settle this wave. */
  payableMinor: number;
  currency: string;
  /** Existing paid payout for this window (blocks duplicate). */
  existingPayout?: PayrollPayoutDto;
  summary: PayrollPeriodSummary;
  hints: string[];
}

/** Calendar helpers for Belarus club pay waves. */
export function advanceHalfRange(year: number, month: number): {
  from: string;
  to: string;
} {
  const m = String(month).padStart(2, '0');
  return { from: `${year}-${m}-01`, to: `${year}-${m}-15` };
}

export function monthSettlementRange(year: number, month: number): {
  from: string;
  to: string;
} {
  /** Settlement on 15th of `month` pays for previous calendar month. */
  const d = new Date(Date.UTC(year, month - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return {
    from: `${y}-${mm}-01`,
    to: `${y}-${mm}-${String(last).padStart(2, '0')}`,
  };
}

export interface TrustExceptionItem {
  id: string;
  kind: WorkUnitKind | 'GROUP_SESSION';
  title: string;
  performerName: string;
  clientName?: string;
  startAt: string;
  trustBand: TrustBand;
  trustReasons: string[];
  baselineCount?: number;
  attendedCount?: number;
}

/** Attributed sales used for ADMIN / manager motivation. */
export interface StaffSalesBreakdown {
  membershipMinor: number;
  extraServicesMinor: number;
  shopMinor: number;
  corporateMinor: number;
  /** True when membership/extra/shop came from Analytics API. */
  fromAnalytics: boolean;
  hint?: string;
}

export interface PayrollCorporateSaleDto {
  id: string;
  userId: string;
  userName: string;
  periodFrom: string;
  periodTo: string;
  amountMinor: number;
  note?: string;
}

export type ClubPayrollSectionId =
  | 'ADMIN'
  | 'TRAINER'
  | 'SPECIALIST'
  | 'TECH'
  | 'EXTERNAL';

export interface ClubPayrollRow {
  userId: string;
  name: string;
  section: ClubPayrollSectionId;
  roles: string[];
  track?: import('./staff-pay').StaffPayTrack;
  employmentKind: import('./staff-pay').StaffEmploymentKind;
  baseSalaryMinor: number;
  motivationMinor: number;
  /** Positive adjustments. */
  bonusMinor: number;
  /** Absolute value of negative adjustments. */
  fineMinor: number;
  adjustmentsMinor: number;
  totalEarnedMinor: number;
  /** ADVANCE_HALF paid in period. */
  advancePaidMinor: number;
  /** Card transfers in period. */
  cardPaidMinor: number;
  /** MONTH_SETTLEMENT paid in period (ЗП 15-го). */
  settlementPaidMinor: number;
  /** Card + actual cash paid in period. */
  periodPaidTotalMinor: number;
  /** Accrued payout totals (legacy). */
  priorPaidMinor: number;
  toPayMinor: number;
  openExceptions: number;
  locked: boolean;
  currency: string;
  payChips: string[];
  anomalyHints: string[];
  sales?: StaffSalesBreakdown;
  workUnitCounts: {
    spa: number;
    pt: number;
    group: number;
    shiftHours: number;
  };
}

export interface ClubPayrollReport {
  from: string;
  to: string;
  currency: string;
  sections: Array<{
    id: ClubPayrollSectionId;
    label: string;
    rows: ClubPayrollRow[];
    totals: {
      baseSalaryMinor: number;
      motivationMinor: number;
      bonusMinor: number;
      fineMinor: number;
      totalEarnedMinor: number;
      toPayMinor: number;
    };
  }>;
  grandTotalMinor: number;
}
