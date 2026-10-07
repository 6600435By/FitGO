import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FitgoAnalyticsHttpProvider,
  type FitgoAnalyticsSalesItem,
} from '@fitgo/1c-adapter';
import {
  moscowDayKey,
  moscowParts,
  parseClubWallClock,
} from '../club-sync/moscow-time';
import { isCollectibleClientDebt } from './club-revenue-debt';
import { PrismaService } from '../prisma/prisma.service';
import {
  applyChangeLog,
  eachUtcDay,
  fetchSalesOnce,
  syncWindow,
  upsertRevenueRows,
  type SalesSyncMode,
} from './sales-sync-window';

const RESOURCE_KEY = 'club_revenue';

export type RevenueRangeOptions = {
  skipChangeLog?: boolean;
  /** Historical backfill: cash movements only — no debt snapshot / unpaid days. */
  skipDebt?: boolean;
  /** Skip global cleanup of pre-:cash: rows (unsafe mid-backfill). */
  skipLegacyCleanup?: boolean;
  delayMsBetweenDays?: number;
};

@Injectable()
export class ClubRevenueSyncService {
  private readonly logger = new Logger(ClubRevenueSyncService.name);
  /** Prevent stacked day-by-day 1C Analytics pulls when dashboard/UI re-triggers sync. */
  private readonly inFlight = new Set<string>();

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

  isSyncing(clubId: string): boolean {
    return this.inFlight.has(clubId);
  }

