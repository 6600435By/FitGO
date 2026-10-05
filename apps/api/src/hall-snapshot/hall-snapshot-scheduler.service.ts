import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HallSnapshotService } from './hall-snapshot.service';

@Injectable()
export class HallSnapshotSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(HallSnapshotSchedulerService.name);
  private lastPurgeDay = '';
  private lastSyncAt = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly hallSnapshots: HallSnapshotService,
  ) {}

  onModuleInit() {
    if (this.config.get('ENABLE_HALL_SNAPSHOT_CRON') === 'false') return;
    if (!this.config.get('HALL_SNAPSHOT_AGENT_TOKEN')?.trim()) {
      this.logger.warn(
        'Hall snapshot cron idle: set HALL_SNAPSHOT_AGENT_TOKEN to enable',
      );
      return;
    }
    setInterval(() => void this.tick(), 60 * 1000);
    // First tick is local slot ensure only (no 1C).
  }

  private async tick() {
    const now = Date.now();
    try {
      if (now - this.lastSyncAt > 15 * 60 * 1000) {
        this.lastSyncAt = now;
        await this.hallSnapshots.syncTodayAndEnsureSlots();
      } else {
        await this.hallSnapshots.ensureSlotsAllClubs();
      }
    } catch (err) {
      this.logger.error('Hall snapshot slot tick failed', err);
    }

    const dayKey = new Date().toISOString().slice(0, 10);
    if (this.lastPurgeDay === dayKey) return;
    // Once per UTC day after 00:30 — purge files older than 60 days
    if (new Date().getUTCHours() === 0 && new Date().getUTCMinutes() < 30) {
      return;
    }
    this.lastPurgeDay = dayKey;
    try {
      const n = await this.hallSnapshots.purgeOlderThanRetention();
      if (n > 0) {
        this.logger.log(`Purged ${n} hall snapshots older than 60 days`);
      }
    } catch (err) {
      this.logger.error('Hall snapshot purge failed', err);
      this.lastPurgeDay = '';
    }
  }
}
