import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PersonalBookingStatus } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const TICK_MS = 15 * 60 * 1000;

/**
 * Client PT reminders at ~24h and ~2h before start.
 * Dedup via Notification.tag + recent rows is imperfect; we mark on booking via
 * a lightweight scan window so each booking gets at most one of each.
 */
@Injectable()
export class PtReminderSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(PtReminderSchedulerService.name);
  private readonly sent = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    if (this.config.get('ENABLE_PT_REMINDER_CRON') === 'false') return;
    setInterval(() => void this.tick(), TICK_MS);
  }

  async tick() {
    try {
      await this.sendWindow(24, 23.5 * 60 * 60 * 1000, 24.5 * 60 * 60 * 1000);
      await this.sendWindow(2, 1.75 * 60 * 60 * 1000, 2.25 * 60 * 60 * 1000);
    } catch (err) {
      this.logger.error('PT reminder tick failed', err);
    }
  }

  private async sendWindow(
    hoursBefore: 24 | 2,
    minMs: number,
    maxMs: number,
  ) {
    const now = Date.now();
    const bookings = await this.prisma.personalTrainingBooking.findMany({
      where: {
        status: PersonalBookingStatus.CONFIRMED,
        startAt: {
          gte: new Date(now + minMs),
          lte: new Date(now + maxMs),
        },
      },
      include: {
        trainer: { select: { firstName: true, lastName: true } },
        client: {
          select: {
            id: true,
            accountStatus: true,
          },
        },
      },
      take: 200,
    });

    for (const b of bookings) {
      const key = `${b.id}:${hoursBefore}`;
      if (this.sent.has(key)) continue;
      if (b.client.accountStatus !== 'ACTIVE') continue;

      const trainerName =
        `${b.trainer.firstName} ${b.trainer.lastName}`.trim() || 'тренер';
      await this.notifications.notifyPtReminder({
        clientId: b.clientId,
        trainerName,
        startAt: b.startAt,
        hoursBefore,
      });
      this.sent.add(key);
    }

    if (this.sent.size > 5000) {
      this.sent.clear();
    }
  }
}
