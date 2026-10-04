/** «Контроль записей» — unified register of 1C class docs + unmatched FitGO bookings. */

export type BookingControlKind = 'GROUP' | 'PT' | 'SPA' | 'SOLARIUM';

export type BookingControlStatus =
  | 'SCHEDULED'
  | 'COMPLETED'
  | 'CANCELLED';

/** Display / payroll payment label for PT & SPA rows. */
export type BookingControlPayment =
  | 'PAID'
  | 'DEBT'
  | 'QUOTA'
  | 'PARTNER'
  | 'GIFT'
  | 'UNKNOWN'
  | 'N_A';

export type BookingControlSource = '1C' | 'FITGO' | 'SALE';

/** How a PT/SPA line was paid — shown as «продажа» / «абонемент». */
export type BookingControlPayTag = 'SALE' | 'PACKAGE';

export interface BookingControlRemark {
  id: string;
  status: 'OPEN' | 'CLOSED';
  staffComment: string;
  staffName: string;
  adminComment?: string;
  adminName?: string;
  createdAt: string;
  closedAt?: string;
}

/** Dual approval workflow for GROUP sessions (trainer → admin → payroll). */
export type GroupApprovalPhase =
  | 'PENDING_TRAINER'
  | 'PENDING_ADMIN'
  | 'APPROVED';

export interface GroupClassApprovalInfo {
  trainerSeenClientIds: string[];
  trainerName?: string;
  trainerApprovedAt?: string;
  trainerComment?: string;
  adminName?: string;
  adminApprovedAt?: string;
  adminComment?: string;
  overrideName?: string;
  overrideApprovedAt?: string;
  overrideComment?: string;
  returnedByName?: string;
  returnedAt?: string;
  returnComment?: string;
  phase: GroupApprovalPhase;
  /** Trainer checkmark count vs 1C arrived — shown when they differ. */
  trainerSeenCount: number;
  payrollEligible: boolean;
  /** True when payroll period is locked for this session. */
  locked: boolean;
}

export interface BookingControlMember {
  externalId: string;
  clientName: string;
  attendance: 'EXPECTED' | 'ATTENDED' | 'NO_SHOW' | 'CANCELLED';
  paymentBasis?: string;
  payment?: BookingControlPayment;
  /** Trainer marked this client as present (FitGO checkbox). */
  trainerSeen?: boolean;
}

export interface BookingControlListItem {
  /** Opaque id for API detail / remarks: 1c:{externalId}, fitgo:{kind}:{bookingId}, sale:PT:{docRef} */
  sessionKey: string;
  kind: BookingControlKind;
  source: BookingControlSource;
  title: string;
  startAt: string;
  endAt?: string;
  status: BookingControlStatus;
  performerName: string;
  performerId?: string;
  clientName?: string;
  roomTitle?: string;
  number?: string;
  /** @deprecated Prefer arrivedCount — kept for older clients. */
  attendeeCount?: number;
  /** Active roster size (not cancelled). */
  bookedCount?: number;
  /** Marked arrived / attended. */
  arrivedCount?: number;
  /** Booked but not arrived (expected + no-show). */
  noShowCount?: number;
  payment?: BookingControlPayment;
  /** «продажа» vs «абонемент» for one-time / package PT. */
  payTag?: BookingControlPayTag;
  needsReview: boolean;
  /** GROUP approval waiting label, e.g. «Ждёт тренера» / «Ждёт администратора». */
  approvalLabel?: string;
  approvalPhase?: GroupApprovalPhase | import('./club-schedule').SessionApprovalPhase;
  /** Linked FitGO booking id when matched or FitGO-only. */
  fitgoBookingId?: string;
  priceMinor?: number;
}

export interface BookingControlDetail extends BookingControlListItem {
  durationMin?: number;
  members: BookingControlMember[];
  remark?: BookingControlRemark | null;
  remarksHistory: BookingControlRemark[];
  fitgoBookedAt?: string;
  crmDocRef?: string;
  groupApproval?: GroupClassApprovalInfo | null;
}

/** Shared admin inbox row for GROUP sessions awaiting admin confirm. */
export interface GroupApprovalPendingTask {
  sessionKey: string;
  title: string;
  startAt: string;
  endAt?: string;
  performerName: string;
  trainerName?: string;
  trainerApprovedAt?: string;
  roomTitle?: string;
  number?: string;
  bookedCount: number;
  arrivedCount: number;
  trainerSeenCount: number;
}

export interface BookingControlListQuery {
  from: string;
  to: string;
  kind?: BookingControlKind | 'ALL';
  performerId?: string;
  status?: BookingControlStatus | 'ALL';
  needsReview?: boolean;
  payment?: 'PAID' | 'DEBT' | 'ALL';
}

export function onexSessionKey(externalId: string): string {
  return `1c:${externalId}`;
}

