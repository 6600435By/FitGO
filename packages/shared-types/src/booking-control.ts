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

export type GroupApprovalNoteRole = 'TRAINER' | 'ADMIN' | 'OVERRIDE';
export type GroupApprovalNoteAction = 'CONFIRM' | 'RETURN';

/** One reply in the GROUP approval comment thread. */
export interface GroupApprovalNoteItem {
  authorName: string;
  authorRole: GroupApprovalNoteRole;
  action: GroupApprovalNoteAction;
  text: string;
  createdAt: string;
}

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
  /** Chronological comment thread (trainer ↔ admin). */
  approvalNotes?: GroupApprovalNoteItem[];
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
  /** FitGO user id when the booking is linked to a local client. */
  clientId?: string;
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
  /**
   * FitGO SPA row already has a 1C visit (`crmDocRef`) or linked sale.
   * When true, UI must not show the «нет в 1С» badge.
   */
  oneCLinked?: boolean;
  /** ClubRevenueEntry.externalId when SPA is linked to a reception sale. */
  linkedSaleExternalId?: string;
  /**
   * 1C SPA visit with no matching FitGO journal row.
   * When true, UI shows «нет в журнале» and «Добавить в журнал».
   */
  missingJournal?: boolean;
}

/** Live settlement of SPA vs 1C (quota write-off or reception payment). */
export type SpaSettlementStatus =
  | 'QUOTA_CONSUMED'
  | 'AWAITING_PAYMENT'
  | 'PAID'
  | 'NOT_IN_1C'
  /** Guest / unlinked — no 1C counterparty on the booking. */
  | 'AWAITING_CLIENT_LINK'
  /** Admin confirmed payment without posting to 1C. */
  | 'MANUAL_PAID'
  | 'CANCELLED_IN_1C'
  | 'DELETED_IN_1C'
  | 'UNKNOWN';

export interface SpaSettlementInfo {
  status: SpaSettlementStatus;
  label: string;
  /** Where the status came from. */
  source: 'visit' | 'debt' | 'local' | 'onex' | 'sale';
  visitPosted?: boolean;
  /** 1C document number safe to show (never a UUID or revenue key). */
  visitNum?: string;
  /** Reception sale amount in minor units, when settlement comes from a payment. */
  amountMinor?: number;
  /** Human package / membership title when quota was consumed. */
  membershipName?: string;
  /**
   * True when FitGO may cancel/edit freely (not an alive 1C document).
   * False when posted & found in 1C — only time/date edit, no delete.
   */
  editableInApp?: boolean;
}

/** Why an admin sees a soft hint instead of auto-link. */
export type SpaLinkHintKind =
  | 'SALE_OTHER_NOMENCLATURE'
  | 'SALE_NO_PERFORMER'
  | 'SALE_OTHER_PERFORMER'
  | 'SALE_MULTIPLE'
  | 'VISIT_MULTIPLE'
  | 'LINKED';

export interface SpaLinkCandidate {
  kind: 'sale' | 'visit';
  externalId: string;
  label: string;
  amountMajor?: number;
  occurredAt?: string;
  paymentStatus?: 'PAID' | 'DEBT';
  productName?: string;
  performerName?: string;
  /** 1C visit title when kind=visit. */
  title?: string;
  /** Sale product maps to a FitGO SpaService — enable «Поставить эту услугу». */
  serviceId?: string;
}

/** One short admin hint under SPA settlement (never shown to specialist). */
export interface SpaLinkHint {
  kind: SpaLinkHintKind;
  message: string;
  candidates: SpaLinkCandidate[];
}

/**
 * Pull the package title from 1C paymentBasis
 * (e.g. `Членство "Курс массажа 5 (удален)" 72102 от 03.10.2025`).
 */
