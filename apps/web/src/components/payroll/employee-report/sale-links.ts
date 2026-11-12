import type { WorkUnit } from '@fitgo/shared-types';

export function unitDayIso(u: WorkUnit): string {
  return u.occurredAt.slice(0, 10);
}

function shiftIsoDays(isoDay: string, deltaDays: number): string {
  const d = new Date(`${isoDay}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
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
