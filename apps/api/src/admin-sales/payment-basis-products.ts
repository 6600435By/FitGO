import type { PrismaService } from '../prisma/prisma.service';
import { normNom } from './admin-sales-segments';

/** Cash-scope labels from Analytics when nomenclature is not on the payment row. */
const GENERIC_PAYMENT_NAMES = new Set([
  'оплата от клиента',
  'возврат',
]);

/** 1C `Строка(Основание)` for Document.Продажа → "Продажа 26253 от 29.08.2026". */
const SALE_DOCUMENT_TITLE_RE =
  /^продажа\s+\d+(\s+от\s+\d{1,2}\.\d{1,2}\.\d{2,4})?/i;

export type BasisProductLine = {
  productName: string;
  productExternalId: string | null;
  productCode: string | null;
  productGroupName: string | null;
  saleType: string | null;
  amount: number;
};

/**
 * Placeholder product names on cash/debt rows — not real nomenclature.
 * Includes Analytics substitution of the sale document presentation.
 */
export function isGenericPaymentProduct(
  name: string | null | undefined,
): boolean {
  const n = (name ?? '').trim().toLowerCase();
  if (!n) return true;
  if (GENERIC_PAYMENT_NAMES.has(n)) return true;
  if (SALE_DOCUMENT_TITLE_RE.test(n)) return true;
  return false;
}

/**
 * Whether ClubRevenueEntry.productName should be replaced with sale lines.
 * True for placeholders and when the cash label does not match any basis SKU
 * (e.g. membership title on a personal-account shop payment).
 */
export function shouldReplaceProductWithBasis(
  productName: string | null | undefined,
  lines: BasisProductLine[],
): boolean {
  if (!lines.length) return false;
  if (isGenericPaymentProduct(productName)) return true;
  const raw = (productName ?? '').trim();
  if (!raw) return true;
  const n = normNom(raw);
  if (lines.some((l) => normNom(l.productName) === n)) return false;
  if (raw.includes(', ')) {
    const parts = raw.split(',').map((p) => normNom(p.trim()));
    if (
      parts.length > 0 &&
      parts.every((p) => p && lines.some((l) => normNom(l.productName) === p))
    ) {
      return false;
    }
  }
  return true;
}

const DOC_UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * Sale document UUID candidates from club-revenue externalId / documentId.
 * cash: `payDoc:cash:Тип:client:saleDoc:ts:op…`
 * debt: `saleDoc:debt:client`
 *
 * Always includes documentId (Регистратор). For shop paid from personal account
 * that was auto-credited with a membership, cash-key «основание» is often
 * ЧленствоПакетУслуг (VIP №N) while Регистратор is Document.Продажа (коктейль).
 */
export function saleDocIdsForRevenueRow(row: {
  externalId: string;
  documentId: string | null;
}): string[] {
  const ids = new Set<string>();
  const parts = row.externalId.split(':');
  const cashIdx = parts.indexOf('cash');
  if (cashIdx >= 0 && parts[cashIdx + 3]) {
    ids.add(parts[cashIdx + 3]);
  }
  const debtIdx = parts.indexOf('debt');
  if (debtIdx > 0) {
    ids.add(parts[0]);
  }
  if (row.documentId?.trim()) {
    ids.add(row.documentId.trim());
  }
  return [...ids].filter((id) => DOC_UUID_RE.test(id));
}

/**
 * Pick SaleTransaction lines for a revenue row.
 * Prefer Регистратор (documentId) when it has nomenclature — PA shop sales —
 * otherwise cash/debt основание.
 */
export function pickBasisLinesForRevenueRow(
  row: { externalId: string; documentId: string | null },
  byDoc: Map<string, BasisProductLine[]>,
): BasisProductLine[] {
  const docs = saleDocIdsForRevenueRow(row);
  const withLines = docs
    .map((d) => ({ d, lines: byDoc.get(d) ?? [] }))
    .filter((x) => x.lines.length > 0);
  if (!withLines.length) return [];
  if (withLines.length === 1) return withLines[0]!.lines;

  const docId = row.documentId?.trim();
  if (docId) {
    const byRegistrar = withLines.find((x) => x.d === docId);
    if (byRegistrar) return byRegistrar.lines;
  }

  const parts = row.externalId.split(':');
  const cashIdx = parts.indexOf('cash');
  const osn = cashIdx >= 0 ? parts[cashIdx + 3] : null;
  if (osn) {
    const byOsn = withLines.find((x) => x.d === osn);
    if (byOsn) return byOsn.lines;
  }
  return withLines[0]!.lines;
}

function saleDocUuidFromExternalSaleId(externalSaleId: string): string | null {
  const first = externalSaleId.trim().split(':')[0];
  return first && /^[0-9a-f-]{36}$/i.test(first) ? first : null;
}

/** Cap OR-clause size — one giant OR over thousands of docs spikes CPU/planner. */
const BASIS_DOC_CHUNK = 100;

