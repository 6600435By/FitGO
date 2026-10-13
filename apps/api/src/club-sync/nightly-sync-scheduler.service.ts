import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ClubSyncProfile,
  ClubSyncTrigger,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClubSyncOrchestrator } from './club-sync-orchestrator.service';
import { isMoscowNightWindow, moscowDayKey, moscowParts } from './moscow-time';

const TICK_MS = 5 * 60 * 1000;
/** Catch-up after night window: 04:00–06:00 Moscow (hour < 6). */
const CATCHUP_HOUR_START = 4;
const CATCHUP_HOUR_END = 6;
/** Night + catch-up together: at most this many NIGHTLY FULL starts per Moscow day. */
const MAX_NIGHTLY_ATTEMPTS_PER_DAY = 2;

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
    // Night window: start FULL. Catch-up only 04:00–06:00 if last night missed.
    void this.tick();
  }

  private async tick() {
    const nightKey = moscowDayKey();
    if (isMoscowNightWindow()) {
      await this.startNightlyForAllClubs(nightKey, 'night');
      return;
    }
    // Catch-up only 04:00–06:00 Moscow. After 06:00 a run already in progress
    // may finish its budget, but we do not start a new FULL.
    const { hour } = moscowParts();
    if (hour < CATCHUP_HOUR_START || hour >= CATCHUP_HOUR_END) return;
    await this.startNightlyForAllClubs(nightKey, 'catch-up');
  }

  private async startNightlyForAllClubs(
    nightKey: string,
    reason: 'night' | 'catch-up',
  ) {
    const clubs = await this.prisma.club.findMany({ select: { id: true } });
    for (const club of clubs) {
      try {
        if (reason === 'catch-up') {
          const attempts = await this.countNightlyAttemptsToday(
            club.id,
            nightKey,
          );
          if (attempts >= MAX_NIGHTLY_ATTEMPTS_PER_DAY) {
            this.logger.debug(
              `Nightly catch-up skipped (attempts=${attempts}) club=${club.id} night=${nightKey}`,
            );
            continue;
          }
        }

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

  /** NIGHTLY FULL starts whose Moscow calendar day matches nightKey. */
  private async countNightlyAttemptsToday(
    clubId: string,
    nightKey: string,
  ): Promise<number> {
    // Moscow midnight of nightKey as UTC instant (offset +3).
    const [y, m, d] = nightKey.split('-').map(Number);
    const dayStartUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 3 * 3600_000);
    const dayEndUtc = new Date(dayStartUtc.getTime() + 24 * 3600_000);
    return this.prisma.clubSyncRun.count({
      where: {
        clubId,
        trigger: ClubSyncTrigger.NIGHTLY,
        profile: ClubSyncProfile.FULL,
        startedAt: { gte: dayStartUtc, lt: dayEndUtc },
      },
    });
  }
}
