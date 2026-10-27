/**
 * Services included in club memberships (VIP / «Все включено» / similar).
 * Exact 1C pack-line names — remaining qty varies per membership (3, 1, …).
 *
 * SPA lines → SpaQuotaRule.membershipServiceName + spaQuotaRates.
 * PT gift → complimentary PT (not SpaQuotaRule).
 */

export type MembershipIncludedKind = 'SPA' | 'PT' | 'SOLARIUM';

export type MembershipIncludedServiceDef = {
  /** Exact nomenclature / pack line as in 1C membership.services[].name */
  name: string;
  kind: MembershipIncludedKind;
  /** Maps to StaffPayProfile.spaQuotaRates.serviceKey when kind=SPA */
  spaQuotaServiceKey?: 'CLASSIC_MASSAGE' | 'BODY_COMPOSITION';
};

/**
 * Live VIP pack lines (screenshot / GET membership).
 * Qty is per card — do not hard-code remaining.
 */
export const MEMBERSHIP_INCLUDED_SERVICES: readonly MembershipIncludedServiceDef[] =
  [
    {
      name: 'Массаж классический общий',
      kind: 'SPA',
      spaQuotaServiceKey: 'CLASSIC_MASSAGE',
    },
    {
      name: 'Подарочная ПТ с тренером',
      kind: 'PT',
    },
    {
      name: 'Анализ состава тела',
      kind: 'SPA',
      spaQuotaServiceKey: 'BODY_COMPOSITION',
    },
  ] as const;

export const MEMBERSHIP_INCLUDED_SPA_NAMES: readonly string[] =
  MEMBERSHIP_INCLUDED_SERVICES.filter((s) => s.kind === 'SPA').map(
    (s) => s.name,
  );

function normalizePackName(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/["«»„"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findMembershipIncludedService(
  title?: string | null,
): MembershipIncludedServiceDef | undefined {
  const n = normalizePackName(title ?? '');
  if (!n) return undefined;
  return MEMBERSHIP_INCLUDED_SERVICES.find(
    (s) => normalizePackName(s.name) === n,
  );
}

export function isKnownMembershipIncludedService(
  title?: string | null,
): boolean {
  return Boolean(findMembershipIncludedService(title));
}

/** True when 1C title embeds a timed retail SKU («… 50 мин»). */
export function spaTitleHasDurationMin(title?: string | null): boolean {
  return /(\d+)\s*(?:мин|min|м)(?=\s|$)/i.test(title ?? '');
}

/**
 * SPA write-off from membership pack (no «N мин» in title), not a paid retail SKU.
 * Known VIP lines + spa-like titles without duration (incl. «… (удален)»).
 */
export function isMembershipIncludedSpaTitle(
  title?: string | null,
): boolean {
  const t = (title ?? '').trim();
  if (!t) return false;
  if (spaTitleHasDurationMin(t)) return false;
  const known = findMembershipIncludedService(t);
  if (known) return known.kind === 'SPA';
  if (/удален/i.test(t) && /массаж|анализ|состав|inbody/i.test(t)) {
    return true;
  }
  return /массаж|анализ\s*состав|inbody|биоимпеданс/i.test(t);
}
