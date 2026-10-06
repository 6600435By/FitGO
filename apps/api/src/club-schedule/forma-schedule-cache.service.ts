import { Injectable, Logger } from '@nestjs/common';
import { SessionType, type ScheduleSlot } from '@fitgo/shared-types';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Schedule reads from ClubScheduleSlot (filled by club-sync).
 * No live Forma calls on staff/client page loads.
 */
@Injectable()
export class FormaScheduleCacheService {
  private readonly logger = new Logger(FormaScheduleCacheService.name);

  constructor(private readonly prisma: PrismaService) {}

  cacheKey(clubId: string, fromDay: string, toDay: string): string {
    return `${clubId}|${fromDay}|${toDay}`;
  }

  async getClubSchedule(
    clubId: string,
    fromDay: string,
    toDay: string,
  ): Promise<ScheduleSlot[]> {
    const rangeStart = new Date(`${fromDay}T00:00:00.000Z`);
    const rangeEnd = new Date(`${toDay}T23:59:59.999Z`);

    const rows = await this.prisma.clubScheduleSlot.findMany({
      where: {
        clubId,
        startAt: { gte: rangeStart, lte: rangeEnd },
      },
      orderBy: { startAt: 'asc' },
    });

    if (rows.length === 0) {
      this.logger.debug(
        `No ClubScheduleSlot rows for ${clubId} ${fromDay}..${toDay} — run staff sync`,
      );
    }

    return rows.map((r) => {
      const capacity = r.capacity ?? 0;
      const booked = r.bookedIn1c ?? 0;
      return {
        id: r.externalId,
        title: r.title,
        type: mapSessionType(r.sessionType),
        trainerName: r.trainerName ?? undefined,
        startAt: r.startAt.toISOString(),
        endAt: r.endAt.toISOString(),
        capacity,
        booked,
        available: capacity === 0 ? true : booked < capacity,
        roomTitle: r.roomTitle ?? undefined,
      };
    });
  }

  /** Invalidate in-memory cache — no-op; DB is source of truth. */
  invalidate(_clubId?: string) {
    /* intentionally empty */
  }
}

function mapSessionType(raw: string | null | undefined): SessionType {
  const v = (raw ?? '').toUpperCase();
  if (v === 'PERSONAL' || v === 'PT') return SessionType.PERSONAL;
  if (v === 'SPA') return SessionType.SPA;
  return SessionType.GROUP;
}
