/**
 * Pure SPA ↔ 1C document matching (sales + quota write-offs).
 * No Prisma / Nest — unit-testable.
 */

import type { SpaLinkCandidate, SpaLinkHint } from '@fitgo/shared-types';
import {
  isMultiVisitPackSale,
  isServiceBlockPackageName,
  isSpaLikeSessionTitle,
} from '@fitgo/shared-types';
import {
  preferredSaleBasisId,
  spaSaleLineKey,
} from '../admin-sales/payment-basis-products';

export { spaSaleLineKey };

/** Days before visit to look for a paid/debt sale. */
export const SPA_SALE_LOOKBACK_DAYS = 21;
/**
 * Days after visit to look for a sale (paid / posted later).
 * Reception often posts/pays days after the visit (e.g. Oct 8 visit → Oct 23 sale).
 */
export const SPA_SALE_LOOKAHEAD_DAYS = 45;
/** Open debt of same client+performer+service may be older. */
export const SPA_DEBT_LOOKBACK_DAYS = 60;

export type SpaSaleCandidate = {
  externalId: string;
  /** ClubRevenueEntry.documentId (Регистратор) when known. */
  documentId?: string | null;
  occurredAt: Date;
  paidAt?: Date | null;
  productName?: string | null;
  productExternalId?: string | null;
  clientExternalId?: string | null;
  clientName?: string | null;
  performerExternalId?: string | null;
  performerName?: string | null;
  saleAmount: number;
  paidAmount: number;
  operationType: string;
  cash?: number | null;
  card?: number | null;
  cashless?: number | null;
  personalAccount?: number | null;
};

function isCashOp(op: string): boolean {
  const o = (op ?? '').toLowerCase();
  return o === 'payment' || o === 'refund';
}

function positiveMajor(n: number | null | undefined): number {
  const v = Number(n) || 0;
  return v > 0.009 ? v : 0;
}

