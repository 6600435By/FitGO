import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminSalesSyncService } from './admin-sales-sync.service';

@Injectable()
export class AdminSalesSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(AdminSalesSchedulerService.name);
  private lastNightlyKey = '';

  constructor(
    private readonly config: ConfigService,
    private readonly sync: AdminSalesSyncService,
  ) {}

  onModuleInit() {
    if (this.config.get('ENABLE_ADMIN_SALES_CRON') === 'false') return;
    // Check hourly; run once after 02:00 local (server TZ) per calendar day.
    setInterval(() => void this.tick(), 60 * 60 * 1000);
    void this.tick();
  }

  private async tick() {
    const now = new Date();
    const dayKey = now.toISOString().slice(0, 10);
    if (now.getHours() < 2) return;
    if (this.lastNightlyKey === dayKey) return;
    this.lastNightlyKey = dayKey;
    this.logger.log('Starting nightly admin sales sync');
    try {
      await this.sync.syncAllClubs();
    } catch (err) {
      this.logger.error('Nightly admin sales sync failed', err);
    }
  }
}
