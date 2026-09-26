import { Prisma } from '@prisma/client';
import type { FitgoAnalyticsHttpProvider, FitgoAnalyticsSalesItem } from '@fitgo/1c-adapter';
import type { PrismaService } from '../prisma/prisma.service';

/** Nightly reconciliation window. */
export const SYNC_FULL_LOOKBACK_DAYS = 60;
/** Manual sync re-reads this many days before the last success (late edits). */
export const SYNC_OVERLAP_DAYS = 2;

export type SalesSyncMode = 'incremental' | 'full';

export function syncWindow(
  mode: SalesSyncMode,
  lastSuccessAt: Date | null,
): { from: string; to: string } {
  const to = new Date();
  const toStr = to.toISOString().slice(0, 10);
  const from = new Date(to);
  if (mode === 'full' || !lastSuccessAt) {
    from.setUTCDate(from.getUTCDate() - SYNC_FULL_LOOKBACK_DAYS);
  } else {
    from.setTime(lastSuccessAt.getTime());
    from.setUTCDate(from.getUTCDate() - SYNC_OVERLAP_DAYS);
  }
  let fromStr = from.toISOString().slice(0, 10);
  if (fromStr > toStr) fromStr = toStr;
  return { from: fromStr, to: toStr };
}

/**
 * One 1C query when the published service honors pageSize=0.
 * Older builds cap the page and re-run the query per page — then we page at 500.
 */
export async function fetchSalesOnce(
  provider: FitgoAnalyticsHttpProvider,
  params: {
    from: string;
    to: string;
    scope?: 'cash' | 'debt' | 'changes';
    saleType?: string;
  },
): Promise<FitgoAnalyticsSalesItem[]> {
  const first = await provider.getSales({
    ...params,
    page: 1,
    pageSize: 0,
  });
  const items = first?.items ?? [];
  const total = first?.total ?? items.length;
  if (items.length >= total || items.length === 0) return items;

  const pageSize = 500;
  const all: FitgoAnalyticsSalesItem[] = [];
  let page = 1;
  for (;;) {
    const data = await provider.getSales({ ...params, page, pageSize });
    const chunk = data?.items ?? [];
    all.push(...chunk);
    const n = data?.total ?? chunk.length;
    if (all.length >= n || chunk.length === 0) break;
    page += 1;
    if (page > 100) break;
  }
  return all;
}

type SaleRow = {
  externalSaleId: string;
  soldAt: Date;
  paidAt: Date | null;
  amount: number;
  saleType: string;
  productName: string | null;
  clientExternalId: string | null;
  clientName: string | null;
  employeeExternalId: string | null;
  employeeName: string | null;
  paymentMethod: string | null;
};

export async function upsertSaleRows(
  prisma: PrismaService,
  clubId: string,
  rows: SaleRow[],
): Promise<void> {
  const unique = new Map<string, SaleRow>();
  for (const row of rows) unique.set(row.externalSaleId, row);
  const now = new Date();
  for (const chunk of chunks([...unique.values()], 80)) {
    const values = chunk.map(
      (r) =>
        Prisma.sql`(
          ${crypto.randomUUID()}, ${clubId}, ${r.externalSaleId},
          ${r.soldAt}, ${r.paidAt}, ${r.amount}, ${r.saleType},
          ${r.productName}, ${r.clientExternalId}, ${r.clientName},
          ${r.employeeExternalId}, ${r.employeeName}, ${r.paymentMethod},
          ${true}, ${now}
        )`,
    );
    await prisma.$executeRaw`
      INSERT INTO "SaleTransaction" (
        "id", "clubId", "externalSaleId", "soldAt", "paidAt", "amount",
        "saleType", "productName", "clientExternalId", "clientName",
        "employeeExternalId", "employeeName", "paymentMethod",
        "isActive", "syncedAt"
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("clubId", "externalSaleId") DO UPDATE SET
        "soldAt" = EXCLUDED."soldAt",
        "paidAt" = EXCLUDED."paidAt",
        "amount" = EXCLUDED."amount",
        "saleType" = EXCLUDED."saleType",
        "productName" = EXCLUDED."productName",
        "clientExternalId" = EXCLUDED."clientExternalId",
        "clientName" = EXCLUDED."clientName",
        "employeeExternalId" = EXCLUDED."employeeExternalId",
        "employeeName" = EXCLUDED."employeeName",
        "paymentMethod" = EXCLUDED."paymentMethod",
        "isActive" = true,
        "syncedAt" = EXCLUDED."syncedAt"
    `;
  }
}

type RevenueRow = {
  externalId: string;
  documentId: string | null;
  operationType: string;
  occurredAt: Date;
  paidAt: Date | null;
  saleAmount: number;
  paidAmount: number;
  refundAmount: number;
  amount: number;
  cash: number;
  card: number;
  cashless: number;
  personalAccount: number;
  paymentMethod: string | null;
  saleType: string | null;
  productName: string | null;
  clientExternalId: string | null;
  clientName: string | null;
  employeeExternalId: string | null;
  employeeName: string | null;
  countsTowardIncome: boolean;
  countsTowardMotivation: boolean;
};

