import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClubSyncProfile, ClubSyncTrigger } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClubSyncOrchestrator } from './club-sync-orchestrator.service';
import { isMoscowNightWindow, moscowDayKey, moscowParts } from './moscow-time';

const TICK_MS = 5 * 60 * 1000;

@Injectable()
export class NightlySyncScheduler implements OnModuleInit {
  private readonly logger = new Logger(NightlySyncScheduler.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly orchestrator: ClubSyncOrchestrator,
  ) {}

  async onModuleInit() {
    // Await boot reclaim so it cannot finish after a user already started sync.
    try {
      await this.orchestrator.reclaimAllOrphans();
    } catch (err) {
      this.logger.warn(
        `reclaimAllOrphans: ${err instanceof Error ? err.message : err}`,
      );
    }
    if (this.config.get('ENABLE_CLUB_SYNC_CRON') === 'false') return;
    setInterval(() => void this.tick(), TICK_MS);
    // Night window: start FULL. Outside window: catch up if last night missed.
    void this.tick();
  }

  private async tick() {
    const nightKey = moscowDayKey();
    if (isMoscowNightWindow()) {
      await this.startNightlyForAllClubs(nightKey, 'night');
      return;
    }
    // After 04:00 Moscow: if tonight's nightKey never finished SUCCESS/PARTIAL,
    // run FULL once (API was down / Update-FitGO during 03–04, etc.).
    const { hour } = moscowParts();
    if (hour < 4) return;
    await this.startNightlyForAllClubs(nightKey, 'catch-up');
  }

  private async startNightlyForAllClubs(
    nightKey: string,
    reason: 'night' | 'catch-up',
  ) {
    const clubs = await this.prisma.club.findMany({ select: { id: true } });
    for (const club of clubs) {
      try {
        const res = await this.orchestrator.start(club.id, {
          trigger: ClubSyncTrigger.NIGHTLY,
          profile: ClubSyncProfile.FULL,
          force: true,
        });
        if (res.status === 'started') {
          this.logger.log(
            `Nightly FULL started (${reason}) club=${club.id} night=${nightKey}`,
          );
        } else if (res.status === 'already_nightly') {
          // already done for this nightKey
        } else if (res.status === 'running') {
          this.logger.debug(
            `Nightly already running (${reason}) club=${club.id}`,
          );
        }
      } catch (err) {
        this.logger.error(
          `Nightly sync failed to start (${reason}) club=${club.id}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }
  }
}