function roundMajor(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Cash/card/PA coverage for one ClubRevenue slice (tenders win over paidAmount). */
export function salePaidCoverage(sale: SpaSaleCandidate): number {
  const split =
    positiveMajor(sale.cash) +
    positiveMajor(sale.card) +
    positiveMajor(sale.cashless) +
    positiveMajor(sale.personalAccount);
  if (split > 0.009) return roundMajor(split);
  return positiveMajor(sale.paidAmount);
}

/**
 * Collapse sale + mixed payments of the same 1C document into one candidate.
 * SUMs tender splits across payment days; keeps sale/visit day on the non-cash
 * anchor. Partial pay stays underpaid until coverage ≥ document total (or write-off).
 */
export function collapseSpaSalesByBasis(
  sales: SpaSaleCandidate[],
): SpaSaleCandidate[] {
  const groups = new Map<string, SpaSaleCandidate[]>();
  let anon = 0;
  for (const s of sales) {
    const basis = preferredSaleBasisId({
      externalId: s.externalId,
      documentId: s.documentId ?? null,
    });
    const key = basis || s.externalId || `anon:${anon++}`;
    const list = groups.get(key);
    if (list) list.push(s);
    else groups.set(key, [s]);
  }
  return [...groups.values()].map(mergeSpaSaleGroup);
}

/** Cache row that already joined several SKUs of one document («A, B»). */
export function isJoinedProductName(
  name: string | null | undefined,
): boolean {
  return (name ?? '').includes(', ');
}

function saleBasisId(sale: SpaSaleCandidate): string {
  return (
    preferredSaleBasisId({
      externalId: sale.externalId,
      documentId: sale.documentId ?? null,
    }) || sale.externalId
  );
}

/**
 * Collapse to ONE candidate per nomenclature line of a sale document.
 * Non-cash rows (sale / unpaid / write-off) are the line anchors; cash slices
 * join the line they pay for (product id, then product name, then the single
 * line of their basis). A cash row with joined product names never invents a
 * line — it stays on its own and is filtered out of «Привязать».
 */
export function collapseSpaSalesByLine(
  sales: SpaSaleCandidate[],
): SpaSaleCandidate[] {
  const groups = new Map<string, SpaSaleCandidate[]>();
  const order: string[] = [];
  const push = (key: string, s: SpaSaleCandidate) => {
    const list = groups.get(key);
    if (list) {
      list.push(s);
      return;
    }
    groups.set(key, [s]);
    order.push(key);
  };

  const anchors = sales.filter((s) => !isCashOp(s.operationType));
  const cashRows = sales.filter((s) => isCashOp(s.operationType));

  const keysByBasis = new Map<string, string[]>();
  for (const s of anchors) {
    const key = spaSaleLineKey(s);
    push(key, s);
    const basis = saleBasisId(s);
    const keys = keysByBasis.get(basis) ?? [];
    if (!keys.includes(key)) keys.push(key);
    keysByBasis.set(basis, keys);
  }

  const anchorOf = (key: string) => groups.get(key)?.[0];

  for (const c of cashRows) {
    const keys = keysByBasis.get(saleBasisId(c)) ?? [];
    if (keys.length === 1) {
      push(keys[0]!, c);
      continue;
    }
    if (keys.length > 1) {
      const byId = c.productExternalId?.trim()
        ? keys.find((k) =>
            idsMatch(anchorOf(k)?.productExternalId, c.productExternalId),
          )
        : undefined;
      if (byId) {
        push(byId, c);
        continue;
      }
      if (!isJoinedProductName(c.productName)) {
        const byName = keys.filter((k) =>
          serviceNamesMatch(anchorOf(k)?.productName, c.productName),
        );
        if (byName.length === 1) {
          push(byName[0]!, c);
          continue;
        }
      }
    }
    // Keep cash-only groups for journal↔sale matching (same-day cash row).
    // Retail Контроль/ЗП must drop them via {@link spaRetailLineHasAnchor}.
    push(spaSaleLineKey(c), c);
  }

  return order.map((key) => mergeSpaSaleGroup(groups.get(key)!));
}

/**
 * True when this collapsed line includes a sale / unpaid / write-off row.
 * Cash-only groups are debt-repayment slices (often for older SPA sales
 * outside the period) — never invent a retail visit from them alone.
 */
export function spaRetailLineHasAnchor(
  sale: SpaSaleCandidate,
  anchoredLineKeys: Set<string>,
): boolean {
  const key = spaSaleLineKey(sale);
  return Boolean(key && anchoredLineKeys.has(key));
}

/** Line keys of non-cash ClubRevenue rows (sale / unpaid / debt_writeoff). */
export function spaAnchoredLineKeys(
  sales: SpaSaleCandidate[],
): Set<string> {
  const keys = new Set<string>();
  for (const s of sales) {
    if (isCashOp(s.operationType)) continue;
    const key = spaSaleLineKey(s);
    if (key) keys.add(key);
  }
  return keys;
}

function mergeSpaSaleGroup(rows: SpaSaleCandidate[]): SpaSaleCandidate {
  if (rows.length === 1) return { ...rows[0]! };

  const cashRows = rows.filter((r) => isCashOp(r.operationType));
  const nonCash = rows.filter((r) => !isCashOp(r.operationType));
  const writeOff = nonCash.find((r) => saleIsDebtWriteOff(r));
  const unpaid = nonCash.find(
    (r) => (r.operationType ?? '').toLowerCase() === 'unpaid',
  );
  const saleRow = nonCash.find(
    (r) => (r.operationType ?? '').toLowerCase() === 'sale',
  );
  // Prefer sale/unpaid/write-off as the persisted link target — not a cash slice.
  const anchor = writeOff ?? unpaid ?? saleRow ?? nonCash[0] ?? cashRows[0]!;

  const paidAmount = roundMajor(
    cashRows.reduce((s, r) => s + salePaidCoverage(r), 0),
  );
  const cash = roundMajor(
    cashRows.reduce((s, r) => s + positiveMajor(r.cash), 0),
  );
  const card = roundMajor(
    cashRows.reduce((s, r) => s + positiveMajor(r.card), 0),
  );
  const cashless = roundMajor(
    cashRows.reduce((s, r) => s + positiveMajor(r.cashless), 0),
  );
  const personalAccount = roundMajor(
    cashRows.reduce((s, r) => s + positiveMajor(r.personalAccount), 0),
  );

  // Document total vs mixed pays:
  // - unpaid twin still at full price next to full payment → max (don't double)
  // - residual unpaid after partial → residual + paid ≈ original
  // - write-off alone → max(write-off, paid); status stays write-off
  let saleAmount: number;
  if (unpaid) {
    const residual = Number(unpaid.saleAmount) || 0;
    if (paidAmount <= 0.009) {
      saleAmount = roundMajor(residual);
    } else if (
      Math.abs(residual - paidAmount) <= 0.02 ||
      residual <= paidAmount + 0.009
    ) {
      // Full unpaid twin of the payment, or residual already covered by pays.
      saleAmount = roundMajor(Math.max(residual, paidAmount));
    } else if (residual >= paidAmount * 2) {
      // Unpaid still looks like the full document price (not reconciled down).
      saleAmount = roundMajor(residual);
    } else {
      saleAmount = roundMajor(residual + paidAmount);
    }
  } else if (writeOff) {
    saleAmount = roundMajor(
      Math.max(Number(writeOff.saleAmount) || 0, paidAmount),
    );
  } else {
    saleAmount = roundMajor(
      Math.max(
        paidAmount,
        ...rows.map((r) => Number(r.saleAmount) || 0),
      ),
    );
  }

  let operationType = anchor.operationType;
  if (writeOff && !unpaid) {
    operationType = 'debt_writeoff';
  } else if (unpaid && paidAmount <= 0.009) {
    operationType = 'unpaid';
  } else if (paidAmount > 0.009) {
    operationType = 'payment';
  }

  const nonCashDates = nonCash.map((r) => r.occurredAt);
  const occurredAt =
    nonCashDates.length > 0
      ? new Date(Math.min(...nonCashDates.map((d) => d.getTime())))
      : new Date(
          Math.min(...rows.map((r) => r.occurredAt.getTime())),
        );

  const paidAtCandidates = rows
    .map((r) => r.paidAt)
    .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()));
  const paidAt =
    paidAtCandidates.length > 0
      ? new Date(Math.max(...paidAtCandidates.map((d) => d.getTime())))
      : anchor.paidAt ?? null;

  const pickProduct = [...nonCash, ...cashRows].find(
    (r) => r.productName?.trim() && !/^продажа\s+\d+/i.test(r.productName.trim()),
  );
  const pickPerf = [...nonCash, ...cashRows].find(
    (r) => r.performerExternalId?.trim() || r.performerName?.trim(),
  );

  return {
    ...anchor,
    occurredAt,
    paidAt,
    paidAmount,
    saleAmount,
    operationType,
    cash: cash || null,
    card: card || null,
    cashless: cashless || null,
    personalAccount: personalAccount || null,
    productName: pickProduct?.productName || anchor.productName,
    productExternalId:
      pickProduct?.productExternalId || anchor.productExternalId,
    performerExternalId:
      pickPerf?.performerExternalId || anchor.performerExternalId,
    performerName: pickPerf?.performerName || anchor.performerName,
    clientExternalId:
      nonCash.find((r) => r.clientExternalId?.trim())?.clientExternalId ||
      cashRows.find((r) => r.clientExternalId?.trim())?.clientExternalId ||
      anchor.clientExternalId,
    clientName:
      nonCash.find((r) => r.clientName?.trim())?.clientName ||
      cashRows.find((r) => r.clientName?.trim())?.clientName ||
      anchor.clientName,
    documentId:
      nonCash.find((r) => r.documentId?.trim())?.documentId ||
      anchor.documentId ||
      cashRows.find((r) => r.documentId?.trim())?.documentId ||
      null,
  };
}

