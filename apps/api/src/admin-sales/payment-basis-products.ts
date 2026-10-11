import type { PrismaService } from '../prisma/prisma.service';

/** Cash-scope labels from Analytics when nomenclature is not on the payment row. */
const GENERIC_PAYMENT_NAMES = new Set([
  'оплата от клиента',
  'возврат',
]);

export type BasisProductLine = {
  productName: string;
  productExternalId: string | null;
  productCode: string | null;
  productGroupName: string | null;
  saleType: string | null;
  amount: number;
};

export function isGenericPaymentProduct(
  name: string | null | undefined,
): boolean {
  const n = (name ?? '').trim().toLowerCase();
  return !n || GENERIC_PAYMENT_NAMES.has(n);
}

/**
 * Sale document UUID from club-revenue externalId / documentId.
 * cash: `payDoc:cash:Тип:client:saleDoc:ts:op…`
 * debt: `saleDoc:debt:client`
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
  if (row.documentId && !parts.includes('cash')) {
    ids.add(row.documentId);
  }
  return [...ids].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
}

function saleDocUuidFromExternalSaleId(externalSaleId: string): string | null {
  const first = externalSaleId.trim().split(':')[0];
  return first && /^[0-9a-f-]{36}$/i.test(first) ? first : null;
}

/** Load SaleTransaction nomenclature lines keyed by 1C sale document UUID. */
export async function loadBasisProductsBySaleDoc(
  prisma: PrismaService,
  clubId: string,
  saleDocIds: string[],
): Promise<Map<string, BasisProductLine[]>> {
  const unique = [...new Set(saleDocIds.filter(Boolean))];
  const map = new Map<string, BasisProductLine[]>();
  if (!unique.length) return map;

  const rows = await prisma.saleTransaction.findMany({
    where: {
      clubId,
      isActive: true,
      OR: unique.flatMap((doc) => [
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
 * Resolve basis nomenclature for generic payment rows and persist onto
 * ClubRevenueEntry so list filters and discrepancies see real product names.
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
): Promise<number> {
  const need = rows.filter((r) => isGenericPaymentProduct(r.productName));
  if (!need.length) return 0;

  const saleDocIds = need.flatMap((r) =>
    saleDocIdsForRevenueRow({
      externalId: r.externalId,
      documentId: r.documentId,
    }),
  );
  const byDoc = await loadBasisProductsBySaleDoc(prisma, clubId, saleDocIds);
  if (!byDoc.size) return 0;

  let updated = 0;
  for (const r of need) {
    const docs = saleDocIdsForRevenueRow({
      externalId: r.externalId,
      documentId: r.documentId,
    });
    const lines = docs.flatMap((d) => byDoc.get(d) ?? []);
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
