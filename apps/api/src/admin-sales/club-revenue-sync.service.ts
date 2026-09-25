import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FitgoAnalyticsHttpProvider,
  type FitgoAnalyticsSalesItem,
} from '@fitgo/1c-adapter';
import { PrismaService } from '../prisma/prisma.service';
import {
  applyChangeLog,
  fetchSalesOnce,
  syncWindow,
  upsertRevenueRows,
  type SalesSyncMode,
} from './sales-sync-window';

const RESOURCE_KEY = 'club_revenue';

@Injectable()
export class ClubRevenueSyncService {
  private readonly logger = new Logger(ClubRevenueSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private createProvider(): FitgoAnalyticsHttpProvider | null {
    const baseUrl = this.config.get<string>('FORMA_ANALYTICS_URL')?.trim();
    const apiKey = this.config.get<string>('FORMA_API_KEY')?.trim();
    const basicAuth = this.config.get<string>('FORMA_BASIC_AUTH')?.trim();
    if (!baseUrl || !apiKey || !basicAuth) return null;
    return new FitgoAnalyticsHttpProvider({ baseUrl, apiKey, basicAuth });
  }

  async syncClub(
    clubId: string,
    mode: SalesSyncMode = 'incremental',
  ): Promise<{
    upserted: number;
    deactivated: number;
    from: string;
    to: string;
  }> {
    const provider = this.createProvider();
    const state = await this.prisma.salesSyncState.upsert({
      where: {
        clubId_resourceKey: { clubId, resourceKey: RESOURCE_KEY },
      },
      create: { clubId, resourceKey: RESOURCE_KEY, lastStatus: 'running' },
      update: { lastRunAt: new Date(), lastStatus: 'running', lastError: null },
    });

    if (!provider) {
      await this.prisma.salesSyncState.update({
        where: { id: state.id },
        data: {
          lastStatus: 'skipped',
          lastError: 'FORMA_ANALYTICS_URL not configured',
          lastRunAt: new Date(),
        },
      });
      return { upserted: 0, deactivated: 0, from: '', to: '' };
    }

    const { from: fromStr, to: toStr } = syncWindow(mode, state.lastSuccessAt);

    try {
      const seen = new Set<string>();
      /** baseIds that received a payment in this sync — reconcile residual unpaid */
      const paidBaseIds = new Set<string>();
      const pending: Parameters<typeof upsertRevenueRows>[2] = [];
      const refreshDays = await applyChangeLog(
        this.prisma,
        provider,
        clubId,
        fromStr,
        toStr,
      );
      // Cash movements are already dated. One query for the window, plus touched old days.
      const items = await fetchSalesOnce(provider, {
        from: fromStr,
        to: toStr,
        scope: 'cash',
      });
      for (const day of refreshDays) {
        const extra = await fetchSalesOnce(provider, {
          from: day,
          to: day,
          scope: 'cash',
        });
        items.push(...extra);
      }
      for (const item of items) {
        const baseId = item.saleDocumentId?.trim();
        if (!baseId) continue;

        const mapped = mapItem(item);
        const paidDay = mapped.paidAt
          ? mapped.paidAt.toISOString().slice(0, 10)
          : null;
        const occurredDay = mapped.occurredAt.toISOString().slice(0, 10);
        const externalId = paidDay
          ? `${baseId}:p${paidDay}`
          : `${baseId}:u${occurredDay}`;

        seen.add(externalId);
        if (paidDay) paidBaseIds.add(baseId);
        pending.push({ externalId, ...mapped });
      }
      await upsertRevenueRows(this.prisma, clubId, pending);
      const upserted = pending.length;

      // After payments: drop stale unpaid, keep residual debt until fully paid
      for (const baseId of paidBaseIds) {
        const residualId = await reconcileClubUnpaid(
          this.prisma,
          clubId,
          baseId,
        );
        if (residualId) seen.add(residualId);
      }

      const windowStart = new Date(`${fromStr}T00:00:00.000Z`);
      const windowEnd = new Date(`${toStr}T23:59:59.999Z`);
      const existing = await this.prisma.clubRevenueEntry.findMany({
        where: {
          clubId,
          isActive: true,
          OR: [
            { occurredAt: { gte: windowStart, lte: windowEnd } },
            { paidAt: { gte: windowStart, lte: windowEnd } },
          ],
        },
        select: { id: true, externalId: true },
      });
      const toDeactivate = existing
        .filter((r) => !seen.has(r.externalId))
        .map((r) => r.id);
      let deactivated = 0;
      if (toDeactivate.length) {
        const res = await this.prisma.clubRevenueEntry.updateMany({
          where: { id: { in: toDeactivate } },
          data: { isActive: false, syncedAt: new Date() },
        });
        deactivated = res.count;
      }

      await this.prisma.salesSyncState.update({
        where: { id: state.id },
        data: {
          cursor: toStr,
          lastStatus: 'ok',
          lastSuccessAt: new Date(),
          lastRunAt: new Date(),
          lastError: null,
        },
      });

      this.logger.log(
        `Club revenue sync club=${clubId} upserted=${upserted} deactivated=${deactivated} window=${fromStr}..${toStr}`,
      );
      return { upserted, deactivated, from: fromStr, to: toStr };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.salesSyncState.update({
        where: { id: state.id },
        data: {
          lastStatus: 'error',
          lastError: message.slice(0, 500),
          lastRunAt: new Date(),
        },
      });
      throw err;
    }
  }

}

/**
 * Payment arrived for a sale line → clear old unpaid rows and, if not fully paid,
 * keep a residual unpaid row (debt carries to later periods; ЗП only on paid slice).
 */
async function reconcileClubUnpaid(
  prisma: PrismaService,
  clubId: string,
  baseId: string,
): Promise<string | null> {
  await prisma.clubRevenueEntry.updateMany({
    where: {
      clubId,
      isActive: true,
      externalId: { startsWith: `${baseId}:u` },
    },
    data: { isActive: false, syncedAt: new Date() },
  });

  const payments = await prisma.clubRevenueEntry.findMany({
    where: {
      clubId,
      isActive: true,
      externalId: { startsWith: `${baseId}:p` },
    },
  });
  if (!payments.length) return null;

  const paidSum = payments.reduce(
    (s, r) => s + (r.paidAmount || r.amount || 0),
    0,
  );
  const saleAmt = Math.max(
    ...payments.map((r) => r.saleAmount || 0),
    paidSum,
  );
  const residual = Math.round((saleAmt - paidSum) * 100) / 100;
  if (residual <= 0.009) return null;

  const template = payments[0]!;
  const occurredAt = template.occurredAt;
  const occurredDay = occurredAt.toISOString().slice(0, 10);
  const externalId = `${baseId}:u${occurredDay}`;

  await prisma.clubRevenueEntry.upsert({
    where: { clubId_externalId: { clubId, externalId } },
    create: {
      clubId,
      externalId,
      documentId: template.documentId,
      operationType: 'unpaid',
      occurredAt,
      paidAt: null,
      saleAmount: residual,
      paidAmount: 0,
      refundAmount: 0,
      amount: residual,
      cash: 0,
      card: 0,
      cashless: 0,
      personalAccount: 0,
      paymentMethod: 'unknown',
      saleType: template.saleType,
      productName: template.productName,
      clientExternalId: template.clientExternalId,
      clientName: template.clientName,
      employeeExternalId: template.employeeExternalId,
      employeeName: template.employeeName,
      countsTowardIncome: false,
      countsTowardMotivation: false,
      isActive: true,
      syncedAt: new Date(),
    },
    update: {
      operationType: 'unpaid',
      occurredAt,
      paidAt: null,
      saleAmount: residual,
      paidAmount: 0,
      amount: residual,
      cash: 0,
      card: 0,
      cashless: 0,
      personalAccount: 0,
      isActive: true,
      syncedAt: new Date(),
    },
  });
  return externalId;
}

function mapItem(item: FitgoAnalyticsSalesItem) {
  const operationType = normalizeOperationType(item);
  const saleAmount = num(item.saleAmount ?? (operationType === 'unpaid' ? item.amount : 0));
  const paidAmount = num(item.paidAmount);
  const refundAmount = num(item.refundAmount);
  const cash = num(item.cash);
  const card = num(item.card);
  const cashless = num(item.cashless);
  const personalAccount = num(item.personalAccount);
  const countsTowardIncome =
    item.countsTowardIncome ??
    (operationType === 'payment' ||
      operationType === 'personal_deposit' ||
      operationType === 'refund');
  const countsTowardMotivation =
    item.countsTowardMotivation ??
    (operationType === 'payment' || operationType === 'personal_deposit');

  return {
    documentId: item.documentId?.trim() || null,
    operationType,
    occurredAt: new Date(item.soldAt),
    paidAt: item.paidAt ? new Date(item.paidAt) : null,
    saleAmount,
    paidAmount,
    refundAmount,
    amount: num(item.amount),
    cash,
    card,
    cashless,
    personalAccount,
    paymentMethod: item.paymentMethod?.trim() || inferPaymentMethod(cash, card, cashless, personalAccount),
    saleType: item.saleType?.trim() || null,
    productName: item.productName?.trim() || null,
    clientExternalId: item.clientExternalId?.trim() || null,
    clientName: item.clientName?.trim() || null,
    employeeExternalId: item.employeeExternalId?.trim() || null,
    employeeName: item.employeeName?.trim() || null,
    countsTowardIncome,
    countsTowardMotivation,
    isActive: true,
  };
}

function normalizeOperationType(item: FitgoAnalyticsSalesItem): string {
  const raw = (item.operationType ?? '').trim();
  if (
    raw === 'payment' ||
    raw === 'unpaid' ||
    raw === 'refund' ||
    raw === 'sale' ||
    raw === 'personal_deposit' ||
    raw === 'personal_credit' ||
    raw === 'personal_burn'
  ) {
    return raw;
  }
  const refund = num(item.refundAmount);
  const paid = num(item.paidAmount);
  const sale = num(item.saleAmount ?? item.amount);
  if (refund > 0 && sale <= 0) return 'refund';
  if (paid <= 0 && sale > 0) return 'unpaid';
  if (paid > 0) return 'payment';
  return 'sale';
}

function inferPaymentMethod(
  cash: number,
  card: number,
  cashless: number,
  personalAccount: number,
): string {
  const parts = [
    cash > 0,
    card > 0,
    cashless > 0,
    personalAccount > 0,
  ].filter(Boolean).length;
  if (parts > 1) return 'mixed';
  if (card > 0) return 'card';
  if (cash > 0) return 'cash';
  if (cashless > 0) return 'cashless';
  if (personalAccount > 0) return 'personalAccount';
  return 'unknown';
}

function num(v: number | undefined | null): number {
  if (v == null || Number.isNaN(Number(v))) return 0;
  return Number(v);
}
