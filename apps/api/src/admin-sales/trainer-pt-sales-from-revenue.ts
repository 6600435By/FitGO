import {
  extractPackDateIsoFromBasis,
  extractQuotedPackNameFromBasis,
  isMultiVisitPackSale,
  isSpaLikeSessionTitle,
  parseListedUnitPriceMajor,
  parsePackVisitCountFromTitle,
} from '@fitgo/shared-types';
import type { PrismaService } from '../prisma/prisma.service';
import { preferredSaleBasisId } from './payment-basis-products';
import {
  isLikelyTrainingProductName,
  isReformerPersonalTitle,
} from './admin-sales-segments';
import { isCollectibleClientDebt } from './club-revenue-debt';

/** Row shape shared by payroll and booking-control PT sales. */
export type TrainerPtSaleRow = {
  externalId?: string;
  clientName?: string;
  serviceName?: string;
  occurredAt: string;
  amount: number;
  quantity?: number;
  employeeCode?: string;
  employeeName?: string;
  docRef?: string;
  paymentStatus?: string;
};

/**
 * Multi-visit pack / debt sale lines used only to recover unit = amount/N
 * when class members lack packageAmount (legacy sync).
 */
export type PackSaleForUnitPrice = {
  clientName?: string;
  serviceName?: string;
  occurredAt: string;
  /** Major currency (BYN). Prefer paid, else sale/document amount. */
  amount: number;
  quantity?: number;
  /** ClubRevenueEntry.externalId for «Продажа» deep-link. */
  externalId?: string;
};

/** Pack unit recovery result (price + optional sale pointer). */
export type PackUnitPriceMatch = {
  unitPriceMinor: number;
  externalId?: string;
  occurredAt?: string;
};