  /**
   * Lightweight pull for dashboard / UI: today + 1 day overlap only.
   * Never runs a 60-day lookback from a page load.
   */
  async syncClubQuick(clubId: string): Promise<{
    upserted: number;
    deactivated: number;
    from: string;
    to: string;
  }> {
    if (this.inFlight.has(clubId)) {
      this.logger.warn(`Club revenue sync already running for ${clubId} — skip quick`);
      return { upserted: 0, deactivated: 0, from: '', to: '' };
    }
    this.inFlight.add(clubId);
    try {
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
        update: {
          lastRunAt: new Date(),
          lastStatus: 'running',
          lastError: null,
        },
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
    } finally {
      this.inFlight.delete(clubId);
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
    if (this.inFlight.has(clubId)) {
      this.logger.warn(`Club revenue sync already running for ${clubId} — skip`);
      return { upserted: 0, deactivated: 0, from: '', to: '' };
    }
    this.inFlight.add(clubId);
    try {
      return await this.syncClubLocked(clubId, mode);
    } finally {
      this.inFlight.delete(clubId);
    }
  }

  private async syncClubLocked(
    clubId: string,
    mode: SalesSyncMode,
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
   * Fixed range without updating operational lastSuccessAt.
   * Backfill: skipDebt + skipChangeLog + skipLegacyCleanup.
   */
  async syncClubRange(
    clubId: string,
    fromStr: string,
    toStr: string,
    options: RevenueRangeOptions = {},
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

    const seen = new Set<string>();
    const paidBaseIds = new Set<string>();
    const pending = new Map<
      string,
      Parameters<typeof upsertRevenueRows>[2][number]
    >();
    const refreshDays = options.skipChangeLog
      ? []
      : await applyChangeLog(
          this.prisma,
          provider,
          clubId,
          fromStr,
          toStr,
          'revenue',
        );
    // Day by day: 1C re-runs the unordered register query for every page, so a
    // multi-page window can duplicate some movements and skip others. A day fits one page.
    const days = [
      ...new Set([...eachUtcDay(fromStr, toStr), ...refreshDays]),
    ].sort();
    const delay = Math.max(0, options.delayMsBetweenDays ?? 0);
    const items: FitgoAnalyticsSalesItem[] = [];
    for (let i = 0; i < days.length; i++) {
      const day = days[i]!;
      if (i > 0 && delay > 0) await sleep(delay);
      items.push(
        ...(await fetchSalesOnce(provider, {
          from: day,
          to: day,
          scope: 'cash',
        })),
      );
    }

    let debtSnapshot = false;
    if (!options.skipDebt) {
      // Open debt: prefer register balances (scope=debt). Old BSL falls through to
      // /sales for one day — then we pull unpaid lines day-by-day instead.
      try {
        const debtItems = await fetchSalesOnce(provider, {
          from: toStr,
          to: toStr,
          scope: 'debt',
        });
        debtSnapshot = debtItems.some((i) =>
          (i.saleDocumentId ?? '').includes(':debt:'),
        );
        if (debtSnapshot) {
          items.push(...debtItems.filter((i) => i.operationType === 'unpaid'));
        }
      } catch {
        debtSnapshot = false;
      }
      if (!debtSnapshot) {
        for (let i = 0; i < days.length; i++) {
          const day = days[i]!;
          if (i > 0 && delay > 0) await sleep(delay);
          const sales = await fetchSalesOnce(provider, { from: day, to: day });
          items.push(
            ...sales.filter(
              (i) =>
                i.operationType === 'unpaid' ||
                (!i.paidAt &&
                  !(Number(i.paidAmount) > 0) &&
                  (Number(i.saleAmount) > 0 || Number(i.amount) > 0)),
            ),
          );
        }
      }
    }

    const unpaidExternalIds = new Set<string>();
    for (const item of items) {
      const baseId = item.saleDocumentId?.trim();
      if (!baseId) continue;

      const mapped = mapItem(item);
      if (!mapped) continue;
      if (
        mapped.operationType === 'unpaid' &&
        !isCollectibleClientDebt({
          externalId: baseId,
          productName: mapped.productName,
        })
      ) {
        continue;
      }
      const paidDay = mapped.paidAt ? moscowDayKey(mapped.paidAt) : null;
      const occurredDay = moscowDayKey(mapped.occurredAt);
      const externalId = paidDay
        ? `${baseId}:p${paidDay}`
        : `${baseId}:u${occurredDay}`;

      seen.add(externalId);
      if (mapped.operationType === 'unpaid') unpaidExternalIds.add(externalId);
      if (paidDay && mapped.operationType !== 'refund') {
        paidBaseIds.add(baseId);
      }
      // Older BSL keys omit «Основание»: one payment document covering several
      // sales yields several movements with the same key. Sum them, never overwrite.
      const prev = pending.get(externalId);
      pending.set(
        externalId,
        prev ? mergeRevenueRows(prev, mapped) : { externalId, ...mapped },
      );
    }
    await upsertRevenueRows(this.prisma, clubId, [...pending.values()]);
    const upserted = pending.size;

    // After payments: drop stale unpaid, keep residual debt until fully paid
    if (!options.skipDebt) {
      for (const baseId of paidBaseIds) {
        const residualId = await reconcileClubUnpaid(
          this.prisma,
          clubId,
          baseId,
        );
        if (residualId) {
          seen.add(residualId);
          unpaidExternalIds.add(residualId);
        }
      }
    }

    const ranges = [
      { from: fromStr, to: toStr },
      ...refreshDays.map((d) => ({ from: d, to: d })),
    ].map((r) => ({
      gte: new Date(`${r.from}T00:00:00.000Z`),
      lte: new Date(`${r.to}T23:59:59.999Z`),
    }));
    // Only cash/receipt rows in the window — unpaid carries across months.
    const existing = await this.prisma.clubRevenueEntry.findMany({
      where: {
        clubId,
        isActive: true,
        operationType: {
          notIn: ['unpaid'],
        },
        OR: ranges.flatMap((r) => [{ occurredAt: r }, { paidAt: r }]),
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

    if (!options.skipDebt && (debtSnapshot || unpaidExternalIds.size > 0)) {
      const staleUnpaid = await this.prisma.clubRevenueEntry.findMany({
        where: {
          clubId,
          isActive: true,
          operationType: 'unpaid',
          ...(debtSnapshot
            ? {}
            : {
                OR: ranges.map((r) => ({ occurredAt: r })),
              }),
        },
        select: { id: true, externalId: true },
      });
      const unpaidDrop = staleUnpaid
        .filter((r) => !unpaidExternalIds.has(r.externalId))
        .map((r) => r.id);
      if (unpaidDrop.length) {
        const res = await this.prisma.clubRevenueEntry.updateMany({
          where: { id: { in: unpaidDrop } },
          data: { isActive: false, syncedAt: new Date() },
        });
        deactivated += res.count;
      }
    }

    if (!options.skipLegacyCleanup) {
      // Old payment/deposit rows without :cash: (pre-scope export) — not unpaid.
      const legacy = await this.prisma.clubRevenueEntry.updateMany({
        where: {
          clubId,
          isActive: true,
          operationType: {
            in: [
              'payment',
              'refund',
              'personal_deposit',
              'personal_credit',
              'personal_burn',
              'sale',
            ],
          },
          NOT: { externalId: { contains: ':cash:' } },
        },
        data: { isActive: false, syncedAt: new Date() },
      });
      deactivated += legacy.count;
    }

    this.logger.log(
      `Club revenue range club=${clubId} upserted=${upserted} deactivated=${deactivated} unpaid=${unpaidExternalIds.size} debtSnapshot=${debtSnapshot} skipDebt=${!!options.skipDebt} window=${fromStr}..${toStr}`,
    );
    return { upserted, deactivated, from: fromStr, to: toStr };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  // A refund is not an open sale. Using its negative amount as «paid»
  // used to invent a residual unpaid row (product «Возврат»).
  if (baseId.includes(':refund:')) return null;

  const payments = await prisma.clubRevenueEntry.findMany({
    where: {
      clubId,
      isActive: true,
      externalId: { startsWith: `${baseId}:p` },
      operationType: { not: 'refund' },
    },
  });
  if (!payments.length) return null;

  const paidSum = payments.reduce(
    (s, r) => s + (r.paidAmount > 0 ? r.paidAmount : 0),
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
  const externalId = `${baseId}:u${moscowDayKey(occurredAt)}`;

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
      employeeExternalId: template.employeeExternalId,
      employeeName: template.employeeName,
      clientExternalId: template.clientExternalId,
      clientName: template.clientName,
      productName: template.productName,
      saleType: template.saleType,
      countsTowardIncome: false,
      countsTowardMotivation: false,
      isActive: true,
      syncedAt: new Date(),
    },
  });
  return externalId;
}

function mapItem(item: FitgoAnalyticsSalesItem) {
  let operationType = normalizeOperationType(item);
  let saleAmount = num(item.saleAmount ?? (operationType === 'unpaid' ? item.amount : 0));
  let paidAmount = num(item.paidAmount);
  const refundAmount = num(item.refundAmount);
  let cash = num(item.cash);
  let card = num(item.card);
  let cashless = num(item.cashless);
  let personalAccount = num(item.personalAccount);
  let amount = num(item.amount);

  // Align with 1C:
  // - deposit without нал/карта/безнал → начисление в абонементе;
  // - Документ.ЗакрытиеДня (23:59, только ЛС) → personal_burn;
  // - do NOT remap cashless→PA (безнал stays cashless).
  const atSold = parseClubWallClock(item.soldAt);
  if (!atSold) return null;
  const { hour, minute } = moscowParts(atSold);
  const endOfDay = hour === 23 && minute === 59;
  if (
    operationType === 'payment' &&
    personalAccount > 0 &&
    cash === 0 &&
    card === 0 &&
    cashless === 0 &&
    endOfDay
  ) {
    operationType = 'personal_burn';
    const amt = personalAccount || amount || paidAmount;
    amount = -Math.abs(amt);
    personalAccount = -Math.abs(amt);
    paidAmount = 0;
    saleAmount = 0;
  }
  if (
    operationType === 'personal_deposit' &&
    cash === 0 &&
    card === 0 &&
    cashless === 0
  ) {
    operationType = 'personal_credit';
    personalAccount = amount || paidAmount || saleAmount;
    paidAmount = 0;
    saleAmount = 0;
  }

  const countsTowardIncome =
    operationType === 'personal_credit' || operationType === 'personal_burn'
      ? false
      : (item.countsTowardIncome ??
        (operationType === 'payment' ||
          operationType === 'personal_deposit' ||
          operationType === 'refund'));
  const countsTowardMotivation =
    operationType === 'personal_credit' || operationType === 'personal_burn'
      ? false
      : (item.countsTowardMotivation ??
        (operationType === 'payment' || operationType === 'personal_deposit'));

  const paymentMethod =
    operationType === 'personal_credit' ||
    operationType === 'personal_burn' ||
    personalAccount !== 0
      ? inferPaymentMethod(cash, card, cashless, Math.abs(personalAccount))
      : item.paymentMethod?.trim() ||
        inferPaymentMethod(cash, card, cashless, personalAccount);

  const productName =
    operationType === 'personal_burn'
      ? 'Сгорание лицевого счета'
      : item.productName?.trim() || null;

  return {
    documentId: item.documentId?.trim() || null,
    operationType,
    occurredAt: atSold,
    paidAt:
      operationType === 'personal_burn'
        ? null
        : parseClubWallClock(item.paidAt),
    saleAmount,
    paidAmount,
    refundAmount,
    amount,
    cash,
    card,
    cashless,
    personalAccount,
    paymentMethod,
    saleType: item.saleType?.trim() || null,
    productName,
    clientExternalId: item.clientExternalId?.trim() || null,
    clientName: item.clientName?.trim() || null,
    employeeExternalId: item.employeeExternalId?.trim() || null,
    employeeName: item.employeeName?.trim() || null,
    countsTowardIncome,
    countsTowardMotivation,
    isActive: true,
  };
}

type MoneyFields = {
  saleAmount: number;
  paidAmount: number;
  refundAmount: number;
  amount: number;
  cash: number;
  card: number;
  cashless: number;
  personalAccount: number;
  paymentMethod: string | null;
};

function mergeRevenueRows<T extends MoneyFields>(a: T, b: MoneyFields): T {
  const sum = (x: number, y: number) => Math.round((x + y) * 100) / 100;
  const cash = sum(a.cash, b.cash);
  const card = sum(a.card, b.card);
  const cashless = sum(a.cashless, b.cashless);
  const personalAccount = sum(a.personalAccount, b.personalAccount);
  return {
    ...a,
    saleAmount: sum(a.saleAmount, b.saleAmount),
    paidAmount: sum(a.paidAmount, b.paidAmount),
    refundAmount: sum(a.refundAmount, b.refundAmount),
    amount: sum(a.amount, b.amount),
    cash,
    card,
    cashless,
    personalAccount,
    paymentMethod:
      a.paymentMethod === b.paymentMethod
        ? a.paymentMethod
        : inferPaymentMethod(cash, card, cashless, personalAccount),
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
