import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FitgoAnalyticsHttpProvider } from '@fitgo/1c-adapter';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeSaleType } from './admin-sales.util';
import {
  applyChangeLog,
  fetchSalesOnce,
  syncWindow,
  upsertSaleRows,
  type SalesSyncMode,
} from './sales-sync-window';

const RESOURCE_KEY = 'admin_sales';

@Injectable()
export class AdminSalesSyncService {
  private readonly logger = new Logger(AdminSalesSyncService.name);

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

  async syncAllClubs(mode: SalesSyncMode = 'full'): Promise<void> {
    const clubs = await this.prisma.club.findMany({ select: { id: true } });
    for (const club of clubs) {
      try {
        await this.syncClub(club.id, mode);
      } catch (err) {
        this.logger.error(
          `Sales sync failed for club ${club.id}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }
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
      /**
       * Day-by-day: 1C `amount` = payment allocated inside the requested period.
       * A multi-day window would merge all payments into one amount while paidAt
       * stays a single day — breaking «Оплата с учетом возврата» per day.
       */
      const seen = new Set<string>();
      /** Bases with a payment this sync — refresh residual unpaid for debt carry. */
      const paidBases = new Map<
        string,
        {
          soldAt: Date;
          saleAmount: number;
          saleType: string;
          productName: string | null;
          clientExternalId: string | null;
          clientName: string | null;
          employeeExternalId: string | null;
          employeeName: string | null;
          paymentMethod: string | null;
        }
      >();
      const pending: Parameters<typeof upsertSaleRows>[2] = [];
      const refreshDays = await applyChangeLog(
        this.prisma,
        provider,
        clubId,
        fromStr,
        toStr,
      );
      const days = [
        ...new Set([...eachUtcDay(fromStr, toStr), ...refreshDays]),
      ].sort();

      for (const day of days) {
        const items = await fetchSalesOnce(provider, { from: day, to: day });
        for (const item of items) {
          const baseId = item.saleDocumentId?.trim();
          if (!baseId) continue;

          const saleType = normalizeSaleType(item.saleType, item.productName);
          const soldAt = new Date(item.soldAt);
          const paidAt = item.paidAt ? new Date(item.paidAt) : null;
          const paidDay = paidAt ? paidAt.toISOString().slice(0, 10) : null;
          const amount = Number(item.amount) || 0;
          const saleAmount =
            Number(item.saleAmount) ||
            (paidDay ? 0 : amount) ||
            Number(item.paidAmount) ||
            0;

          // One DB row per (line × payment-day); unpaid → sold-day key.
          const externalSaleId = paidDay
            ? `${baseId}:p${paidDay}`
            : `${baseId}:u${soldAt.toISOString().slice(0, 10)}`;

          seen.add(externalSaleId);
          pending.push({
            externalSaleId,
            soldAt,
            paidAt,
            amount,
            saleType,
            productName: item.productName ?? null,
            clientExternalId: item.clientExternalId ?? null,
            clientName: item.clientName ?? null,
            employeeExternalId: item.employeeExternalId ?? null,
            employeeName: item.employeeName ?? null,
            paymentMethod: item.paymentMethod ?? null,
          });

          if (paidDay) {
            const prev = paidBases.get(baseId);
            paidBases.set(baseId, {
              soldAt,
              saleAmount: Math.max(saleAmount, prev?.saleAmount ?? 0),
              saleType,
              productName: item.productName ?? null,
              clientExternalId: item.clientExternalId ?? null,
              clientName: item.clientName ?? null,
              employeeExternalId: item.employeeExternalId ?? null,
              employeeName: item.employeeName ?? null,
              paymentMethod: item.paymentMethod ?? null,
            });
          }
        }
      }

      await upsertSaleRows(this.prisma, clubId, pending);
      const upserted = pending.length;

      for (const [baseId, meta] of paidBases) {
        const residualId = await reconcileAdminUnpaid(
          this.prisma,
          clubId,
          baseId,
          meta,
        );
        if (residualId) seen.add(residualId);
      }

      const windowStart = new Date(`${fromStr}T00:00:00.000Z`);
      const windowEnd = new Date(`${toStr}T23:59:59.999Z`);
      const existing = await this.prisma.saleTransaction.findMany({
        where: {
          clubId,
          isActive: true,
          OR: [
            { soldAt: { gte: windowStart, lte: windowEnd } },
            { paidAt: { gte: windowStart, lte: windowEnd } },
          ],
        },
        select: { id: true, externalSaleId: true },
      });
      const toDeactivate = existing
        .filter((r) => !seen.has(r.externalSaleId))
        .map((r) => r.id);
      let deactivated = 0;
      if (toDeactivate.length) {
        const res = await this.prisma.saleTransaction.updateMany({
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
        `Sales sync club=${clubId} upserted=${upserted} deactivated=${deactivated} window=${fromStr}..${toStr} days=${days.length}`,
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
 * Payment for a sale line → clear stale unpaid; keep residual until fully paid.
 * Payroll uses only paid rows (paidAt in period).
 */
async function reconcileAdminUnpaid(
  prisma: PrismaService,
  clubId: string,
  baseId: string,
  meta: {
    soldAt: Date;
    saleAmount: number;
    saleType: string;
    productName: string | null;
    clientExternalId: string | null;
    clientName: string | null;
    employeeExternalId: string | null;
    employeeName: string | null;
    paymentMethod: string | null;
  },
): Promise<string | null> {
  const priorUnpaid = await prisma.saleTransaction.findMany({
    where: {
      clubId,
      isActive: true,
      externalSaleId: { startsWith: `${baseId}:u` },
    },
    select: { amount: true, soldAt: true },
  });

  await prisma.saleTransaction.updateMany({
    where: {
      clubId,
      isActive: true,
      externalSaleId: { startsWith: `${baseId}:u` },
    },
    data: { isActive: false, syncedAt: new Date() },
  });

  const payments = await prisma.saleTransaction.findMany({
    where: {
      clubId,
      isActive: true,
      externalSaleId: { startsWith: `${baseId}:p` },
    },
    select: { amount: true, soldAt: true },
  });
  if (!payments.length) return null;

  const paidSum = payments.reduce((s, r) => s + (r.amount || 0), 0);
  const saleAmt = Math.max(
    meta.saleAmount,
    ...priorUnpaid.map((r) => r.amount || 0),
    paidSum,
  );
  const residual = Math.round((saleAmt - paidSum) * 100) / 100;
  if (residual <= 0.009) return null;

  const soldAt =
    priorUnpaid[0]?.soldAt ??
    payments.reduce<Date | null>((min, r) => {
      if (!min || r.soldAt < min) return r.soldAt;
      return min;
    }, null) ??
    meta.soldAt;
  const externalSaleId = `${baseId}:u${soldAt.toISOString().slice(0, 10)}`;

  await prisma.saleTransaction.upsert({
    where: { clubId_externalSaleId: { clubId, externalSaleId } },
    create: {
      clubId,
      externalSaleId,
      soldAt,
      paidAt: null,
      amount: residual,
      saleType: meta.saleType,
      productName: meta.productName,
      clientExternalId: meta.clientExternalId,
      clientName: meta.clientName,
      employeeExternalId: meta.employeeExternalId,
      employeeName: meta.employeeName,
      paymentMethod: meta.paymentMethod,
      isActive: true,
      syncedAt: new Date(),
    },
    update: {
      soldAt,
      paidAt: null,
      amount: residual,
      saleType: meta.saleType,
      productName: meta.productName,
      clientExternalId: meta.clientExternalId,
      clientName: meta.clientName,
      employeeExternalId: meta.employeeExternalId,
      employeeName: meta.employeeName,
      isActive: true,
      syncedAt: new Date(),
    },
  });
  return externalSaleId;
}

function eachUtcDay(fromStr: string, toStr: string): string[] {
  const days: string[] = [];
  const cur = new Date(`${fromStr}T00:00:00.000Z`);
  const end = new Date(`${toStr}T00:00:00.000Z`);
  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}
