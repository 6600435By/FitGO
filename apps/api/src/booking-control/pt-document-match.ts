/**
 * Pure PT FitGO booking ↔ 1C document matching (TrainerPtSale + live payment probe).
 * No Prisma / Nest — unit-testable.
 */

export const PT_DOC_LOOKBACK_DAYS = 7;
export const PT_DOC_LOOKAHEAD_DAYS = 14;

/**
 * FitGO PT control / payroll path applies to bookings created on or after this date
 * when `trainer_pt_control` is on. Older rows stay on the Onex / sale stream.
 */
export const PT_CONTROL_LAUNCH_AT = new Date('2026-01-01T00:00:00.000Z');

/** Canonical link key for a sale: prefer UUID#line (`externalId`), else `docRef`. */
export function canonicalPtDocId(sale: {
  externalId?: string | null;
  docRef?: string | null;
}): string | null {
  const ext = sale.externalId?.trim();
  if (ext) return ext;
  const ref = sale.docRef?.trim();
  return ref || null;
}

/** All string forms that mean the same 1C sale line (unique index must treat as one). */
export function ptDocIdAliases(sale: {
  externalId?: string | null;
  docRef?: string | null;
}): string[] {
  const out: string[] = [];
  const ext = sale.externalId?.trim();
  const ref = sale.docRef?.trim();
  if (ext) out.push(ext);
  if (ref && ref !== ext) out.push(ref);
  return out;
}

/**
 * Expand taken `linkedDocExternalId` values with known sale aliases so
 * `docRef` and `externalId` of the same line cannot double-link.
 */
export function expandTakenPtDocIds(
  takenIds: Iterable<string>,
  sales: Array<{ externalId?: string | null; docRef?: string | null }>,
): Set<string> {
  const taken = new Set(
    [...takenIds].map((id) => id.trim()).filter(Boolean),
  );
  for (const sale of sales) {
    const aliases = ptDocIdAliases(sale);
    if (aliases.some((a) => taken.has(a))) {
      for (const a of aliases) taken.add(a);
    }
  }
  return taken;
}

export function isPtControlEraBooking(createdAt: Date): boolean {
  return createdAt.getTime() >= PT_CONTROL_LAUNCH_AT.getTime();
}

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

/** Sale already linked to another FitGO PT booking (any alias). */
export function saleTakenByOther(
  sale: { externalId?: string | null; docRef?: string | null } | string,
  takenIds: ReadonlySet<string>,
): boolean {
  if (typeof sale === 'string') return takenIds.has(sale.trim());
  return ptDocIdAliases(sale).some((id) => takenIds.has(id));
}

export function filterPtSaleCandidates(
  booking: PtBookingMatchInput,
  sales: PtSaleCandidate[],
  takenDocIds: ReadonlySet<string>,
): PtSaleCandidate[] {
  if (booking.isComplimentary) return [];
  if (booking.linkedDocExternalId?.trim()) return [];

  return sales.filter((sale) => {
    if (!canonicalPtDocId(sale)) return false;
    if (saleTakenByOther(sale, takenDocIds)) return false;
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
