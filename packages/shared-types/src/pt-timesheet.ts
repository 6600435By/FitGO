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
      return 'Нет в 1С';
    case 'IDENTITY_MISMATCH':
      return 'Не тот клиент';
    default:
      return '';
  }
}
