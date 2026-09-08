import {
  MembershipStatus,
  type Membership,
  type Visit,
} from '@fitgo/shared-types';

/**
 * Forma visit titles often look like:
 *   Членство "VIP (1месяц)" 69663 от 17.06.2026
 * When /membership returns null, recover name (+ rough dates) from visits.
 *
 * Important: after club renewals the visit title still shows the original
 * start date / package name — do NOT treat estimated end as authoritative expiry.
 */
export function deriveMembershipFromVisits(
  visits: Array<Pick<Visit, 'id' | 'date' | 'title'>>,
): Membership | null {
  for (const visit of visits) {
    const title = visit.title?.trim();
    if (!title) continue;

    const match = title.match(
      /Членство\s+[«"„]?([^»"“]+)[»"“]?(?:\s+(\d+))?(?:\s+от\s+(\d{2})[./](\d{2})[./](\d{4}))?/i,
    );
    if (!match) continue;

    const name = match[1].trim();
    if (!name) continue;

    const validFrom =
      match[3] && match[4] && match[5]
        ? `${match[5]}-${match[4]}-${match[3]}`
        : visit.date.slice(0, 10);

    const months = parseDurationMonths(name) ?? 1;
    const estimatedUntil = addMonthsIso(validFrom, months);
    const estimatedPast = new Date(`${estimatedUntil}T23:59:59`) < new Date();

    return {
      id: match[2] ? `membership-doc-${match[2]}` : `visit-derived-${visit.id}`,
      name,
      // Title-based estimate cannot prove expiry after a 1C renewal.
      status: MembershipStatus.ACTIVE,
      validFrom,
      // Keep estimated end for UI progress; if past, push a short horizon so
      // the home card does not look "dead" while /membership is still null.
      validUntil: estimatedPast
        ? addMonthsIso(new Date().toISOString().slice(0, 10), Math.max(months, 1))
        : estimatedUntil,
    };
  }

  return null;
}

function parseDurationMonths(name: string): number | null {
  const lower = name.toLowerCase().replace(/\s+/g, '');
  if (/год|годов|12\s*мес|12мес/.test(name.toLowerCase()) || /12мес/.test(lower)) {
    return 12;
  }
  const m = name.match(/(\d+)\s*(месяц|мес|month)/i) ?? lower.match(/(\d+)мес/);
  if (m) {
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function addMonthsIso(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}
