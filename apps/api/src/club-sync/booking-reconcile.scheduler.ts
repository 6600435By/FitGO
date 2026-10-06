import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BookingGateway } from './booking-gateway.service';

const TICK_MS = 2 * 60 * 1000;

@Injectable()
export class BookingReconcileScheduler implements OnModuleInit {
  private readonly logger = new Logger(BookingReconcileScheduler.name);

  constructor(
    private readonly config: ConfigService,
    private readonly gateway: BookingGateway,
  ) {}

  onModuleInit() {
    if (this.config.get('ENABLE_CLUB_SYNC_CRON') === 'false') return;
    setInterval(() => void this.tick(), TICK_MS);
  }

  private async tick() {
    try {
      const n = await this.gateway.reconcilePendingGroupBookings();
      if (n > 0) {
        this.logger.log(`Reconciled ${n} PENDING_1C group bookings`);
      }
    } catch (err) {
      this.logger.error(
        'Booking reconcile failed',
        err instanceof Error ? err.stack : err,
      );
    }
  }
}
