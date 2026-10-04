import { Injectable, Logger } from '@nestjs/common';
import type { ScheduleSlot } from '@fitgo/shared-types';
import { FitnessService } from '../fitness/fitness.service';
import { PrismaService } from '../prisma/prisma.service';
import { formaScheduleRange } from './trainer-schedule.helpers';

type CacheEntry = {
  expiresAt: number;
  slots: ScheduleSlot[];
};

@Injectable()
export class FormaScheduleCacheService {
  private readonly logger = new Logger(FormaScheduleCacheService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs = 5 * 60 * 1000;

  constructor(
    private readonly fitness: FitnessService,
    private readonly prisma: PrismaService,
  ) {}

  cacheKey(clubId: string, fromDay: string, toDay: string): string {
    return `${clubId}|${fromDay}|${toDay}`;
  }

  async getClubSchedule(
    clubId: string,
    fromDay: string,
    toDay: string,
  ): Promise<ScheduleSlot[]> {
    const key = this.cacheKey(clubId, fromDay, toDay);
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.slots;
    }

    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { externalId: true },
    });
    const externalId =
      club?.externalId?.trim() || process.env.FORMA_CLUB_ID?.trim() || '';
    if (!externalId) {
      this.logger.warn(`Club ${clubId}: no externalId / FORMA_CLUB_ID for schedule`);
      return [];
    }

    try {
      const range = formaScheduleRange(fromDay, toDay);
      const slots = await this.fitness.getProvider().getSchedule(externalId, {
        from: range.from,
        to: range.to,
      });
      this.cache.set(key, {
        expiresAt: Date.now() + this.ttlMs,
        slots,
      });
      return slots;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Forma getSchedule failed club=${clubId} ext=${externalId} ${fromDay}..${toDay}: ${message}`,
      );
      // Do not cache failures — allow Onex fallback in callers.
      return [];
    }
  }
}
