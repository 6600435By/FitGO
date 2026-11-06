import {
  extractQuotedPackNameFromBasis,
  inferPaymentFromBasis,
  isServiceBlockPackageName,
  isSpaAllSportsBioimpedance,
  isSpaLikeSessionTitle,
} from '@fitgo/shared-types';
import { OnexClassKind, SpaPaymentType } from '@prisma/client';
import { namesMatch } from '../booking-control/spa-document-match';

export function staffDisplayNames(u: {
  firstName: string;
  lastName: string;
}): string[] {
  const first = (u.firstName ?? '').trim();
  const last = (u.lastName ?? '').trim();
  const out: string[] = [];
  if (first && last) {
    out.push(`${last} ${first}`);
    out.push(`${first} ${last}`);
  } else if (last || first) {
    out.push(`${last} ${first}`.trim());
  }
  return out;
}

/** Match Onex / sale employee to FitGO user by external id or ФИО (order-flexible). */
export function resolveStaffUserId(
  byExternal: Map<string, string>,
  staff: Iterable<{ id: string; firstName: string; lastName: string }>,
  employeeExternalId?: string | null,
  employeeName?: string | null,
): string | undefined {
  const raw = employeeExternalId?.trim();
  if (raw) {
    const uid =
      byExternal.get(raw) ?? byExternal.get(raw.replace(/^0+/, ''));
    if (uid) return uid;
  }
  const name = employeeName?.trim();
  if (!name) return undefined;
  for (const t of staff) {
    for (const display of staffDisplayNames(t)) {
      if (namesMatch(display, name)) return t.id;
    }
  }
  return undefined;
}

function isMembershipQuotaBasis(basis: string | null | undefined): boolean {
  const b = (basis ?? '').toLowerCase();
  if (!b) return false;
  if (isServiceBlockPackageName(basis)) return false;
  const pack = extractQuotedPackNameFromBasis(basis);
  if (pack && isServiceBlockPackageName(pack)) return false;
  return /членств|абонемент|квот|безлимит|\bvip\b/.test(b);
}

function isMassageBlockBasis(basis: string | null | undefined): boolean {
  if (!basis?.trim()) return false;
  if (isServiceBlockPackageName(basis)) return true;
  const pack = extractQuotedPackNameFromBasis(basis);
  return Boolean(pack && isServiceBlockPackageName(pack));
}

/**
 * SPA payment buckets for club + staff analytics.
 * - PAID: one-shot sale OR massage/service block write-off
 * - QUOTA: membership / VIP subscription only
 * - PARTNER: Allsports БИОИМПЕДАНС (UUID or name with both tokens)
 * - UNKNOWN: cannot classify
 */
export function classifySpaPaymentBucket(input: {
  paymentBasis?: string | null;
  paySource?: string | null;
  paymentType?: SpaPaymentType | null;
  partnerSource?: string | null;
  serviceExternalId?: string | null;
  serviceTitle?: string | null;
}): 'QUOTA' | 'PAID' | 'PARTNER' | 'UNKNOWN' {
  const titleProbe = [
    input.serviceTitle,
    input.paymentBasis,
  ]
    .filter(Boolean)
    .join(' ');

  if (
    isSpaAllSportsBioimpedance({
      serviceExternalId: input.serviceExternalId,
      title: titleProbe || input.serviceTitle,
    })
  ) {
    return 'PARTNER';
  }

  // Massage / PT service blocks → paid pack, never membership quota.
  if (isMassageBlockBasis(input.paymentBasis)) {
    return 'PAID';
  }

  const ps = (input.partnerSource ?? '').toUpperCase();
  if (
    ps.includes('ALLSPORT') &&
    isSpaAllSportsBioimpedance({
      serviceExternalId: input.serviceExternalId,
      title: titleProbe,
    })
  ) {
    return 'PARTNER';
  }

  // FitGO journal: QUOTA only when membership basis (blocks already handled).
  if (input.paymentType === SpaPaymentType.PAID) return 'PAID';
  if (input.paymentType === SpaPaymentType.QUOTA) {
    if (isMembershipQuotaBasis(input.paymentBasis)) return 'QUOTA';
    // QUOTA flag without membership text (often a block booked as quota).
    if (!input.paymentBasis?.trim()) return 'UNKNOWN';
    return 'UNKNOWN';
  }

  const payment = inferPaymentFromBasis(input.paymentBasis);
  if (payment === 'PARTNER') {
    return isSpaAllSportsBioimpedance({ title: input.paymentBasis })
      ? 'PARTNER'
      : 'UNKNOWN';
  }
  if (payment === 'QUOTA') {
    return isMembershipQuotaBasis(input.paymentBasis) ? 'QUOTA' : 'UNKNOWN';
  }
  if (payment === 'PAID' || payment === 'DEBT') {
    const basis = input.paymentBasis ?? '';
    // Bare AllSports visit without биоимпеданс SKU — not a paid SPA bucket.
    if (
      /allsports|all\s*sports/i.test(basis) &&
      !isSpaAllSportsBioimpedance({ title: basis })
    ) {
      return 'UNKNOWN';
    }
    return 'PAID';
  }
  if (payment === 'GIFT') return 'UNKNOWN';

  const paySource = (input.paySource ?? '').toUpperCase();
  if (paySource === 'SALE') return 'PAID';
  if (paySource === 'PACKAGE') {
    // Bare PACKAGE without membership name — not quota.
    if (isMembershipQuotaBasis(input.paymentBasis)) return 'QUOTA';
    return 'UNKNOWN';
  }
  return 'UNKNOWN';
}

/** Same SPA session universe as club analytics. */
export function isSpaAnalyticsSession(input: {
  kind: OnexClassKind;
  title: string | null | undefined;
}): boolean {
  return (
    input.kind === OnexClassKind.SPA ||
    (input.kind === OnexClassKind.PT && isSpaLikeSessionTitle(input.title))
  );
}
