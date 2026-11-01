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

/** Normalize pack / catalog labels for quota matching. */
export function normalizeMembershipServiceName(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/["«»„"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Catalog service may consume VIP «Массаж классический общий» —
 * exact/near name only, not every timed massage SKU.
 */
export function catalogMatchesClassicGeneralMassage(
  catalogName: string,
): boolean {
  const n = normalizeMembershipServiceName(catalogName);
  if (!n) return false;
  const target = normalizeMembershipServiceName('Массаж классический общий');
  if (n === target) return true;
  // Allow «Массаж классический общий 50 мин» only when it still says «общий».
  return (
    n.includes('массаж') &&
    n.includes('классическ') &&
    n.includes('общ') &&
    !/лиц[ае]|расслаб|антицеллюл|спортивн|баночн/.test(n)
  );
}

/** Strip trailing «(10)» qty decoration from 1C UI / pack line labels. */
export function stripPackQtySuffix(name: string): string {
  return normalizeMembershipServiceName(name).replace(/\s*\(\d+\)\s*$/u, '').trim();
}

function extractDurationMin(name: string): number | undefined {
  const m = name.match(/(\d+)\s*(?:мин|min|м)(?=\s|$|\))/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

function stripDurationToken(name: string): string {
  return name
    .replace(/\s*\d+\s*(?:мин|min|м)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Heuristic when SpaQuotaRule is missing: which catalog kinds/names
 * a membership pack line may unlock.
 *
 * Massage blocks («Блок массажа 10») expose СоставУслуг lines like
 * «Массаж классический 25 мин» — those must match the same timed SKU only,
 * never every «классический» duration via strip-min.
 */
export function spaCatalogMatchesMembershipLine(input: {
  membershipServiceName: string;
  catalogName: string;
  catalogKind?: 'MASSAGE' | 'BODY_COMPOSITION' | 'WRAP' | string | null;
}): boolean {
  const line = stripPackQtySuffix(input.membershipServiceName);
  const catalog = stripPackQtySuffix(input.catalogName);
  if (!line || !catalog) return false;

  const included = findMembershipIncludedService(input.membershipServiceName);
  if (included?.spaQuotaServiceKey === 'BODY_COMPOSITION') {
    if (input.catalogKind === 'BODY_COMPOSITION') return true;
    return /состав|inbody|биоимпеданс|анализ/.test(catalog);
  }
  if (included?.spaQuotaServiceKey === 'CLASSIC_MASSAGE') {
    return catalogMatchesClassicGeneralMassage(input.catalogName);
  }

  if (line === catalog) return true;

  const lineMin = extractDurationMin(line);
  const catalogMin = extractDurationMin(catalog);

  // Both timed retail SKUs (massage-block composition): same minutes + same base.
  if (lineMin != null && catalogMin != null) {
    if (lineMin !== catalogMin) return false;
    return stripDurationToken(line) === stripDurationToken(catalog);
  }

  // Untimed pack line vs timed catalog (or reverse) — base name only.
  if (lineMin == null || catalogMin == null) {
    const a = stripDurationToken(line);
    const b = stripDurationToken(catalog);
    return Boolean(a && b && a === b);
  }
  return false;
}

/**
 * Timed composition line from a sold massage block (not VIP «…общий»).
 * Source of truth = СоставУслуг / Остатки, not SpaQuotaRule allowlist.
 */
export function isMassageBlockCompositionLine(name?: string | null): boolean {
  const t = (name ?? '').trim();
  if (!t) return false;
  if (findMembershipIncludedService(t)) return false;
  if (!spaTitleHasDurationMin(t)) return false;
  return /массаж|massage|обёртыв|wrap|спа\b|spa\b/i.test(t);
}

/**
 * Membership pack line «Групповое занятие реформер 1» (nomenclature
 * GROUP_REFORMER_SESSION_SERVICE_IDS) — not personal reformer PT.
 * Any membership that includes this line unlocks «Использовать» → REFORMER-only schedule.
 */
export function isGroupReformerMembershipService(
  name?: string | null,
): boolean {
  const n = normalizeMembershipServiceName(name ?? '');
  if (!n || !/реформ/.test(n)) return false;
  if (/индивидуал|(?:^|[\s(])пт(?:[\s)]|$)|персонал/.test(n)) return false;
  // Canonical 1C line + close variants («групповое занятие реформер N»).
  if (/группов/.test(n) && /занят/.test(n)) return true;
  if (/группов/.test(n) && /реформ/.test(n)) return true;
  // Bare «реформер 1» / «реформер N» pack write-off lines without «индивидуал».
  if (/реформер\s*\d{1,3}\b/.test(n)) return true;
  return /реформ/.test(n) && /групп|занят|программ/.test(n);
}

/** General group programs line (VIP «Групповые программы») — excludes reformer. */
export function isGeneralGroupMembershipService(
  name?: string | null,
): boolean {
  const n = normalizeMembershipServiceName(name ?? '');
  if (!n || /реформ/.test(n)) return false;
  return /групп/.test(n);
}

/**
 * Client may see/book reformer group classes when membership has a
 * reformer-group entitlement. General «Групповые программы» alone is not enough.
 *
 * Prefer 1C segment «групповые реформеры» (REFORMER_GROUP_SEGMENT_UUID) match
 * on membership/package name; fall back to service-line name heuristics.
 */
export function membershipAllowsGroupReformer(
  services?: Array<{ name: string }> | null,
  opts?: {
    membershipName?: string | null;
    packageNames?: string[] | null;
    /** Normalized names / UUIDs from REFORMER_GROUP_SEGMENT_UUID */
    reformerGroupSegmentKeys?: Iterable<string> | null;
  },
): boolean {
  if ((services ?? []).some((s) => isGroupReformerMembershipService(s.name))) {
    return true;
  }
  const segment = opts?.reformerGroupSegmentKeys;
  if (segment) {
    const keys = segment instanceof Set ? segment : new Set(segment);
    if (keys.size > 0) {
      const candidates = [
        opts?.membershipName,
        ...(opts?.packageNames ?? []),
      ].filter(Boolean) as string[];
      for (const raw of candidates) {
        const n = normalizeMembershipServiceName(raw).replace(
          /[^a-zа-я0-9]+/gi,
          '',
        );
        const id = raw.trim().toLowerCase().replace(/-/g, '');
        for (const entry of keys) {
          if (n && entry === n) return true;
          if (id && entry.replace(/-/g, '') === id) return true;
        }
      }
    }
  }
  return false;
}
