import { inferPaymentFromBasis, isSpaLikeSessionTitle } from '@fitgo/shared-types';
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

export function classifySpaPaymentBucket(input: {
  paymentBasis?: string | null;
  paySource?: string | null;
  paymentType?: SpaPaymentType | null;
  partnerSource?: string | null;
}): 'QUOTA' | 'PAID' | 'PARTNER' | 'UNKNOWN' {
  const ps = (input.partnerSource ?? '').toUpperCase();
  if (ps.includes('ALLSPORT')) return 'PARTNER';
  if (input.paymentType === SpaPaymentType.QUOTA) return 'QUOTA';
  if (input.paymentType === SpaPaymentType.PAID) return 'PAID';

  const payment = inferPaymentFromBasis(input.paymentBasis);
  const paySource = (input.paySource ?? '').toUpperCase();
  if (payment === 'PARTNER') return 'PARTNER';
  if (payment === 'QUOTA' || paySource === 'PACKAGE') return 'QUOTA';
  if (payment === 'PAID' || paySource === 'SALE') return 'PAID';
  if (payment === 'GIFT') return 'UNKNOWN';
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
