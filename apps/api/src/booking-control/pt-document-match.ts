/**
 * Pure PT FitGO booking ↔ 1C document matching (TrainerPtSale + live payment probe).
 * No Prisma / Nest — unit-testable.
 */

import { isMultiVisitPackSale } from '@fitgo/shared-types';
import { minskDayKey } from './spa-document-match';

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
  /** Shared 1C sale document UUID when several lines share one receipt. */
  saleDocumentId?: string | null;
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
  /** Gift / membership write-off — no cash sale match. */
  isComplimentary?: boolean;
  /** CLIENT_BOOKED also expects membership write-off, not cash sale. */
  origin?: string | null;
  payKind?: string | null;
};

export type PtDocMatchResult =
  | { kind: 'auto'; sale: PtSaleCandidate }
  | { kind: 'ambiguous'; sales: PtSaleCandidate[] }
  | { kind: 'none' };

/** Onex / class visit candidate for same-day journal glue. */
export type PtVisitCandidate = {
  externalId: string;
  startAt: Date;
  employeeExternalId?: string | null;
  clientExternalId?: string | null;
  clientName?: string | null;
  status?: string | null;
  title?: string | null;
  paymentBasis?: string | null;
  number?: string | null;
};

export type PtVisitMatchResult =
  | { kind: 'auto'; visit: PtVisitCandidate }
  | { kind: 'ambiguous'; visits: PtVisitCandidate[] }
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

/** Cash sale is not the basis for gift / membership write-off bookings. */
export function bookingSkipsCashSale(booking: PtBookingMatchInput): boolean {
  if (booking.isComplimentary) return true;
  if (booking.payKind === 'GIFT' || booking.payKind === 'BLOCK') return true;
  if (booking.origin === 'CLIENT_BOOKED') return true;
  return false;
}

