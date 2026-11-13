import type { WorkUnit } from '@fitgo/shared-types';
import { namesMatch } from '../booking-control/spa-document-match';

/** SPA / PT debt row: shown in period detail, never counted in ЗП totals. */
export const PAYROLL_DEBT_HINT = 'Долг, в расчёт не входит';

/** Same-visit window: FitGO booking vs 1C Onex often differ by a few minutes. */
export const SPA_VISIT_COVER_WINDOW_MS = 90 * 60 * 1000;

export function normalizePayrollClientKey(
  name: string | null | undefined,
): string {
  return (name ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

/** Same person: exact key or FIO soft-match («Петров Андрей» ≈ «Петров Андрей Юрьевич»). */
export function payrollClientNamesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ka = normalizePayrollClientKey(a);
  const kb = normalizePayrollClientKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  return namesMatch(a, b);
}

export function spaUnitHasDebtHint(u: WorkUnit): boolean {
  return Boolean(u.trustHints?.includes(PAYROLL_DEBT_HINT));
}

function looksMembershipSpa(u: WorkUnit): boolean {
  if (u.spaMembershipQuota) return true;
  return /\(абонемент\)/i.test(u.title ?? '');
}

/**
 * True when an existing SPA unit is the same visit (client + close start).
 * Used so FitGO DEBT stubs do not duplicate a 1C write-off / paid sibling.
 */
export function spaUnitCoversVisit(
  units: WorkUnit[],
  clientName: string | null | undefined,
  startAt: Date,
  opts?: { onlyTrusted?: boolean; excludeId?: string },
): boolean {
  if (!normalizePayrollClientKey(clientName)) return false;
  const t = startAt.getTime();
  for (const u of units) {
    if (u.kind !== 'SPA') continue;
    if (opts?.excludeId && u.id === opts.excludeId) continue;
    if (opts?.onlyTrusted && !u.payrollTrusted) continue;
    if (!payrollClientNamesMatch(u.clientName, clientName)) continue;
    const ut = new Date(u.occurredAt).getTime();
    if (Number.isFinite(ut) && Math.abs(ut - t) <= SPA_VISIT_COVER_WINDOW_MS) {
      return true;
    }
  }
  return false;
}

/** Prefer paid/trusted Onex (or linked) over FitGO unpaid debt twin. */
export function preferSpaPayrollUnit(a: WorkUnit, b: WorkUnit): WorkUnit {
  if (a.payrollTrusted !== b.payrollTrusted) {
    return a.payrollTrusted ? a : b;
  }
  const aDebt = spaUnitHasDebtHint(a);
  const bDebt = spaUnitHasDebtHint(b);
  if (aDebt !== bDebt) return aDebt ? b : a;
  const aMem = looksMembershipSpa(a);
  const bMem = looksMembershipSpa(b);
  if (aMem !== bMem) return aMem ? a : b;
  const aOnex = a.id.startsWith('onex:');
  const bOnex = b.id.startsWith('onex:');
  // Prefer the row that still carries a sale / pack link for «Продажа».
  const aSale = Boolean(a.saleExternalId?.trim());
  const bSale = Boolean(b.saleExternalId?.trim());
  if (aSale !== bSale) return aSale ? a : b;
  // Prefer concrete FitGO booking id over synthetic onex: when equal trust.
  if (aOnex !== bOnex) return aOnex ? b : a;
  return a;
}

/**
 * Collapse SPA twins (same client + close time): keep one unit.
 * Drops FitGO «не оплачено» when 1C already has the membership/block write-off.
 */
export function dedupeSpaPayrollUnits(units: WorkUnit[]): WorkUnit[] {
  const spaIdx: number[] = [];
  for (let i = 0; i < units.length; i++) {
    if (units[i]?.kind === 'SPA') spaIdx.push(i);
  }
  if (spaIdx.length < 2) return units;

  const drop = new Set<number>();
  for (let a = 0; a < spaIdx.length; a++) {
    const ia = spaIdx[a]!;
    if (drop.has(ia)) continue;
    const ua = units[ia]!;
    if (!normalizePayrollClientKey(ua.clientName)) continue;
    const ta = new Date(ua.occurredAt).getTime();
    if (!Number.isFinite(ta)) continue;
    for (let b = a + 1; b < spaIdx.length; b++) {
      const ib = spaIdx[b]!;
      if (drop.has(ib)) continue;
      const ub = units[ib]!;
      if (!payrollClientNamesMatch(ua.clientName, ub.clientName)) continue;
      const tb = new Date(ub.occurredAt).getTime();
      if (!Number.isFinite(tb)) continue;
      if (Math.abs(ta - tb) > SPA_VISIT_COVER_WINDOW_MS) continue;
      const keep = preferSpaPayrollUnit(ua, ub);
      if (keep === ua) drop.add(ib);
      else {
        drop.add(ia);
        break;
      }
    }
  }
  if (drop.size === 0) return units;
  return units.filter((_, i) => !drop.has(i));
}
