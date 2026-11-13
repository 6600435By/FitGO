import {
  extractPackDateIsoFromBasis,
  extractQuotedPackNameFromBasis,
  isMultiVisitPackSale,
  isSpaLikeSessionTitle,
  parseListedUnitPriceMajor,
  parsePackVisitCountFromTitle,
} from '@fitgo/shared-types';
import type { PrismaService } from '../prisma/prisma.service';
import { isBeforePayOnPaymentEpoch } from '../payroll/payroll-dates';
import { preferredSaleBasisId } from './payment-basis-products';
import {
  isLikelyTrainingProductName,
  isReformerPersonalTitle,
} from './admin-sales-segments';
import { isCollectibleClientDebt } from './club-revenue-debt';

/** Row shape shared by payroll and booking-control PT sales. */
export type TrainerPtSaleRow = {
  externalId?: string;
  /** 1C Document.Продажа UUID — links cash payments across days. */
  saleDocumentId?: string;
  clientName?: string;
  serviceName?: string;
  occurredAt: string;
  amount: number;
  quantity?: number;
  employeeCode?: string;
  employeeName?: string;
  docRef?: string;
  paymentStatus?: string;
  /** True when row came from ClubRevenue cash payment/refund, not TrainerPtSale. */
  fromCashPayment?: boolean;
};

const DOC_UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * Extract 1C sale document UUID from Integration `externalId` (`{uuid}#{line}`)
 * or from a bare UUID / cash-key basis.
 */
