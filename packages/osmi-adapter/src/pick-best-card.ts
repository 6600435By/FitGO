import type { OsmiCardData } from './types';

/** When several OSMI cards share a phone, prefer one with membership data, then newest serial. */
export function pickBestOsmiCard(cards: Array<OsmiCardData | null | undefined>): OsmiCardData | null {
  const valid = cards.filter((c): c is OsmiCardData => Boolean(c));
  if (!valid.length) return null;

  const withMembership = valid.filter((c) => c.membership?.name);
  const pool = withMembership.length ? withMembership : valid;
  return [...pool].sort((a, b) => b.cardId.localeCompare(a.cardId))[0];
}

export function namesMatchOwner(owner: string, firstName: string, lastName: string): boolean {
  const words = owner.toLowerCase().split(/\s+/).filter(Boolean);
  const fn = firstName.trim().toLowerCase();
  const ln = lastName.trim().toLowerCase();
  if (!fn || !ln) return false;
  return words.includes(fn) && words.includes(ln);
}

export function registrationNameMatches(
  row: Record<string, string | undefined>,
  firstName: string,
  lastName: string,
): boolean {
  const first = (row['Имя'] ?? '').trim().toLowerCase();
  const last = (row['Фамилия'] ?? '').trim().toLowerCase();
  const fn = firstName.trim().toLowerCase();
  const ln = lastName.trim().toLowerCase();
  if (!fn || !ln) return false;
  return (first === fn && last === ln) || (first === ln && last === fn);
}
