/**
 * Recover per-visit price for SPA massage block write-offs.
 * 1C member rows often lack packageAmount (money lives on the Sale document).
 */
import {
  extractPackDateIsoFromBasis,
  extractQuotedPackNameFromBasis,
  parsePackVisitCountFromTitle,
  spaBlockDiscountPct,
} from '@fitgo/shared-types';
import type { PrismaService } from '../prisma/prisma.service';

const SPA_BLOCK_SALE_LOOKBACK_DAYS = 180;

/** Single-visit catalog band (BYN major) — packs are typically ≥200. */
const ONE_SHOT_MIN_MAJOR = 20;
const ONE_SHOT_MAX_MAJOR = 200;

/** Reject sale/N when below this fraction of catalog (e.g. 75÷10 = 7.50). */
const SALE_VS_CATALOG_MIN_RATIO = 0.5;

export type SpaBlockSaleDoc = {
  documentId: string;
  clientName: string;
  soldAtIso: string;
  /** Full document amount in minor units. */
  amountMinor: number;
  productName?: string;
  productExternalId?: string;
};

export type SpaBlockUnitMatch = {
  unitPriceMinor: number;
  source: 'SALE' | 'CATALOG';
  externalId?: string;
  occurredAt?: string;
  /** Visit count N used for /N or catalog discount. */
  packQty: number;
  discountPct?: number;
};

function normName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

/** Document UUID = prefix of SaleTransaction.externalSaleId before first `:`. */
export function saleDocumentId(externalSaleId: string): string {
  const s = (externalSaleId ?? '').trim();
  if (!s) return '';
  const i = s.indexOf(':');
  return i >= 0 ? s.slice(0, i) : s;
}

function saleIdSuffix(externalSaleId: string): string | null {
  const s = (externalSaleId ?? '').trim();
  const i = s.lastIndexOf(':');
  if (i < 0) return null;
  const tail = s.slice(i + 1);
  if (/^[up]\d{4}-\d{2}-\d{2}$/i.test(tail)) return tail;
  return null;
}

/**
 * Group massage SaleTransaction rows into one doc per sale UUID.
 * Prefer base row (no :u/:p suffix); else sum latest unpaid+paid snapshot.
 */
export function groupMassageSalesToDocs(
  rows: Array<{
    externalSaleId: string;
    clientName: string | null;
    soldAt: Date;
    amount: number;
    productName: string | null;
    productExternalId: string | null;
    isActive: boolean;
  }>,
): SpaBlockSaleDoc[] {
  type Acc = {
    documentId: string;
    clientName: string;
    soldAt: Date;
    productName?: string;
    productExternalId?: string;
    /** Bare externalSaleId (no :u/:p) — preferred full sale amount. */
    baseAmount?: number;
    /** Max amount seen on any snapshot (u often = full sale; p = paid slice). */
    maxAmount: number;
  };
  const byDoc = new Map<string, Acc>();

  for (const r of rows) {
    const documentId = saleDocumentId(r.externalSaleId);
    if (!documentId) continue;
    const client = (r.clientName ?? '').trim();
    if (!client) continue;
    const amount = Number(r.amount) || 0;
    if (amount <= 0) continue;

    let acc = byDoc.get(documentId);
    if (!acc) {
      acc = {
        documentId,
        clientName: client,
        soldAt: r.soldAt,
        productName: r.productName ?? undefined,
        productExternalId: r.productExternalId ?? undefined,
        maxAmount: 0,
      };
      byDoc.set(documentId, acc);
    }
    if (r.soldAt < acc.soldAt) acc.soldAt = r.soldAt;
    if (!acc.productName && r.productName) acc.productName = r.productName;
    if (!acc.productExternalId && r.productExternalId) {
      acc.productExternalId = r.productExternalId;
    }
    if (amount > acc.maxAmount) acc.maxAmount = amount;

    const suffix = saleIdSuffix(r.externalSaleId);
    if (!suffix) {
      // Bare document id — authoritative full amount.
      if (acc.baseAmount == null || amount > acc.baseAmount) {
        acc.baseAmount = amount;
      }
    }
  }

  const out: SpaBlockSaleDoc[] = [];
  for (const acc of byDoc.values()) {
    // Prefer bare-id row; else largest snapshot (unpaid u often holds full pack).
    const amountMajor = acc.baseAmount ?? acc.maxAmount;
    if (amountMajor <= 0) continue;
    out.push({
      documentId: acc.documentId,
      clientName: acc.clientName,
      soldAtIso: acc.soldAt.toISOString(),
      amountMinor: Math.round(amountMajor * 100),
      productName: acc.productName,
      productExternalId: acc.productExternalId,
    });
  }
  return out;
}

