/** L0 trust bands for anti-padding (SPA / PT / GROUP). */

export type TrustBand = 'GREEN' | 'AMBER' | 'RED';

export type TrustReasonCode =
  | 'NO_VISIT'
  | 'ADDED_BY_STAFF'
  | 'ADDED_BY_TRAINER'
  | 'ABOVE_BASELINE'
  | 'NO_CRM_ID'
  | 'OUTSIDE_WINDOW'
  | 'PARTIAL_BASELINE'
  | 'ADMIN_OVERRIDE_PRESENCE'
  | 'ELEVATED_ORIGIN'
  | 'RESOLVED_EXCEPTION';

export type TrustResolution = 'NONE' | 'RESOLVED';

/** Visit must fall within ± hours of booking start/end. */
export const PRESENCE_VISIT_WINDOW_HOURS = 3;

/** Soft cap: attended above baseline by this many → session not AUTO_READY. */
export const GROUP_BASELINE_SOFT_CAP = 2;

export const TRUST_REASON_LABELS: Record<TrustReasonCode, string> = {
  NO_VISIT: 'Нет отметки на входе',
  ADDED_BY_STAFF: 'Добавил сотрудник',
  ADDED_BY_TRAINER: 'Добавил тренер',
  ABOVE_BASELINE: 'Больше эталона записи',
  NO_CRM_ID: 'Нет привязки к клиенту CRM',
  OUTSIDE_WINDOW: 'Визит вне окна услуги',
  PARTIAL_BASELINE: 'Неполный эталон из 1С',
  ADMIN_OVERRIDE_PRESENCE: 'Вход подтвердил админ',
  ELEVATED_ORIGIN: 'Запись не от клиента',
  RESOLVED_EXCEPTION: 'Исключение принято админом',
};

export function visitInBookingWindow(
  visitAt: Date,
  startAt: Date,
  endAt: Date,
  windowHours = PRESENCE_VISIT_WINDOW_HOURS,
): boolean {
  const padMs = windowHours * 60 * 60 * 1000;
  const from = startAt.getTime() - padMs;
  const to = endAt.getTime() + padMs;
  const t = visitAt.getTime();
  return t >= from && t <= to;
}

export function worstTrustBand(bands: TrustBand[]): TrustBand {
  if (bands.includes('RED')) return 'RED';
  if (bands.includes('AMBER')) return 'AMBER';
  return 'GREEN';
}

/** Payroll may count GREEN or admin-RESOLVED rows only. */
export function isPayrollTrusted(input: {
  trustBand: TrustBand;
  trustResolution?: TrustResolution | string | null;
}): boolean {
  if (input.trustResolution === 'RESOLVED') return true;
  return input.trustBand === 'GREEN';
}

/**
 * Trust for a single SPA/PT booking after dual-gate signals.
 * Review-queue ack does NOT upgrade band.
 */
export function computeBookingTrust(input: {
  origin: string;
  presenceStatus: string;
  performanceStatus: string;
  usageStatus?: string;
}): { trustBand: TrustBand; trustReasons: TrustReasonCode[] } {
  const reasons: TrustReasonCode[] = [];
  const elevated = input.origin !== 'CLIENT_BOOKED';
  const hasVisit = input.presenceStatus === 'VERIFIED_1C';
  const adminPresence = input.presenceStatus === 'ADMIN_OVERRIDE';
  const performed = input.performanceStatus === 'CONFIRMED_BY_PERFORMER';

  if (!performed) {
    return { trustBand: 'AMBER', trustReasons: reasons };
  }

  if (elevated) reasons.push('ELEVATED_ORIGIN');
  if (adminPresence) reasons.push('ADMIN_OVERRIDE_PRESENCE');
  if (!hasVisit && !adminPresence) reasons.push('NO_VISIT');

  if (elevated && !hasVisit && !adminPresence) {
    return { trustBand: 'RED', trustReasons: reasons };
  }
  if (elevated || adminPresence || !hasVisit) {
    return { trustBand: 'AMBER', trustReasons: reasons };
  }
  return { trustBand: 'GREEN', trustReasons: [] };
}

export function computeGroupMemberTrust(input: {
  source: 'BASELINE_1C' | 'TRAINER_ADDED' | 'ADMIN_ADDED' | string;
  attendance: 'EXPECTED' | 'ATTENDED' | 'NO_SHOW' | 'REMOVED' | string;
  visitMatched: boolean;
  hasCrmId: boolean;
}): { trustBand: TrustBand; trustReasons: TrustReasonCode[] } {
  const reasons: TrustReasonCode[] = [];
  if (
    input.attendance === 'NO_SHOW' ||
    input.attendance === 'REMOVED' ||
    input.attendance === 'EXPECTED'
  ) {
    return { trustBand: 'GREEN', trustReasons: [] };
  }

  if (!input.hasCrmId) {
    reasons.push('NO_CRM_ID');
    return { trustBand: 'RED', trustReasons: reasons };
  }

  const staffAdded =
    input.source === 'TRAINER_ADDED' || input.source === 'ADMIN_ADDED';
  if (input.source === 'TRAINER_ADDED') reasons.push('ADDED_BY_TRAINER');
  if (input.source === 'ADMIN_ADDED') reasons.push('ADDED_BY_STAFF');

  if (!input.visitMatched) {
    reasons.push('NO_VISIT');
    if (staffAdded) return { trustBand: 'RED', trustReasons: reasons };
    return { trustBand: 'AMBER', trustReasons: reasons };
  }

  if (staffAdded) {
    return { trustBand: 'AMBER', trustReasons: reasons };
  }
  return { trustBand: 'GREEN', trustReasons: [] };
}

export function computeGroupSessionTrust(input: {
  memberBands: TrustBand[];
  baselineQuality: 'FULL' | 'PARTIAL' | string;
  baselineCount: number;
  attendedCount: number;
  softCap?: number;
}): { trustBand: TrustBand; trustReasons: TrustReasonCode[] } {
  const reasons: TrustReasonCode[] = [];
  const cap = input.softCap ?? GROUP_BASELINE_SOFT_CAP;
  let band = worstTrustBand(
    input.memberBands.length ? input.memberBands : ['GREEN'],
  );

  if (input.baselineQuality === 'PARTIAL') {
    reasons.push('PARTIAL_BASELINE');
    band = worstTrustBand([band, 'AMBER']);
  }
  if (input.attendedCount > input.baselineCount + cap) {
    reasons.push('ABOVE_BASELINE');
    band = worstTrustBand([band, 'AMBER']);
  }
  return { trustBand: band, trustReasons: reasons };
}
