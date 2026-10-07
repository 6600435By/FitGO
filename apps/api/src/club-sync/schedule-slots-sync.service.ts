import { Injectable, Logger } from '@nestjs/common';
import { pickFormaClubId } from '@fitgo/1c-adapter';
import { FitnessService } from '../fitness/fitness.service';
import { PrismaService } from '../prisma/prisma.service';
import { isFormaClubUuid, resolveFormaClubId } from './forma-club-id';
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
    const externalId = await this.alignFormaClubId(clubId, club?.externalId);
    if (!externalId) {
      await this.markState(
        clubId,
        'skipped',
        'no Forma club UUID — set Club.externalId or FORMA_CLUB_ID',
      );
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
      const hint =
        /1025|структурн/i.test(msg)
          ? ` — проверьте Club.externalId / FORMA_CLUB_ID (Forma club_id), сейчас использован ${externalId}`
          : '';
      await this.markState(clubId, 'error', `${msg}${hint}`);
      throw new Error(`${msg}${hint}`);
    }
  }

  /**
   * `1c-club-001` is not a Forma structural unit (API 400/1025).
   * `GET /clubs/` returns the real UUID; persist it on Club.externalId.
   */
  private async alignFormaClubId(
    clubId: string,
    stored: string | null | undefined,
  ): Promise<string> {
    const resolved = resolveFormaClubId(stored);
    let externalId = resolved.clubId;
    const provider = this.fitness.getProvider();
    if (provider.listClubs) {
      try {
        const clubs = await provider.listClubs();
        const picked = pickFormaClubId(clubs, externalId);
        if (picked) externalId = picked;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`schedule_slots: GET /clubs/ failed: ${msg}`);
      }
    }
    if (isFormaClubUuid(externalId) && (stored?.trim() ?? '') !== externalId) {
      await this.prisma.club.update({
        where: { id: clubId },
        data: { externalId },
      });
      this.logger.warn(
        `schedule_slots: Club.externalId=${stored?.trim() || '(empty)'} replaced with Forma club ${externalId}`,
      );
    }
    return externalId;
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
