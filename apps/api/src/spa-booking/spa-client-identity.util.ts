/** Exact guest-name match for cascade / specialist history search. */
export function normalizeGuestLabel(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Prefer typed alias; fall back to current guestName for legacy rows. */
export function guestMatchLabel(booking: {
  guestAlias?: string | null;
  guestName?: string | null;
}): string {
  return normalizeGuestLabel(booking.guestAlias || booking.guestName);
}

/** Two+ words → safe to auto-cascade; one word needs explicit confirm. */
export function shouldAutoCascadeByName(label: string): boolean {
  return normalizeGuestLabel(label).split(' ').filter(Boolean).length >= 2;
}

export function spaClientGroupKey(row: {
  clientExternalId?: string | null;
  clientId?: string | null;
  guestPhone?: string | null;
  guestAlias?: string | null;
  guestName?: string | null;
}): string {
  if (row.clientExternalId?.trim()) {
    return `ext:${row.clientExternalId.trim()}`;
  }
  if (row.clientId?.trim()) {
    return `user:${row.clientId.trim()}`;
  }
  const phone = (row.guestPhone ?? '').replace(/\D/g, '');
  if (phone.length >= 9) {
    return `phone:${phone}`;
  }
  const name = guestMatchLabel(row);
  if (name) return `name:${name}`;
  return `anon:${Math.random()}`;
}
