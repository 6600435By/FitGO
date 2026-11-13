import type { ClubRevenueLineDto, WorkUnit } from '@fitgo/shared-types';
import { isSpaLikeSessionTitle } from '@fitgo/shared-types';

export function unitDayIso(u: WorkUnit): string {
  return u.occurredAt.slice(0, 10);
}

function shiftIsoDays(isoDay: string, deltaDays: number): string {
  const d = new Date(`${isoDay}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

/** True when sale opens by linked ClubRevenue externalId. */
export function unitHasSalePeek(u: WorkUnit): boolean {
  return Boolean(u.saleExternalId?.trim());
}

export type UnitSaleSearch = {
  from: string;
  to: string;
  q: string;
};

/**
 * Search params to resolve a sale card when there is no single externalId
 * (client / program query over ClubRevenue).
 */
export function unitSaleSearchQuery(u: WorkUnit): UnitSaleSearch | null {
  if (u.kind !== 'SPA' && u.kind !== 'PT' && u.kind !== 'GROUP') return null;
  if (unitHasSalePeek(u)) return null;
  const sessionDay = unitDayIso(u);
  const saleDay = u.saleOccurredAt?.slice(0, 10) || undefined;
  if (u.kind === 'GROUP') {
    if (!u.title?.trim() || !sessionDay) return null;
    return { from: sessionDay, to: sessionDay, q: u.title.trim() };
  }
  if (u.clientName?.trim()) {
    const looksPack = /\(абонемент\)|\(блок\)|абонемент|пакет|блок/i.test(
      u.title ?? '',
    );
    let from = sessionDay;
    let to = sessionDay;
    if (saleDay) {
      from = saleDay;
      to = saleDay;
    } else if (sessionDay && looksPack) {
      from = shiftIsoDays(sessionDay, -120);
      to = sessionDay;
    }
    return { from, to, q: u.clientName.trim() };
  }
  if (u.title?.trim() && sessionDay) {
    return { from: sessionDay, to: sessionDay, q: u.title.trim() };
  }
  return null;
}

/** Sale can open as in-page card (linked id or searchable). */
export function unitCanOpenSale(u: WorkUnit): boolean {
  return unitHasSalePeek(u) || unitSaleSearchQuery(u) != null;
}

/**
 * Score how well a ClubRevenue line matches the payroll work unit.
 * Used so «Продажа» does not open a bar/ЛС cheque for the same client.
 */
export function scoreSaleLineForUnit(
  u: WorkUnit,
  line: Pick<ClubRevenueLineDto, 'productName' | 'clientName' | 'occurredAt'>,
): number {
  const product = norm(line.productName ?? '');
  const title = norm(u.title ?? '').replace(
    /\s*\((абонемент|блок)\)\s*$/i,
    '',
  );
  const client = norm(u.clientName ?? '');
  const lineClient = norm(line.clientName ?? '');
  if (client && lineClient && client !== lineClient) return -1;

  let score = 0;
  if (u.kind === 'SPA') {
    if (isSpaLikeSessionTitle(product)) score += 40;
    else if (/массаж|spa|биоимпедан|solari|солярри/i.test(product)) score += 30;
    else return -1; // bar / shop / membership cash — never for SPA visit
  }
  if (u.kind === 'PT') {
    if (/тренер|персональн|\bпт\b|реформер|занятие/i.test(product)) score += 40;
    else if (isSpaLikeSessionTitle(product)) return -1;
  }
  if (title && product) {
    if (product.includes(title) || title.includes(product)) score += 50;
    else {
      const titleTok = title.split(' ').filter((t) => t.length > 3);
      const hits = titleTok.filter((t) => product.includes(t)).length;
      score += hits * 8;
    }
  }
  if (/\(абонемент\)|\(блок\)|пакет|блок/i.test(u.title ?? '')) {
    if (/пакет|блок|абонемент|безлимит/i.test(product)) score += 15;
  }
  const saleDay = (u.saleOccurredAt ?? u.occurredAt).slice(0, 10);
  const lineDay = (line.occurredAt ?? '').slice(0, 10);
  if (saleDay && lineDay && saleDay === lineDay) score += 10;
  return score;
}

/** Keep only plausible sale lines for this unit, best first. */
export function pickSaleLinesForUnit(
  u: WorkUnit,
  lines: ClubRevenueLineDto[],
): ClubRevenueLineDto[] {
  const scored = lines
    .map((line) => ({ line, score: scoreSaleLineForUnit(u, line) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return [];
  const best = scored[0]!.score;
  // Keep near-ties so the picker can disambiguate.
  return scored.filter((x) => x.score >= best - 15).map((x) => x.line);
}

export function unitCostLabel(u: WorkUnit, currency: string): string {
  if (u.kind !== 'SPA' && u.kind !== 'PT') return '—';
  if (u.priceMinor == null || u.priceMinor <= 0) return '—';
  return `${(u.priceMinor / 100).toFixed(2)}\u00a0${currency}`;
}

export function unitEarnLabel(u: WorkUnit, currency: string): string {
  if (u.kind !== 'SPA' && u.kind !== 'PT' && u.kind !== 'GROUP') return '—';
  if (u.earnMinor == null) return '—';
  if (u.ratePercent != null && (u.priceMinor ?? 0) > 0) {
    return `${u.ratePercent}% · ${(u.earnMinor / 100).toFixed(2)}\u00a0${currency}`;
  }
  return `${(u.earnMinor / 100).toFixed(2)}\u00a0${currency}`;
}
