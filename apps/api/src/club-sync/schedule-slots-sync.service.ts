import { Injectable, Logger } from '@nestjs/common';
import { FitnessService } from '../fitness/fitness.service';
import { PrismaService } from '../prisma/prisma.service';
import { addMoscowDays, moscowDayKey } from './moscow-time';

const RESOURCE_KEY = 'schedule_slots';

export type ScheduleSlotsSyncResult = {
  from: string;
  to: string;
  upserted: number;
  deactivated: number;
};

@Injectable()
export class ScheduleSlotsSyncService {
  private readonly logger = new Logger(ScheduleSlotsSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
  ) {}

  async syncClub(
    clubId: string,
    opts?: { from?: string; to?: string },
  ): Promise<ScheduleSlotsSyncResult> {
    const today = moscowDayKey();
    const from = opts?.from ?? today;
    const to = opts?.to ?? addMoscowDays(today, 14);

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

    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { externalId: true },
    });
    const externalId =
      club?.externalId?.trim() || process.env.FORMA_CLUB_ID?.trim() || '';
    if (!externalId) {
      await this.markState(clubId, 'skipped', 'no club externalId');
      return { from, to, upserted: 0, deactivated: 0 };
    }

    try {
      const slots = await this.fitness.getProvider().getSchedule(externalId, {
        from: `${from}T00:00:00`,
        to: `${to}T23:59:59`,
      });
      const now = new Date();
      const seen = new Set<string>();
      let upserted = 0;

      for (const slot of slots) {
        if (!slot.id) continue;
        seen.add(slot.id);
        const startAt = new Date(slot.startAt);
        const endAt = new Date(slot.endAt);
        if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
          continue;
        }
        await this.prisma.clubScheduleSlot.upsert({
          where: {
            clubId_externalId: { clubId, externalId: slot.id },
          },
          create: {
            clubId,
            externalId: slot.id,
            title: slot.title,
            trainerName: slot.trainerName ?? null,
            roomTitle: slot.roomTitle ?? null,
            startAt,
            endAt,
            capacity: slot.capacity ?? 0,
            bookedIn1c: slot.booked ?? 0,
            sessionType: slot.type ?? null,
            syncedAt: now,
          },
          update: {
            title: slot.title,
            trainerName: slot.trainerName ?? null,
            roomTitle: slot.roomTitle ?? null,
            startAt,
            endAt,
            capacity: slot.capacity ?? 0,
            bookedIn1c: slot.booked ?? 0,
            sessionType: slot.type ?? null,
            syncedAt: now,
          },
        });
        upserted += 1;
      }

      // Soft-remove slots in range that disappeared from Forma.
      const rangeStart = new Date(`${from}T00:00:00.000Z`);
      const rangeEnd = new Date(`${to}T23:59:59.999Z`);
      const stale = await this.prisma.clubScheduleSlot.findMany({
        where: {
          clubId,
          startAt: { gte: rangeStart, lte: rangeEnd },
          externalId: { notIn: [...seen] },
        },
        select: { id: true },
      });
      let deactivated = 0;
      if (stale.length) {
        // Delete stale — schedule is authoritative snapshot.
        const res = await this.prisma.clubScheduleSlot.deleteMany({
          where: { id: { in: stale.map((s) => s.id) } },
        });
        deactivated = res.count;
      }

      await this.markState(clubId, 'ok', null);
      this.logger.log(
        `Schedule slots ${clubId}: ${upserted} upserted, ${deactivated} removed (${from}…${to})`,
      );
      return { from, to, upserted, deactivated };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.markState(clubId, 'error', msg);
      throw err;
    }
  }

  private async markState(
    clubId: string,
    status: string,
    error: string | null,
  ) {
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
