import { Injectable } from '@nestjs/common';
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
    if (!club?.externalId) return [];

    try {
      const range = formaScheduleRange(fromDay, toDay);
      const slots = await this.fitness.getProvider().getSchedule(club.externalId, {
        from: range.from,
        to: range.to,
      });
      this.cache.set(key, {
        expiresAt: Date.now() + this.ttlMs,
        slots,
      });
      return slots;
    } catch {
      return [];
    }
  }
}
