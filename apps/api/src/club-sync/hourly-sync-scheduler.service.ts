import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ClubSyncProfile,
  ClubSyncTrigger,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClubSyncOrchestrator } from './club-sync-orchestrator.service';
import { isMoscowDaytimeAutoSyncWindow } from './moscow-time';

const TICK_MS = 60 * 1000;
/** Min gap after any LIGHT MANUAL/AUTO start before the next AUTO LIGHT. */
const HOURLY_GAP_MS = 60 * 60 * 1000;

/**
 * Daytime auto LIGHT sync (08:00–23:00 Moscow). Same profile as the
 * «Обновить из 1С» button. Anchor = startedAt of the last LIGHT MANUAL/AUTO
 * (any status, including RUNNING) so failures do not hammer 1C every minute.
 * Manual press shifts the next auto by +1h. Nightly FULL is untouched.
 */
@Injectable()
export class HourlySyncScheduler implements OnModuleInit {
  private readonly logger = new Logger(HourlySyncScheduler.name);
  private ticking = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly orchestrator: ClubSyncOrchestrator,
  ) {}

  onModuleInit() {
    if (this.config.get('ENABLE_CLUB_SYNC_CRON') === 'false') return;
    setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
  }

  private async tick() {
    if (this.ticking) return;
    if (!isMoscowDaytimeAutoSyncWindow()) return;
    this.ticking = true;
    try {
      const clubs = await this.prisma.club.findMany({ select: { id: true } });
      for (const club of clubs) {
        try {
          await this.maybeStartHourly(club.id);
        } catch (err) {
          this.logger.error(
            `Hourly sync failed to start club=${club.id}`,
            err instanceof Error ? err.stack : err,
          );
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  private async maybeStartHourly(clubId: string): Promise<void> {
    const lastLight = await this.prisma.clubSyncRun.findFirst({
      where: {
        clubId,
        profile: ClubSyncProfile.LIGHT,
        trigger: {
          in: [ClubSyncTrigger.MANUAL, ClubSyncTrigger.AUTO],
        },
      },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true },
    });

    if (lastLight) {
      const nextAt = lastLight.startedAt.getTime() + HOURLY_GAP_MS;
      if (Date.now() < nextAt) return;
    }
    // No prior LIGHT → catch up once inside the window (no backfill of missed hours).

    const res = await this.orchestrator.start(clubId, {
      trigger: ClubSyncTrigger.AUTO,
      profile: ClubSyncProfile.LIGHT,
      force: true,
    });
    if (res.status === 'started') {
      this.logger.log(`Hourly LIGHT started club=${clubId}`);
    } else if (res.status === 'running') {
      this.logger.debug(`Hourly skipped (already running) club=${clubId}`);
    }
  }
}