export async function upsertRevenueRows(
  prisma: PrismaService,
  clubId: string,
  rows: RevenueRow[],
): Promise<void> {
  const unique = new Map<string, RevenueRow>();
  for (const row of rows) unique.set(row.externalId, row);
  const now = new Date();
  for (const chunk of chunks([...unique.values()], 40)) {
    const values = chunk.map(
      (r) =>
        Prisma.sql`(
          ${crypto.randomUUID()}, ${clubId}, ${r.externalId}, ${r.documentId},
          ${r.operationType}, ${r.occurredAt}, ${r.paidAt},
          ${r.saleAmount}, ${r.paidAmount}, ${r.refundAmount}, ${r.amount},
          ${r.cash}, ${r.card}, ${r.cashless}, ${r.personalAccount},
          ${r.paymentMethod}, ${r.saleType}, ${r.productName},
          ${r.clientExternalId}, ${r.clientName},
          ${r.employeeExternalId}, ${r.employeeName},
          ${r.countsTowardIncome}, ${r.countsTowardMotivation},
          ${true}, ${now}
        )`,
    );
    await prisma.$executeRaw`
      INSERT INTO "ClubRevenueEntry" (
        "id", "clubId", "externalId", "documentId", "operationType",
        "occurredAt", "paidAt", "saleAmount", "paidAmount", "refundAmount",
        "amount", "cash", "card", "cashless", "personalAccount",
        "paymentMethod", "saleType", "productName",
        "clientExternalId", "clientName", "employeeExternalId", "employeeName",
        "countsTowardIncome", "countsTowardMotivation", "isActive", "syncedAt"
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("clubId", "externalId") DO UPDATE SET
        "documentId" = EXCLUDED."documentId",
        "operationType" = EXCLUDED."operationType",
        "occurredAt" = EXCLUDED."occurredAt",
        "paidAt" = EXCLUDED."paidAt",
        "saleAmount" = EXCLUDED."saleAmount",
        "paidAmount" = EXCLUDED."paidAmount",
        "refundAmount" = EXCLUDED."refundAmount",
        "amount" = EXCLUDED."amount",
        "cash" = EXCLUDED."cash",
        "card" = EXCLUDED."card",
        "cashless" = EXCLUDED."cashless",
        "personalAccount" = EXCLUDED."personalAccount",
        "paymentMethod" = EXCLUDED."paymentMethod",
        "saleType" = EXCLUDED."saleType",
        "productName" = EXCLUDED."productName",
        "clientExternalId" = EXCLUDED."clientExternalId",
        "clientName" = EXCLUDED."clientName",
        "employeeExternalId" = EXCLUDED."employeeExternalId",
        "employeeName" = EXCLUDED."employeeName",
        "countsTowardIncome" = EXCLUDED."countsTowardIncome",
        "countsTowardMotivation" = EXCLUDED."countsTowardMotivation",
        "isActive" = true,
        "syncedAt" = EXCLUDED."syncedAt"
    `;
  }
}

/**
 * Журнал 1С за дни событий [from, to].
 * Удаление и правка гасят строки кэша по UUID документа.
 * Если дата документа вне окна синка — вернуть этот день, чтобы перечитать только его.
 * Старая публикация без scope=changes отдаёт обычные продажи: их operationType пропускаем.
 * Гасим только свою таблицу: дни для перечитывания получает лишь вызвавший синк,
 * иначе строки другой таблицы с датой вне её окна пропадут до ночного full.
 */
export async function applyChangeLog(
  prisma: PrismaService,
  provider: FitgoAnalyticsHttpProvider,
  clubId: string,
  from: string,
  to: string,
  target: 'sales' | 'revenue',
): Promise<string[]> {
  let items: FitgoAnalyticsSalesItem[] = [];
  try {
    items = await fetchSalesOnce(provider, { from, to, scope: 'changes' });
  } catch {
    return [];
  }

  const refresh = new Set<string>();
  const seen = new Set<string>();
  const now = new Date();
  for (const item of items) {
    const action = item.operationType;
    if (action !== 'delete' && action !== 'update') continue;
    const id = (item.documentId || item.saleDocumentId || '').trim();
    if (!id) continue;
    const key = `${action}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const prefix = `${id}:`;
    if (target === 'sales') {
      await prisma.saleTransaction.updateMany({
        where: {
          clubId,
          isActive: true,
          externalSaleId: { startsWith: prefix },
        },
        data: { isActive: false, syncedAt: now },
      });
    } else {
      await prisma.clubRevenueEntry.updateMany({
        where: {
          clubId,
          isActive: true,
          OR: [{ documentId: id }, { externalId: { startsWith: prefix } }],
        },
        data: { isActive: false, syncedAt: now },
      });
    }

    if (action === 'update' && item.soldAt) {
      const day = item.soldAt.slice(0, 10);
      if (day < from || day > to) refresh.add(day);
    }
  }
  return [...refresh];
}

export function eachUtcDay(fromStr: string, toStr: string): string[] {
  const days: string[] = [];
  const cur = new Date(`${fromStr}T00:00:00.000Z`);
  const end = new Date(`${toStr}T00:00:00.000Z`);
  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
