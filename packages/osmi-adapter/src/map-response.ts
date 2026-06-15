import { MembershipStatus, type Membership } from '@fitgo/shared-types';
import type { OsmiCardData } from './types';

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

function mapMembership(raw: unknown): Membership | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const name = pickString(m, ['name', 'title', 'membershipName', 'product_name']);
  const validUntil = pickString(m, ['validUntil', 'valid_until', 'expires_at', 'end_date']);
  const validFrom = pickString(m, ['validFrom', 'valid_from', 'start_date', 'activated_at']);
  const statusRaw = pickString(m, ['status', 'membershipStatus', 'state'])?.toUpperCase();

  if (!name && !validUntil) return null;

  let status = MembershipStatus.ACTIVE;
  if (statusRaw?.includes('EXPIR') || statusRaw === 'INACTIVE') {
    status = MembershipStatus.EXPIRED;
  } else if (statusRaw?.includes('FROZEN') || statusRaw?.includes('SUSPEND')) {
    status = MembershipStatus.FROZEN;
  }

  const visitsRemaining = m.visitsRemaining ?? m.visits_remaining ?? m.remain_visits;
  const visitsTotal = m.visitsTotal ?? m.visits_total ?? m.total_visits;

  return {
    id: pickString(m, ['id', 'membershipId', 'membership_id']) ?? 'osmi-membership',
    name: name ?? 'Абонемент',
    status,
    validFrom: validFrom ?? new Date().toISOString().slice(0, 10),
    validUntil: validUntil ?? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    visitsRemaining:
      typeof visitsRemaining === 'number' ? visitsRemaining : undefined,
    visitsTotal: typeof visitsTotal === 'number' ? visitsTotal : undefined,
  };
}

/** Map OSMI API JSON (flexible shapes) to internal card data. */
export function mapOsmiCardResponse(body: unknown): OsmiCardData | null {
  if (!body || typeof body !== 'object') return null;

  const root = body as Record<string, unknown>;
  const data =
    root.data && typeof root.data === 'object'
      ? (root.data as Record<string, unknown>)
      : root.card && typeof root.card === 'object'
        ? (root.card as Record<string, unknown>)
        : root;

  const cardId = pickString(data, ['id', 'cardId', 'card_id', 'uuid']);
  const barcode = pickString(data, [
    'barcode',
    'bar_code',
    'cardNumber',
    'card_number',
    'number',
    'code',
  ]);

  if (!cardId || !barcode) return null;

  const membershipRaw =
    data.membership ??
    data.subscription ??
    data.abonement ??
    data.pass;

  return {
    cardId,
    barcode,
    walletUrl: pickString(data, ['walletUrl', 'wallet_url', 'pass_url', 'url']),
    membership: mapMembership(membershipRaw),
  };
}
