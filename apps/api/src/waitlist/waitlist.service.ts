import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GroupClassBookingStatus,
  GroupClassWaitlistStatus,
  NotificationType,
} from '@prisma/client';
import type { ScheduleSlot } from '@fitgo/shared-types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { FitnessService } from '../fitness/fitness.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const REST_NOTIFY_DELAY_MS = 10 * 60 * 1000;

export interface WaitlistSlotMeta {
  title: string;
  trainerName?: string | null;
  startAt: Date;
  endAt: Date;
}

@Injectable()
export class WaitlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
    private readonly notifications: NotificationsService,
  ) {}

  async enrichScheduleSlots(user: JwtPayload, slots: ScheduleSlot[]) {
    if (slots.length === 0) return slots;

    const appointmentIds = slots.map((s) => s.id);
    const entries = await this.prisma.groupClassWaitlistEntry.findMany({
      where: {
        clientId: user.sub,
        appointmentId: { in: appointmentIds },
        status: {
          in: [GroupClassWaitlistStatus.WAITING, GroupClassWaitlistStatus.NOTIFIED],
        },
      },
    });
    const entryByAppointment = new Map(
      entries.map((e) => [e.appointmentId, e]),
    );

    const counts = await this.prisma.groupClassWaitlistEntry.groupBy({
      by: ['appointmentId'],
      where: {
        appointmentId: { in: appointmentIds },
        status: {
          in: [GroupClassWaitlistStatus.WAITING, GroupClassWaitlistStatus.NOTIFIED],
        },
      },
      _count: { _all: true },
    });
    const countByAppointment = new Map(
      counts.map((c) => [c.appointmentId, c._count._all]),
    );

    const openEvents = await this.prisma.groupClassWaitlistOpenEvent.findMany({
      where: {
        appointmentId: { in: appointmentIds },
        resolvedAt: null,
      },
      orderBy: { openedAt: 'desc' },
    });
    const openEventByAppointment = new Map<string, (typeof openEvents)[0]>();
    for (const event of openEvents) {
      if (!openEventByAppointment.has(event.appointmentId)) {
        openEventByAppointment.set(event.appointmentId, event);
      }
    }

    return slots.map((slot) => {
      const userEntry = entryByAppointment.get(slot.id);
      const waitlistCount = countByAppointment.get(slot.id) ?? 0;
      const isFull =
        !slot.available && slot.capacity > 0 && slot.booked >= slot.capacity;
      const openEvent = openEventByAppointment.get(slot.id);

      let canConfirm = false;
      if (userEntry?.status === GroupClassWaitlistStatus.NOTIFIED) {
        if (userEntry.position === 1) {
          canConfirm = true;
        } else if (openEvent?.restNotifiedAt) {
          canConfirm = true;
        }
      }

      return {
        ...slot,
        waitlist: {
          open: isFull,
          count: waitlistCount,
          userPosition: userEntry?.position,
          userStatus: userEntry?.status,
          isFirstInQueue:
            userEntry?.position === 1 &&
            userEntry.status === GroupClassWaitlistStatus.WAITING,
          canConfirm,
        },
      };
    });
  }

  async joinWaitlist(user: JwtPayload, sessionId: string) {
    const clubId = requireClubId(user);
    const slot = await this.requireScheduleSlot(clubId, sessionId);
    if (slot.available) {
      throw new BadRequestException(
        'На занятии ещё есть свободные места — запишитесь напрямую',
      );
    }

    const existingBooking = await this.prisma.groupClassBooking.findFirst({
      where: {
        clientId: user.sub,
        appointmentId: sessionId,
        status: GroupClassBookingStatus.CONFIRMED,
      },
    });
    if (existingBooking) {
      throw new ConflictException('Вы уже записаны на это занятие');
    }

    const existingWaitlist = await this.prisma.groupClassWaitlistEntry.findUnique({
      where: {
        clientId_appointmentId: {
          clientId: user.sub,
          appointmentId: sessionId,
        },
      },
    });
    if (
      existingWaitlist &&
      (existingWaitlist.status === GroupClassWaitlistStatus.WAITING ||
        existingWaitlist.status === GroupClassWaitlistStatus.NOTIFIED)
    ) {
      throw new ConflictException('Вы уже в листе ожидания');
    }

    const activeCount = await this.prisma.groupClassWaitlistEntry.count({
      where: {
        appointmentId: sessionId,
        status: {
          in: [GroupClassWaitlistStatus.WAITING, GroupClassWaitlistStatus.NOTIFIED],
        },
      },
    });
    const position = activeCount + 1;

    const entry = await this.prisma.groupClassWaitlistEntry.upsert({
      where: {
        clientId_appointmentId: {
          clientId: user.sub,
          appointmentId: sessionId,
        },
      },
      create: {
        clubId,
        clientId: user.sub,
        appointmentId: sessionId,
        title: slot.title,
        trainerName: slot.trainerName ?? null,
        startAt: new Date(slot.startAt),
        endAt: new Date(slot.endAt),
        position,
        status: GroupClassWaitlistStatus.WAITING,
      },
      update: {
        title: slot.title,
        trainerName: slot.trainerName ?? null,
        startAt: new Date(slot.startAt),
        endAt: new Date(slot.endAt),
        position,
        status: GroupClassWaitlistStatus.WAITING,
        notifiedAt: null,
      },
    });

    return this.mapEntry(entry);
  }

  async leaveWaitlist(user: JwtPayload, sessionId: string) {
    const entry = await this.prisma.groupClassWaitlistEntry.findFirst({
      where: {
        clientId: user.sub,
        appointmentId: sessionId,
        status: {
          in: [GroupClassWaitlistStatus.WAITING, GroupClassWaitlistStatus.NOTIFIED],
        },
      },
    });
    if (!entry) {
      throw new NotFoundException('Запись в листе ожидания не найдена');
    }

    await this.prisma.groupClassWaitlistEntry.update({
      where: { id: entry.id },
      data: { status: GroupClassWaitlistStatus.CANCELLED },
    });

    await this.recalculatePositions(sessionId);
    return { success: true };
  }

  async assertCanConfirm(user: JwtPayload, sessionId: string) {
    const entry = await this.prisma.groupClassWaitlistEntry.findFirst({
      where: {
        clientId: user.sub,
        appointmentId: sessionId,
        status: GroupClassWaitlistStatus.NOTIFIED,
      },
    });
    if (!entry) {
      throw new BadRequestException('Нет активного приглашения подтвердить запись');
    }

    const openEvent = await this.prisma.groupClassWaitlistOpenEvent.findFirst({
      where: { appointmentId: sessionId, resolvedAt: null },
      orderBy: { openedAt: 'desc' },
    });

    if (entry.position > 1 && !openEvent?.restNotifiedAt) {
      throw new BadRequestException(
        'Первый в очереди получает приглашение на 10 минут раньше — дождитесь уведомления',
      );
    }

    return entry;
  }

  async onConfirmed(user: JwtPayload, sessionId: string) {
    await this.prisma.groupClassWaitlistEntry.updateMany({
      where: {
        clientId: user.sub,
        appointmentId: sessionId,
      },
      data: { status: GroupClassWaitlistStatus.CONFIRMED },
    });

    await this.resolveOpenEvents(sessionId);

    const others = await this.prisma.groupClassWaitlistEntry.findMany({
      where: {
        appointmentId: sessionId,
        status: GroupClassWaitlistStatus.NOTIFIED,
        clientId: { not: user.sub },
      },
    });

    for (const other of others) {
      await this.prisma.groupClassWaitlistEntry.update({
        where: { id: other.id },
        data: {
          status: GroupClassWaitlistStatus.WAITING,
          notifiedAt: null,
        },
      });
      await this.sendWaitlistNotification(
        other.clientId,
        'Место занято',
        `Место на «${other.title}» уже занято. Вы остаётесь в листе ожидания.`,
      );
    }

    await this.recalculatePositions(sessionId);
  }

  async onSpotOpened(
    clubId: string,
    appointmentId: string,
    meta: WaitlistSlotMeta,
  ) {
    const firstWaiting = await this.prisma.groupClassWaitlistEntry.findFirst({
      where: {
        appointmentId,
        status: GroupClassWaitlistStatus.WAITING,
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });

    if (!firstWaiting) return;

    const event = await this.prisma.groupClassWaitlistOpenEvent.create({
      data: {
        clubId,
        appointmentId,
        openedAt: new Date(),
      },
    });

    await this.notifyEntry(firstWaiting, meta, event.id, true);
  }

  async processDelayedNotifications() {
    const cutoff = new Date(Date.now() - REST_NOTIFY_DELAY_MS);
    const events = await this.prisma.groupClassWaitlistOpenEvent.findMany({
      where: {
        resolvedAt: null,
        firstNotifiedAt: { lte: cutoff },
        restNotifiedAt: null,
      },
      take: 50,
    });

    for (const event of events) {
      const waiting = await this.prisma.groupClassWaitlistEntry.findMany({
        where: {
          appointmentId: event.appointmentId,
          status: GroupClassWaitlistStatus.WAITING,
        },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      });

      const meta: WaitlistSlotMeta =
        waiting.length > 0
          ? {
              title: waiting[0].title,
              trainerName: waiting[0].trainerName,
              startAt: waiting[0].startAt,
              endAt: waiting[0].endAt,
            }
          : {
              title: 'Групповое занятие',
              startAt: new Date(),
              endAt: new Date(),
            };

      for (const entry of waiting) {
        await this.notifyEntry(entry, meta, event.id, false);
      }

      await this.prisma.groupClassWaitlistOpenEvent.update({
        where: { id: event.id },
        data: { restNotifiedAt: new Date() },
      });
    }
  }

  async getMyWaitlist(user: JwtPayload) {
    const entries = await this.prisma.groupClassWaitlistEntry.findMany({
      where: {
        clientId: user.sub,
        status: {
          in: [GroupClassWaitlistStatus.WAITING, GroupClassWaitlistStatus.NOTIFIED],
        },
        endAt: { gte: new Date() },
      },
      orderBy: { startAt: 'asc' },
    });

    return entries.map((e) => this.mapEntry(e));
  }

  private async notifyEntry(
    entry: {
      id: string;
      clientId: string;
      appointmentId: string;
      title: string;
      startAt: Date;
      position: number;
    },
    meta: WaitlistSlotMeta,
    eventId: string,
    isFirst: boolean,
  ) {
    await this.prisma.groupClassWaitlistEntry.update({
      where: { id: entry.id },
      data: {
        status: GroupClassWaitlistStatus.NOTIFIED,
        notifiedAt: new Date(),
      },
    });

    if (isFirst) {
      await this.prisma.groupClassWaitlistOpenEvent.update({
        where: { id: eventId },
        data: { firstNotifiedAt: new Date() },
      });
    }

    const when = meta.startAt.toLocaleString('ru-RU', {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });

    const title = isFirst
      ? 'Освободилось место — вы первые в очереди'
      : 'Освободилось место на занятии';

    const body = isFirst
      ? `На «${meta.title}»${when ? ` (${when})` : ''} появилось место. Подтвердите запись в расписании в течение 10 минут до открытия очереди для остальных.`
      : `На «${meta.title}»${when ? ` (${when})` : ''} появилось место. Подтвердите запись в разделе «Расписание».`;

    await this.sendWaitlistNotification(entry.clientId, title, body);
  }

  private async sendWaitlistNotification(
    userId: string,
    title: string,
    body: string,
  ) {
    await this.notifications.sendNotification(
      userId,
      NotificationType.WAITLIST_SPOT,
      title,
      body,
    );
  }

  private async resolveOpenEvents(appointmentId: string) {
    await this.prisma.groupClassWaitlistOpenEvent.updateMany({
      where: { appointmentId, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
  }

  private async recalculatePositions(appointmentId: string) {
    const active = await this.prisma.groupClassWaitlistEntry.findMany({
      where: {
        appointmentId,
        status: {
          in: [GroupClassWaitlistStatus.WAITING, GroupClassWaitlistStatus.NOTIFIED],
        },
      },
      orderBy: [{ createdAt: 'asc' }],
    });

    await Promise.all(
      active.map((entry, index) =>
        this.prisma.groupClassWaitlistEntry.update({
          where: { id: entry.id },
          data: { position: index + 1 },
        }),
      ),
    );
  }

  private mapEntry(entry: {
    id: string;
    appointmentId: string;
    title: string;
    trainerName: string | null;
    startAt: Date;
    endAt: Date;
    position: number;
    status: GroupClassWaitlistStatus;
    notifiedAt: Date | null;
  }) {
    return {
      id: entry.id,
      sessionId: entry.appointmentId,
      title: entry.title,
      trainerName: entry.trainerName ?? undefined,
      startAt: entry.startAt.toISOString(),
      endAt: entry.endAt.toISOString(),
      position: entry.position,
      status: entry.status,
      isFirstInQueue:
        entry.position === 1 && entry.status === GroupClassWaitlistStatus.WAITING,
      notifiedAt: entry.notifiedAt?.toISOString(),
    };
  }

  private async requireScheduleSlot(clubId: string, sessionId: string) {
    const slot = await this.findScheduleSlot(clubId, sessionId);
    if (!slot) {
      throw new NotFoundException('Занятие не найдено в расписании');
    }
    return slot;
  }

  private async findScheduleSlot(clubId: string, sessionId: string) {
    const club = await this.prisma.club.findUnique({ where: { id: clubId } });
    if (!club?.externalId) return null;

    const from = new Date();
    from.setDate(from.getDate() - 1);
    const to = new Date();
    to.setDate(to.getDate() + 60);

    const slots = await this.fitness.getProvider().getSchedule(club.externalId, {
      from: from.toISOString(),
      to: to.toISOString(),
    });
    return slots.find((s) => s.id === sessionId) ?? null;
  }
}
