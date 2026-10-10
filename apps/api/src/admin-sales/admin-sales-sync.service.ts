import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FitgoAnalyticsHttpProvider,
  type FitgoAnalyticsSalesItem,
} from '@fitgo/1c-adapter';
import { moscowDayKey, parseClubWallClock } from '../club-sync/moscow-time';
import { PrismaService } from '../prisma/prisma.service';
import {
  classifySaleType,
  loadPayrollSegmentSets,
} from './admin-sales-segments';
import { isCollectibleClientDebt } from './club-revenue-debt';
import {
  applyChangeLog,
  eachUtcDay,
  fetchSalesOnce,
  syncWindow,
  upsertSaleRows,
  type SalesSyncMode,
} from './sales-sync-window';

const RESOURCE_KEY = 'admin_sales';

export type SalesRangeOptions = {
  /** Historical backfill: skip 1C change-log (sealed years). */
  skipChangeLog?: boolean;
  /** Pause between day fetches to ease 1C load (ms). */
  delayMsBetweenDays?: number;
  /**
   * Skip register debt cleanup of SaleTransaction unpaid.
   * Default false — drop ghost unpaid not in Analytics scope=debt.
   */
  skipDebtCleanup?: boolean;
};

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

  /**
   * Manual LIGHT refresh: yesterday–today only, no change-log fan-out.
   * Never expands to the 60-day lookback used when lastSuccessAt is null.
   */
  async syncClubQuick(clubId: string): Promise<{
    upserted: number;
    deactivated: number;
    from: string;
    to: string;
  }> {
    const to = new Date();
    const toStr = to.toISOString().slice(0, 10);
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - 1);
    const fromStr = from.toISOString().slice(0, 10);

    const state = await this.prisma.salesSyncState.upsert({
      where: {
        clubId_resourceKey: { clubId, resourceKey: RESOURCE_KEY },
      },
      create: { clubId, resourceKey: RESOURCE_KEY, lastStatus: 'running' },
      update: { lastRunAt: new Date(), lastStatus: 'running', lastError: null },
    });

    if (!this.createProvider()) {
      await this.prisma.salesSyncState.update({
        where: { id: state.id },
        data: {
          lastStatus: 'skipped',
          lastError: 'FORMA_ANALYTICS_URL not configured',
          lastRunAt: new Date(),
        },
      });
      return { upserted: 0, deactivated: 0, from: fromStr, to: toStr };
    }

    try {
      const result = await this.syncClubRange(clubId, fromStr, toStr, {
        skipChangeLog: true,
      });
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
      return result;
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
      const result = await this.syncClubRange(clubId, fromStr, toStr, {});
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
      return result;
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

  /**
   * Sync a fixed date range without touching operational SalesSyncState
   * (lastSuccessAt). Used by historical backfill.
   */
  async syncClubRange(
    clubId: string,
    fromStr: string,
    toStr: string,
    options: SalesRangeOptions = {},
  ): Promise<{
    upserted: number;
    deactivated: number;
    from: string;
    to: string;
  }> {
    const provider = this.createProvider();
    if (!provider) {
      return { upserted: 0, deactivated: 0, from: fromStr, to: toStr };
    }

    /**
     * Day-by-day: 1C `amount` = payment allocated inside the requested period.
     * A multi-day window would merge all payments into one amount while paidAt
     * stays a single day — breaking «Оплата с учетом возврата» per day.
     */
    const seen = new Set<string>();
    const pending: Parameters<typeof upsertSaleRows>[2] = [];
    const refreshDays = options.skipChangeLog
      ? []
      : await applyChangeLog(
          this.prisma,
          provider,
          clubId,
          fromStr,
          toStr,
          'sales',
        );
    const days = [
      ...new Set([...eachUtcDay(fromStr, toStr), ...refreshDays]),
    ].sort();
    const delay = Math.max(0, options.delayMsBetweenDays ?? 0);
    const segments = await loadPayrollSegmentSets(this.config);

    for (let i = 0; i < days.length; i++) {
      const day = days[i]!;
      if (i > 0 && delay > 0) await sleep(delay);
      const items = await fetchSalesOnce(provider, { from: day, to: day });
      for (const item of items) {
        const baseId = item.saleDocumentId?.trim();
        if (!baseId) continue;

        const soldAt = parseClubWallClock(item.soldAt);
        if (!soldAt) continue;
        const paidAt = parseClubWallClock(item.paidAt);
        // Paid rows only. Open debt lives in ClubRevenue (scope=debt);
        // writing unpaid here left ghosts outside the sync window.
        if (!paidAt) continue;

        const saleType = classifySaleType(
          item.saleType,
          item.productName,
          segments,
        );
        const paidDay = moscowDayKey(paidAt);
        const amount = Number(item.amount) || 0;
        const cash = Number(item.cash) || 0;
        const card = Number(item.card) || 0;
        const cashless = Number(item.cashless) || 0;
        const personalAccount = Number(item.personalAccount) || 0;

        const externalSaleId = `${baseId}:p${paidDay}`;

        seen.add(externalSaleId);
        pending.push({
          externalSaleId,
          soldAt,
          paidAt,
          amount,
          cash,
          card,
          cashless,
          personalAccount,
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

    await upsertSaleRows(this.prisma, clubId, pending);
    const upserted = pending.length;

    const windowStart = new Date(`${fromStr}T00:00:00.000Z`);
    const windowEnd = new Date(`${toStr}T23:59:59.999Z`);
    const existing = await this.prisma.saleTransaction.findMany({
      where: {
        clubId,
        isActive: true,
        paidAt: { not: null },
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

    let debtDropped = 0;
    if (!options.skipDebtCleanup) {
      debtDropped = await deactivateStaleSaleUnpaid(
        this.prisma,
        provider,
        clubId,
        toStr,
      );
      deactivated += debtDropped;
    }

    this.logger.log(
      `Sales range club=${clubId} upserted=${upserted} deactivated=${deactivated} debtDropped=${debtDropped} window=${fromStr}..${toStr} days=${days.length}`,
    );
    return { upserted, deactivated, from: fromStr, to: toStr };
  }
}

/** UUID of the sale document from Analytics debt / sale keys. */
function saleDocumentUuid(
  item: Pick<FitgoAnalyticsSalesItem, 'saleDocumentId' | 'documentId'>,
): string | null {
  const doc = item.documentId?.trim();
  if (doc && /^[0-9a-f-]{36}$/i.test(doc)) return doc.toLowerCase();
  const first = (item.saleDocumentId ?? '').trim().split(':')[0];
  if (first && /^[0-9a-f-]{36}$/i.test(first)) return first.toLowerCase();
  return null;
}

function externalSaleDocUuid(externalSaleId: string): string | null {
  const first = externalSaleId.trim().split(':')[0];
  if (first && /^[0-9a-f-]{36}$/i.test(first)) return first.toLowerCase();
  return null;
}

/**
 * Drop SaleTransaction unpaid not present in Analytics scope=debt.
 * Same register as ClubRevenue unpaid / 1C «Неоплаченные».
 */
async function deactivateStaleSaleUnpaid(
  prisma: PrismaService,
  provider: FitgoAnalyticsHttpProvider,
  clubId: string,
  asOf: string,
): Promise<number> {
  let debtItems: FitgoAnalyticsSalesItem[];
  try {
    debtItems = await fetchSalesOnce(provider, {
      from: asOf,
      to: asOf,
      scope: 'debt',
    });
  } catch {
    return 0;
  }
  const debtSnapshot = debtItems.some((i) =>
    (i.saleDocumentId ?? '').includes(':debt:'),
  );
  if (!debtSnapshot) return 0;

  const liveDocs = new Set<string>();
  for (const item of debtItems) {
    if ((item.operationType ?? 'unpaid') !== 'unpaid') continue;
    const id = item.saleDocumentId ?? '';
    if (
      !isCollectibleClientDebt({
        externalId: id,
        productName: item.productName,
      })
    ) {
      continue;
    }
    const doc = saleDocumentUuid(item);
    if (doc) liveDocs.add(doc);
  }

  const unpaid = await prisma.saleTransaction.findMany({
    where: {
      clubId,
      isActive: true,
      paidAt: null,
    },
    select: { id: true, externalSaleId: true },
  });
  const dropIds = unpaid
    .filter((r) => {
      const doc = externalSaleDocUuid(r.externalSaleId);
      return !doc || !liveDocs.has(doc);
    })
    .map((r) => r.id);
  if (!dropIds.length) return 0;

  let dropped = 0;
  const chunk = 500;
  for (let i = 0; i < dropIds.length; i += chunk) {
    const slice = dropIds.slice(i, i + chunk);
    const res = await prisma.saleTransaction.updateMany({
      where: { id: { in: slice } },
      data: { isActive: false, syncedAt: new Date() },
    });
    dropped += res.count;
  }
  return dropped;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
