import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { retentionDays } from './discrepancies-period';

@Injectable()
export class DiscrepancyCleanupScheduler implements OnModuleInit {
  private readonly logger = new Logger(DiscrepancyCleanupScheduler.name);
  private lastDayKey = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (this.config.get('ENABLE_DISCREPANCY_CLEANUP') === 'false') return;
    setInterval(() => void this.tick(), 60 * 60 * 1000);
    void this.tick();
  }

  private async tick() {
    const now = new Date();
    // Nightly 03:00–04:00 local
    if (now.getHours() !== 3) return;
    const dayKey = now.toISOString().slice(0, 10);
    if (this.lastDayKey === dayKey) return;
    this.lastDayKey = dayKey;

    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays());
    try {
      const receipts = await this.prisma.webkassaReceipt.deleteMany({
        where: { occurredAt: { lt: cutoff } },
      });
      const acks = await this.prisma.discrepancyAck.deleteMany({
        where: {
          OR: [{ expiresAt: { lt: now } }, { createdAt: { lt: cutoff } }],
        },
      });
      this.logger.log(
        `Discrepancy cleanup: receipts=${receipts.count} acks=${acks.count}`,
      );
    } catch (err) {
      this.logger.error('Discrepancy cleanup failed', err);
    }
  }
}