export async function loadSpaBlockSales(
  prisma: PrismaService,
  clubId: string,
  fromD: Date,
  toD: Date,
  lookbackDays = SPA_BLOCK_SALE_LOOKBACK_DAYS,
): Promise<SpaBlockSaleDoc[]> {
  const lookbackFrom = new Date(fromD);
  lookbackFrom.setDate(lookbackFrom.getDate() - lookbackDays);
  const rows = await prisma.saleTransaction.findMany({
    where: {
      clubId,
      saleType: 'massage',
      soldAt: { gte: lookbackFrom, lte: toD },
    },
    select: {
      externalSaleId: true,
      clientName: true,
      soldAt: true,
      amount: true,
      productName: true,
      productExternalId: true,
      isActive: true,
    },
    orderBy: { soldAt: 'asc' },
  });
  return groupMassageSalesToDocs(rows);
}

export function packQtyFromBasis(
  paymentBasis?: string | null,
  sessionTitle?: string | null,
): number | null {
  const quoted = extractQuotedPackNameFromBasis(paymentBasis);
  return (
    parsePackVisitCountFromTitle(paymentBasis) ??
    parsePackVisitCountFromTitle(quoted) ??
    parsePackVisitCountFromTitle(sessionTitle) ??
    null
  );
}

/**
 * client|YYYY-MM-DD → distinct packageDocId count (same-day multi-pack sales).
 */
export function buildPacksSameDayMap(
  members: Array<{
    clientName?: string | null;
    paymentBasis?: string | null;
    packageDocId?: string | null;
  }>,
): Map<string, number> {
  const sets = new Map<string, Set<string>>();
  for (const m of members) {
    const client = normName(m.clientName ?? '');
    const day = extractPackDateIsoFromBasis(m.paymentBasis);
    const doc = (m.packageDocId ?? '').trim();
    if (!client || !day || !doc) continue;
    const key = `${client}|${day}`;
    let set = sets.get(key);
    if (!set) {
      set = new Set();
      sets.set(key, set);
    }
    set.add(doc);
  }
  const out = new Map<string, number>();
  for (const [k, set] of sets) out.set(k, set.size);
  return out;
}

export function matchSpaBlockSale(input: {
  sales: SpaBlockSaleDoc[];
  clientName: string;
  paymentBasis?: string | null;
  sessionTitle?: string | null;
  packsSameDay?: number;
  catalogUnitMinor?: number | null;
}): SpaBlockUnitMatch | undefined {
  const client = normName(input.clientName);
  if (!client) return undefined;
  const packDate = extractPackDateIsoFromBasis(input.paymentBasis);
  if (!packDate) return undefined;
  const packQty = packQtyFromBasis(input.paymentBasis, input.sessionTitle);
  if (packQty == null || packQty <= 1) return undefined;

  const packsSameDay =
    input.packsSameDay != null && input.packsSameDay > 0
      ? input.packsSameDay
      : 1;

  const cands = input.sales.filter((s) => {
    if (normName(s.clientName) !== client) return false;
    return s.soldAtIso.slice(0, 10) === packDate;
  });
  if (!cands.length) return undefined;

  // Prefer larger amount (covers multi-pack docs); then any.
  cands.sort((a, b) => b.amountMinor - a.amountMinor);
  const best = cands[0]!;
  let unit = Math.round(best.amountMinor / packsSameDay / packQty);
  if (unit <= 0) return undefined;

  const catalog = input.catalogUnitMinor ?? 0;
  if (catalog > 0 && unit < catalog * SALE_VS_CATALOG_MIN_RATIO) {
    return undefined;
  }

  return {
    unitPriceMinor: unit,
    source: 'SALE',
    externalId: best.documentId,
    occurredAt: best.soldAtIso,
    packQty,
  };
}

