import { Injectable, Logger, NotFoundException, OnModuleInit, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationStatus, NotificationType, Role } from '@prisma/client';
import { UserRole } from '@fitgo/shared-types';
import { MOCK_USERS } from '@fitgo/1c-adapter';
import { MembershipStatus } from '@fitgo/shared-types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
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

  async getNotifications(
    userId: string,
    filter?: 'all' | 'pending' | 'completed' | 'unread',
  ) {
    const where: {
      userId: string;
      status?: NotificationStatus;
      read?: boolean;
    } = { userId };

    if (filter === 'pending') {
      where.status = NotificationStatus.PENDING;
    } else if (filter === 'completed') {
      where.status = NotificationStatus.COMPLETED;
    } else if (filter === 'unread') {
      where.read = false;
    }

    const notifications = await this.prisma.notification.findMany({
      where,
      include: {
        sender: {
          select: { firstName: true, lastName: true, phone: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return notifications.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      read: n.read,
      status: n.status,
      senderName: n.sender
        ? `${n.sender.firstName} ${n.sender.lastName}`.trim()
        : undefined,
      createdAt: n.createdAt.toISOString(),
    }));
  }

  async markRead(userId: string, notificationId: string) {
    return this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { read: true },
    });
  }

  async markComplete(userId: string, notificationId: string, roles: UserRole[] = []) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!notification) {
      throw new NotFoundException('Уведомление не найдено');
    }

    const isTrainerOnly =
      roles.includes(UserRole.TRAINER) && !roles.includes(UserRole.ADMIN);
    if (
      isTrainerOnly &&
      notification.title !== 'Отмена персональной тренировки'
    ) {
      throw new ForbiddenException('Нельзя завершить это уведомление');
    }

    return this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { status: NotificationStatus.COMPLETED, read: true },
    });
  }

  async sendMessageToAdmins(user: JwtPayload, message: string) {
    return this.sendStaffMessage(user, {
      message,
      recipientType: 'admin',
    });
  }

  async sendStaffMessage(
    user: JwtPayload,
    params: {
      message: string;
      recipientType: 'admin' | 'trainer';
      trainerId?: string;
    },
  ) {
    const sender = await this.prisma.user.findUnique({
      where: { id: user.sub },
    });
    if (!sender) {
      throw new NotFoundException('Пользователь не найден');
    }

    const isTrainer = user.roles.includes(UserRole.TRAINER);
    const senderName = `${sender.firstName} ${sender.lastName}`.trim();
    const phone = sender.phone ? ` (${sender.phone})` : '';
    const body = `${senderName}${phone}: ${params.message}`;
    const clubId = requireClubId(user);

    if (params.recipientType === 'admin') {
      const title = isTrainer
        ? 'Сообщение от тренера'
        : 'Сообщение от клиента';

      const admins = await this.prisma.user.findMany({
        where: {
          clubId,
          roles: { some: { role: Role.ADMIN } },
        },
      });

      await Promise.all(
        admins.map(async (admin) => {
          await this.prisma.notification.create({
            data: {
              userId: admin.id,
              type: NotificationType.GENERAL,
              title,
              body,
              senderId: user.sub,
              status: NotificationStatus.PENDING,
            },
          });
          await this.sendWebPush(admin.id, title, body);
        }),
      );

      return { success: true, recipients: admins.length };
    }

    if (!params.trainerId) {
      throw new BadRequestException('Выберите тренера');
    }

    const trainer = await this.prisma.user.findFirst({
      where: {
        id: params.trainerId,
        clubId,
        roles: { some: { role: Role.TRAINER } },
      },
    });

    if (!trainer) {
      throw new NotFoundException('Тренер не найден');
    }

    const title = 'Сообщение от клиента';
    await this.prisma.notification.create({
      data: {
        userId: trainer.id,
        type: NotificationType.GENERAL,
        title,
        body,
        senderId: user.sub,
        status: NotificationStatus.PENDING,
      },
    });
    await this.sendWebPush(trainer.id, title, body);

    return { success: true, recipients: 1 };
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
      (type === NotificationType.RATING_DECAY && prefs.ratingDecayAlerts) ||
      type === NotificationType.GENERAL ||
      type === NotificationType.CHALLENGE ||
      type === NotificationType.WAITLIST_SPOT;

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

  async sendDirectMessage(
    userId: string,
    title: string,
    body: string,
    senderId?: string,
    status: NotificationStatus = NotificationStatus.PENDING,
  ) {
    return this.createNotification({
      userId,
      title,
      body,
      senderId,
      status,
    });
  }

  private async createNotification(params: {
    userId: string;
    title: string;
    body: string;
    senderId?: string;
    status?: NotificationStatus;
    type?: NotificationType;
  }) {
    const notification = await this.prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type ?? NotificationType.GENERAL,
        title: params.title,
        body: params.body,
        senderId: params.senderId,
        status: params.status ?? NotificationStatus.PENDING,
      },
    });

    await this.sendWebPush(params.userId, params.title, params.body);
    return notification;
  }

  private formatCancellationWhen(startAt: Date | null | undefined): string {
    if (!startAt) return '';
    return startAt.toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private async findTrainerByScheduleName(
    clubId: string,
    trainerName: string | null | undefined,
  ) {
    if (!trainerName?.trim()) return null;

    const trainers = await this.prisma.user.findMany({
      where: {
        clubId,
        roles: { some: { role: Role.TRAINER } },
      },
    });

    const normalized = trainerName.trim().toLowerCase();
    return (
      trainers.find((trainer) => {
        const full = `${trainer.firstName} ${trainer.lastName}`.trim().toLowerCase();
        return (
          full === normalized ||
          normalized.includes(trainer.lastName.toLowerCase())
        );
      }) ?? null
    );
  }

  async notifySessionAssigned(params: {
    clientId: string;
    trainerId: string;
    trainerName: string;
    startAt: Date;
  }) {
    const when = this.formatCancellationWhen(params.startAt);
    const body = `${params.trainerName} назначил(а) вам персональную тренировку${when ? ` — ${when}` : ''}.`;

    await this.createNotification({
      userId: params.clientId,
      title: 'Новая тренировка',
      body,
      senderId: params.trainerId,
      status: NotificationStatus.PENDING,
    });
  }

  async notifyBookingCancelled(params: {
    clubId: string;
    clientId: string;
    clientName: string;
    clientPhone?: string;
    sessionTitle: string;
    startAt?: Date | null;
    sessionType: 'group' | 'personal';
    trainerId?: string;
    trainerName?: string | null;
  }) {
    const when = this.formatCancellationWhen(params.startAt ?? null);
    const phoneLine = params.clientPhone ? ` (${params.clientPhone})` : '';
    const sessionLabel =
      params.sessionType === 'group' ? 'групповое' : 'персональное';
    const body = `${params.clientName}${phoneLine} отменил(а) запись на ${sessionLabel} «${params.sessionTitle}»${when ? ` — ${when}` : ''}.`;

    const admins = await this.prisma.user.findMany({
      where: {
        clubId: params.clubId,
        isActive: true,
        roles: { some: { role: { in: [Role.ADMIN, Role.SUPER_ADMIN] } } },
      },
    });

    await Promise.all(
      admins.map((admin) =>
        this.createNotification({
          userId: admin.id,
          title: 'Отмена записи клиента',
          body,
          senderId: params.clientId,
          status: NotificationStatus.PENDING,
        }),
      ),
    );

    const trainerId =
      params.trainerId ??
      (params.sessionType === 'group'
        ? (await this.findTrainerByScheduleName(
            params.clubId,
            params.trainerName,
          ))?.id
        : undefined);

    if (!trainerId) return;

    const isPersonal = params.sessionType === 'personal';
    await this.createNotification({
      userId: trainerId,
      title: isPersonal
        ? 'Отмена персональной тренировки'
        : 'Отмена группового занятия',
      body,
      senderId: params.clientId,
      status: isPersonal
        ? NotificationStatus.PENDING
        : NotificationStatus.COMPLETED,
    });
  }

  /** @deprecated use notifyBookingCancelled */
  async notifyAdminsGroupBookingCancelled(params: {
    clubId: string;
    clientName: string;
    clientPhone?: string;
    classTitle: string;
    classStartAt?: Date | null;
    clientId?: string;
    trainerName?: string | null;
  }) {
    if (!params.clientId) return;

    await this.notifyBookingCancelled({
      clubId: params.clubId,
      clientId: params.clientId,
      clientName: params.clientName,
      clientPhone: params.clientPhone,
      sessionTitle: params.classTitle,
      startAt: params.classStartAt,
      sessionType: 'group',
      trainerName: params.trainerName,
    });
  }

  async sendReminderToClient(userId: string, message: string) {
    return this.sendDirectMessage(userId, 'Сообщение от клуба', message);
  }

  async sendRatingDecayReminder(userId: string, dayOfMonth: number) {
    const messages: Record<number, string> = {
      7: 'В этом месяце ещё не было активности в приложении. Выполните цель, чтобы сохранить лигу!',
      14: 'Половина месяца прошла без активности — ваш рейтинг может понизиться.',
      21: 'До конца месяца осталось мало времени. Сохраните свой рейтинг!',
      25: 'Последние дни! Откройте приложение и выполните цель, иначе лига понизится.',
    };
    const body = messages[dayOfMonth] ?? messages[25];
    return this.sendNotification(
      userId,
      NotificationType.RATING_DECAY,
      'Сохраните рейтинг',
      body,
    );
  }

  getMockClientData() {
    return MOCK_USERS;
  }
}
