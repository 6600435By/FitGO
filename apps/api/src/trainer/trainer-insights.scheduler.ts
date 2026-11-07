import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { FeaturesService } from '../features/features.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { TrainerInsightsService } from './trainer-insights.service';

const DIGEST_TITLE = 'Помощник на сегодня';
const DIGEST_TAG = 'trainer-insights-digest';

/** Morning «Помощник» digest at 08:00 Europe/Minsk. */
@Injectable()
export class TrainerInsightsSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(TrainerInsightsSchedulerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly insights: TrainerInsightsService,
    private readonly notifications: NotificationsService,
    private readonly features: FeaturesService,
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

  /** Start of club calendar day in UTC (Minsk has no DST). */
  private startOfMinskDay(dayKey: string): Date {
    return new Date(`${dayKey}T00:00:00+03:00`);
  }

  async tick() {
    try {
      const { dayKey, hour } = this.minskParts();
      if (hour !== 8) return;
      await this.sendMorningDigests(dayKey);
    } catch (err) {
      this.logger.error('Trainer insights digest tick failed', err);
    }
  }

  private async alreadySentToday(userId: string, dayStart: Date) {
    const existing = await this.prisma.notification.findFirst({
      where: {
        userId,
        title: DIGEST_TITLE,
        createdAt: { gte: dayStart },
      },
      select: { id: true },
    });
    return Boolean(existing);
  }

  private async sendMorningDigests(dayKey: string) {
    const dayStart = this.startOfMinskDay(dayKey);
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

    let sent = 0;
    let skipped = 0;

    for (const t of trainers) {
      if (!(await this.features.isEnabledForUser('trainer_ui_v2', t.id))) {
        skipped += 1;
        continue;
      }

      const prefs = t.notificationPrefs;
      if (
        prefs &&
        !prefs.bookingReminders &&
        !prefs.membershipAlerts &&
        !prefs.inactivityAlerts
      ) {
        continue;
      }

      if (await this.alreadySentToday(t.id, dayStart)) {
        continue;
      }

      const top = await this.insights.topInsightsForDigest(t.id, t.clubId);
      if (!top.length) continue;

      const body = top.map((i) => `• ${i.title}: ${i.body}`).join('\n');
      await this.notifications.sendDirectMessage(
        t.id,
        DIGEST_TITLE,
        body.slice(0, 500),
        undefined,
        { url: '/trainer', tag: DIGEST_TAG },
      );
      sent += 1;
    }

    this.logger.log(
      `Morning insights digest: sent=${sent} skippedNoForma=${skipped} scanned=${trainers.length}`,
    );
  }
}
