import { Injectable, NotFoundException } from '@nestjs/common';
import { GroupClassBookingStatus, PersonalBookingStatus, Role } from '@prisma/client';
import { SessionType, UserRole, type Visit } from '@fitgo/shared-types';
import type { ScheduleFilters } from '@fitgo/1c-adapter';
import { ClubMembershipService } from '../common/club-membership.service';
import { FitnessService } from '../fitness/fitness.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PersonalTrainingService } from '../personal-training/personal-training.service';
import { WaitlistService } from '../waitlist/waitlist.service';
import { OsmiCardService } from '../osmi/osmi-card.service';
import type { JwtPayload } from '../auth/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClientService {
  constructor(
    private readonly fitness: FitnessService,
    private readonly prisma: PrismaService,
    private readonly personalTraining: PersonalTrainingService,
    private readonly notifications: NotificationsService,
    private readonly waitlist: WaitlistService,
    private readonly osmiCards: OsmiCardService,
    private readonly clubMembership: ClubMembershipService,
  ) {}

  private async resolveExternalId(user: JwtPayload): Promise<string> {
    const membership = await this.clubMembership.getActiveMembership(user.sub);
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
    });
    const externalId = this.clubMembership.resolveExternalId(
      membership,
      user.externalId ?? dbUser?.externalId,
    );
    if (!externalId) {
      throw new NotFoundException('Клиент не привязан к клубу');
    }
    return externalId;
  }

  private async requireActiveMembership(userId: string) {
    const membership = await this.clubMembership.getActiveMembership(userId);
    if (!membership?.club.externalId) {
      throw new NotFoundException('Нет активного клубного абонемента');
    }
    return membership;
  }

  private async getBookingContext(user: JwtPayload) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
    });
    return {
      phone: dbUser?.phone ?? undefined,
      name: dbUser
        ? `${dbUser.firstName} ${dbUser.lastName}`.trim()
        : undefined,
    };
  }

  private resolveLifecycle(
    status: GroupClassBookingStatus | PersonalBookingStatus,
    endAt: Date,
  ): 'UPCOMING' | 'COMPLETED' | 'CANCELLED' {
    if (status === 'CANCELLED') {
      return 'CANCELLED';
    }
    if (status === GroupClassBookingStatus.COMPLETED) {
      return 'COMPLETED';
    }
    return endAt.getTime() > Date.now() ? 'UPCOMING' : 'COMPLETED';
  }

  private formatVisitTime(date: Date): string {
    return date.toISOString().slice(11, 16);
  }

  private async getAppSessionVisits(
    clientId: string,
    clubName: string,
  ): Promise<Visit[]> {
    const now = new Date();

    const [groupBookings, personalBookings] = await Promise.all([
      this.prisma.groupClassBooking.findMany({
        where: {
          clientId,
          status: { not: GroupClassBookingStatus.CANCELLED },
          endAt: { lt: now },
        },
        orderBy: { startAt: 'desc' },
      }),
      this.prisma.personalTrainingBooking.findMany({
        where: {
          clientId,
          status: { not: PersonalBookingStatus.CANCELLED },
          endAt: { lt: now },
        },
        include: { trainer: true },
        orderBy: { startAt: 'desc' },
      }),
    ]);

    const groupVisits: Visit[] = groupBookings.map((booking) => ({
      id: `group-${booking.id}`,
      date: booking.startAt.toISOString().slice(0, 10),
      checkIn: this.formatVisitTime(booking.startAt),
      checkOut: this.formatVisitTime(booking.endAt),
      clubName,
      title: booking.title,
      sessionType: SessionType.GROUP,
      source: 'fitgo',
    }));

    const personalVisits: Visit[] = personalBookings.map((booking) => ({
      id: `personal-${booking.id}`,
      date: booking.startAt.toISOString().slice(0, 10),
      checkIn: this.formatVisitTime(booking.startAt),
      checkOut: this.formatVisitTime(booking.endAt),
      clubName,
      title: `Персональная · ${booking.trainer.firstName} ${booking.trainer.lastName}`.trim(),
      sessionType: SessionType.PERSONAL,
      source: 'fitgo',
    }));

    return [...groupVisits, ...personalVisits];
  }

  private mergeVisits(externalVisits: Visit[], appVisits: Visit[]): Visit[] {
    return [...externalVisits, ...appVisits].sort((a, b) => {
      const dateCompare = b.date.localeCompare(a.date);
      if (dateCompare !== 0) return dateCompare;
      return (b.checkIn ?? '').localeCompare(a.checkIn ?? '');
    });
  }

  private async syncGroupBookingStatuses(clientId: string) {
    const now = new Date();
    await this.prisma.groupClassBooking.updateMany({
      where: {
        clientId,
        status: GroupClassBookingStatus.CONFIRMED,
        endAt: { lt: now },
      },
      data: { status: GroupClassBookingStatus.COMPLETED },
    });
  }

  private async getGroupClassBookings(
    user: JwtPayload,
    options?: { upcomingOnly?: boolean; includeAll?: boolean },
  ) {
    await this.syncGroupBookingStatuses(user.sub);

    const where: {
      clientId: string;
      status?: GroupClassBookingStatus | { in: GroupClassBookingStatus[] };
      endAt?: { gte: Date };
    } = { clientId: user.sub };

    if (options?.upcomingOnly) {
      where.status = GroupClassBookingStatus.CONFIRMED;
      where.endAt = { gte: new Date() };
    }

    const bookings = await this.prisma.groupClassBooking.findMany({
      where,
      orderBy: { startAt: options?.includeAll ? 'desc' : 'asc' },
    });

    return bookings.map((booking) => ({
      id: booking.id,
      sessionId: booking.appointmentId,
      title: booking.title,
      type: SessionType.GROUP,
      trainerName: booking.trainerName ?? undefined,
      startAt: booking.startAt.toISOString(),
      endAt: booking.endAt.toISOString(),
      source: '1c' as const,
      lifecycle: this.resolveLifecycle(booking.status, booking.endAt),
    }));
  }

  private async upsertGroupClassBooking(
    user: JwtPayload,
    sessionId: string,
    status: GroupClassBookingStatus,
    cancelledAt?: Date | null,
  ): Promise<boolean> {
    const club = await this.prisma.club.findUnique({
      where: { id: user.clubId },
    });
    if (!club?.externalId) return false;

    const from = new Date();
    from.setDate(from.getDate() - 1);
    const to = new Date();
    to.setDate(to.getDate() + 30);

    const slots = await this.fitness.getProvider().getSchedule(club.externalId, {
      from: from.toISOString(),
      to: to.toISOString(),
    });
    const slot = slots.find((s) => s.id === sessionId);
    if (!slot) return false;

    await this.prisma.groupClassBooking.upsert({
      where: {
        clientId_appointmentId: {
          clientId: user.sub,
          appointmentId: sessionId,
        },
      },
      create: {
        clientId: user.sub,
        appointmentId: sessionId,
        title: slot.title,
        trainerName: slot.trainerName,
        startAt: new Date(slot.startAt),
        endAt: new Date(slot.endAt),
        status,
        cancelledAt: cancelledAt ?? null,
      },
      update: {
        title: slot.title,
        trainerName: slot.trainerName,
        startAt: new Date(slot.startAt),
        endAt: new Date(slot.endAt),
        status,
        cancelledAt: cancelledAt ?? null,
      },
    });

    return true;
  }

  private async saveGroupClassBooking(
    user: JwtPayload,
    sessionId: string,
  ) {
    await this.upsertGroupClassBooking(
      user,
      sessionId,
      GroupClassBookingStatus.CONFIRMED,
      null,
    );
  }

  private async persistGroupBookingCancellation(
    user: JwtPayload,
    sessionId: string,
    existing?: {
      id: string;
      title: string;
      trainerName: string | null;
      startAt: Date;
      endAt: Date;
    } | null,
  ): Promise<boolean> {
    const cancelledAt = new Date();

    if (existing) {
      await this.prisma.groupClassBooking.update({
        where: { id: existing.id },
        data: {
          status: GroupClassBookingStatus.CANCELLED,
          cancelledAt,
        },
      });
      return true;
    }

    const savedFromSchedule = await this.upsertGroupClassBooking(
      user,
      sessionId,
      GroupClassBookingStatus.CANCELLED,
      cancelledAt,
    );
    if (savedFromSchedule) return true;

    return false;
  }

  private async findScheduleSlot(clubId: string, sessionId: string) {
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
    });
    if (!club?.externalId) return null;

    const from = new Date();
    from.setDate(from.getDate() - 30);
    const to = new Date();
    to.setDate(to.getDate() + 60);

    const slots = await this.fitness.getProvider().getSchedule(club.externalId, {
      from: from.toISOString(),
      to: to.toISOString(),
    });
    return slots.find((s) => s.id === sessionId) ?? null;
  }

  async getDashboard(user: JwtPayload) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
      include: { club: true },
    });
    const activeMembership = await this.clubMembership.getActiveMembership(user.sub);
    const clubRecord = activeMembership?.club ?? null;
    const externalId = activeMembership
      ? this.clubMembership.resolveExternalId(
          activeMembership,
          user.externalId ?? dbUser?.externalId,
        )
      : undefined;
    const provider = this.fitness.getProvider();
    const clubName = clubRecord?.name ?? 'Клуб';

    const osmiEnabled = this.osmiCards.isEnabled();
    const osmiAccess =
      osmiEnabled && dbUser && clubRecord
        ? this.osmiCards.getAccessCardFromCache({
            id: dbUser.id,
            firstName: dbUser.firstName,
            lastName: dbUser.lastName,
            osmiCardId: dbUser.osmiCardId,
            osmiBarcode: dbUser.osmiBarcode,
            club: clubRecord,
          })
        : null;

    const [membershipFromFitness, externalVisits, accessCardFromFitness, appVisits] =
      await Promise.all([
        externalId && !osmiEnabled
          ? provider.getMembership(externalId)
          : Promise.resolve(null),
        externalId ? provider.getVisits(externalId) : Promise.resolve([]),
        externalId && !osmiEnabled
          ? provider.getAccessCard(externalId)
          : Promise.resolve(null),
        this.getAppSessionVisits(user.sub, clubName),
      ]);

    let membership = membershipFromFitness;
    let accessCard = accessCardFromFitness;

    if (osmiEnabled && dbUser?.phone && activeMembership) {
      try {
        const osmiResult = await this.osmiCards.getClubCard(user);
        if (osmiResult.card) {
          accessCard = {
            id: osmiResult.card.id,
            barcode: osmiResult.card.barcode,
            clientName: osmiResult.card.clientName,
            clubName: osmiResult.card.clubName,
          };
          if (osmiResult.card.membership) {
            membership = osmiResult.card.membership;
          }
        } else if (osmiAccess) {
          accessCard = osmiAccess;
        }
      } catch {
        if (osmiAccess) accessCard = osmiAccess;
      }
    }

    const visits = this.mergeVisits(
      externalVisits.map((visit) => ({ ...visit, source: '1c' as const })),
      appVisits,
    );

    return {
      profile: {
        id: user.sub,
        externalId,
        clubId: user.clubId,
        email: user.email,
        firstName: dbUser?.firstName ?? '',
        lastName: dbUser?.lastName ?? '',
        phone: dbUser?.phone ?? undefined,
        roles: user.roles,
      },
      membership,
      visits,
      accessCard,
      club: clubRecord
        ? {
            id: clubRecord.id,
            name: clubRecord.name,
            slug: clubRecord.slug,
            address: clubRecord.address ?? undefined,
          }
        : null,
    };
  }

  async joinClub(user: JwtPayload, clubSlug: string, externalId?: string) {
    const membership = await this.clubMembership.joinClub(
      user.sub,
      clubSlug,
      externalId,
    );
    return {
      club: {
        id: membership.club.id,
        name: membership.club.name,
        slug: membership.club.slug,
        address: membership.club.address ?? undefined,
      },
      externalId: membership.externalId ?? undefined,
      joinedAt: membership.joinedAt.toISOString(),
    };
  }

  async getMembership(user: JwtPayload) {
    const activeMembership = await this.clubMembership.getActiveMembership(user.sub);
    if (!activeMembership) {
      return { membership: null, club: null };
    }

    const externalId = this.clubMembership.resolveExternalId(
      activeMembership,
      user.externalId,
    );
    const membership =
      externalId && !this.osmiCards.isEnabled()
        ? await this.fitness.getProvider().getMembership(externalId)
        : null;

    return {
      membership,
      club: {
        id: activeMembership.club.id,
        name: activeMembership.club.name,
        slug: activeMembership.club.slug,
        address: activeMembership.club.address ?? undefined,
      },
    };
  }

  async getClubVisits(user: JwtPayload) {
    const activeMembership = await this.clubMembership.getActiveMembership(user.sub);
    if (!activeMembership) {
      return [];
    }

    const externalId = this.clubMembership.resolveExternalId(
      activeMembership,
      user.externalId,
    );
    const externalVisits = externalId
      ? await this.fitness.getProvider().getVisits(externalId)
      : [];
    const groupAppVisits = (
      await this.getAppSessionVisits(user.sub, activeMembership.club.name)
    ).filter((visit) => visit.sessionType === SessionType.GROUP);

    return this.mergeVisits(
      externalVisits.map((visit) => ({ ...visit, source: '1c' as const })),
      groupAppVisits,
    );
  }

  async getSchedule(user: JwtPayload, filters?: ScheduleFilters) {
    const membership = await this.requireActiveMembership(user.sub);
    const club = membership.club;
    if (!club?.externalId) {
      throw new NotFoundException('Клуб не привязан к 1С');
    }

    const slots = await this.fitness
      .getProvider()
      .getSchedule(club.externalId, filters);

    const now = Date.now();
    const filtered = slots
      .filter((slot) => new Date(slot.endAt).getTime() > now)
      .sort((a, b) => a.startAt.localeCompare(b.startAt));

    return this.waitlist.enrichScheduleSlots(user, filtered);
  }

  async getProducts(user: JwtPayload) {
    const membership = await this.requireActiveMembership(user.sub);
    const club = membership.club;
    if (!club?.externalId) {
      throw new NotFoundException('Клуб не привязан к 1С');
    }
    return this.fitness.getProvider().getMembershipProducts(club.externalId);
  }

  async getBookings(user: JwtPayload) {
    const personalBookings =
      await this.personalTraining.getClientPersonalBookings(user, {
        upcomingOnly: true,
      });
    const personalItems =
      this.personalTraining.toBookingItems(personalBookings);
    const groupItems = await this.getGroupClassBookings(user, {
      upcomingOnly: true,
    });

    return [...groupItems, ...personalItems].sort((a, b) =>
      a.startAt.localeCompare(b.startAt),
    );
  }

  async getBookingHistory(
    user: JwtPayload,
    filter: 'all' | 'upcoming' | 'completed' | 'cancelled',
  ) {
    const groupItems = await this.getGroupClassBookings(user, {
      includeAll: true,
    });
    const personalBookings =
      await this.personalTraining.getClientPersonalBookings(user, {
        includeAll: true,
      });
    const personalItems =
      this.personalTraining.toBookingItems(personalBookings);

    const items = [...groupItems, ...personalItems].sort((a, b) =>
      b.startAt.localeCompare(a.startAt),
    );

    if (filter === 'all') return items;

    const lifecycleFilter =
      filter === 'upcoming'
        ? 'UPCOMING'
        : filter === 'completed'
          ? 'COMPLETED'
          : 'CANCELLED';

    return items.filter((item) => item.lifecycle === lifecycleFilter);
  }

  async getClubTrainers(clubId: string) {
    const trainers = await this.prisma.user.findMany({
      where: {
        clubId,
        roles: { some: { role: Role.TRAINER } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    return trainers.map((trainer) => ({
      id: trainer.id,
      firstName: trainer.firstName,
      lastName: trainer.lastName,
    }));
  }

  async bookSession(user: JwtPayload, sessionId: string) {
    const context = await this.getBookingContext(user);
    const externalId = user.externalId ?? user.sub;
    const result = await this.fitness
      .getProvider()
      .bookSession(externalId, sessionId, context);

    if (result.success) {
      await this.saveGroupClassBooking(user, sessionId);
    }

    return result;
  }

  async cancelBooking(user: JwtPayload, sessionId: string) {
    const context = await this.getBookingContext(user);
    const externalId = await this.resolveExternalId(user);

    const [booking, dbUser] = await Promise.all([
      this.prisma.groupClassBooking.findFirst({
        where: { clientId: user.sub, appointmentId: sessionId },
      }),
      this.prisma.user.findUnique({ where: { id: user.sub } }),
    ]);

    const externalResult = await this.fitness
      .getProvider()
      .cancelBooking(externalId, sessionId, context);

    if (!externalResult.success) {
      return externalResult;
    }

    await this.persistGroupBookingCancellation(user, sessionId, booking);

    const cancelledBooking = await this.prisma.groupClassBooking.findFirst({
      where: { clientId: user.sub, appointmentId: sessionId },
    });
    const slot =
      !cancelledBooking?.title && !booking?.title
        ? await this.findScheduleSlot(user.clubId, sessionId)
        : null;

    const clientName = dbUser
      ? `${dbUser.firstName} ${dbUser.lastName}`.trim()
      : 'Клиент';

    await this.notifications.notifyBookingCancelled({
      clubId: user.clubId,
      clientId: user.sub,
      clientName,
      clientPhone: dbUser?.phone ?? undefined,
      sessionTitle:
        cancelledBooking?.title ??
        booking?.title ??
        slot?.title ??
        'Групповое занятие',
      startAt:
        cancelledBooking?.startAt ??
        booking?.startAt ??
        (slot ? new Date(slot.startAt) : null),
      sessionType: 'group',
      trainerName:
        cancelledBooking?.trainerName ??
        booking?.trainerName ??
        slot?.trainerName,
    });

    await this.waitlist.onSpotOpened(user.clubId, sessionId, {
      title:
        cancelledBooking?.title ??
        booking?.title ??
        slot?.title ??
        'Групповое занятие',
      trainerName:
        cancelledBooking?.trainerName ??
        booking?.trainerName ??
        slot?.trainerName,
      startAt:
        cancelledBooking?.startAt ??
        booking?.startAt ??
        (slot ? new Date(slot.startAt) : new Date()),
      endAt:
        cancelledBooking?.endAt ??
        booking?.endAt ??
        (slot ? new Date(slot.endAt) : new Date()),
    });

    return {
      success: true,
      message: externalResult.message ?? 'Запись отменена на сервере клуба',
    };
  }

  async createPayment(user: JwtPayload, productId: string) {
    const externalId = await this.resolveExternalId(user);
    return this.fitness.getProvider().createPayment(externalId, productId);
  }

  async joinWaitlist(user: JwtPayload, sessionId: string) {
    return this.waitlist.joinWaitlist(user, sessionId);
  }

  async leaveWaitlist(user: JwtPayload, sessionId: string) {
    return this.waitlist.leaveWaitlist(user, sessionId);
  }

  async getWaitlist(user: JwtPayload) {
    return this.waitlist.getMyWaitlist(user);
  }

  async confirmWaitlistSpot(user: JwtPayload, sessionId: string) {
    await this.waitlist.assertCanConfirm(user, sessionId);
    const result = await this.bookSession(user, sessionId);
    if (result.success) {
      await this.waitlist.onConfirmed(user, sessionId);
    }
    return result;
  }

  getClubCard(user: JwtPayload) {
    return this.osmiCards.getClubCard(user);
  }

  syncClubCard(user: JwtPayload) {
    return this.osmiCards.getClubCard(user, { forceRefresh: true });
  }

  ensureClientRole(user: JwtPayload) {
    if (!user.roles.includes(UserRole.CLIENT)) {
      throw new NotFoundException();
    }
  }
}
