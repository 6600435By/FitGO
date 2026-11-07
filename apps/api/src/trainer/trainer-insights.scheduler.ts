import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { TrainerInsightsService } from './trainer-insights.service';

/** Morning «Помощник» digest at 08:00 Europe/Minsk. */
@Injectable()
export class TrainerInsightsSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(TrainerInsightsSchedulerService.name);
  private lastDigestKey = '';

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly insights: TrainerInsightsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    if (this.config.get('ENABLE_TRAINER_INSIGHTS_CRON') === 'false') return;
    setInterval(() => void this.tick(), 15 * 60 * 1000);
  }

  private minskParts(now = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Minsk',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? '';
    return {
      dayKey: `${get('year')}-${get('month')}-${get('day')}`,
      hour: Number(get('hour')),
    };
  }

  async tick() {
    try {
      const { dayKey, hour } = this.minskParts();
      if (hour !== 8) return;
      if (this.lastDigestKey === dayKey) return;
      this.lastDigestKey = dayKey;
      await this.sendMorningDigests();
    } catch (err) {
      this.logger.error('Trainer insights digest tick failed', err);
    }
  }

  private async sendMorningDigests() {
    const trainers = await this.prisma.user.findMany({
      where: {
        isActive: true,
        archivedAt: null,
        roles: { some: { role: Role.TRAINER } },
      },
      select: {
        id: true,
        clubId: true,
        notificationPrefs: {
          select: {
            bookingReminders: true,
            membershipAlerts: true,
            inactivityAlerts: true,
          },
        },
      },
      take: 200,
    });

    for (const t of trainers) {
      const prefs = t.notificationPrefs;
      if (
        prefs &&
        !prefs.bookingReminders &&
        !prefs.membershipAlerts &&
        !prefs.inactivityAlerts
      ) {
        continue;
      }

      const top = await this.insights.topInsightsForDigest(t.id, t.clubId);
      if (!top.length) continue;

      const body = top.map((i) => `• ${i.title}: ${i.body}`).join('\n');
      await this.notifications.sendDirectMessage(
        t.id,
        'Помощник на сегодня',
        body.slice(0, 500),
        undefined,
        { url: '/trainer', tag: 'trainer-insights-digest' },
      );
    }

    this.logger.log(`Morning insights digest sent for ${trainers.length} trainers`);
  }
}
