import { Injectable, Logger } from '@nestjs/common';
import { FitnessService } from '../fitness/fitness.service';
import { PrismaService } from '../prisma/prisma.service';
import { addMoscowDays, moscowDayKey } from './moscow-time';

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

    try {
      const rows = await provider.getTrainerPtSales({ from, to });
      const now = new Date();
      let upserted = 0;
      const seen = new Set<string>();

      for (const row of rows) {
        const externalId = row.externalId || row.docRef;
        if (!externalId) continue;
        seen.add(externalId);
        const occurredAt = new Date(row.occurredAt);
        if (Number.isNaN(occurredAt.getTime())) continue;

        await this.prisma.trainerPtSale.upsert({
          where: { clubId_externalId: { clubId, externalId } },
          create: {
            clubId,
            externalId,
            clientName: row.clientName ?? null,
            serviceName: row.serviceName ?? null,
            occurredAt,
            amount: row.amount ?? 0,
            currency: row.currency ?? null,
            employeeCode: row.employeeCode ?? null,
            employeeName: row.employeeName ?? null,
            docRef: row.docRef ?? null,
            paymentStatus: row.paymentStatus ?? null,
            bookingRef: row.bookingRef ?? null,
            isActive: true,
            syncedAt: now,
          },
          update: {
            clientName: row.clientName ?? null,
            serviceName: row.serviceName ?? null,
            occurredAt,
            amount: row.amount ?? 0,
            currency: row.currency ?? null,
            employeeCode: row.employeeCode ?? null,
            employeeName: row.employeeName ?? null,
            docRef: row.docRef ?? null,
            paymentStatus: row.paymentStatus ?? null,
            bookingRef: row.bookingRef ?? null,
            isActive: true,
            syncedAt: now,
          },
        });
        upserted += 1;
      }

      // Soft-deactivate rows in window missing from this pull.
      const rangeStart = new Date(`${from}T00:00:00.000Z`);
      const rangeEnd = new Date(`${to}T23:59:59.999Z`);
      await this.prisma.trainerPtSale.updateMany({
        where: {
          clubId,
          occurredAt: { gte: rangeStart, lte: rangeEnd },
          isActive: true,
          ...(seen.size
            ? { externalId: { notIn: [...seen] } }
            : {}),
        },
        data: { isActive: false, syncedAt: now },
      });

      await this.mark(clubId, 'ok', null);
      this.logger.log(`Trainer PT sales ${clubId}: ${upserted} (${from}…${to})`);
      return { from, to, upserted };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.mark(clubId, 'error', msg);
      throw err;
    }
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