/** Mode of one-shot major amounts (20–200 BYN) for a nomenclature UUID. */
export function modeOneShotPriceMinor(
  amountsMajor: number[],
): number | undefined {
  const counts = new Map<number, number>();
  for (const raw of amountsMajor) {
    const a = Math.round((Number(raw) || 0) * 100) / 100;
    if (a < ONE_SHOT_MIN_MAJOR || a > ONE_SHOT_MAX_MAJOR) continue;
    counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  if (!counts.size) return undefined;
  let bestAmt = 0;
  let bestN = 0;
  for (const [amt, n] of counts) {
    if (n > bestN || (n === bestN && amt > bestAmt)) {
      bestN = n;
      bestAmt = amt;
    }
  }
  return bestAmt > 0 ? Math.round(bestAmt * 100) : undefined;
}

export async function resolveSpaCatalogUnitMinor(
  prisma: PrismaService,
  clubId: string,
  opts: {
    serviceExternalId?: string | null;
    /** Fallback SpaService.id when externalId missing. */
    serviceId?: string | null;
  },
): Promise<number | undefined> {
  const ext = (opts.serviceExternalId ?? '').trim();
  if (ext) {
    const svc = await prisma.spaService.findFirst({
      where: { clubId, externalId: ext, active: true },
      select: { priceFromOneCMinor: true, priceMinor: true },
    });
    const fromSvc = svc?.priceFromOneCMinor ?? svc?.priceMinor;
    if (fromSvc != null && fromSvc > 0) return fromSvc;

    const sales = await prisma.saleTransaction.findMany({
      where: {
        clubId,
        saleType: 'massage',
        productExternalId: ext,
        amount: { gt: 0 },
      },
      select: { amount: true },
      take: 200,
    });
    const mode = modeOneShotPriceMinor(sales.map((s) => s.amount));
    if (mode != null) return mode;
  }

  const sid = (opts.serviceId ?? '').trim();
  if (sid) {
    const svc = await prisma.spaService.findFirst({
      where: { id: sid, clubId },
      select: { priceFromOneCMinor: true, priceMinor: true },
    });
    const fromSvc = svc?.priceFromOneCMinor ?? svc?.priceMinor;
    if (fromSvc != null && fromSvc > 0) return fromSvc;
  }
  return undefined;
}

/** Catalog price × (1 − block discount%). */
export function catalogUnitWithBlockDiscount(
  catalogUnitMinor: number,
  packQty: number,
): SpaBlockUnitMatch | undefined {
  if (!(catalogUnitMinor > 0) || packQty <= 1) return undefined;
  const discountPct = spaBlockDiscountPct(packQty);
  const unit = Math.round((catalogUnitMinor * (100 - discountPct)) / 100);
  if (unit <= 0) return undefined;
  return {
    unitPriceMinor: unit,
    source: 'CATALOG',
    packQty,
    discountPct,
  };
}

/**
 * Full recovery: sale/N first, then catalog with block discount.
 * Returns undefined when neither path yields a price.
 */
export function resolveSpaBlockUnitPrice(input: {
  sales: SpaBlockSaleDoc[];
  clientName: string;
  paymentBasis?: string | null;
  sessionTitle?: string | null;
  packsSameDay?: number;
  catalogUnitMinor?: number | null;
}): SpaBlockUnitMatch | undefined {
  const packQty = packQtyFromBasis(input.paymentBasis, input.sessionTitle);
  const fromSale = matchSpaBlockSale(input);
  if (fromSale) return fromSale;

  if (packQty == null || packQty <= 1) return undefined;
  const catalog = input.catalogUnitMinor ?? 0;
  if (!(catalog > 0)) return undefined;
  return catalogUnitWithBlockDiscount(catalog, packQty);
}
