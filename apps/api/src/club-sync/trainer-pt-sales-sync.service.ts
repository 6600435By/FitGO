import { Injectable, Logger } from '@nestjs/common';
import {
  overlayPtSaleDebtFromRevenue,
  saleDocumentIdFromPtExternalId,
} from '../admin-sales/trainer-pt-sales-from-revenue';
import { FitnessService } from '../fitness/fitness.service';
import { PrismaService } from '../prisma/prisma.service';
import { addMoscowDays, moscowDayKey } from './moscow-time';
import {
  shouldSoftDeactivateTrainerPtSales,
  splitYmdRangeInclusive,
  TRAINER_PT_SALES_CHUNK_DAYS,
} from './trainer-pt-sales-sync.util';

const RESOURCE_KEY = 'trainer_pt_sales';

@Injectable()
export class TrainerPtSalesSyncService {
  private readonly logger = new Logger(TrainerPtSalesSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
  ) {}

  async syncClub(
    clubId: string,
    opts?: { from?: string; to?: string },
  ): Promise<{ from: string; to: string; upserted: number }> {
    const today = moscowDayKey();
    const from = opts?.from ?? addMoscowDays(today, -1);
    const to = opts?.to ?? today;

    await this.prisma.salesSyncState.upsert({
      where: { clubId_resourceKey: { clubId, resourceKey: RESOURCE_KEY } },
      create: {
        clubId,
        resourceKey: RESOURCE_KEY,
        lastStatus: 'running',
        lastRunAt: new Date(),
      },
      update: {
        lastStatus: 'running',
        lastRunAt: new Date(),
        lastError: null,
      },
    });

    const provider = this.fitness.getProvider();
    if (!provider.getTrainerPtSales) {
      await this.mark(clubId, 'skipped', 'getTrainerPtSales not available');
      return { from, to, upserted: 0 };
    }

    const chunks = splitYmdRangeInclusive(from, to, TRAINER_PT_SALES_CHUNK_DAYS);
    let upserted = 0;
    try {
      for (const chunk of chunks) {
        upserted += await this.syncChunk(clubId, chunk.from, chunk.to);
      }
      await this.mark(clubId, 'ok', null);
      this.logger.log(`Trainer PT sales ${clubId}: ${upserted} (${from}…${to})`);
      return { from, to, upserted };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.mark(clubId, 'error', msg);
      throw err;
    }
  }

  private async syncChunk(
    clubId: string,
    from: string,
    to: string,
  ): Promise<number> {
    const provider = this.fitness.getProvider();
    const pull = provider.getTrainerPtSales;
    if (!pull) return 0;

    // Let errors propagate — never treat failure as «0 sales → wipe window».
    const raw = await pull.call(provider, { from, to });
    const fromD = new Date(`${from}T00:00:00.000`);
    const toD = new Date(`${to}T23:59:59.999`);
    const mapped = (Array.isArray(raw) ? raw : []).map((row) => ({
      externalId: row.externalId ?? undefined,
      clientName: row.clientName ?? undefined,
      serviceName: row.serviceName ?? undefined,
      occurredAt: row.occurredAt,
      amount: row.amount ?? 0,
      currency: row.currency ?? null,
      employeeCode: row.employeeCode ?? undefined,
      employeeName: row.employeeName ?? undefined,
      docRef: row.docRef ?? undefined,
      paymentStatus: row.paymentStatus ?? undefined,
      bookingRef: row.bookingRef ?? null,
    }));
    const rows =
      !Number.isNaN(fromD.getTime()) && !Number.isNaN(toD.getTime())
        ? await overlayPtSaleDebtFromRevenue(
            this.prisma,
            clubId,
            fromD,
            toD,
            mapped,
          )
        : mapped;
    const now = new Date();
    let upserted = 0;
    const seen = new Set<string>();
    const metaByExt = new Map(
      mapped.map((r) => [r.docRef || r.externalId || '', r] as const),
    );

    for (const row of rows) {
      // Prefer sale-line key (docRef); client UUID in externalId collapses rows.
      // Keep Integration UUID in saleDocumentId before the docRef swap.
      const saleDocumentId =
        saleDocumentIdFromPtExternalId(row.externalId) ?? null;
      const externalId = row.docRef || row.externalId;
      if (!externalId) continue;
      seen.add(externalId);
      const occurredAt = new Date(row.occurredAt);
      if (Number.isNaN(occurredAt.getTime())) continue;
      const meta = metaByExt.get(externalId);

      await this.prisma.trainerPtSale.upsert({
        where: { clubId_externalId: { clubId, externalId } },
        create: {
          clubId,
          externalId,
          saleDocumentId,
          clientName: row.clientName ?? null,
          serviceName: row.serviceName ?? null,
          occurredAt,
          amount: row.amount ?? 0,
          currency: meta?.currency ?? null,
          employeeCode: row.employeeCode ?? null,
          employeeName: row.employeeName ?? null,
          docRef: row.docRef ?? null,
          paymentStatus: row.paymentStatus ?? null,
          bookingRef: meta?.bookingRef ?? null,
          isActive: true,
          syncedAt: now,
        },
        update: {
          saleDocumentId,
          clientName: row.clientName ?? null,
          serviceName: row.serviceName ?? null,
          occurredAt,
          amount: row.amount ?? 0,
          currency: meta?.currency ?? null,
          employeeCode: row.employeeCode ?? null,
          employeeName: row.employeeName ?? null,
          docRef: row.docRef ?? null,
          paymentStatus: row.paymentStatus ?? null,
          bookingRef: meta?.bookingRef ?? null,
          isActive: true,
          syncedAt: now,
        },
      });
      upserted += 1;
    }

    // Soft-deactivate only on a complete-looking pull (same window as upsert).
    const rangeStart = fromD;
    const rangeEnd = toD;
    if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
      return upserted;
    }

    const existingActiveCount = await this.prisma.trainerPtSale.count({
      where: {
        clubId,
        isActive: true,
        occurredAt: { gte: rangeStart, lte: rangeEnd },
      },
    });

    if (
      !shouldSoftDeactivateTrainerPtSales({
        seenCount: seen.size,
        existingActiveCount,
      })
    ) {
      if (existingActiveCount > 0 && seen.size < existingActiveCount) {
        this.logger.warn(
          `Trainer PT sales ${clubId}: skip deactivate ${from}…${to} ` +
            `(seen=${seen.size}, active=${existingActiveCount})`,
        );
      }
      return upserted;
    }

    await this.prisma.trainerPtSale.updateMany({
      where: {
        clubId,
        occurredAt: { gte: rangeStart, lte: rangeEnd },
        isActive: true,
        externalId: { notIn: [...seen] },
      },
      data: { isActive: false, syncedAt: now },
    });

    return upserted;
  }

  private async mark(clubId: string, status: string, error: string | null) {
    await this.prisma.salesSyncState.update({
      where: { clubId_resourceKey: { clubId, resourceKey: RESOURCE_KEY } },
      data: {
        lastStatus: status,
        lastError: error,
        lastSuccessAt: status === 'ok' ? new Date() : undefined,
        lastRunAt: new Date(),
      },
    });
  }
}