function formatMajor(n: number): string {
  return `${n.toFixed(2)} BYN`;
}

/** Sum of tender splits, else paid / sale amount (document total). */
export function saleAmountMajor(sale: SpaSaleCandidate): number {
  const paid = salePaidCoverage(sale);
  if (paid > 0.009) return paid;
  return positiveMajor(sale.saleAmount);
}

/**
 * Price of this nomenclature line (sale / unpaid / write-off anchor).
 * Never tender coverage — a mixed payment of a two-line document must not
 * push the other line's money onto this card.
 */
export function saleLineTotalMajor(sale: SpaSaleCandidate): number {
  return positiveMajor(sale.saleAmount);
}

/** «Оплачено · наличные 90.00 BYN» — never the revenue externalId. */
export function paidSaleSettlementLabel(sale: SpaSaleCandidate): string {
  if (saleIsDebtWriteOff(sale)) {
    const amt = saleAmountMajor(sale);
    return amt > 0
      ? `Списание задолженности · ${formatMajor(amt)}`
      : 'Списание задолженности';
  }
  const bits: string[] = [];
  const cash = positiveMajor(sale.cash);
  const card = positiveMajor(sale.card);
  const cashless = positiveMajor(sale.cashless);
  const pa = positiveMajor(sale.personalAccount);
  if (cash) bits.push(`наличные ${formatMajor(cash)}`);
  if (card) bits.push(`карта ${formatMajor(card)}`);
  if (cashless) bits.push(`безнал ${formatMajor(cashless)}`);
  if (pa) bits.push(`лицевой счёт ${formatMajor(pa)}`);
  if (bits.length) return `Оплачено · ${bits.join(' · ')}`;
  const amt = saleAmountMajor(sale);
  if (amt > 0) return `Оплачено · ${formatMajor(amt)}`;
  if (saleIsComplimentaryPartner(sale)) {
    return 'AllSports · бесплатно';
  }
  return 'Оплачено';
}

export type SpaOnexCandidate = {
  externalId: string;
  number: string | null;
  startAt: Date;
  title: string;
  employeeExternalId: string | null;
  status: string;
  fitgoBookingRef?: string | null;
  members: Array<{
    externalId: string;
    clientName: string;
    cancelled?: boolean;
    paymentBasis?: string | null;
    paySource?: string | null;
  }>;
};

export type SpaBookingMatchInput = {
  id: string;
  startAt: Date;
  paymentType: 'QUOTA' | 'PAID' | string;
  clientExternalId?: string | null;
  clientName?: string | null;
  specialistExternalId?: string | null;
  specialistEmployeeCode?: string | null;
  specialistName: string;
  serviceExternalId?: string | null;
  serviceName: string;
  crmDocRef?: string | null;
  linkedSaleExternalId?: string | null;
};

export type SpaSaleMatchResult =
  | { kind: 'auto'; sale: SpaSaleCandidate; paymentStatus: 'PAID' | 'DEBT' }
  | { kind: 'hint'; hint: SpaLinkHint }
  | { kind: 'none' };

export type SpaDayVisitMatchResult =
  | { kind: 'auto'; onex: SpaOnexCandidate }
  | { kind: 'hint'; hint: SpaLinkHint }
  | { kind: 'none' };

export function minskDayKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Minsk',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function normalizeLabel(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Surname + given name, order-flexible. */
export function namesMatch(
  a?: string | null,
  b?: string | null,
): boolean {
  const na = normalizeLabel(a);
  const nb = normalizeLabel(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const pa = na.split(' ').filter(Boolean);
  const pb = nb.split(' ').filter(Boolean);
  if (pa.length === 0 || pb.length === 0) return false;
  const sameFirst =
    pa[0] === pb[0] ||
    (pa[0]!.length > 2 &&
      pb[0]!.length > 2 &&
      (pa[0]!.startsWith(pb[0]!) || pb[0]!.startsWith(pa[0]!)));
  if (!sameFirst) {
    // "Иванов Иван" vs "Иван Иванов"
    if (pa.length >= 2 && pb.length >= 2) {
      if (pa[0] === pb[1] && pa[1] === pb[0]) return true;
    }
    return false;
  }
  if (pa.length === 1 || pb.length === 1) return true;
  const ga = pa[1]!.replace(/\./g, '');
  const gb = pb[1]!.replace(/\./g, '');
  if (!ga || !gb) return true;
  return ga === gb || ga.startsWith(gb) || gb.startsWith(ga);
}

/** Drop duration / filler so «классический общий 50 мин» ≈ «классический 50 мин». */
export function serviceNameCore(s: string | null | undefined): string {
  // Avoid \\b — it does not treat Cyrillic as word chars in JS.
  return normalizeLabel(s)
    .replace(/(^|\s)\d+\s*(мин|min|м)(?=\s|$)/gi, ' ')
    .replace(/(^|\s)(общий|общая|общие|массаж)(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Minutes from «25 мин» / «40 min» in a service title, if present. */
export function serviceDurationMin(
  s: string | null | undefined,
): number | null {
  const m = /(\d+)\s*(?:мин|min|м)(?=\s|$)/i.exec(s ?? '');
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** One-char typos in journal titles («моссажем» vs «массажем»). */
function labelsNearlyEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) diff += 1;
      if (diff > 2) return false;
    }
    return diff <= 2;
  }
  const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let skipped = 0;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i += 1;
      j += 1;
    } else {
      skipped += 1;
      if (skipped > 1) return false;
      j += 1;
    }
  }
  return true;
}

