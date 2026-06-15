import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WaitlistService } from './waitlist.service';

@Injectable()
export class WaitlistSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(WaitlistSchedulerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly waitlist: WaitlistService,
  ) {}

  onModuleInit() {
    if (this.config.get('ENABLE_WAITLIST_CRON') === 'false') return;
    setInterval(() => void this.tick(), 60 * 1000);
    void this.tick();
  }

  private async tick() {
    try {
      await this.waitlist.processDelayedNotifications();
    } catch (err) {
      this.logger.error('Waitlist scheduler tick failed', err);
    }
  }
}