export function filterPtSaleCandidates(
  booking: PtBookingMatchInput,
  sales: PtSaleCandidate[],
  takenDocIds: ReadonlySet<string>,
): PtSaleCandidate[] {
  if (bookingSkipsCashSale(booking)) return [];
  if (booking.linkedDocExternalId?.trim()) return [];

  return sales.filter((sale) => {
    if (!canonicalPtDocId(sale)) return false;
    if (saleTakenByOther(sale, takenDocIds)) return false;
    if (isMultiVisitPackSale(sale.serviceName)) return false;
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

function sameMinskDay(a: Date, b: Date): boolean {
  return minskDayKey(a) === minskDayKey(b);
}

/**
 * Prefer a single same-day cash sale over wider-window ambiguous hits.
 * Exactly one free candidate → auto; several → admin chooses; else none.
 */
export function matchPtDocument(
  booking: PtBookingMatchInput,
  sales: PtSaleCandidate[],
  takenDocIds: ReadonlySet<string>,
): PtDocMatchResult {
  const hits = filterPtSaleCandidates(booking, sales, takenDocIds);
  if (hits.length === 0) return { kind: 'none' };

  const sameDay = hits.filter((s) => sameMinskDay(s.occurredAt, booking.startAt));
  const pool = sameDay.length > 0 ? sameDay : hits;

  if (pool.length === 1) return { kind: 'auto', sale: pool[0]! };

  // Several lines of one receipt with equal open bookings → pair by time/line.
  const paired = tryPairSameSaleDocument(booking, pool, takenDocIds);
  if (paired) return paired;

  if (pool.length > 1) return { kind: 'ambiguous', sales: pool };
  return { kind: 'none' };
}

/**
 * When N free lines share one saleDocumentId and we only know this booking,
 * do not auto-pick — caller must pass sibling bookings for pairing.
 * Single-booking path: if only one free line on a multi-line receipt remains, auto.
 */
function tryPairSameSaleDocument(
  booking: PtBookingMatchInput,
  pool: PtSaleCandidate[],
  _takenDocIds: ReadonlySet<string>,
): PtDocMatchResult | null {
  const byDoc = new Map<string, PtSaleCandidate[]>();
  for (const s of pool) {
    const key =
      s.saleDocumentId?.trim() ||
      saleDocumentKeyFromDocRef(s.docRef) ||
      '';
    if (!key) continue;
    const list = byDoc.get(key) ?? [];
    list.push(s);
    byDoc.set(key, list);
  }
  // Only useful when all candidates share one receipt and we have exactly one
  // free line left for this booking (others already taken elsewhere).
  for (const lines of byDoc.values()) {
    if (lines.length === 1 && pool.length === 1) {
      return { kind: 'auto', sale: lines[0]! };
    }
  }
  void booking;
  return null;
}

function saleDocumentKeyFromDocRef(docRef?: string | null): string | null {
  const ref = docRef?.trim();
  if (!ref) return null;
  const hash = ref.indexOf('#');
  if (hash <= 0) return ref;
  return ref.slice(0, hash);
}

/** Line number from `000123#2` → 2; missing → 0. */
export function ptSaleLineNumber(sale: {
  docRef?: string | null;
  externalId?: string | null;
}): number {
  const ref = sale.docRef?.trim() || sale.externalId?.trim() || '';
  const m = ref.match(/#(\d+)\s*$/);
  return m ? Number(m[1]) : 0;
}

/**
 * Pair N unlinked bookings with N free lines of the same sale document.
 * Bookings by startAt asc, lines by #line asc. Equal counts only.
 */
export function pairPtSalesToBookings(input: {
  bookings: Array<{ id: string; startAt: Date }>;
  sales: PtSaleCandidate[];
}): Array<{ bookingId: string; sale: PtSaleCandidate }> | null {
  const bookings = [...input.bookings].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime(),
  );
  const sales = [...input.sales].sort(
    (a, b) => ptSaleLineNumber(a) - ptSaleLineNumber(b),
  );
  if (bookings.length === 0 || sales.length === 0) return null;
  if (bookings.length !== sales.length) return null;
  return bookings.map((b, i) => ({ bookingId: b.id, sale: sales[i]! }));
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

function visitClientOk(
  booking: PtBookingMatchInput,
  visit: PtVisitCandidate,
): boolean {
  if (
    booking.clientExternalId?.trim() &&
    visit.clientExternalId?.trim() &&
    booking.clientExternalId.trim() === visit.clientExternalId.trim()
  ) {
    return true;
  }
  return namesMatch(booking.clientName, visit.clientName);
}

function visitTrainerOk(
  booking: PtBookingMatchInput,
  visit: PtVisitCandidate,
): boolean {
  const emp = visit.employeeExternalId?.trim();
  if (!emp) {
    return !(
      booking.trainerEmployeeCode?.trim() || booking.trainerExternalId?.trim()
    );
  }
  return (
    codesMatch(booking.trainerEmployeeCode, emp) ||
    codesMatch(booking.trainerExternalId, emp)
  );
}

/**
 * Same Minsk day, same client + trainer. Auto when exactly one living visit.
 * Contested visits (another open booking would also claim) stay ambiguous.
 */
export function matchPtVisitByDay(input: {
  booking: PtBookingMatchInput;
  visits: PtVisitCandidate[];
  takenVisitIds?: ReadonlySet<string>;
  /** Other open FitGO bookings that could claim the same visit. */
  siblingBookings?: PtBookingMatchInput[];
}): PtVisitMatchResult {
  const { booking, visits, takenVisitIds, siblingBookings } = input;
  const day = minskDayKey(booking.startAt);
  const candidates = visits.filter((v) => {
    if (takenVisitIds?.has(v.externalId)) return false;
    if ((v.status || '').toUpperCase() === 'CANCELLED') return false;
    if (minskDayKey(v.startAt) !== day) return false;
    if (!visitTrainerOk(booking, v)) return false;
    if (!visitClientOk(booking, v)) return false;
    return true;
  });

  if (candidates.length === 0) return { kind: 'none' };
  if (candidates.length > 1) {
    return { kind: 'ambiguous', visits: candidates };
  }

  const only = candidates[0]!;
  const siblings = siblingBookings ?? [];
  for (const other of siblings) {
    if (other.id === booking.id) continue;
    if (other.linkedDocExternalId?.trim()) continue;
    const otherHit = matchPtVisitByDay({
      booking: other,
      visits: [only],
      takenVisitIds: new Set(),
    });
    if (otherHit.kind === 'auto') {
      return { kind: 'ambiguous', visits: [only] };
    }
  }
  return { kind: 'auto', visit: only };
}

/**
 * Build day-merge pairs booking ↔ onex for list dedup / fitgoBookingRef write.
 */
export function buildPtDayMergePairs(input: {
  bookings: PtBookingMatchInput[];
  visits: PtVisitCandidate[];
  alreadyMatchedBookingIds?: Set<string>;
  alreadyMatchedVisitIds?: Set<string>;
}): Array<{ bookingId: string; visitExternalId: string }> {
  const pairs: Array<{ bookingId: string; visitExternalId: string }> = [];
  const takenVisit = new Set(input.alreadyMatchedVisitIds ?? []);
  const takenBooking = new Set(input.alreadyMatchedBookingIds ?? []);
  const open = input.bookings.filter((b) => !takenBooking.has(b.id));

  for (const b of open) {
    const result = matchPtVisitByDay({
      booking: b,
      visits: input.visits,
      takenVisitIds: takenVisit,
      siblingBookings: open,
    });
    if (result.kind !== 'auto') continue;
    pairs.push({
      bookingId: b.id,
      visitExternalId: result.visit.externalId,
    });
    takenVisit.add(result.visit.externalId);
    takenBooking.add(b.id);
  }
  return pairs;
}