export function serviceNamesMatch(
  a?: string | null,
  b?: string | null,
): boolean {
  const na = normalizeLabel(a);
  const nb = normalizeLabel(b);
  if (!na || !nb) return false;
  // Retail SKUs with explicit duration must agree (25 ≠ 40 мин).
  // Membership «классический общий» (no minutes) may still match timed SKUs.
  const durA = serviceDurationMin(a);
  const durB = serviceDurationMin(b);
  if (durA != null && durB != null && durA !== durB) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  if (labelsNearlyEqual(na, nb)) return true;
  const ca = serviceNameCore(a);
  const cb = serviceNameCore(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  if (ca.includes(cb) || cb.includes(ca)) return true;
  if (labelsNearlyEqual(ca, cb)) return true;
  return false;
}

/**
 * Stricter name rule for «продажа ↔ визит» links.
 * Joined cache rows («A, B») are never one service, and a timed SKU must not
 * link to an untimed title (quota «общий» pays from write-offs, not sales).
 */
export function serviceNamesMatchForSaleLink(
  a?: string | null,
  b?: string | null,
): boolean {
  if (isJoinedProductName(a) || isJoinedProductName(b)) return false;
  const durA = serviceDurationMin(a);
  const durB = serviceDurationMin(b);
  if (durA != null || durB != null) {
    if (durA == null || durB == null) return false;
    if (durA !== durB) return false;
  }
  return serviceNamesMatch(a, b);
}

export {
  isMembershipIncludedSpaTitle,
  spaTitleHasDurationMin,
} from '@fitgo/shared-types';

/**
 * Preferred duration for «В журнал» Auto:
 * minutes in the 1C title, else onex.durationMin / slot length.
 */
export function preferredServiceDurationMin(opts: {
  title?: string | null;
  durationMin?: number | null;
  startAt?: Date | null;
  endAt?: Date | null;
}): number | null {
  const fromTitle = /(\d+)\s*(?:мин|min|м)(?=\s|$)/i.exec(opts.title ?? '');
  if (fromTitle?.[1]) {
    const n = Number(fromTitle[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (opts.durationMin && opts.durationMin > 0) return opts.durationMin;
  if (opts.startAt && opts.endAt) {
    const mins = Math.round(
      (opts.endAt.getTime() - opts.startAt.getTime()) / 60_000,
    );
    if (mins > 0) return mins;
  }
  return null;
}

/**
 * Among name-matched catalog rows, pick by duration.
 * Prefer exact durationMin; else closest among services that do not exceed
 * the visit length (visit often = service + buffer); else closest overall.
 * Returns null when still ambiguous (caller should ask the user).
 */
export function pickBestServiceByDuration<T extends { durationMin: number }>(
  matches: T[],
  preferredMin: number | null,
): T | null {
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0]!;
  if (preferredMin == null || preferredMin <= 0) return null;
  const exact = matches.filter((m) => m.durationMin === preferredMin);
  if (exact.length >= 1) return exact[0]!;
  const notOver = matches.filter((m) => m.durationMin <= preferredMin);
  const pool = notOver.length > 0 ? notOver : matches;
  return pool.reduce((best, m) =>
    Math.abs(m.durationMin - preferredMin) <
    Math.abs(best.durationMin - preferredMin)
      ? m
      : best,
  );
}

export function idsMatch(
  a?: string | null,
  b?: string | null,
): boolean {
  const x = (a ?? '').trim();
  const y = (b ?? '').trim();
  if (!x || !y) return false;
  if (x === y) return true;
  const sx = x.replace(/^0+/, '');
  const sy = y.replace(/^0+/, '');
  return Boolean(sx && sy && sx === sy);
}

/** Free AllSports биоимпеданс (0 BYN) — still a completed sale for settlement/payroll. */
export function saleIsComplimentaryPartner(sale: SpaSaleCandidate): boolean {
  if (sale.operationType === 'unpaid') return false;
  const money =
    (Number(sale.saleAmount) || 0) +
    (Number(sale.paidAmount) || 0) +
    (Number(sale.cash) || 0) +
    (Number(sale.card) || 0) +
    (Number(sale.cashless) || 0) +
    (Number(sale.personalAccount) || 0);
  if (money > 0.009) return false;
  const title = `${sale.productName ?? ''}`.toLowerCase();
  return /биоимпеданс|bio.?imped/i.test(title);
}

/** Closed via Документ.СписаниеЗадолженности — no cash, still pays SPA motivation. */
export function saleIsDebtWriteOff(sale: SpaSaleCandidate): boolean {
  return (sale.operationType ?? '').toLowerCase() === 'debt_writeoff';
}

/**
 * Fully settled for SPA control / motivation.
 * Mixed payments across days count only after collapse (SUM ≥ document total).
 * Partial cash/card alone must stay DEBT until the sale is closed or written off.
 */
export function saleIsPaid(sale: SpaSaleCandidate): boolean {
  if ((sale.operationType ?? '').toLowerCase() === 'unpaid') return false;
  if (saleIsDebtWriteOff(sale)) return true;
  if (saleIsComplimentaryPartner(sale)) return true;
  const paid = salePaidCoverage(sale);
  const due = Number(sale.saleAmount) || 0;
  if (due > 0.009) return paid + 0.009 >= due;
  return paid > 0.009;
}

export function salePaymentStatus(
  sale: SpaSaleCandidate,
): 'PAID' | 'DEBT' {
  return saleIsPaid(sale) ? 'PAID' : 'DEBT';
}

function specialistCodes(booking: SpaBookingMatchInput): string[] {
  const out: string[] = [];
  for (const raw of [
    booking.specialistExternalId,
    booking.specialistEmployeeCode,
  ]) {
    const t = raw?.trim();
    if (t) out.push(t);
  }
  return out;
}

export function performerMatchesBooking(
  sale: SpaSaleCandidate,
  booking: SpaBookingMatchInput,
): boolean {
  const codes = specialistCodes(booking);
  if (sale.performerExternalId?.trim()) {
    if (codes.some((c) => idsMatch(c, sale.performerExternalId))) return true;
  }
  if (sale.performerName?.trim() && booking.specialistName) {
    if (namesMatch(sale.performerName, booking.specialistName)) return true;
  }
  return false;
}

export function performerPresent(sale: SpaSaleCandidate): boolean {
  return Boolean(
    sale.performerExternalId?.trim() || sale.performerName?.trim(),
  );
}

export function clientMatchesSale(
  sale: SpaSaleCandidate,
  booking: SpaBookingMatchInput,
): boolean {
  if (
    booking.clientExternalId?.trim() &&
    sale.clientExternalId?.trim() &&
    idsMatch(booking.clientExternalId, sale.clientExternalId)
  ) {
    return true;
  }
  if (booking.clientName && sale.clientName) {
    return namesMatch(booking.clientName, sale.clientName);
  }
  return false;
}

export function nomenclatureMatches(
  sale: SpaSaleCandidate,
  booking: SpaBookingMatchInput,
): boolean {
  if (
    booking.serviceExternalId?.trim() &&
    sale.productExternalId?.trim() &&
    idsMatch(booking.serviceExternalId, sale.productExternalId)
  ) {
    return true;
  }
  return serviceNamesMatchForSaleLink(sale.productName, booking.serviceName);
}

/** Both sides have a 1C client card and they are different people. */
export function saleClientIdConflict(
  sale: SpaSaleCandidate,
  booking: SpaBookingMatchInput,
): boolean {
  const a = booking.clientExternalId?.trim();
  const b = sale.clientExternalId?.trim();
  if (!a || !b) return false;
  return !idsMatch(a, b);
}

/**
 * Sale product is a SPA catalog / spa-like retail title for visit linking.
 * Multi-visit pack purchases («Блок массажа 10») are not visit payment docs —
 * they must not appear in «Привязать» hints (write-offs pay motivation).
 * Bars / café / PT one-offs must not appear either.
 */
export function saleIsSpaLinkCandidate(
  sale: SpaSaleCandidate,
  serviceIdByProduct?: Map<string, string>,
): boolean {
  if (isMultiVisitPackSale(sale.productName)) return false;
  if (isServiceBlockPackageName(sale.productName)) return false;
  // Joined cache row («A, B») is not one nomenclature — re-sync from 1C first.
  if (isJoinedProductName(sale.productName)) return false;
  if (isSpaLikeSessionTitle(sale.productName)) return true;
  if (!serviceIdByProduct) return false;
  if (sale.productExternalId?.trim()) {
    if (serviceIdByProduct.has(sale.productExternalId.trim())) return true;
  }
  const key = normalizeLabel(sale.productName);
  if (key && serviceIdByProduct.has(`name:${key}`)) return true;
  return false;
}

/** Massage/PT blocks may be linked to several visit cards; retail SPA sales may not. */
export function saleTakenBlocksSpaLink(
  sale: SpaSaleCandidate,
  takenSaleIds?: Set<string>,
): boolean {
  if (!takenSaleIds?.has(sale.externalId)) return false;
  if (isServiceBlockPackageName(sale.productName)) return false;
  return true;
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

/** Inclusive sale window around visit (calendar days via UTC date math is fine for DB range). */
export function saleSearchWindow(visitAt: Date): { from: Date; to: Date } {
  return {
    from: addDays(visitAt, -SPA_SALE_LOOKBACK_DAYS),
    to: addDays(visitAt, SPA_SALE_LOOKAHEAD_DAYS),
  };
}

export function debtSearchWindow(visitAt: Date): { from: Date; to: Date } {
  return {
    from: addDays(visitAt, -SPA_DEBT_LOOKBACK_DAYS),
    to: addDays(visitAt, SPA_SALE_LOOKAHEAD_DAYS),
  };
}

function formatSaleLabel(sale: SpaSaleCandidate): string {
  const name = (sale.productName ?? 'Продажа').trim();
  const amt = saleLineTotalMajor(sale);
  const money = amt > 0 ? ` · ${amt.toFixed(2)} BYN` : '';
  return `${name}${money}`;
}

export function toSaleCandidate(
  sale: SpaSaleCandidate,
  serviceId?: string,
): SpaLinkCandidate {
  return {
    kind: 'sale',
    externalId: sale.externalId,
    label: formatSaleLabel(sale),
    amountMajor: saleLineTotalMajor(sale),
    occurredAt: sale.occurredAt.toISOString(),
    paymentStatus: salePaymentStatus(sale),
    productName: sale.productName ?? undefined,
    performerName: sale.performerName ?? undefined,
    serviceId,
  };
}

/** Turn an auto single-sale match into a pick-list hint (manual unlink / relink). */
export function autoSaleAsHint(
  sale: SpaSaleCandidate,
  serviceIdByProduct?: Map<string, string>,
  message = 'Выберите документ продажи',
): SpaLinkHint {
  let serviceId: string | undefined;
  if (serviceIdByProduct) {
    if (sale.productExternalId?.trim()) {
      serviceId = serviceIdByProduct.get(sale.productExternalId.trim());
    }
    if (!serviceId) {
      const key = normalizeLabel(sale.productName);
      if (key) serviceId = serviceIdByProduct.get(`name:${key}`);
    }
  }
  return {
    kind: 'SALE_MULTIPLE',
    message,
    candidates: [toSaleCandidate(sale, serviceId)],
  };
}

/**
 * Rank sales for a FitGO SPA booking.
 * Auto only when exactly one candidate has client + performer + same service.
 */
export function matchSpaSale(input: {
  booking: SpaBookingMatchInput;
  sales: SpaSaleCandidate[];
  /** Sale externalIds already linked to another booking. */
  takenSaleIds?: Set<string>;
  /** Map productExternalId / normalized product name → SpaService.id */
  serviceIdByProduct?: Map<string, string>;
  /**
   * When true, ignore existing linkedSaleExternalId short-circuit and never
   * return auto (convert to hint) — used after admin unlink / for RELINK list.
   */
  blockAutoLink?: boolean;
}): SpaSaleMatchResult {
  const { booking, takenSaleIds, serviceIdByProduct, blockAutoLink } = input;
  // One candidate per nomenclature line: sale + its later payments collapse,
  // two SKUs of the same document stay apart.
  const sales = collapseSpaSalesByLine(input.sales);
  if (!blockAutoLink && booking.linkedSaleExternalId?.trim()) {
    const linkedId = booking.linkedSaleExternalId.trim();
    const linkedBasis = preferredSaleBasisId({
      externalId: linkedId,
      documentId: null,
    });
    const sameBasis = (s: SpaSaleCandidate) => {
      const basis = preferredSaleBasisId({
        externalId: s.externalId,
        documentId: s.documentId ?? null,
      });
      return (
        basis === linkedBasis ||
        s.documentId?.trim().toLowerCase() === linkedBasis ||
        s.externalId.startsWith(`${linkedBasis}:`)
      );
    };
    const findLinked = (list: SpaSaleCandidate[]) =>
      list.find((s) => s.externalId === linkedId) ??
      // Several lines of the linked document → keep the booking's own service.
      list.find((s) => sameBasis(s) && nomenclatureMatches(s, booking)) ??
      list.find(sameBasis);
    const linked = findLinked(sales) ?? findLinked(input.sales);
    if (linked) {
      const collapsed =
        sales.find((s) => s.externalId === linked.externalId) ?? linked;
      // Stale pointer (service / client / performer changed since the link) —
      // fall through to normal matching instead of showing a wrong document.
      const stillValid =
        clientMatchesSale(collapsed, booking) &&
        performerMatchesBooking(collapsed, booking) &&
        nomenclatureMatches(collapsed, booking);
      if (stillValid) {
        return {
          kind: 'auto',
          sale: collapsed,
          paymentStatus: salePaymentStatus(collapsed),
        };
      }
    }
  }

  const visitDay = booking.startAt;
  const win = saleSearchWindow(visitDay);
  const debtWin = debtSearchWindow(visitDay);

  const saleAnchorTime = (s: SpaSaleCandidate) => {
    // Prefer sale/visit day over cash settlement paidAt for ranking.
    return s.occurredAt.getTime();
  };

  const inWindow = (s: SpaSaleCandidate) => {
    const anchors = [s.occurredAt.getTime()];
    if (s.paidAt) anchors.push(s.paidAt.getTime());
    const hit = (t: number, from: Date, to: Date) =>
      t >= from.getTime() && t <= to.getTime();
    if (anchors.some((t) => hit(t, win.from, win.to))) return true;
    if (
      !saleIsPaid(s) &&
      anchors.some((t) => hit(t, debtWin.from, debtWin.to))
    ) {
      return true;
    }
    return false;
  };

  const forClient: SpaSaleCandidate[] = [];
  /** Same FIO, different 1C client card — reception likely used a duplicate. */
  const otherClientCard: SpaSaleCandidate[] = [];
  /** Cache row with several SKUs in one name — needs a 1C re-sync, not a link. */
  const joinedProduct: SpaSaleCandidate[] = [];
  for (const s of sales) {
    if (saleTakenBlocksSpaLink(s, takenSaleIds)) continue;
    if (!inWindow(s)) continue;
    if (!clientMatchesSale(s, booking)) continue;
    if (saleClientIdConflict(s, booking)) {
      otherClientCard.push(s);
      continue;
    }
    if (isJoinedProductName(s.productName)) {
      joinedProduct.push(s);
      continue;
    }
    if (!saleIsSpaLinkCandidate(s, serviceIdByProduct)) continue;
    // Multi-visit pack purchases («Блок массажа 10») are not visit payment docs —
    // motivation comes from 1C write-offs. Do not offer them as «Привязать».
    if (isMultiVisitPackSale(s.productName)) continue;
    forClient.push(s);
  }

  const resolveServiceId = (s: SpaSaleCandidate): string | undefined => {
    if (!serviceIdByProduct) return undefined;
    if (s.productExternalId?.trim()) {
      const byId = serviceIdByProduct.get(s.productExternalId.trim());
      if (byId) return byId;
    }
    const key = normalizeLabel(s.productName);
    if (key) return serviceIdByProduct.get(`name:${key}`);
    return undefined;
  };

  const dayDist = (s: SpaSaleCandidate) =>
    Math.abs(saleAnchorTime(s) - visitDay.getTime());

  /** Prefer same calendar day / closest sale; drop far stale duplicates from the pick list. */
  const rankByVisit = (list: SpaSaleCandidate[]) =>
    [...list].sort((a, b) => dayDist(a) - dayDist(b));

  if (forClient.length === 0) {
    if (otherClientCard.length > 0) {
      const pick = rankByVisit(otherClientCard).slice(0, 5);
      return {
        kind: 'hint',
        hint: {
          kind: 'SALE_CLIENT_MISMATCH',
          message: 'Разные карточки клиента в 1С',
          candidates: pick.map((s) => toSaleCandidate(s, resolveServiceId(s))),
        },
      };
    }
    if (joinedProduct.length > 0) {
      const pick = rankByVisit(joinedProduct).slice(0, 5);
      return {
        kind: 'hint',
        hint: {
          kind: 'SALE_JOINED_PRODUCT',
          message:
            'В документе несколько номенклатур — обновите продажи из 1С',
          candidates: pick.map((s) => toSaleCandidate(s, resolveServiceId(s))),
        },
      };
    }
    return { kind: 'none' };
  }

  const exact = rankByVisit(
    forClient.filter(
      (s) =>
        performerMatchesBooking(s, booking) && nomenclatureMatches(s, booking),
    ),
  );
  if (exact.length === 1) {
    const only = exact[0]!;
    if (blockAutoLink) {
      return {
        kind: 'hint',
        hint: autoSaleAsHint(
          only,
          serviceIdByProduct,
          'Документ отвязан — выберите продажу',
        ),
      };
    }
    return {
      kind: 'auto',
      sale: only,
      paymentStatus: salePaymentStatus(only),
    };
  }
  if (exact.length > 1) {
    // Two документа / строки fit equally well — the admin must pick the line.
    // Same-day guessing linked the wrong sale too often.
    const pick = exact.slice(0, 8);
    return {
      kind: 'hint',
      hint: {
        kind: 'SALE_MULTIPLE',
        message: `Несколько продаж (${pick.length}) — выберите строку`,
        candidates: pick.map((s) => toSaleCandidate(s, resolveServiceId(s))),
      },
    };
  }

  // Same client + performer, different nomenclature
  const otherNom = forClient.filter(
    (s) =>
      performerMatchesBooking(s, booking) && !nomenclatureMatches(s, booking),
  );
  if (otherNom.length >= 1) {
    const top = otherNom[0]!;
    return {
      kind: 'hint',
      hint: {
        kind: 'SALE_OTHER_NOMENCLATURE',
        message: `Продажа «${(top.productName ?? 'услуга').trim()}»${
          saleLineTotalMajor(top) > 0
            ? ` · ${saleLineTotalMajor(top).toFixed(2)} BYN`
            : ''
        }`,
        candidates: otherNom.map((s) => toSaleCandidate(s, resolveServiceId(s))),
      },
    };
  }

  // Same client + same service, no / wrong performer
  const sameService = forClient.filter((s) => nomenclatureMatches(s, booking));
  if (sameService.length >= 1) {
    const noPerf = sameService.filter((s) => !performerPresent(s));
    if (noPerf.length >= 1) {
      return {
        kind: 'hint',
        hint: {
          kind: 'SALE_NO_PERFORMER',
          message:
            'В продаже не указан исполнитель — в ЗП не попадёт',
          candidates: noPerf.map((s) => toSaleCandidate(s, resolveServiceId(s))),
        },
      };
    }
    const otherPerf = sameService.filter(
      (s) => performerPresent(s) && !performerMatchesBooking(s, booking),
    );
    if (otherPerf.length >= 1) {
      const name = otherPerf[0]!.performerName?.trim() || 'другой';
      return {
        kind: 'hint',
        hint: {
          kind: 'SALE_OTHER_PERFORMER',
          message: `Исполнитель в продаже — ${name}`,
          candidates: otherPerf.map((s) =>
            toSaleCandidate(s, resolveServiceId(s)),
          ),
        },
      };
    }
  }

  // Client has sales but nothing actionable for auto — soft multiple list
  if (forClient.length > 1) {
    return {
      kind: 'hint',
      hint: {
        kind: 'SALE_MULTIPLE',
        message: `Продажи клиента (${forClient.length}) — выберите документ`,
        candidates: forClient
          .slice(0, 5)
          .map((s) => toSaleCandidate(s, resolveServiceId(s))),
      },
    };
  }

  return { kind: 'none' };
}

export function onexClientExternalId(
  onex: SpaOnexCandidate,
): string | undefined {
  const m =
    onex.members.find((x) => !x.cancelled) ?? onex.members[0];
  return m?.externalId?.trim() || undefined;
}

export function onexMatchesSpecialist(
  onex: SpaOnexCandidate,
  booking: SpaBookingMatchInput,
): boolean {
  const codes = specialistCodes(booking);
  if (onex.employeeExternalId?.trim()) {
    if (codes.some((c) => idsMatch(c, onex.employeeExternalId))) return true;
  }
  // no employee on either side → allow day match only if booking has no code
  if (!onex.employeeExternalId?.trim() && codes.length === 0) return true;
  return false;
}

export function onexMatchesClient(
  onex: SpaOnexCandidate,
  booking: SpaBookingMatchInput,
): boolean {
  const memberExt = onexClientExternalId(onex);
  if (booking.clientExternalId?.trim() && memberExt) {
    return idsMatch(booking.clientExternalId, memberExt);
  }
  const member =
    onex.members.find((x) => !x.cancelled) ?? onex.members[0];
  if (booking.clientName && member?.clientName) {
    return namesMatch(booking.clientName, member.clientName);
  }
  return false;
}

/**
 * Onex title ↔ FitGO service name.
 * Tiebreak only: 1C titles drift from the catalog, so a mismatch never drops a
 * lone candidate — it only separates two procedures of one client in a day.
 */
export function onexMatchesService(
  onex: SpaOnexCandidate,
  booking: SpaBookingMatchInput,
): boolean {
  const title = onex.title?.trim();
  const name = booking.serviceName?.trim();
  if (!title || !name) return false;
  return (
    serviceNamesMatchForSaleLink(title, name) || serviceNamesMatch(title, name)
  );
}

/**
 * Same calendar day (Europe/Minsk), same specialist + client.
 * Auto when exactly one living onex session remains.
 */
export function matchSpaVisitByDay(input: {
  booking: SpaBookingMatchInput;
  onexSessions: SpaOnexCandidate[];
  /** Onex externalIds already matched to another FitGO booking. */
  takenOnexIds?: Set<string>;
}): SpaDayVisitMatchResult {
  const { booking, onexSessions, takenOnexIds } = input;
  const day = minskDayKey(booking.startAt);
  const candidates = onexSessions.filter((o) => {
    if (takenOnexIds?.has(o.externalId)) return false;
    if ((o.status || '').toUpperCase() === 'CANCELLED') return false;
    if (minskDayKey(o.startAt) !== day) return false;
    if (!onexMatchesSpecialist(o, booking)) return false;
    if (!onexMatchesClient(o, booking)) return false;
    return true;
  });

  if (candidates.length === 0) return { kind: 'none' };
  if (candidates.length === 1) {
    return { kind: 'auto', onex: candidates[0]! };
  }
  // Two procedures of the same client in one day — the service title decides.
  const byService = candidates.filter((o) => onexMatchesService(o, booking));
  if (byService.length === 1) {
    return { kind: 'auto', onex: byService[0]! };
  }
  return {
    kind: 'hint',
    hint: {
      kind: 'VISIT_MULTIPLE',
      message: `Несколько списаний в 1С за день (${candidates.length}) — выберите`,
      candidates: candidates.map((o) => {
        const member =
          o.members.find((x) => !x.cancelled) ?? o.members[0];
        return {
          kind: 'visit' as const,
          externalId: o.externalId,
          label: `${o.title} · ${o.startAt.toISOString().slice(11, 16)}`,
          title: o.title,
          occurredAt: o.startAt.toISOString(),
          productName: member?.paymentBasis ?? undefined,
        };
      }),
    },
  };
}

/**
 * Build day-merge pairs for list dedup.
 * One booking ↔ one onex per day|specialist|client bucket.
 * Any payment type (quota, paid, partner) — journal slot time often differs from 1C.
 */
export function buildSpaDayMergePairs(input: {
  bookings: SpaBookingMatchInput[];
  onexSessions: SpaOnexCandidate[];
  alreadyMatchedBookingIds: Set<string>;
  alreadyMatchedOnexIds: Set<string>;
}): Array<{ bookingId: string; onexExternalId: string }> {
  const pairs: Array<{ bookingId: string; onexExternalId: string }> = [];
  const takenOnex = new Set(input.alreadyMatchedOnexIds);
  const takenBooking = new Set(input.alreadyMatchedBookingIds);

  const openBookings = input.bookings.filter((b) => !takenBooking.has(b.id));

  for (const b of openBookings) {
    const result = matchSpaVisitByDay({
      booking: b,
      onexSessions: input.onexSessions,
      takenOnexIds: takenOnex,
    });
    if (result.kind !== 'auto') continue;
    // Ensure this onex is not the only candidate for another unmatched booking
    // that would also auto-match the same session — skip if another booking claims it.
    let contested = false;
    for (const other of openBookings) {
      if (other.id === b.id) continue;
      if (takenBooking.has(other.id)) continue;
      const otherHit = matchSpaVisitByDay({
        booking: other,
        onexSessions: [result.onex],
        takenOnexIds: new Set(),
      });
      if (otherHit.kind === 'auto') {
        // Not contested when only this booking's service matches the visit —
        // two services of one client in a day are different cards.
        if (
          onexMatchesService(result.onex, b) &&
          !onexMatchesService(result.onex, other)
        ) {
          continue;
        }
        contested = true;
        break;
      }
    }
    if (contested) continue;
    pairs.push({ bookingId: b.id, onexExternalId: result.onex.externalId });
    takenOnex.add(result.onex.externalId);
    takenBooking.add(b.id);
  }
  return pairs;
}

export function awaitingPaymentLabel(sale: SpaSaleCandidate): string {
  const due = Number(sale.saleAmount) || 0;
  const paid = salePaidCoverage(sale);
  const rest = due > 0.009 ? roundMajor(Math.max(0, due - paid)) : due;
  const day = minskDayKey(sale.occurredAt);
  const [y, m, d] = day.split('-');
  const dateRu = d && m && y ? `${d}.${m}.${y}` : day;
  if (paid > 0.009 && rest > 0.009) {
    return `Частично оплачено · остаток ${rest.toFixed(2)} BYN от ${dateRu}`;
  }
  if (rest > 0.009 || due > 0.009) {
    return `Ждёт оплаты · долг ${(rest || due).toFixed(2)} BYN от ${dateRu}`;
  }
  return `Ждёт оплаты · долг от ${dateRu}`;
}
