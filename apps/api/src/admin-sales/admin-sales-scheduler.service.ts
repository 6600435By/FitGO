import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AdminSalesSyncService } from './admin-sales-sync.service';
import { ClubRevenueSyncService } from './club-revenue-sync.service';

@Injectable()
export class AdminSalesSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(AdminSalesSchedulerService.name);
  private lastNightlyKey = '';

  constructor(
    private readonly config: ConfigService,
    private readonly sync: AdminSalesSyncService,
    private readonly clubRevenueSync: ClubRevenueSyncService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    if (this.config.get('ENABLE_ADMIN_SALES_CRON') === 'false') return;
    setInterval(() => void this.tick(), 60 * 60 * 1000);
    void this.tick();
  }

  private async tick() {
    const now = new Date();
    const dayKey = now.toISOString().slice(0, 10);
    if (now.getHours() < 2) return;
    if (this.lastNightlyKey === dayKey) return;
    this.lastNightlyKey = dayKey;
    this.logger.log('Starting nightly admin sales + club revenue sync');
    try {
      await this.sync.syncAllClubs();
    } catch (err) {
      this.logger.error('Nightly admin sales sync failed', err);
    }
    try {
      const clubs = await this.prisma.club.findMany({ select: { id: true } });
      for (const club of clubs) {
        try {
          await this.clubRevenueSync.syncClub(club.id, 'full');
        } catch (err) {
          this.logger.error(
            `Club revenue sync failed for ${club.id}`,
            err instanceof Error ? err.stack : err,
          );
        }
      }
    } catch (err) {
      this.logger.error('Nightly club revenue sync failed', err);
    }
  }
}
