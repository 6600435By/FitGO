import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClubSyncProfile, ClubSyncTrigger } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClubSyncOrchestrator } from './club-sync-orchestrator.service';
import { isMoscowNightWindow, moscowDayKey } from './moscow-time';

const TICK_MS = 5 * 60 * 1000;

@Injectable()
export class NightlySyncScheduler implements OnModuleInit {
  private readonly logger = new Logger(NightlySyncScheduler.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly orchestrator: ClubSyncOrchestrator,
  ) {}

  onModuleInit() {
    // Always reclaim stuck locks after restart (even if cron is off).
    void this.orchestrator.reclaimAllOrphans().catch((err) => {
      this.logger.warn(
        `reclaimAllOrphans: ${err instanceof Error ? err.message : err}`,
      );
    });
    if (this.config.get('ENABLE_CLUB_SYNC_CRON') === 'false') return;
    setInterval(() => void this.tick(), TICK_MS);
    // Safe: no-ops outside 03:00–04:00 Moscow.
    void this.tick();
  }

  private async tick() {
    if (!isMoscowNightWindow()) return;
    const nightKey = moscowDayKey();
    const clubs = await this.prisma.club.findMany({ select: { id: true } });
    for (const club of clubs) {
      try {
        const res = await this.orchestrator.start(club.id, {
          trigger: ClubSyncTrigger.NIGHTLY,
          profile: ClubSyncProfile.FULL,
          force: true,
        });
        if (res.status === 'started') {
          this.logger.log(`Nightly FULL started club=${club.id} night=${nightKey}`);
        } else if (res.status === 'already_nightly') {
          // already done tonight
        } else if (res.status === 'running') {
          this.logger.debug(`Nightly already running club=${club.id}`);
        }
      } catch (err) {
        this.logger.error(
          `Nightly sync failed to start club=${club.id}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }
  }
}
