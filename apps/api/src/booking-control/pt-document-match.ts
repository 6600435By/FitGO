/**
 * Pure PT FitGO booking ↔ 1C document matching (TrainerPtSale + live payment probe).
 * No Prisma / Nest — unit-testable.
 */

export const PT_DOC_LOOKBACK_DAYS = 7;
export const PT_DOC_LOOKAHEAD_DAYS = 14;

export type PtSaleCandidate = {
  externalId: string;
  occurredAt: Date;
  clientExternalId?: string | null;
  clientName?: string | null;
  employeeCode?: string | null;
  employeeName?: string | null;
  docRef?: string | null;
  paymentStatus?: string | null;
  amount?: number | null;
  serviceName?: string | null;
};

export type PtBookingMatchInput = {
  id: string;
  startAt: Date;
  clientExternalId?: string | null;
  clientName?: string | null;
  trainerEmployeeCode?: string | null;
  trainerExternalId?: string | null;
  trainerName?: string | null;
  linkedDocExternalId?: string | null;
  crmDocRef?: string | null;
  isComplimentary?: boolean;
};

export type PtDocMatchResult =
  | { kind: 'auto'; sale: PtSaleCandidate }
  | { kind: 'ambiguous'; sales: PtSaleCandidate[] }
  | { kind: 'none' };

function dayMs(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function withinWindow(saleAt: Date, sessionAt: Date): boolean {
  const s = dayMs(sessionAt);
  const x = dayMs(saleAt);
  const back = PT_DOC_LOOKBACK_DAYS * 86_400_000;
  const ahead = PT_DOC_LOOKAHEAD_DAYS * 86_400_000;
  return x >= s - back && x <= s + ahead;
}

export function namesMatch(
  a?: string | null,
  b?: string | null,
): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^a-zа-я0-9]+/gi, ' ')
      .trim();
  const left = norm(a);
  const right = norm(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const la = left.split(/\s+/);
  const rb = right.split(/\s+/);
  if (la[0] && rb[0] && la[0] === rb[0]) {
    if (la.length === 1 || rb.length === 1) return true;
    if (la[1]?.[0] && rb[1]?.[0] && la[1][0] === rb[1][0]) return true;
  }
  return left.includes(right) || right.includes(left);
}

function codesMatch(a?: string | null, b?: string | null): boolean {
  if (!a?.trim() || !b?.trim()) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Sale already linked to another FitGO PT booking. */
export function saleTakenByOther(
  saleExternalId: string,
  takenIds: ReadonlySet<string>,
): boolean {
  return takenIds.has(saleExternalId);
}

export function filterPtSaleCandidates(
  booking: PtBookingMatchInput,
  sales: PtSaleCandidate[],
  takenDocIds: ReadonlySet<string>,
): PtSaleCandidate[] {
  if (booking.isComplimentary) return [];
  if (booking.linkedDocExternalId?.trim()) return [];

  return sales.filter((sale) => {
    if (!sale.externalId?.trim()) return false;
    if (saleTakenByOther(sale.externalId, takenDocIds)) return false;
    if (!withinWindow(sale.occurredAt, booking.startAt)) return false;

    const clientOk =
      (booking.clientExternalId &&
        sale.clientExternalId &&
        booking.clientExternalId === sale.clientExternalId) ||
      namesMatch(booking.clientName, sale.clientName);
    if (!clientOk) return false;

    const trainerOk =
      codesMatch(booking.trainerEmployeeCode, sale.employeeCode) ||
      codesMatch(booking.trainerExternalId, sale.employeeCode) ||
      namesMatch(booking.trainerName, sale.employeeName);
    // If sale has no performer, still allow client+day match (rare).
    if (sale.employeeCode || sale.employeeName) {
      if (!trainerOk) return false;
    }
    return true;
  });
}

/**
 * Exactly one free candidate → auto; several → admin chooses; else none.
 */
export function matchPtDocument(
  booking: PtBookingMatchInput,
  sales: PtSaleCandidate[],
  takenDocIds: ReadonlySet<string>,
): PtDocMatchResult {
  const hits = filterPtSaleCandidates(booking, sales, takenDocIds);
  if (hits.length === 1) return { kind: 'auto', sale: hits[0]! };
  if (hits.length > 1) return { kind: 'ambiguous', sales: hits };
  return { kind: 'none' };
}

/** Prefer closer date, then higher amount. */
export function rankPtSaleCandidates(
  bookingStart: Date,
  sales: PtSaleCandidate[],
): PtSaleCandidate[] {
  const t = bookingStart.getTime();
  return [...sales].sort((a, b) => {
    const da = Math.abs(a.occurredAt.getTime() - t);
    const db = Math.abs(b.occurredAt.getTime() - t);
    if (da !== db) return da - db;
    return (Number(b.amount) || 0) - (Number(a.amount) || 0);
  });
}