export function membershipNameFromPaymentBasis(
  basis?: string | null,
): string | undefined {
  if (!basis?.trim()) return undefined;
  const quoted = basis.match(/[«"„]([^»"“]+)[»"“]/);
  if (quoted?.[1]?.trim()) return quoted[1].trim();
  const m = basis.match(
    /членство\s+(.+?)(?:\s+\d{4,}(?:\s+от|\s*$)|$)/i,
  );
  if (m?.[1]?.trim()) {
    return m[1].trim().replace(/^["«]|["»]$/g, '');
  }
  return undefined;
}

const DOC_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 1C document number an admin can read («32076»).
 * Revenue keys (`uuid:cash:…`) and bare UUIDs are not document numbers.
 */
export function humanDocumentNumber(raw?: string | null): string | undefined {
  const v = raw?.trim();
  if (!v) return undefined;
  if (v.includes(':')) return undefined;
  if (DOC_UUID_RE.test(v)) return undefined;
  if (v.length > 24) return undefined;
  if (!/\d/.test(v)) return undefined;
  return v;
}

/** Multi-visit service pack title (massage/PT block), not VIP membership. */
export function isServiceBlockPackageName(
  name: string | null | undefined,
): boolean {
  const s = (name ?? '').trim();
  if (!s) return false;
  // Lazy import avoided — pack count lives in staff-pay; keep a light local check.
  const n = s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
  if (/(?:блок\s+)?массаж[а]?\s+\d{1,3}/.test(n)) return true;
  if (/курс\s+массаж[ае]?\s*\d{1,3}/.test(n)) return true;
  if (/(?:^|[^\d])\d{1,3}\s*пт(?![a-zа-яё])/.test(n)) return true;
  if (/реформер\s*\d{1,3}/.test(n)) return true;
  return false;
}

export function spaSettlementLabelRu(
  status: SpaSettlementStatus | undefined,
  membershipName?: string | null,
): string {
  switch (status) {
    case 'QUOTA_CONSUMED': {
      const name = membershipName?.trim();
      if (!name) return 'Списано с абонемента';
      if (isServiceBlockPackageName(name)) {
        return `Списано с блока · ${name}`;
      }
      return `Списано с абонемента · ${name}`;
    }
    case 'AWAITING_PAYMENT':
      return 'Ждёт оплаты в 1С';
    case 'PAID':
      return 'Оплачено';
    case 'NOT_IN_1C':
      return 'Нет документа в 1С';
    case 'AWAITING_CLIENT_LINK':
      return 'Ожидает привязки к 1С';
    case 'MANUAL_PAID':
      return 'Оплата подтверждена без 1С';
    case 'CANCELLED_IN_1C':
      return 'Отменено в 1С';
    case 'DELETED_IN_1C':
      return 'Удалено в 1С — можно править или удалить в FitGO';
    default:
      return 'Статус в 1С неизвестен';
  }
}

/** Compact audit trail for booking cards (no extra 1C round-trips). */
export interface BookingControlHistoryEvent {
  /** ISO timestamp */
  at: string;
  /** Short RU label, e.g. «Создана», «Подтвердил тренер». */
  action: string;
  byName?: string;
}

export interface BookingControlDetail extends BookingControlListItem {
  durationMin?: number;
  members: BookingControlMember[];
  remark?: BookingControlRemark | null;
  remarksHistory: BookingControlRemark[];
  fitgoBookedAt?: string;
  crmDocRef?: string;
  groupApproval?: GroupClassApprovalInfo | null;
  /** SPA only: quota write-off / payment fact from 1C. */
  spaSettlement?: SpaSettlementInfo;
  /** Admin-only: soft match to a sale/visit that needs a click. */
  spaLinkHint?: SpaLinkHint;
  /** When FitGO service title differs from the linked 1C visit title. */
  oneCTitle?: string;
  /** FitGO SpaService id — for nomenclature editor. */
  serviceId?: string;
  /** Who created / confirmed — small popover on the card. */
  history?: BookingControlHistoryEvent[];
  /** SPA guest / booking phone (may be empty until admin fills it). */
  guestPhone?: string;
}

/** Shared admin inbox row for GROUP / SPA / PT tasks awaiting admin action. */
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
  /** Defaults to GROUP for backwards compatibility */
  kind?: BookingControlKind;
  /** Why it is in the inbox */
  reason?: 'AWAITING_ADMIN' | 'UNPAID';
  clientName?: string;
  paymentStatus?: string;
}

export interface BookingControlListQuery {
  from: string;
  to: string;
  kind?: BookingControlKind | 'ALL';
  performerId?: string;
  status?: BookingControlStatus | 'ALL';
  needsReview?: boolean;
  payment?: 'PAID' | 'DEBT' | 'GIFT' | 'ALL';
  /** Reformer hall deep-link (room/title). */
  hall?: 'REFORMER';
  /** Personal reformer PT only (title match). */
  reformer?: 'personal';
  /** Substring match on clientName (case-insensitive). */
  client?: string;
  /** Exact FitGO client user id, or match guest by same normalized name. */
  clientId?: string;
  /** SPA rows not yet linked to 1C (source FITGO). */
  notIn1c?: boolean;
  /** 1C SPA visits with no FitGO journal booking. */
  missingJournal?: boolean;
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
  // Free AllSports биоимпеданс often has «беспл.» in basis — still PARTNER, not gift.
  if (/биоимпеданс|bio.?imped/.test(b)) return 'PARTNER';
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

export function payTagLabelRu(
  t: BookingControlPayTag | undefined,
  opts?: { packageName?: string | null },
): string {
  if (t === 'SALE') return 'продажа';
  if (t === 'PACKAGE') {
    return isServiceBlockPackageName(opts?.packageName) ? 'блок' : 'абонемент';
  }
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
