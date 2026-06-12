import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationType } from '@prisma/client';
import { MOCK_USERS } from '@fitgo/1c-adapter';
import { MembershipStatus } from '@fitgo/shared-types';
import { FitnessService } from '../fitness/fitness.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (this.config.get('ENABLE_NOTIFICATION_CRON') !== 'false') {
      void this.runChurnTriggers();
    }
  }

  async getNotifications(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markRead(userId: string, notificationId: string) {
    return this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { read: true },
    });
  }

  async getPreferences(userId: string) {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
  }

  async updatePreferences(
    userId: string,
    prefs: Partial<{
      bookingReminders: boolean;
      membershipAlerts: boolean;
      inactivityAlerts: boolean;
      milestoneAlerts: boolean;
      marketingAlerts: boolean;
    }>,
  ) {
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      update: prefs,
      create: { userId, ...prefs },
    });
  }

  async subscribePush(
    userId: string,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  ) {
    return this.prisma.pushSubscription.upsert({
      where: {
        userId_endpoint: { userId, endpoint: subscription.endpoint },
      },
      update: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      create: {
        userId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    });
  }

  async sendNotification(
    userId: string,
    type: NotificationType,
    title: string,
    body: string,
  ) {
    const prefs = await this.getPreferences(userId);
    const allowed =
      (type === NotificationType.BOOKING_REMINDER && prefs.bookingReminders) ||
      (type === NotificationType.MEMBERSHIP_EXPIRING && prefs.membershipAlerts) ||
      (type === NotificationType.INACTIVITY && prefs.inactivityAlerts) ||
      (type === NotificationType.MILESTONE && prefs.milestoneAlerts) ||
      type === NotificationType.GENERAL ||
      type === NotificationType.CHALLENGE;

    if (!allowed) return null;

    const dayAgo = new Date(Date.now() - 86400000);
    const recent = await this.prisma.notification.findFirst({
      where: { userId, type, title, createdAt: { gte: dayAgo } },
    });
    if (recent) return recent;

    const notification = await this.prisma.notification.create({
      data: { userId, type, title, body },
    });

    await this.sendWebPush(userId, title, body);
    return notification;
  }

  private async sendWebPush(userId: string, title: string, body: string) {
    const vapidPublic = this.config.get('VAPID_PUBLIC_KEY');
    const vapidPrivate = this.config.get('VAPID_PRIVATE_KEY');
    if (!vapidPublic || !vapidPrivate) return;

    try {
      const webpush = await import('web-push');
      webpush.setVapidDetails(
        'mailto:admin@fitgo.local',
        vapidPublic,
        vapidPrivate,
      );

      const subs = await this.prisma.pushSubscription.findMany({
        where: { userId },
      });

      await Promise.all(
        subs.map((sub) =>
          webpush
            .sendNotification(
              {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth },
              },
              JSON.stringify({ title, body }),
            )
            .catch(() => {
              this.logger.warn(`Push failed for user ${userId}`);
            }),
        ),
      );
    } catch {
      this.logger.warn('web-push not available');
    }
  }

  async runChurnTriggers() {
    const clubs = await this.prisma.club.findMany({
      where: { externalId: { not: null } },
      include: { users: { include: { roles: true } } },
    });

    for (const club of clubs) {
      const clients = club.users.filter((u) =>
        u.roles.some((r) => r.role === 'CLIENT'),
      );

      for (const client of clients) {
        if (!client.externalId) continue;

        try {
          const provider = this.fitness.getProvider();
          const [membership, visits] = await Promise.all([
            provider.getMembership(client.externalId),
            provider.getVisits(client.externalId),
          ]);

          const today = new Date();
          const lastVisit = visits[0]?.date
            ? new Date(visits[0].date)
            : null;

          if (lastVisit) {
            const daysSince = Math.floor(
              (today.getTime() - lastVisit.getTime()) / 86400000,
            );
            if (daysSince >= 3) {
              await this.sendNotification(
                client.id,
                NotificationType.INACTIVITY,
                'Мы скучаем!',
                `Вы не были в клубе ${daysSince} дней. Запишитесь на тренировку!`,
              );
            }
          }

          if (membership?.status === MembershipStatus.ACTIVE) {
            const daysLeft = Math.floor(
              (new Date(membership.validUntil).getTime() - today.getTime()) /
                86400000,
            );
            if (daysLeft <= 7 && daysLeft >= 0) {
              await this.sendNotification(
                client.id,
                NotificationType.MEMBERSHIP_EXPIRING,
                'Абонемент скоро истекает',
                `До окончания абонемента осталось ${daysLeft} дн. Продлите сейчас.`,
              );
            }
          }

          const visitsThisMonth = visits.filter((v) => {
            const d = new Date(v.date);
            return (
              d.getMonth() === today.getMonth() &&
              d.getFullYear() === today.getFullYear()
            );
          });

          if (visitsThisMonth.length === 5) {
            await this.sendNotification(
              client.id,
              NotificationType.MILESTONE,
              'Отличная работа!',
              'Это ваш 5-й визит в этом месяце. Так держать!',
            );
          }
        } catch {
          this.logger.warn(`Churn check failed for ${client.id}`);
        }
      }
    }

    this.logger.log('Churn triggers completed');
  }

  async sendDirectMessage(userId: string, title: string, body: string) {
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        type: NotificationType.GENERAL,
        title,
        body,
      },
    });

    await this.sendWebPush(userId, title, body);
    return notification;
  }

  async sendReminderToClient(userId: string, message: string) {
    return this.sendDirectMessage(userId, 'Сообщение от клуба', message);
  }

  getMockClientData() {
    return MOCK_USERS;
  }
}