/** Load SaleTransaction nomenclature lines keyed by 1C sale document UUID. */
export async function loadBasisProductsBySaleDoc(
  prisma: PrismaService,
  clubId: string,
  saleDocIds: string[],
): Promise<Map<string, BasisProductLine[]>> {
  const unique = [...new Set(saleDocIds.filter(Boolean))];
  const map = new Map<string, BasisProductLine[]>();
  if (!unique.length) return map;

  for (let i = 0; i < unique.length; i += BASIS_DOC_CHUNK) {
    const chunk = unique.slice(i, i + BASIS_DOC_CHUNK);
    const rows = await prisma.saleTransaction.findMany({
      where: {
        clubId,
        isActive: true,
        OR: chunk.flatMap((doc) => [
          { externalSaleId: { startsWith: `${doc}:` } },
          { externalSaleId: doc },
        ]),
      },
      select: {
        externalSaleId: true,
        productName: true,
        productExternalId: true,
        productCode: true,
        productGroupName: true,
        saleType: true,
        amount: true,
      },
    });

    for (const r of rows) {
      const doc = saleDocUuidFromExternalSaleId(r.externalSaleId);
      if (!doc) continue;
      const name = (r.productName ?? '').trim();
      if (!name || isGenericPaymentProduct(name)) continue;
      const list = map.get(doc) ?? [];
      list.push({
        productName: name,
        productExternalId: r.productExternalId?.trim() || null,
        productCode: r.productCode?.trim() || null,
        productGroupName: r.productGroupName?.trim() || null,
        saleType: r.saleType?.trim() || null,
        amount: Number(r.amount) || 0,
      });
      map.set(doc, list);
    }
  }
  return map;
}

/** Pick a single display line (largest amount) or join names for UI. */
export function summarizeBasisProducts(lines: BasisProductLine[]): {
  productName: string;
  productExternalId: string | null;
  productCode: string | null;
  productGroupName: string | null;
  saleType: string | null;
} | null {
  if (!lines.length) return null;
  if (lines.length === 1) {
    const L = lines[0]!;
    return {
      productName: L.productName,
      productExternalId: L.productExternalId,
      productCode: L.productCode,
      productGroupName: L.productGroupName,
      saleType: L.saleType,
    };
  }
  const sorted = [...lines].sort((a, b) => b.amount - a.amount);
  const primary = sorted[0]!;
  return {
    productName: sorted.map((l) => l.productName).join(', '),
    productExternalId: primary.productExternalId,
    productCode: primary.productCode,
    productGroupName: primary.productGroupName,
    saleType: primary.saleType,
  };
}

/**
 * Resolve basis nomenclature for generic / mismatched payment rows and persist
 * onto ClubRevenueEntry so list filters and discrepancies see real product names.
 * Pass `preloaded` when the caller already loaded basis (avoids a second query).
 */
export async function enrichGenericPaymentProducts(
  prisma: PrismaService,
  clubId: string,
  rows: Array<{
    id: string;
    externalId: string;
    documentId: string | null;
    productName: string | null;
    productExternalId: string | null;
    productCode: string | null;
    productGroupName: string | null;
    saleType: string | null;
  }>,
  preloaded?: Map<string, BasisProductLine[]>,
): Promise<number> {
  if (!rows.length) return 0;

  const byDoc =
    preloaded ??
    (await loadBasisProductsBySaleDoc(
      prisma,
      clubId,
      rows.flatMap((r) =>
        saleDocIdsForRevenueRow({
          externalId: r.externalId,
          documentId: r.documentId,
        }),
      ),
    ));
  if (!byDoc.size) return 0;

  let updated = 0;
  for (const r of rows) {
    const lines = pickBasisLinesForRevenueRow(
      { externalId: r.externalId, documentId: r.documentId },
      byDoc,
    );
    if (!shouldReplaceProductWithBasis(r.productName, lines)) continue;
    const summary = summarizeBasisProducts(lines);
    if (!summary) continue;
    // Single line → exact nomenclature; several → joined names for list/detail.
    await prisma.clubRevenueEntry.update({
      where: { id: r.id },
      data: {
        productName: summary.productName,
        productExternalId:
          lines.length === 1
            ? (summary.productExternalId ?? r.productExternalId)
            : r.productExternalId,
        productCode:
          lines.length === 1
            ? (summary.productCode ?? r.productCode)
            : r.productCode,
        productGroupName:
          lines.length === 1
            ? (summary.productGroupName ?? r.productGroupName)
            : r.productGroupName,
        saleType: summary.saleType ?? r.saleType,
      },
    });
    r.productName = summary.productName;
    if (lines.length === 1) {
      r.productExternalId = summary.productExternalId ?? r.productExternalId;
      r.productCode = summary.productCode ?? r.productCode;
      r.productGroupName = summary.productGroupName ?? r.productGroupName;
    }
    r.saleType = summary.saleType ?? r.saleType;
    updated += 1;
  }
  return updated;
}