export function saleDocumentIdFromPtExternalId(
  externalId: string | null | undefined,
): string | undefined {
  const raw = (externalId ?? '').trim();
  if (!raw) return undefined;
  const head = (raw.split(/[:#]/)[0] ?? '').trim();
  if (head && DOC_UUID_RE.test(head)) return head.toLowerCase();
  return undefined;
}

/** Normalize service title for cross-day payment ↔ sale matching. */
function normServiceKey(name: string | null | undefined): string {
  return (name ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

function trainerLooseKeyParts(r: {
  employeeCode?: string;
  employeeName?: string;
}): { code?: string; name?: string } {
  const code = (r.employeeCode ?? '').trim().replace(/^0+/, '');
  const name = (r.employeeName ?? '').trim().toLowerCase();
  return {
    code: code || undefined,
    name: name || undefined,
  };
}

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

/** Closed client debt (СписаниеЗадолженности) — no cash, still SPA motivation base. */
export function clubRevenueIsDebtWriteOff(e: {
  operationType?: string | null;
}): boolean {
  return (e.operationType ?? '').toLowerCase() === 'debt_writeoff';
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

/** Days after period end to still treat card/cash as settlement of a DEBT sale. */
const PAID_OVERLAY_LOOKAHEAD_DAYS = 120;

/**
 * Upgrade DEBT → PAID when ClubRevenue has card/cash/cashless/ЛС for the same
 * sale document (preferredSaleBasisId) or same day+client+trainer.
 * Payment on a later day (incl. split 25+25 next month) still marks the sale PAID.
 */
export async function overlayPtSalePaidFromRevenue<T extends TrainerPtSaleRow>(
  prisma: PrismaService,
  clubId: string,
  fromD: Date,
  toD: Date,
  sales: T[],
): Promise<T[]> {
  if (sales.length === 0) return sales;
  if (!sales.some((s) => (s.paymentStatus ?? '').toUpperCase() === 'DEBT')) {
    return sales;
  }

  const payTo = new Date(toD);
  payTo.setDate(payTo.getDate() + PAID_OVERLAY_LOOKAHEAD_DAYS);

  const entries = await prisma.clubRevenueEntry.findMany({
    where: {
      clubId,
      isActive: true,
      OR: [
        { occurredAt: { gte: fromD, lte: toD } },
        { paidAt: { gte: fromD, lte: payTo } },
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
      paidAmount: true,
      personalAccount: true,
      cash: true,
      card: true,
      cashless: true,
      occurredAt: true,
      paidAt: true,
    },
  });

  const paidKeys = new Set<string>();
  /** Sum of card/cash/… by sale UUID — split pays (25+25) must cover the sale. */
  const paidByBasis = new Map<string, number>();
  for (const e of entries) {
    const product = e.productName ?? '';
    const isPt =
      (e.saleType ?? '').toLowerCase() === 'training' ||
      isLikelyTrainingProductName(product);
    if (!isPt) continue;
    if (!clubRevenueHasPaidMoney(e)) continue;
    const when = e.paidAt ?? e.occurredAt;
    const day = when.toISOString().slice(0, 10);
    const inPeriod = when >= fromD && when <= toD;
    const client = (e.clientName ?? '').trim().toLowerCase();
    const basis = preferredSaleBasisId({
      externalId: e.externalId,
      documentId: e.documentId,
    });
    const payAmt =
      Number(e.paidAmount) ||
      Number(e.personalAccount) ||
      (Number(e.cash) || 0) +
        (Number(e.card) || 0) +
        (Number(e.cashless) || 0) ||
      0;
    if (basis && DOC_UUID_RE.test(basis)) {
      const b = basis.toLowerCase();
      paidKeys.add(`doc:${b}`);
      paidByBasis.set(b, Math.round(((paidByBasis.get(b) ?? 0) + payAmt) * 100) / 100);
    }
    const registrar = e.documentId?.trim();
    if (registrar) paidKeys.add(`doc:${registrar.toLowerCase()}`);
    // Same-day loose keys only inside the report window (not lookahead noise).
    if (!inPeriod || !day || !client) continue;
    const perfCode = e.performerExternalId?.trim();
    const perfName = e.performerName?.trim();
    const empCode = e.employeeExternalId?.trim();
    const empName = e.employeeName?.trim();
    const trainerCode = perfCode || (!perfName ? empCode : undefined);
    const trainerName = perfName || (!perfCode ? empName : undefined);
    if (trainerCode) {
      paidKeys.add(`${day}|${client}|c:${trainerCode.replace(/^0+/, '')}`);
    }
    if (trainerName) {
      paidKeys.add(`${day}|${client}|n:${trainerName.toLowerCase()}`);
    }
  }
  if (paidKeys.size === 0) return sales;

  return sales.map((s) => {
    if ((s.paymentStatus ?? '').toUpperCase() !== 'DEBT') return s;
    const day = (s.occurredAt || '').slice(0, 10);
    const client = (s.clientName ?? '').trim().toLowerCase();
    const code = (s.employeeCode ?? '').trim().replace(/^0+/, '');
    const name = (s.employeeName ?? '').trim().toLowerCase();
    const doc = (s.docRef || '').trim();
    const ext = (s.externalId || '').trim();
    const extRoot = ext.split(/[:#]/)[0]?.trim().toLowerCase();
    const docRoot = doc.includes('#') ? doc.split('#')[0]! : doc;
    const mappedUuid =
      (s.saleDocumentId ?? '').trim().toLowerCase() ||
      saleDocumentIdFromPtExternalId(ext) ||
      saleDocumentIdFromPtExternalId(doc);
    const hit =
      (code && paidKeys.has(`${day}|${client}|c:${code}`)) ||
      (name && paidKeys.has(`${day}|${client}|n:${name}`)) ||
      (doc && paidKeys.has(`doc:${doc.toLowerCase()}`)) ||
      (docRoot && paidKeys.has(`doc:${docRoot.toLowerCase()}`)) ||
      (extRoot && paidKeys.has(`doc:${extRoot}`)) ||
      (mappedUuid && paidKeys.has(`doc:${mappedUuid}`));
    if (!hit) return s;
    // Split card pays: require covered amount when we know both sides.
    if (mappedUuid && paidByBasis.has(mappedUuid)) {
      const covered = paidByBasis.get(mappedUuid) ?? 0;
      const due = Number(s.amount) || 0;
      if (due > 0.01 && covered + 0.01 < due) return s;
    }
    return { ...s, paymentStatus: 'PAID' };
  });
}

function markPaid(row: TrainerPtSaleRow): TrainerPtSaleRow {
  if (row.paymentStatus === 'PAID') return row;
  return { ...row, paymentStatus: 'PAID' };
}

/** Sale document UUID when present (authoritative cross-day identity). */
function rowSaleUuid(r: TrainerPtSaleRow): string | undefined {
  const uuid =
    (r.saleDocumentId ?? '').trim().toLowerCase() ||
    saleDocumentIdFromPtExternalId(r.externalId) ||
    saleDocumentIdFromPtExternalId(r.docRef);
  return uuid || undefined;
}

/**
 * Cross-day identity for cash settlement → original sale.
 * UUID is authoritative: never fall back to client|trainer|service when a
 * document UUID is present (same client can have many «Занятие 50р» sales).
 * Legacy rows without UUID keep svc keys for one-shot payment matching.
 */
function saleIdentityKeys(r: TrainerPtSaleRow): string[] {
  const uuid = rowSaleUuid(r);
  if (uuid) return [`uuid:${uuid}`];
  const keys: string[] = [];
  const client = (r.clientName ?? '').trim().toLowerCase();
  const svc = normServiceKey(r.serviceName);
  if (!client || !svc) return keys;
  const { code, name } = trainerLooseKeyParts(r);
  if (code) keys.push(`svc:${client}|c:${code}|${svc}`);
  if (name) keys.push(`svc:${client}|n:${name}|${svc}`);
  return keys;
}

/** Prefer TrainerPtSale rows; add revenue-only PT lines not already present.
 * Cash payment/refund of an existing sale only flips PAID — never a second visit.
 */
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
  const identityIndex = new Map<string, number[]>();
  const consumed = new Set<number>();
  const looseMatched = new Set<string>();

  const indexRow = (r: TrainerPtSaleRow, idx: number) => {
    keys.add(keyOf(r));
    for (const lk of looseKeys(r)) {
      const list = looseIndex.get(lk) ?? [];
      list.push(idx);
      looseIndex.set(lk, list);
    }
    for (const ik of saleIdentityKeys(r)) {
      const list = identityIndex.get(ik) ?? [];
      list.push(idx);
      identityIndex.set(ik, list);
    }
  };

  const findIdentityMatch = (r: TrainerPtSaleRow): number | undefined => {
    const keys = saleIdentityKeys(r);
    // Prefer UUID hits.
    for (const ik of keys.filter((k) => k.startsWith('uuid:'))) {
      const hit = (identityIndex.get(ik) ?? []).find((i) => !consumed.has(i));
      if (hit != null) return hit;
    }
    // Legacy svc: only when this row has no UUID, and only if a single
    // unmatched sale shares client+trainer+service (avoids swallowing the
    // rest of the client's same-priced PT sales — Новик / Доминецкая).
    if (rowSaleUuid(r)) return undefined;
    for (const ik of keys.filter((k) => k.startsWith('svc:'))) {
      const open = (identityIndex.get(ik) ?? []).filter((i) => !consumed.has(i));
      if (open.length === 1) return open[0];
    }
    return undefined;
  };

  for (const r of primary) {
    const idx = out.length;
    out.push(r);
    indexRow(r, idx);
  }
  for (const r of extra) {
    const k = keyOf(r);
    if (keys.has(k)) {
      // Same day+doc already present — still upgrade PAID from cash.
      if (r.paymentStatus === 'PAID') {
        const idx = out.findIndex((x) => keyOf(x) === k);
        if (idx >= 0) out[idx] = markPaid(out[idx]!);
      }
      continue;
    }

    // Cross-day: cash settlement of an existing sale → PAID only, keep sale date/amount.
    // Split pays (25+25 card on one sale UUID) all attach to the same row —
    // do not consume UUID matches (legacy svc still consumes one-to-one).
    const identityIdx = findIdentityMatch(r);
    if (identityIdx != null) {
      const matchedByUuid = saleIdentityKeys(r).some((k) =>
        k.startsWith('uuid:'),
      );
      if (!matchedByUuid) consumed.add(identityIdx);
      out[identityIdx] = markPaid(out[identityIdx]!);
      continue;
    }
    if (r.fromCashPayment) {
      // Cash row with no matching sale — keep as fallback session below.
    }

    let matchIdx: number | undefined;
    for (const lk of looseKeys(r)) {
      matchIdx = (looseIndex.get(lk) ?? []).find((i) => !consumed.has(i));
      if (matchIdx != null) break;
    }
    if (matchIdx != null) {
      consumed.add(matchIdx);
      for (const lk of looseKeys(r)) looseMatched.add(lk);
      out[matchIdx] = markPaid(out[matchIdx]!);
      continue;
    }
    if (looseKeys(r).some((lk) => looseMatched.has(lk))) {
      continue;
    }
    const idx = out.length;
    out.push(r);
    indexRow(r, idx);
  }
  return out;
}

/** Cash-register settlement of a sale (not the sale document itself). */
export function isClubRevenueCashSettlement(e: {
  operationType?: string | null;
  externalId?: string | null;
}): boolean {
  const op = (e.operationType ?? '').toLowerCase();
  if (op === 'payment' || op === 'refund') return true;
  return (e.externalId ?? '').includes(':cash:');
}

/**
 * Cash/ЛС settlement of an earlier sale must keep the sale date (not pay day).
 * Otherwise Oct 12 debt paid 30.10 shows as a phantom PT on 30.10.
 */
export function resolvePtCashOccurredAt(
  paymentAt: Date,
  basisUuid: string | undefined,
  priorSaleAtByUuid: Map<string, Date>,
): Date {
  if (!basisUuid) return paymentAt;
  return priorSaleAtByUuid.get(basisUuid) ?? paymentAt;
}

/**
 * Drop one-shot PT rows whose sale/service day is before pay-on-payment epoch.
 * Late cash for those sales only clears pre-app debt — no control card / ЗП.
 * Rows that could not be backdated keep the cashier day and stay (may be new).
 */
export function dropPrePayOnPaymentEpochPtSales<
  T extends { occurredAt: string },
>(sales: T[]): T[] {
  return sales.filter((s) => !isBeforePayOnPaymentEpoch(s.occurredAt));
}

const SALE_MATCH_LOOKBACK_DAYS = 120;

/**
 * PT one-shots from ClubRevenueEntry.
 * Match trainer by performer* (Исполнитель); employee* is sale author (admin).
 * Cash payment/refund of a known TrainerPtSale is omitted (PAID via overlay).
 */
export async function loadTrainerPtSalesFromRevenue(
  prisma: PrismaService,
  clubId: string,
  fromD: Date,
  toD: Date,
  opts?: { excludeSolariumAndGym?: boolean },
): Promise<TrainerPtSaleRow[]> {
  const exclude = opts?.excludeSolariumAndGym ?? false;
  const lookbackFrom = new Date(fromD);
  lookbackFrom.setDate(lookbackFrom.getDate() - SALE_MATCH_LOOKBACK_DAYS);

  const [entries, knownSales, lookbackDocs, saleTxRows] = await Promise.all([
    prisma.clubRevenueEntry.findMany({
      where: {
        clubId,
        isActive: true,
        OR: [
          { occurredAt: { gte: fromD, lte: toD } },
          { paidAt: { gte: fromD, lte: toD } },
        ],
      },
      orderBy: { occurredAt: 'asc' },
    }),
    prisma.trainerPtSale.findMany({
      where: {
        clubId,
        isActive: true,
        occurredAt: { gte: lookbackFrom, lte: toD },
      },
      select: {
        saleDocumentId: true,
        externalId: true,
        clientName: true,
        serviceName: true,
        employeeCode: true,
        employeeName: true,
        occurredAt: true,
      },
    }),
    // Prior PT sale/debt stubs (lookback) — late split card pays must not
    // become a second visit in the payment month (Новик 02.10 → 25+25 02.11).
    prisma.clubRevenueEntry.findMany({
      where: {
        clubId,
        isActive: true,
        occurredAt: { gte: lookbackFrom, lte: toD },
        OR: [
          { operationType: { in: ['unpaid', 'debt_writeoff'] } },
          {
            AND: [
              { operationType: { notIn: ['payment', 'refund'] } },
              {
                OR: [
                  { saleType: 'training' },
                  { productName: { contains: 'Занятие с тренером' } },
                  { productName: { contains: 'занятие с тренером' } },
                ],
              },
            ],
          },
        ],
      },
      select: {
        documentId: true,
        externalId: true,
        productName: true,
        saleType: true,
        operationType: true,
        occurredAt: true,
      },
    }),
    // Analytics sale date (soldAt) — cash-scope rows only have the payment day.
    prisma.saleTransaction.findMany({
      where: {
        clubId,
        soldAt: { gte: lookbackFrom, lte: toD },
        OR: [
          { saleType: 'training' },
          { productName: { contains: 'Занятие с тренером' } },
          { productName: { contains: 'занятие с тренером' } },
          { productName: { contains: 'реформер' } },
          { productName: { contains: 'Реформер' } },
        ],
      },
      select: { externalSaleId: true, soldAt: true },
    }),
  ]);

  // Only UUID suppresses a cash visit. client|trainer|service is too broad:
  // one cached sale (Новик 19.10) must not drop other sales' card payments
  // (14.10 / 26.10) for the same «Занятие с тренером 50р.».
  const knownUuids = new Set<string>();
  /** Earliest sale/debt date by document UUID — backdate late cash/ЛС pays. */
  const priorSaleAtByUuid = new Map<string, Date>();
  const rememberPriorSaleAt = (uuid: string, when: Date) => {
    const prev = priorSaleAtByUuid.get(uuid);
    if (!prev || when < prev) priorSaleAtByUuid.set(uuid, when);
  };
  for (const s of knownSales) {
    const uuid =
      (s.saleDocumentId ?? '').trim().toLowerCase() ||
      saleDocumentIdFromPtExternalId(s.externalId);
    if (uuid) {
      knownUuids.add(uuid);
      rememberPriorSaleAt(uuid, s.occurredAt);
    }
  }
  for (const d of lookbackDocs) {
    if (isClubRevenueCashSettlement(d)) continue;
    const product = d.productName ?? '';
    const isPt =
      (d.saleType ?? '').toLowerCase() === 'training' ||
      isLikelyTrainingProductName(product);
    const basis = preferredSaleBasisId({
      externalId: d.externalId,
      documentId: d.documentId,
    });
    const doc = (d.documentId ?? '').trim().toLowerCase();
    // Always remember sale/debt date (even «Продажа N от …» stubs) so a later
    // card/ЛС payment keeps the training day, not the cashier day.
    if (basis && DOC_UUID_RE.test(basis)) {
      rememberPriorSaleAt(basis.toLowerCase(), d.occurredAt);
    }
    if (doc && DOC_UUID_RE.test(doc)) {
      rememberPriorSaleAt(doc, d.occurredAt);
    }
    // Suppress cash→visit only for real PT nomenclature rows (not «Продажа N»).
    // Debt presentation stubs still backdate via priorSaleAtByUuid above.
    if (!isPt) continue;
    if (basis && DOC_UUID_RE.test(basis)) knownUuids.add(basis.toLowerCase());
    if (doc && DOC_UUID_RE.test(doc)) knownUuids.add(doc);
  }
  // Analytics soldAt fills prior map when ClubRevenue only has the pay day.
  // Do not add to knownUuids — cash must still become the period visit when
  // TrainerPtSale is missing (backdated, then epoch-filtered if pre-Oct).
  for (const tx of saleTxRows) {
    const uuid = saleDocumentIdFromPtExternalId(tx.externalSaleId);
    if (!uuid) continue;
    rememberPriorSaleAt(uuid, tx.soldAt);
  }

  type Agg = {
    externalId: string;
    saleDocumentId?: string;
    clientName?: string;
    serviceName?: string;
    occurredAt: string;
    amount: number;
    employeeCode?: string;
    employeeName?: string;
    docRef: string;
    fromCashPayment: boolean;
    paymentStatus: 'PAID' | 'DEBT';
  };
  const byKey = new Map<string, Agg>();
  for (const e of entries) {
    const product = e.productName ?? '';
    // Skip spa/solarium/gym before cash→session so a massage payment tagged
    // as training never becomes a phantom PT unit.
    if (exclude && isExcludedFromPtBookingControl(product)) continue;
    if (isSpaLikeSessionTitle(product)) continue;
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
    const op = (e.operationType ?? '').toLowerCase();
    // Unpaid PT sale with Исполнитель (Новик 02.10) — visit on sale date, DEBT.
    const unpaidPt =
      !paid &&
      (op === 'unpaid' || op === 'debt_writeoff') &&
      !!(e.performerExternalId?.trim() || e.performerName?.trim());
    if (!paid && !unpaidPt) continue;
    const rawAmount = paid
      ? Number(e.paidAmount) ||
        Number(e.personalAccount) ||
        Number(e.amount) ||
        0
      : Number(e.saleAmount) || Number(e.amount) || 0;
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
    if (isSpaLikeSessionTitle(serviceName)) continue;

    const fromCash = isClubRevenueCashSettlement(e);
    const basisUuid = DOC_UUID_RE.test(basis) ? basis.toLowerCase() : '';
    if (fromCash) {
      if (basisUuid && knownUuids.has(basisUuid)) {
        // Settlement of a cached TrainerPtSale — PAID via overlay, not a visit.
        continue;
      }
    }

    // Prefer sale/debt document date over later cash/ЛС settlement date.
    const paymentAt = fromCash ? (e.paidAt ?? e.occurredAt) : e.occurredAt;
    const when = fromCash
      ? resolvePtCashOccurredAt(paymentAt, basisUuid || undefined, priorSaleAtByUuid)
      : paymentAt;
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
    const saleDocumentId = DOC_UUID_RE.test(basis) ? basis.toLowerCase() : undefined;
    const paymentStatus: 'PAID' | 'DEBT' = paid ? 'PAID' : 'DEBT';
    const prev = byKey.get(groupKey);
    if (!prev) {
      byKey.set(groupKey, {
        externalId: e.externalId,
        saleDocumentId,
        clientName: e.clientName ?? undefined,
        serviceName,
        occurredAt: whenIso,
        amount,
        employeeCode: trainerCode || undefined,
        employeeName: trainerName || undefined,
        docRef: basis,
        fromCashPayment: fromCash,
        paymentStatus,
      });
    } else {
      // Same sale UUID: do not sum a sale/debt stub with its cash settlement.
      // Two partial card payments of the same debt (25+25) must add up.
      if (fromCash && prev.fromCashPayment) {
        prev.amount = Math.round((prev.amount + amount) * 100) / 100;
      } else if (amount > prev.amount) {
        prev.amount = amount;
      }
      if (whenIso < prev.occurredAt) prev.occurredAt = whenIso;
      if (!prev.clientName && e.clientName) {
        prev.clientName = e.clientName;
      }
      if (!prev.serviceName && serviceName) prev.serviceName = serviceName;
      if (fromCash) prev.fromCashPayment = true;
      if (paymentStatus === 'PAID') prev.paymentStatus = 'PAID';
      if (!prev.saleDocumentId && saleDocumentId) {
        prev.saleDocumentId = saleDocumentId;
      }
      // Prefer non-cash externalId (sale / debt stub) when available.
      if (!fromCash && e.externalId) prev.externalId = e.externalId;
    }
  }
  return [...byKey.values()].map((a) => ({
    externalId: a.externalId,
    saleDocumentId: a.saleDocumentId,
    clientName: a.clientName,
    serviceName: a.serviceName,
    occurredAt: a.occurredAt,
    amount: a.amount,
    employeeCode: a.employeeCode,
    employeeName: a.employeeName,
    docRef: a.docRef,
    paymentStatus: a.paymentStatus,
    fromCashPayment: a.fromCashPayment || undefined,
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

  /** Collapse sale + later cash payment of same UUID into one pack row. */
  const byBasis = new Map<string, PackSaleForUnitPrice>();
  let anonSeq = 0;
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

    const basis = preferredSaleBasisId({
      externalId: e.externalId,
      documentId: e.documentId,
    });
    const groupKey =
      basis ||
      e.externalId ||
      `anon:${anonSeq++}`;
    // Prefer sale document date over later cash settlement date.
    const when = isClubRevenueCashSettlement(e)
      ? e.occurredAt
      : (e.paidAt ?? e.occurredAt);
    const amount = Math.round(rawAmount * 100) / 100;
    const prev = byBasis.get(groupKey);
    if (!prev) {
      byBasis.set(groupKey, {
        clientName: e.clientName ?? undefined,
        serviceName: product || undefined,
        occurredAt: when.toISOString(),
        amount,
        quantity: qtyFromName && qtyFromName > 1 ? qtyFromName : undefined,
        externalId: e.externalId || undefined,
      });
    } else {
      if (amount > prev.amount) prev.amount = amount;
      const whenIso = when.toISOString();
      if (whenIso < prev.occurredAt) {
        prev.occurredAt = whenIso;
        // Prefer non-cash externalId (sale line) when available.
        if (!isClubRevenueCashSettlement(e) && e.externalId) {
          prev.externalId = e.externalId;
        }
      }
      if (!prev.clientName && e.clientName) prev.clientName = e.clientName;
      if (!prev.serviceName && product) prev.serviceName = product;
      if (
        qtyFromName &&
        qtyFromName > 1 &&
        !(prev.quantity && prev.quantity > 1)
      ) {
        prev.quantity = qtyFromName;
      }
    }
  }
  return [...byBasis.values()];
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