/** Title clearly means solarium (1C often tags the doc as PT / personal). */
export function isSolariumSessionTitle(
  name: string | null | undefined,
): boolean {
  const s = (name ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return false;
  return /соляр|solarium|tanning/.test(s);
}

/**
 * Open gym-floor visits logged in 1C as GROUP «Тренажерный зал».
 * Kept for analytics / attendance; no responsible trainer → skip control & confirm.
 */
export function isGymFloorSessionTitle(
  name: string | null | undefined,
): boolean {
  const s = (name ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return false;
  if (s.includes('тренажер')) return true;
  if (/\bзал\b/.test(s) && /тренаж/.test(s)) return true;
  return false;
}

/**
 * Солярий / тренажёрный зал / SPA-массаж — не в Контроле записей (ПТ)
 * и не в merge рейтинга тренеров.
 * 1С часто помечает массаж как kind=PT; для продаж исключаем здесь,
 * для занятий — переклассификация PT→SPA в booking-control / sync.
 * Kind SOLARIUM в Onex не трогаем отдельно.
 */
export function isExcludedFromPtBookingControl(
  name: string | null | undefined,
): boolean {
  const s = (name ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return false;
  if (isSolariumSessionTitle(s)) return true;
  if (isGymFloorSessionTitle(s)) return true;
  // Massage / bioimpedance / SPA titles tagged as training in 1C sales.
  if (isSpaLikeSessionTitle(s)) return true;
  return false;
}

/** Trainer surfaces: never show SPA / solarium (wrong 1C performer). */
export function isHiddenFromTrainerBookingControl(item: {
  kind?: string | null;
  title?: string | null;
}): boolean {
  const kind = (item.kind ?? '').toUpperCase();
  if (kind === 'SPA' || kind === 'SOLARIUM') return true;
  if (isSolariumSessionTitle(item.title)) return true;
  return false;
}

/**
 * Cash-scope Analytics may glue «Занятие…, Вода…» into one productName with
 * the full card total. For trainer PT use only the listed PT price.
 */
export function ptAmountFromPossiblyGluedProduct(
  product: string,
  rawAmount: number,
): number {
  if (!product.includes(',')) return rawAmount;
  const parts = product
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    if (
      !isLikelyTrainingProductName(part) &&
      !/тренер|персональн|\bпт\b|занятие с/i.test(part)
    ) {
      continue;
    }
    const listed = parseListedUnitPriceMajor(part);
    if (listed != null && listed > 0) return listed;
  }
  const listedWhole = parseListedUnitPriceMajor(product);
  if (
    listedWhole != null &&
    listedWhole > 0 &&
    listedWhole + 0.01 < rawAmount
  ) {
    return listedWhole;
  }
  return rawAmount;
}

export function trainerPtSaleDocKey(r: TrainerPtSaleRow): string {
  const doc = (r.docRef || '').trim();
  if (doc) return doc.toLowerCase();
  const ext = (r.externalId || '').trim();
  if (!ext) return '';
  return (ext.split(':')[0] || ext).toLowerCase();
}

/** ClubRevenue unpaid row fields used to force DEBT on TrainerPtSale. */
export type UnpaidDebtRevenueEntry = {
  documentId?: string | null;
  externalId: string;
  productName?: string | null;
  saleType?: string | null;
  clientName?: string | null;
  performerExternalId?: string | null;
  performerName?: string | null;
  employeeExternalId?: string | null;
  employeeName?: string | null;
  operationType?: string | null;
  paidAmount?: number | null;
  personalAccount?: number | null;
  cash?: number | null;
  card?: number | null;
  cashless?: number | null;
  saleAmount?: number | null;
  occurredAt: Date;
  paidAt?: Date | null;
};

/** True when ClubRevenue row has real money (cash/card/cashless/ЛС/paidAmount). */
export function clubRevenueHasPaidMoney(e: {
  paidAmount?: number | null;
  personalAccount?: number | null;
  cash?: number | null;
  card?: number | null;
  cashless?: number | null;
}): boolean {
  return (
    (Number(e.paidAmount) || 0) > 0.01 ||
    (Number(e.personalAccount) || 0) > 0.01 ||
    (Number(e.cash) || 0) + (Number(e.card) || 0) + (Number(e.cashless) || 0) >
      0.01
  );
}

/**
 * Keys for open unpaid sales in ClubRevenue (scope=debt).
 * Doc keys: any unpaid collectible (PT / SPA / shop / membership) — match by
 * sale document wins for every staff track.
 * Day|client|performer keys: PT + SPA-like (исполнитель), so trainers and
 * specialists both get DEBT corrected when Integration wrongly marked PAID.
 */
export function collectUnpaidPtDebtKeys(
  entries: UnpaidDebtRevenueEntry[],
): Set<string> {
  const keys = new Set<string>();
  for (const e of entries) {
    if ((e.operationType ?? '').toLowerCase() !== 'unpaid') continue;
    if (!isCollectibleClientDebt(e)) continue;
    if (clubRevenueHasPaidMoney(e)) continue;
    const product = e.productName ?? '';
    const saleType = (e.saleType ?? '').toLowerCase();
    const isPerformerService =
      saleType === 'training' ||
      saleType === 'service' ||
      isLikelyTrainingProductName(product) ||
      isSpaLikeSessionTitle(product) ||
      /тренер|персональн|\bпт\b|занятие с|массаж|spa|биоимпедан/i.test(
        product,
      ) ||
      /^продажа\s+\d+/i.test(product.trim());
    const doc =
      e.documentId?.trim() ||
      e.externalId.split(':')[0] ||
      e.externalId;
    // Always index by document — covers admin-sold membership/shop debt too
    // when the same doc appears on a TrainerPtSale / specialist line.
    if (doc) keys.add(`doc:${doc.toLowerCase()}`);
    if (!isPerformerService) continue;
    const when = e.paidAt ?? e.occurredAt;
    const day = when.toISOString().slice(0, 10);
    const client = (e.clientName ?? '').trim().toLowerCase();
    if (!day || !client) continue;
    const perfCode = e.performerExternalId?.trim();
    const perfName = e.performerName?.trim();
    const empCode = e.employeeExternalId?.trim();
    const empName = e.employeeName?.trim();
    const performerCode = perfCode || (!perfName ? empCode : undefined);
    const performerName = perfName || (!perfCode ? empName : undefined);
    if (performerCode) {
      keys.add(`${day}|${client}|c:${performerCode.replace(/^0+/, '')}`);
    }
    if (performerName) {
      keys.add(`${day}|${client}|n:${performerName.toLowerCase()}`);
    }
  }
  return keys;
}

/** Force paymentStatus=DEBT when ClubRevenue still has an open unpaid PT sale. */
export function applyUnpaidDebtStatusToPtSales<
  T extends {
    paymentStatus?: string;
    occurredAt: string;
    clientName?: string;
    employeeCode?: string;
    employeeName?: string;
    docRef?: string;
    externalId?: string;
  },
>(sales: T[], unpaidKeys: Set<string>): T[] {
  if (unpaidKeys.size === 0) return sales;
  return sales.map((s) => {
    if ((s.paymentStatus ?? '').toUpperCase() === 'DEBT') return s;
    const day = (s.occurredAt || '').slice(0, 10);
    const client = (s.clientName ?? '').trim().toLowerCase();
    const code = (s.employeeCode ?? '').trim().replace(/^0+/, '');
    const name = (s.employeeName ?? '').trim().toLowerCase();
    const doc = (s.docRef || '').trim().toLowerCase();
    const extRoot = (s.externalId || '').split(/[:#]/)[0]?.trim().toLowerCase();
    const docRoot = doc.includes('#') ? doc.split('#')[0]! : doc;
    const hit =
      (code && unpaidKeys.has(`${day}|${client}|c:${code}`)) ||
      (name && unpaidKeys.has(`${day}|${client}|n:${name}`)) ||
      (doc && unpaidKeys.has(`doc:${doc}`)) ||
      (docRoot && unpaidKeys.has(`doc:${docRoot}`)) ||
      (extRoot && unpaidKeys.has(`doc:${extRoot}`));
    if (!hit) return s;
    return { ...s, paymentStatus: 'DEBT' };
  });
}

/**
 * Downgrade wrongly-PAID TrainerPtSale rows using ClubRevenue unpaid snapshot.
 * Defense for Integration until republish + already-synced bad PAID rows.
 */
export async function overlayPtSaleDebtFromRevenue<T extends TrainerPtSaleRow>(
  prisma: PrismaService,
  clubId: string,
  fromD: Date,
  toD: Date,
  sales: T[],
): Promise<T[]> {
  if (sales.length === 0) return sales;
  const entries = await prisma.clubRevenueEntry.findMany({
    where: {
      clubId,
      isActive: true,
      operationType: 'unpaid',
      OR: [
        { occurredAt: { gte: fromD, lte: toD } },
        { paidAt: { gte: fromD, lte: toD } },
      ],
    },
    select: {
      documentId: true,
      externalId: true,
      productName: true,
      saleType: true,
      clientName: true,
      performerExternalId: true,
      performerName: true,
      employeeExternalId: true,
      employeeName: true,
      operationType: true,
      paidAmount: true,
      personalAccount: true,
      cash: true,
      card: true,
      cashless: true,
      saleAmount: true,
      occurredAt: true,
      paidAt: true,
    },
  });
  const keys = collectUnpaidPtDebtKeys(entries);
  return applyUnpaidDebtStatusToPtSales(sales, keys);
}

/** Prefer TrainerPtSale rows; add revenue-only PT lines not already present. */
export function mergeTrainerPtSaleRows(
  primary: TrainerPtSaleRow[],
  extra: TrainerPtSaleRow[],
): TrainerPtSaleRow[] {
  const keys = new Set<string>();
  const out: TrainerPtSaleRow[] = [];
  const keyOf = (r: TrainerPtSaleRow) => {
    const day = (r.occurredAt || '').slice(0, 10);
    const client = (r.clientName ?? '').trim().toLowerCase();
    const emp = (r.employeeCode || r.employeeName || '').trim().toLowerCase();
    const doc = trainerPtSaleDocKey(r);
    if (doc && client) return `${day}|${client}|${emp}|${doc}`;
    const svc = (r.serviceName ?? '').trim().toLowerCase();
    return `${day}|${client}|${svc}|${emp}|${r.externalId || ''}`;
  };
  const looseKeys = (r: TrainerPtSaleRow): string[] => {
    const day = (r.occurredAt || '').slice(0, 10);
    const client = (r.clientName ?? '').trim().toLowerCase();
    if (!day || !client) return [];
    const ks: string[] = [];
    const code = (r.employeeCode ?? '').trim().replace(/^0+/, '');
    if (code) ks.push(`${day}|${client}|c:${code}`);
    const name = (r.employeeName ?? '').trim().toLowerCase();
    if (name) ks.push(`${day}|${client}|n:${name}`);
    return ks;
  };
  const looseIndex = new Map<string, number[]>();
  const consumed = new Set<number>();
  const looseMatched = new Set<string>();
  for (const r of primary) {
    keys.add(keyOf(r));
    const idx = out.length;
    out.push(r);
    for (const lk of looseKeys(r)) {
      const list = looseIndex.get(lk) ?? [];
      list.push(idx);
      looseIndex.set(lk, list);
    }
  }
  for (const r of extra) {
    const k = keyOf(r);
    if (keys.has(k)) continue;
    let matchIdx: number | undefined;
    for (const lk of looseKeys(r)) {
      matchIdx = (looseIndex.get(lk) ?? []).find((i) => !consumed.has(i));
      if (matchIdx != null) break;
    }
    if (matchIdx != null) {
      consumed.add(matchIdx);
      for (const lk of looseKeys(r)) looseMatched.add(lk);
      if (r.paymentStatus === 'PAID' && out[matchIdx].paymentStatus !== 'PAID') {
        out[matchIdx] = { ...out[matchIdx], paymentStatus: 'PAID' };
      }
      continue;
    }
    if (looseKeys(r).some((lk) => looseMatched.has(lk))) {
      continue;
    }
    keys.add(k);
    const idx = out.length;
    out.push(r);
    for (const lk of looseKeys(r)) {
      const list = looseIndex.get(lk) ?? [];
      list.push(idx);
      looseIndex.set(lk, list);
    }
  }
  return out;
}

/**
 * PT one-shots from ClubRevenueEntry.
 * Match trainer by performer* (Исполнитель); employee* is sale author (admin).
 */
export async function loadTrainerPtSalesFromRevenue(
  prisma: PrismaService,
  clubId: string,
  fromD: Date,
  toD: Date,
  opts?: { excludeSolariumAndGym?: boolean },
): Promise<TrainerPtSaleRow[]> {
  const exclude = opts?.excludeSolariumAndGym ?? false;
  const entries = await prisma.clubRevenueEntry.findMany({
    where: {
      clubId,
      isActive: true,
      OR: [
        { occurredAt: { gte: fromD, lte: toD } },
        { paidAt: { gte: fromD, lte: toD } },
      ],
    },
    orderBy: { occurredAt: 'asc' },
  });

  type Agg = {
    externalId: string;
    clientName?: string;
    serviceName?: string;
    occurredAt: string;
    amount: number;
    employeeCode?: string;
    employeeName?: string;
    docRef: string;
  };
  const byKey = new Map<string, Agg>();
  for (const e of entries) {
    const product = e.productName ?? '';
    if (exclude && isExcludedFromPtBookingControl(product)) continue;
    const isPt =
      (e.saleType ?? '').toLowerCase() === 'training' ||
      isLikelyTrainingProductName(product);
    if (!isPt) continue;
    if (isMultiVisitPackSale(product)) continue;
    const paid =
      (Number(e.paidAmount) || 0) > 0.01 ||
      (Number(e.personalAccount) || 0) > 0.01 ||
      (Number(e.cash) || 0) + (Number(e.card) || 0) + (Number(e.cashless) || 0) >
        0.01;
    if (!paid) continue;
    const rawAmount =
      Number(e.paidAmount) ||
      Number(e.personalAccount) ||
      Number(e.amount) ||
      0;
    if (rawAmount <= 0) continue;
    const perfCode = e.performerExternalId?.trim();
    const perfName = e.performerName?.trim();
    const empCode = e.employeeExternalId?.trim();
    const empName = e.employeeName?.trim();
    const trainerCode = perfCode || (!perfName ? empCode : undefined);
    const trainerName = perfName || (!perfCode ? empName : undefined);
    if (!trainerCode && !trainerName) continue;
    if (e.countsTowardMotivation === false && !perfCode && !perfName) {
      continue;
    }
    const amount = ptAmountFromPossiblyGluedProduct(product, rawAmount);
    const when = e.paidAt ?? e.occurredAt;
    const basis = preferredSaleBasisId({
      externalId: e.externalId,
      documentId: e.documentId,
    });
    let serviceName = product || undefined;
    if (product.includes(',')) {
      const ptPart = product
        .split(',')
        .map((p) => p.trim())
        .find(
          (p) =>
            isLikelyTrainingProductName(p) ||
            /тренер|персональн|\bпт\b|занятие с/i.test(p),
        );
      if (ptPart) serviceName = ptPart;
    }
    if (exclude && isExcludedFromPtBookingControl(serviceName)) continue;
    const productKey = (
      e.productExternalId?.trim() ||
      serviceName ||
      product ||
      ''
    )
      .trim()
      .toLowerCase();
    const trainerKey = (trainerCode || trainerName || '').trim().toLowerCase();
    const groupKey = `${basis}|${productKey}|${trainerKey}`;
    const whenIso = when.toISOString();
    const prev = byKey.get(groupKey);
    if (!prev) {
      byKey.set(groupKey, {
        externalId: e.externalId,
        clientName: e.clientName ?? undefined,
        serviceName,
        occurredAt: whenIso,
        amount,
        employeeCode: trainerCode || undefined,
        employeeName: trainerName || undefined,
        docRef: basis,
      });
    } else {
      prev.amount = Math.round((prev.amount + amount) * 100) / 100;
      if (whenIso < prev.occurredAt) prev.occurredAt = whenIso;
      if (!prev.clientName && e.clientName) {
        prev.clientName = e.clientName;
      }
      if (!prev.serviceName && serviceName) prev.serviceName = serviceName;
    }
  }
  return [...byKey.values()].map((a) => ({
    externalId: a.externalId,
    clientName: a.clientName,
    serviceName: a.serviceName,
    occurredAt: a.occurredAt,
    amount: a.amount,
    employeeCode: a.employeeCode,
    employeeName: a.employeeName,
    docRef: a.docRef,
    paymentStatus: 'PAID' as const,
  }));
}

const PACK_UNIT_LOOKBACK_DAYS = 120;

/**
 * Pack sales (incl. unpaid debt rows) for payroll unit = amount/N.
 * Lookback covers packs sold before the payroll period (e.g. Aug pack, Oct write-offs).
 */
export async function loadPackSalesForUnitPrice(
  prisma: PrismaService,
  clubId: string,
  fromD: Date,
  toD: Date,
  lookbackDays = PACK_UNIT_LOOKBACK_DAYS,
): Promise<PackSaleForUnitPrice[]> {
  const lookbackFrom = new Date(fromD);
  lookbackFrom.setDate(lookbackFrom.getDate() - lookbackDays);
  const entries = await prisma.clubRevenueEntry.findMany({
    where: {
      clubId,
      isActive: true,
      OR: [
        { occurredAt: { gte: lookbackFrom, lte: toD } },
        { paidAt: { gte: lookbackFrom, lte: toD } },
      ],
    },
    orderBy: { occurredAt: 'asc' },
  });

  const out: PackSaleForUnitPrice[] = [];
  for (const e of entries) {
    const product = (e.productName ?? '').trim();
    const saleAmt = Number(e.saleAmount) || 0;
    const paidAmt =
      Number(e.paidAmount) ||
      Number(e.personalAccount) ||
      Number(e.cash) ||
      0;
    const cardCashless =
      (Number(e.card) || 0) + (Number(e.cashless) || 0);
    const paid =
      paidAmt > 0.01 ||
      (Number(e.cash) || 0) + cardCashless > 0.01;
    const rawAmount = paid
      ? paidAmt || Number(e.amount) || saleAmt
      : saleAmt || Number(e.amount) || 0;
    if (rawAmount <= 0) continue;

    const qtyFromName = parsePackVisitCountFromTitle(product);
    // Multi-visit packs only («Блок массажа 10», «10 ПТ», реформер N).
    // Never treat one-shot «Массаж классический 50 мин» (75 BYN) as a pack —
    // matching it with basis N=10 yields 75/10 = 7.50 and underpays SPA.
    const isPack =
      isMultiVisitPackSale(product, qtyFromName) ||
      isReformerPersonalTitle(product) ||
      (isLikelyTrainingProductName(product) &&
        qtyFromName != null &&
        qtyFromName > 1) ||
      // Debt stub «Продажа 30907…» — still usable with basis date + client match.
      (/^продажа\s+\d+/i.test(product) && saleAmt > 0);

    if (!isPack) continue;
    // One-shot PT / SPA (qty 1, no pack marker) — not for pack unit recovery.
    if (
      (qtyFromName == null || qtyFromName <= 1) &&
      !isReformerPersonalTitle(product) &&
      !/^продажа\s+\d+/i.test(product)
    ) {
      continue;
    }

    const when = e.paidAt ?? e.occurredAt;
    out.push({
      clientName: e.clientName ?? undefined,
      serviceName: product || undefined,
      occurredAt: when.toISOString(),
      amount: Math.round(rawAmount * 100) / 100,
      quantity: qtyFromName && qtyFromName > 1 ? qtyFromName : undefined,
      externalId: e.externalId || undefined,
    });
  }
  return out;
}

/**
 * Per-visit price (minor) from a matching client pack sale.
 * Visit count comes from paymentBasis / quoted pack name — not from
 * conducted session title («реформер 1»).
 */
export function matchPackSaleForUnitPrice(
  sales: PackSaleForUnitPrice[],
  clientName: string,
  paymentBasis?: string | null,
  sessionTitle?: string | null,
): PackUnitPriceMatch | undefined {
  const normName = (s: string) =>
    s.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
  const client = normName(clientName);
  if (!client) return undefined;
  const basis = (paymentBasis ?? '').toLowerCase().replace(/ё/g, 'е');
  const title = (sessionTitle ?? '').toLowerCase().replace(/ё/g, 'е');
  const quoted = (extractQuotedPackNameFromBasis(paymentBasis) ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
  const packQty =
    parsePackVisitCountFromTitle(paymentBasis) ??
    parsePackVisitCountFromTitle(quoted) ??
    null;
  const packDateIso = extractPackDateIsoFromBasis(paymentBasis);

  type Cand = {
    amountMinor: number;
    score: number;
    externalId?: string;
    occurredAt?: string;
    serviceName?: string;
    svcQty?: number | null;
  };
  const cands: Cand[] = [];

  for (const sale of sales) {
    const saleClient = normName(sale.clientName ?? '');
    if (!saleClient || saleClient !== client) continue;
    const amountMinor = Math.round((Number(sale.amount) || 0) * 100);
    if (amountMinor <= 0) continue;
    const svc = (sale.serviceName ?? '').toLowerCase();
    const svcQty =
      sale.quantity && sale.quantity > 1
        ? sale.quantity
        : parsePackVisitCountFromTitle(svc);
    const day = (sale.occurredAt || '').slice(0, 10);
    const isDebtStub = /^продажа\s+\d+/.test(svc);
    // One-shot service lines must never become amount/N (75÷10 → 7.50).
    const saleIsPack =
      (svcQty != null && svcQty > 1) || isDebtStub || !svc.trim();
    if (!saleIsPack) continue;

    let score = 0;
    if (quoted && svc && (svc.includes(quoted) || quoted.includes(svc))) {
      score = 100;
    } else if (basis && svc && basis.includes(svc)) {
      score = 90;
    } else if (
      packQty != null &&
      svcQty != null &&
      packQty === svcQty &&
      ((/реформер/.test(basis) && /реформер/.test(svc)) ||
        (/пт/.test(basis) && /пт/.test(svc)) ||
        (/массаж/.test(basis) && /массаж/.test(svc)))
    ) {
      score = 80;
    } else if (
      packDateIso &&
      day === packDateIso &&
      (svcQty == null || (packQty != null && svcQty === packQty)) &&
      // Avoid grabbing a different pack sold same day (реформер 4 vs 8).
      !(svcQty != null && packQty != null && svcQty !== packQty)
    ) {
      // Debt stub «Продажа N» or unnamed row on pack document day.
      score = isDebtStub || !svc ? 50 : 40;
    } else if (
      title &&
      svc &&
      (title.includes(svc) || svc.includes(title)) &&
      packQty != null &&
      svcQty != null &&
      packQty === svcQty
    ) {
      score = 30;
    }

    if (score <= 0) continue;
    // Prefer exact visit-count match when known.
    if (packQty != null && svcQty != null && packQty === svcQty) score += 10;
    if (packQty != null && svcQty != null && packQty !== svcQty) continue;
    cands.push({
      amountMinor,
      score,
      externalId: sale.externalId,
      occurredAt: sale.occurredAt,
      serviceName: sale.serviceName,
      svcQty,
    });
  }

  if (!cands.length) return undefined;
  cands.sort((a, b) => b.score - a.score || b.amountMinor - a.amountMinor);
  const best = cands[0]!;
  const qty =
    packQty && packQty > 0
      ? packQty
      : parsePackVisitCountFromTitle(quoted) ?? 0;
  if (qty <= 1) return undefined;
  return {
    unitPriceMinor: Math.round(best.amountMinor / qty),
    externalId: best.externalId,
    occurredAt: best.occurredAt,
  };
}

/** @deprecated Prefer matchPackSaleForUnitPrice when sale pointer is needed. */
export function unitPriceFromMatchingPackSale(
  sales: PackSaleForUnitPrice[],
  clientName: string,
  paymentBasis?: string | null,
  sessionTitle?: string | null,
): number | undefined {
  return matchPackSaleForUnitPrice(
    sales,
    clientName,
    paymentBasis,
    sessionTitle,
  )?.unitPriceMinor;
}
