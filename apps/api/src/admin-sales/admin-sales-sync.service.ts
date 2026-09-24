import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FitgoAnalyticsHttpProvider,
  type FitgoAnalyticsSalesItem,
} from '@fitgo/1c-adapter';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeSaleType } from './admin-sales.util';

const RESOURCE_KEY = 'admin_sales';
/** Rolling window synced each night (covers late payments + deletions). */
const SYNC_LOOKBACK_DAYS = 60;

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

  async syncAllClubs(): Promise<void> {
    const clubs = await this.prisma.club.findMany({ select: { id: true } });
    for (const club of clubs) {
      try {
        await this.syncClub(club.id);
      } catch (err) {
        this.logger.error(
          `Sales sync failed for club ${club.id}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }
  }

  async syncClub(clubId: string): Promise<{
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

    const to = new Date();
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - SYNC_LOOKBACK_DAYS);
    const fromStr = from.toISOString().slice(0, 10);
    const toStr = to.toISOString().slice(0, 10);

    try {
      /**
       * Day-by-day: 1C `amount` = payment allocated inside the requested period.
       * A multi-day window would merge all payments into one amount while paidAt
       * stays a single day — breaking «Оплата с учетом возврата» per day.
       */
      const seen = new Set<string>();
      let upserted = 0;
      const days = eachUtcDay(fromStr, toStr);

      for (const day of days) {
        const items = await this.fetchAllPages(provider, day, day);
        for (const item of items) {
          const baseId = item.saleDocumentId?.trim();
          if (!baseId) continue;

          const saleType = normalizeSaleType(item.saleType, item.productName);
          const soldAt = new Date(item.soldAt);
          const paidAt = item.paidAt ? new Date(item.paidAt) : null;
          const paidDay = paidAt ? paidAt.toISOString().slice(0, 10) : null;

          // One DB row per (line × payment-day); unpaid → sold-day key.
          const externalSaleId = paidDay
            ? `${baseId}:p${paidDay}`
            : `${baseId}:u${soldAt.toISOString().slice(0, 10)}`;

          seen.add(externalSaleId);

          await this.prisma.saleTransaction.upsert({
            where: {
              clubId_externalSaleId: { clubId, externalSaleId },
            },
            create: {
              clubId,
              externalSaleId,
              soldAt,
              paidAt,
              amount: item.amount,
              saleType,
              productName: item.productName ?? null,
              clientExternalId: item.clientExternalId ?? null,
              clientName: item.clientName ?? null,
              employeeExternalId: item.employeeExternalId ?? null,
              employeeName: item.employeeName ?? null,
              paymentMethod: item.paymentMethod ?? null,
              isActive: true,
              syncedAt: new Date(),
            },
            update: {
              soldAt,
              paidAt,
              amount: item.amount,
              saleType,
              productName: item.productName ?? null,
              clientExternalId: item.clientExternalId ?? null,
              clientName: item.clientName ?? null,
              employeeExternalId: item.employeeExternalId ?? null,
              employeeName: item.employeeName ?? null,
              paymentMethod: item.paymentMethod ?? null,
              isActive: true,
              syncedAt: new Date(),
            },
          });
          upserted += 1;
        }
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

  private async fetchAllPages(
    provider: FitgoAnalyticsHttpProvider,
    from: string,
    to: string,
  ): Promise<FitgoAnalyticsSalesItem[]> {
    const pageSize = 200;
    let page = 1;
    const all: FitgoAnalyticsSalesItem[] = [];
    for (;;) {
      const data = await provider.getSales({ from, to, page, pageSize });
      const items = data?.items ?? [];
      all.push(...items);
      const total = data?.total ?? items.length;
      if (all.length >= total || items.length === 0) break;
      page += 1;
      if (page > 500) break;
    }
    return all;
  }
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
