/**
 * Pure SPA ↔ 1C document matching (sales + quota write-offs).
 * No Prisma / Nest — unit-testable.
 */

import type { SpaLinkCandidate, SpaLinkHint } from '@fitgo/shared-types';

/** Days before visit to look for a paid/debt sale. */
export const SPA_SALE_LOOKBACK_DAYS = 21;
/** Days after visit to look for a sale (paid later). */
export const SPA_SALE_LOOKAHEAD_DAYS = 14;
/** Open debt of same client+performer+service may be older. */
export const SPA_DEBT_LOOKBACK_DAYS = 60;

export type SpaSaleCandidate = {
  externalId: string;
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

function positiveMajor(n: number | null | undefined): number {
  const v = Number(n) || 0;
  return v > 0.009 ? v : 0;
}

function formatMajor(n: number): string {
  return `${n.toFixed(2)} BYN`;
}

/** Sum of tender splits, else paid / sale amount. */
export function saleAmountMajor(sale: SpaSaleCandidate): number {
  const split =
    positiveMajor(sale.cash) +
    positiveMajor(sale.card) +
    positiveMajor(sale.cashless) +
    positiveMajor(sale.personalAccount);
  if (split > 0.009) return Math.round(split * 100) / 100;
  return positiveMajor(sale.paidAmount) || positiveMajor(sale.saleAmount);
}

/** «Оплачено · наличные 90.00 BYN» — never the revenue externalId. */
export function paidSaleSettlementLabel(sale: SpaSaleCandidate): string {
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

export function serviceNamesMatch(
  a?: string | null,
  b?: string | null,
): boolean {
  const na = normalizeLabel(a);
  const nb = normalizeLabel(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Strip common duration suffixes for near-match (still not auto without exact).
  return false;
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

export function saleIsPaid(sale: SpaSaleCandidate): boolean {
  if (sale.operationType === 'unpaid') return false;
  if (saleIsComplimentaryPartner(sale)) return true;
  if (sale.paidAmount > 0.009) return true;
  if (sale.operationType === 'payment' && sale.saleAmount > 0) return true;
  return false;
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
  return serviceNamesMatch(sale.productName, booking.serviceName);
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
  const amt = Number(sale.saleAmount) || Number(sale.paidAmount) || 0;
  const money = amt > 0 ? ` · ${amt.toFixed(2)} BYN` : '';
  return `${name}${money}`;
}

function toSaleCandidate(
  sale: SpaSaleCandidate,
  serviceId?: string,
): SpaLinkCandidate {
  return {
    kind: 'sale',
    externalId: sale.externalId,
    label: formatSaleLabel(sale),
    amountMajor: Number(sale.saleAmount) || Number(sale.paidAmount) || 0,
    occurredAt: sale.occurredAt.toISOString(),
    paymentStatus: salePaymentStatus(sale),
    productName: sale.productName ?? undefined,
    performerName: sale.performerName ?? undefined,
    serviceId,
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
}): SpaSaleMatchResult {
  const { booking, sales, takenSaleIds, serviceIdByProduct } = input;
  if (booking.linkedSaleExternalId?.trim()) {
    const linked = sales.find(
      (s) => s.externalId === booking.linkedSaleExternalId,
    );
    if (linked) {
      return {
        kind: 'auto',
        sale: linked,
        paymentStatus: salePaymentStatus(linked),
      };
    }
  }

  const visitDay = booking.startAt;
  const win = saleSearchWindow(visitDay);
  const debtWin = debtSearchWindow(visitDay);

  const inWindow = (s: SpaSaleCandidate) => {
    const t = s.occurredAt.getTime();
    if (t >= win.from.getTime() && t <= win.to.getTime()) return true;
    if (
      !saleIsPaid(s) &&
      t >= debtWin.from.getTime() &&
      t <= debtWin.to.getTime()
    ) {
      return true;
    }
    return false;
  };

  const forClient = sales.filter(
    (s) =>
      (!takenSaleIds || !takenSaleIds.has(s.externalId)) &&
      inWindow(s) &&
      clientMatchesSale(s, booking),
  );
  if (forClient.length === 0) return { kind: 'none' };

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

  const exact = forClient.filter(
    (s) => performerMatchesBooking(s, booking) && nomenclatureMatches(s, booking),
  );
  if (exact.length === 1) {
    return {
      kind: 'auto',
      sale: exact[0]!,
      paymentStatus: salePaymentStatus(exact[0]!),
    };
  }
  if (exact.length > 1) {
    return {
      kind: 'hint',
      hint: {
        kind: 'SALE_MULTIPLE',
        message: `Несколько продаж клиента (${exact.length}) — выберите документ`,
        candidates: exact.map((s) => toSaleCandidate(s, resolveServiceId(s))),
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
          (Number(top.saleAmount) || 0) > 0
            ? ` · ${(Number(top.saleAmount) || 0).toFixed(2)} BYN`
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

  const quotaBookings = input.bookings.filter(
    (b) =>
      !takenBooking.has(b.id) &&
      String(b.paymentType).toUpperCase() === 'QUOTA',
  );

  for (const b of quotaBookings) {
    const result = matchSpaVisitByDay({
      booking: b,
      onexSessions: input.onexSessions,
      takenOnexIds: takenOnex,
    });
    if (result.kind !== 'auto') continue;
    // Ensure this onex is not the only candidate for another unmatched booking
    // that would also auto-match the same session — skip if another booking claims it.
    let contested = false;
    for (const other of quotaBookings) {
      if (other.id === b.id) continue;
      if (takenBooking.has(other.id)) continue;
      const otherHit = matchSpaVisitByDay({
        booking: other,
        onexSessions: [result.onex],
        takenOnexIds: new Set(),
      });
      if (otherHit.kind === 'auto') {
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
  const amt = Number(sale.saleAmount) || 0;
  const day = minskDayKey(sale.occurredAt);
  const [y, m, d] = day.split('-');
  const dateRu = d && m && y ? `${d}.${m}.${y}` : day;
  if (amt > 0) {
    return `Ждёт оплаты · долг ${amt.toFixed(2)} BYN от ${dateRu}`;
  }
  return `Ждёт оплаты · долг от ${dateRu}`;
}
