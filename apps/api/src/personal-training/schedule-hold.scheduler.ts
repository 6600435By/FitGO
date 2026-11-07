import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AvailabilityBlockKind } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  HOLD_WARN_BEFORE_MS,
  expiredHoldWhere,
  isHoldInWarnWindow,
} from './schedule-hold.rules';

const TICK_MS = 10 * 60 * 1000;

/** Expire HOLD_CLIENT blocks and warn trainers ~1h before release. */
@Injectable()
export class ScheduleHoldSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(ScheduleHoldSchedulerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    if (this.config.get('ENABLE_SCHEDULE_HOLD_CRON') === 'false') return;
    setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
  }

  async tick() {
    try {
      await this.warnExpiringHolds();
      await this.releaseExpiredHolds();
    } catch (err) {
      this.logger.error('Schedule hold tick failed', err);
    }
  }

  private async warnExpiringHolds() {
    const now = new Date();
    const warnUntil = new Date(now.getTime() + HOLD_WARN_BEFORE_MS);
    const holds = await this.prisma.trainerAvailabilityBlock.findMany({
      where: {
        kind: AvailabilityBlockKind.HOLD_CLIENT,
        holdExpiresAt: { gt: now, lte: warnUntil },
        holdExpiryWarnedAt: null,
      },
      include: {
        holdClient: { select: { firstName: true, lastName: true } },
      },
      take: 100,
    });

    for (const hold of holds) {
      if (
        !isHoldInWarnWindow({
          holdExpiresAt: hold.holdExpiresAt,
          holdExpiryWarnedAt: hold.holdExpiryWarnedAt,
          now,
        })
      ) {
        continue;
      }
      const name = hold.holdClient
        ? `${hold.holdClient.firstName} ${hold.holdClient.lastName}`.trim()
        : 'клиент';
      await this.notifications.notifyTrainerHoldExpiring({
        trainerId: hold.trainerId,
        clientName: name,
        expiresAt: hold.holdExpiresAt!,
      });
      await this.prisma.trainerAvailabilityBlock.update({
        where: { id: hold.id },
        data: { holdExpiryWarnedAt: now },
      });
    }
  }

  private async releaseExpiredHolds() {
    const now = new Date();
    const result = await this.prisma.trainerAvailabilityBlock.deleteMany({
      where: expiredHoldWhere(now),
    });
    if (result.count > 0) {
      this.logger.log(`Released ${result.count} expired schedule holds`);
    }
  }
}
