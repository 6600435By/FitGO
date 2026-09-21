/** Work units, rates, and payroll period package. */

import type { TrustBand, TrustResolution } from './trust';

export type WorkUnitKind = 'SPA' | 'PT' | 'GROUP';

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
  totalMinor: number;
  currency: string;
  canLock: boolean;
  locked: boolean;
  anomalyHints: string[];
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