export function fitgoSessionKey(
  kind: BookingControlKind,
  bookingId: string,
): string {
  return `fitgo:${kind}:${bookingId}`;
}

export function saleSessionKey(kind: 'PT', docRef: string): string {
  return `sale:${kind}:${encodeURIComponent(docRef)}`;
}

export function parseSessionKey(sessionKey: string): {
  source: BookingControlSource;
  kind?: BookingControlKind;
  id: string;
} | null {
  if (sessionKey.startsWith('1c:')) {
    return { source: '1C', id: sessionKey.slice(3) };
  }
  const sale = /^sale:(PT):(.+)$/.exec(sessionKey);
  if (sale) {
    return {
      source: 'SALE',
      kind: sale[1] as BookingControlKind,
      id: decodeURIComponent(sale[2]),
    };
  }
  const m = /^fitgo:(GROUP|PT|SPA|SOLARIUM):(.+)$/.exec(sessionKey);
  if (m) {
    return {
      source: 'FITGO',
      kind: m[1] as BookingControlKind,
      id: m[2],
    };
  }
  return null;
}

/** Map 1C Onex status → register display status. */
export function mapOnexStatusToControl(
  status: string,
): BookingControlStatus {
  const s = status.toUpperCase();
  if (s === 'COMPLETED') return 'COMPLETED';
  if (s === 'CANCELLED') return 'CANCELLED';
  return 'SCHEDULED';
}

/** Infer payment label from 1C member paymentBasis text. */
export function inferPaymentFromBasis(
  basis: string | null | undefined,
): BookingControlPayment {
  const b = (basis ?? '').trim().toLowerCase();
  if (!b) return 'UNKNOWN';
  if (/подарок|gift|комплимент|бесплат/.test(b)) return 'GIFT';
  if (/allsports|all.?sports/.test(b)) return 'PARTNER';
  if (/членств|абонемент|пакет|квот|безлимит/.test(b)) return 'QUOTA';
  if (/долг|рассроч/.test(b)) return 'DEBT';
  if (/оплач|нал|карт|безнал|лс|лицевой|продаж/.test(b)) return 'PAID';
  return 'PAID';
}

export function inferPayTag(input: {
  paySource?: string | null;
  payment?: BookingControlPayment;
  source?: BookingControlSource;
}): BookingControlPayTag | undefined {
  if (input.source === 'SALE') return 'SALE';
  const ps = (input.paySource ?? '').toUpperCase();
  if (ps === 'PACKAGE') return 'PACKAGE';
  if (ps === 'SALE') return 'SALE';
  if (input.payment === 'QUOTA') return 'PACKAGE';
  if (input.payment === 'PAID' || input.payment === 'DEBT') return 'SALE';
  return undefined;
}

export function payTagLabelRu(t: BookingControlPayTag | undefined): string {
  if (t === 'SALE') return 'продажа';
  if (t === 'PACKAGE') return 'абонемент';
  return '';
}

export function paymentLabelRu(p: BookingControlPayment | undefined): string {
  switch (p) {
    case 'PAID':
      return 'Оплачено';
    case 'DEBT':
      return 'Нет оплаты';
    case 'QUOTA':
      return 'Абонемент';
    case 'PARTNER':
      return 'AllSports';
    case 'GIFT':
      return 'Подарок';
    case 'N_A':
      return '—';
    default:
      return 'Неизвестно';
  }
}

/** Money-eligible for PT/SPA payroll (not debt / unknown). */
export function paymentCountsForMoney(
  p: BookingControlPayment | undefined,
): boolean {
  return p === 'PAID' || p === 'QUOTA' || p === 'PARTNER';
}

/** Counts toward PT volume tiers (includes gifts). */
export function paymentCountsForVolume(
  p: BookingControlPayment | undefined,
): boolean {
  return (
    p === 'PAID' ||
    p === 'QUOTA' ||
    p === 'PARTNER' ||
    p === 'GIFT'
  );
}

/** GROUP payroll-eligible when admin confirmed or SA/manager override. */
export function groupApprovalPayrollEligible(input: {
  adminApprovedAt?: string | null;
  overrideApprovedAt?: string | null;
}): boolean {
  return Boolean(input.adminApprovedAt || input.overrideApprovedAt);
}

export function groupApprovalPhase(input: {
  trainerApprovedAt?: string | null;
  adminApprovedAt?: string | null;
  overrideApprovedAt?: string | null;
}): GroupApprovalPhase {
  if (input.overrideApprovedAt || input.adminApprovedAt) return 'APPROVED';
  if (input.trainerApprovedAt) return 'PENDING_ADMIN';
  return 'PENDING_TRAINER';
}

export function groupApprovalLabelRu(
  phase: GroupApprovalPhase | undefined,
): string | undefined {
  if (phase === 'PENDING_TRAINER') return 'Ждёт тренера';
  if (phase === 'PENDING_ADMIN') return 'Ждёт администратора';
  return undefined;
}
