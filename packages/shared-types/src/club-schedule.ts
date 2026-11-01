import type { GroupApprovalPhase } from './booking-control';

/**
 * Client group schedule date-strip + ClubScheduleSlot sync horizon (days from today).
 * Keep UI strip and night/full sync in lockstep so day N is bookable when visible.
 */
export const GROUP_SCHEDULE_HORIZON_DAYS = 21;

/** Unified club calendar event status. */
export type ClubScheduleStatus = 'planned' | 'done' | 'cancelled';

export type ClubScheduleEventType = 'GROUP' | 'PT' | 'SPA' | 'DUTY';

export type SessionApprovalPhase =
  | 'PENDING_PERFORMER'
  | 'PENDING_ADMIN'
  | 'APPROVED';

export interface GpScheduleEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  status: ClubScheduleStatus;
  booked: number;
  capacity: number;
  attended: number;
  roomTitle?: string;
  sessionKey?: string;
  onexExternalId?: string;
  approvalPhase?: GroupApprovalPhase;
  approvalLabel?: string;
  payrollLocked: boolean;
}

export interface ClubScheduleEvent {
  id: string;
  type: ClubScheduleEventType;
  title: string;
  startAt: string;
  endAt: string;
  status: ClubScheduleStatus;
  staffId?: string;
  staffName?: string;
  clientId?: string;
  clientName?: string;
  roomTitle?: string;
  bookingId?: string;
  sessionKey?: string;
  booked?: number;
  capacity?: number;
  attended?: number;
  approvalPhase?: GroupApprovalPhase | SessionApprovalPhase;
  approvalLabel?: string;
  payrollLocked?: boolean;
}

export interface ClubScheduleQuery {
  from: string;
  to: string;
  types?: ClubScheduleEventType[];
  staffIds?: string[];
  status?: ClubScheduleStatus | 'ALL';
  /** Exact phase, or PENDING = any PENDING_* phase. */
  approval?: GroupApprovalPhase | SessionApprovalPhase | 'PENDING' | 'ALL';
}

export interface SpaAvailabilityOverlapItem {
  specialistId: string;
  specialistName: string;
  reason: 'PUBLISHED_BLOCK' | 'WORK_SCHEDULE';
  defaultSpaRoomId?: string | null;
}

export function sessionApprovalPhase(input: {
  performerConfirmedAt?: string | null;
  adminApprovedAt?: string | null;
  overrideApprovedAt?: string | null;
}): SessionApprovalPhase {
  if (input.overrideApprovedAt || input.adminApprovedAt) return 'APPROVED';
  if (input.performerConfirmedAt) return 'PENDING_ADMIN';
  return 'PENDING_PERFORMER';
}

export function sessionApprovalLabelRu(
  phase: SessionApprovalPhase | undefined,
): string | undefined {
  if (phase === 'PENDING_PERFORMER') return 'Ждёт исполнителя';
  if (phase === 'PENDING_ADMIN') return 'Ждёт администратора';
  return undefined;
}

export function isSessionPayrollEligible(input: {
  adminApprovedAt?: string | Date | null;
  overrideApprovedAt?: string | Date | null;
}): boolean {
  return Boolean(input.adminApprovedAt || input.overrideApprovedAt);
}
