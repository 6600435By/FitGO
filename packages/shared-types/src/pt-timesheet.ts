/** PT day timesheet / shift control (journal → sheet → approve → payroll). */

export type PtClientIssue =
  | 'NONE'
  | 'WRONG_PHONE'
  | 'CRM_UNMATCHED'
  | 'IDENTITY_MISMATCH';

export type PtSessionPayKind = 'UNKNOWN' | 'GIFT' | 'BLOCK' | 'PAID';

export type TrainerShiftStatus = 'PLANNED' | 'OPEN' | 'CLOSED';

export type TrainerDaySheetStatus =
  | 'DRAFT'
  | 'TRAINER_SUBMITTED'
  | 'ADMIN_REVIEW'
  | 'ADMIN_APPROVED'
  | 'SA_APPROVED'
  | 'LOCKED';

export interface TrainerShiftDto {
  id: string;
  trainerId: string;
  date: string;
  startAt: string;
  endAt: string;
  status: TrainerShiftStatus;
  minutes: number;
}

export interface TrainerDaySheetLineDto {
  id: string;
  bookingId: string;
  clientId: string;
  clientName: string;
  clientPhone?: string;
  startAt: string;
  endAt: string;
  source: string;
  payKind: PtSessionPayKind;
  priceMinor?: number;
  paymentStatus: string;
  verified1c: boolean;
  payable: boolean;
  countsForVolume: boolean;
  isLateAdd: boolean;
  clientIssue: PtClientIssue;
  clientIssueEscalated: boolean;
  /** Admin confirmed payment without a 1C document. */
  manualPaymentConfirmed?: boolean;
  forceIncludeInPayroll: boolean;
  isComplimentary: boolean;
  motivationMinor: number;
  trustBand: string;
}

export interface TrainerDaySheetDto {
  id: string;
  trainerId: string;
  trainerName: string;
  date: string;
  status: TrainerDaySheetStatus;
  shiftMinutes: number;
  workedMinutes: number;
  hourlyMinor: number;
  shiftPayMinor: number;
  sessionMotivationMinor: number;
  totalMinor: number;
  currency: string;
  submittedAt?: string;
  adminApprovedByName?: string;
  adminApprovedAt?: string;
  saApprovedByName?: string;
  saApprovedAt?: string;
  lines: TrainerDaySheetLineDto[];
  openClientIssues: number;
  openLateAdds: number;
  unpaidCount: number;
}

export interface PtClientIssueQueueItem {
  bookingId: string;
  sheetId?: string;
  trainerId: string;
  trainerName: string;
  clientId: string;
  clientName: string;
  clientPhone?: string;
  startAt: string;
  clientIssue: PtClientIssue;
  clientIssueEscalated: boolean;
  isLateAdd: boolean;
}

export function clientIssueLabel(issue: PtClientIssue): string {
  switch (issue) {
    case 'WRONG_PHONE':
      return 'Ошибочный телефон';
    case 'CRM_UNMATCHED':
      return 'Нет в 1С — ждёт привязки';
    case 'IDENTITY_MISMATCH':
      return 'Не тот клиент';
    default:
      return '';
  }
}

/** How the conducted PT was funded (абонемент / блок / разовая). */
export type PtStatsOrigin =
  | 'MEMBERSHIP'
  | 'BLOCK'
  | 'ONE_SHOT'
  | 'GIFT'
  | 'UNKNOWN';

/**
 * Settlement axis (independent of origin):
 * WRITTEN_OFF — quota from membership/block; PAID — cash sale; DEBT; GIFT; UNKNOWN.
 */
export type PtStatsPayment =
  | 'WRITTEN_OFF'
  | 'PAID'
  | 'DEBT'
  | 'GIFT'
  | 'UNKNOWN';

export interface PtStatsSessionLine {
  sessionKey: string;
  occurredAt: string;
  trainerId: string;
  trainerName: string;
  clientKey: string;
  clientId?: string;
  clientName: string;
  origin: PtStatsOrigin;
  payment: PtStatsPayment;
  /** Unit / session price used for motivation. */
  priceMinor: number;
  /** Ladder % applied (omitted for fixed AllSports / gift). */
  ratePercent?: number;
  earnMinor: number;
  isComplimentary: boolean;
  payrollTrusted: boolean;
  title: string;
  /** Deep-link to sales when a pack/sale doc is known. */
  saleExternalId?: string;
  saleOccurredAt?: string;
}

export interface PtStatsMixCounts {
  membership: number;
  block: number;
  oneShot: number;
  gift: number;
  unknown: number;
}

export interface PtStatsPaymentCounts {
  writtenOff: number;
  paid: number;
  debt: number;
  gift: number;
  unknown: number;
  debtMinor: number;
}

export interface PtStatsClientGap {
  clientKey: string;
  clientId?: string;
  clientName: string;
  lastSessionAt: string;
  trainerId: string;
  trainerName: string;
}

export interface PtStatsTrainerSummary {
  trainerId: string;
  trainerName: string;
  sessionsConducted: number;
  noShowCount: number;
  cancelledCount: number;
  uniqueClients: number;
  newClients: number;
  returningClients: number;
  sessionsPerClient: number | null;
  /** Share of prior-window clients who also trained in this period (0–100). */
  retentionPct: number | null;
  /** Cohort first-PT 60–150d before period end; return in days 60–90. */
  retention90Pct: number | null;
  conversionPct: number | null;
  mix: PtStatsMixCounts;
  payments: PtStatsPaymentCounts;
  shiftMinutes: number;
  shiftPayMinor: number;
  hourlyRateMinor: number;
  /** PT session motivation in period (month ladder). */
  sessionMotivationMinor: number;
  /** sessionMotivationMinor + shiftPayMinor. */
  totalEarnMinor: number;
  /** Ladder % from full calendar months overlapping the period (max if multi-month). */
  ladderPercent: number | null;
}

export interface PtStatsReport {
  from: string;
  to: string;
  currency: string;
  /** Null when report is scoped to one trainer (trainer app or filter). */
  trainerId: string | null;
  trainers: PtStatsTrainerSummary[];
  /** Club-wide rollup when multiple trainers; equals trainers[0] when single. */
  totals: PtStatsTrainerSummary;
  lines: PtStatsSessionLine[];
  /** Clients with conducted PT in period and no future PersonalTrainingBooking. */
  noNextBooking: PtStatsClientGap[];
  /** True when at least one trainer has hourlyRateMinor > 0. */
  showShiftColumns: boolean;
}

export function ptStatsOriginLabelRu(o: PtStatsOrigin): string {
  switch (o) {
    case 'MEMBERSHIP':
      return 'Абонемент';
    case 'BLOCK':
      return 'Блок';
    case 'ONE_SHOT':
      return 'Разовая';
    case 'GIFT':
      return 'Подарок';
    default:
      return 'Не распознано';
  }
}

export function ptStatsPaymentLabelRu(p: PtStatsPayment): string {
  switch (p) {
    case 'WRITTEN_OFF':
      return 'Списано';
    case 'PAID':
      return 'Оплачено';
    case 'DEBT':
      return 'Долг';
    case 'GIFT':
      return 'Подарок';
    default:
      return 'Неизвестно';
  }
}
