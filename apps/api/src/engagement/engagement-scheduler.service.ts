import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { LeagueService } from './league.service';
import { NotificationsService } from '../notifications/notifications.service';
import { VisitSyncService } from './visit-sync.service';

@Injectable()
export class EngagementSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(EngagementSchedulerService.name);
  private lastDailyRun = '';
  private lastWeeklyAssign = '';
  private lastWeeklySettle = '';
  private lastMonthlyDecay = '';

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly league: LeagueService,
    private readonly visitSync: VisitSyncService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    if (this.config.get('ENABLE_ENGAGEMENT_CRON') === 'false') return;
    setInterval(() => void this.tick(), 60 * 60 * 1000);
    void this.tick();
  }

  private todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  private weekKey() {
    const { weekStart } = this.league.weekBounds();
    return weekStart.toISOString().slice(0, 10);
  }

  async tick() {
    const now = new Date();
    const today = this.todayKey();
    const dayOfWeek = now.getDay();
    const dayOfMonth = now.getDate();

    try {
      if (this.lastDailyRun !== today) {
        this.lastDailyRun = today;
        await this.sendInactivityReminders(dayOfMonth);
      }

      if (dayOfWeek === 1 && this.lastWeeklyAssign !== this.weekKey()) {
        this.lastWeeklyAssign = this.weekKey();
        const clubs = await this.prisma.club.findMany({ select: { id: true } });
        for (const club of clubs) {
          await this.league.assignWeeklyGroups(club.id);
        }
      }

      if (dayOfWeek === 0 && now.getHours() >= 22 && this.lastWeeklySettle !== this.weekKey()) {
        this.lastWeeklySettle = this.weekKey();
        const clubs = await this.prisma.club.findMany({ select: { id: true } });
        for (const club of clubs) {
          await this.league.settleWeeklyLeague(club.id);
        }
      }

      if (dayOfMonth === 1 && this.lastMonthlyDecay !== today.slice(0, 7)) {
        this.lastMonthlyDecay = today.slice(0, 7);
        await this.league.processMonthlyRatingDecay();
      }

      await this.syncAllVisits();
    } catch (err) {
      this.logger.error('Engagement scheduler tick failed', err);
    }
  }

  async sendInactivityReminders(dayOfMonth: number) {
    const reminderDays = [7, 14, 21, 25];
    if (!reminderDays.includes(dayOfMonth)) return;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const ratings = await this.prisma.clientRating.findMany({
      where: {
        OR: [
          { lastAppActivityAt: null },
          { lastAppActivityAt: { lt: startOfMonth } },
        ],
      },
      select: { userId: true },
    });

    for (const r of ratings) {
      await this.notifications.sendRatingDecayReminder(r.userId, dayOfMonth);
    }
  }

  private async syncAllVisits() {
    const users = await this.prisma.user.findMany({
      where: { gamificationStartedAt: { not: null } },
      select: { id: true, clubId: true, externalId: true },
    });
    for (const u of users) {
      if (!u.clubId) continue;
      await this.visitSync.syncUserVisits(u.id, u.clubId, u.externalId);
    }
  }
}
