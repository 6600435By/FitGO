import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GroupClassBookingStatus, PersonalBookingStatus, Role } from '@prisma/client';
import {
  MembershipStatus,
  SessionType,
  UserRole,
  type ClubCardView,
  type Membership,
  type Visit,
} from '@fitgo/shared-types';
import {
  deriveMembershipFromVisits,
  type ScheduleFilters,
} from '@fitgo/1c-adapter';
import { ClubCrmLinkService } from '../common/club-crm-link.service';
import { ClubMembershipService } from '../common/club-membership.service';
import { FitnessService } from '../fitness/fitness.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PersonalTrainingService } from '../personal-training/personal-training.service';
import { WaitlistService } from '../waitlist/waitlist.service';
import { OsmiCardService } from '../osmi/osmi-card.service';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
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
    private readonly crmLink: ClubCrmLinkService,
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
      where: { id: requireClubId(user) },
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
    const [crm, dbUser, activeMembership] = await Promise.all([
      this.crmLink.syncMembershipCrmLink(user.sub),
      this.prisma.user.findUnique({
        where: { id: user.sub },
        include: { club: true },
      }),
      this.clubMembership.getActiveMembership(user.sub),
    ]);

    const clubRecord = activeMembership?.club ?? null;
    const externalId =
      crm.externalId ??
      (activeMembership
        ? this.clubMembership.resolveExternalId(
            activeMembership,
            user.externalId ?? dbUser?.externalId,
          )
        : undefined);
    const provider = this.fitness.getProvider();
    const clubName = clubRecord?.name ?? 'Клуб';
    const osmiEnabled = this.osmiCards.isEnabled();

    // Home shows only 3 recent visits — don't pull a wide 1C range over VPN.
    const visitsTo = new Date();
    const visitsFrom = new Date();
    visitsFrom.setDate(visitsFrom.getDate() - 45);
    const visitPeriod = {
      from: visitsFrom.toISOString().slice(0, 10),
      to: visitsTo.toISOString().slice(0, 10),
    };

    // Skip /client profile: names/phone already in FitGO DB (saves 1 round-trip to 1C).
    const [membershipResult, visitsResult, cardResult, appVisits] =
      await Promise.all([
        externalId
          ? provider.getMembership(externalId).catch(() => null)
          : Promise.resolve(null),
        externalId
          ? provider.getVisits(externalId, visitPeriod).catch(() => [] as Visit[])
          : Promise.resolve([] as Visit[]),
        externalId
          ? provider.getAccessCard(externalId).catch(() => null)
          : Promise.resolve(null),
        this.getAppSessionVisits(user.sub, clubName),
      ]);

    const externalVisits = visitsResult;
    let membership = membershipResult;
    let membershipSource: '1c' | 'osmi' | 'derived' | null = membership
      ? '1c'
      : null;
    let accessCard = cardResult;
    let cardSource: ClubCardView['source'] | undefined = accessCard
      ? '1c'
      : undefined;

    // OSMI: barcode fallback only when 1C card missing (avoid extra wait when 1C ok)
    if (osmiEnabled && dbUser?.phone && activeMembership && !accessCard) {
      try {
        const osmiResult = await this.osmiCards.getClubCard(user);
        if (!membership && osmiResult.card?.membership) {
          membership = osmiResult.card.membership;
          membershipSource = 'osmi';
        }
        if (osmiResult.card) {
          accessCard = {
            id: osmiResult.card.id,
            barcode: osmiResult.card.barcode,
            clientName: osmiResult.card.clientName,
            clubName: osmiResult.card.clubName,
          };
          cardSource = 'osmi';
        } else {
          const osmiAccess = this.osmiCards.getAccessCardFromCache({
            id: dbUser.id,
            firstName: dbUser.firstName,
            lastName: dbUser.lastName,
            osmiCardId: dbUser.osmiCardId,
            osmiBarcode: dbUser.osmiBarcode,
            club: clubRecord ?? { name: clubName },
          });
          if (osmiAccess) {
            accessCard = osmiAccess;
            cardSource = 'osmi';
          }
        }
      } catch {
        const osmiAccess = this.osmiCards.getAccessCardFromCache({
          id: dbUser.id,
          firstName: dbUser.firstName,
          lastName: dbUser.lastName,
          osmiCardId: dbUser.osmiCardId,
          osmiBarcode: dbUser.osmiBarcode,
          club: clubRecord ?? { name: clubName },
        });
        if (osmiAccess) {
          accessCard = osmiAccess;
          cardSource = 'osmi';
        }
      }
    } else if (
      osmiEnabled &&
      dbUser?.phone &&
      activeMembership &&
      !membership
    ) {
      try {
        const osmiResult = await this.osmiCards.getClubCard(user);
        if (osmiResult.card?.membership) {
          membership = osmiResult.card.membership;
          membershipSource = 'osmi';
        }
      } catch {
        // ignore
      }
    }

    if (!membership) {
      membership = deriveMembershipFromVisits(externalVisits);
      if (membership) membershipSource = 'derived';
    }

    const visits = this.mergeVisits(
      externalVisits.map((visit) => ({ ...visit, source: '1c' as const })),
      appVisits,
    );

    const crmStatus =
      crm.crmStatus ??
      activeMembership?.crmStatus ??
      (externalId ? 'LINKED' : activeMembership ? 'PENDING_CRM' : null);

    return {
      profile: {
        id: user.sub,
        externalId,
        clubId: user.clubId ?? clubRecord?.id ?? '',
        email: user.email,
        firstName: dbUser?.firstName || '',
        lastName: dbUser?.lastName || '',
        phone: dbUser?.phone || undefined,
        roles: user.roles,
      },
      membership,
      membershipSource,
      visits,
      accessCard,
      cardSource,
      crmStatus,
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

  async listClubs() {
    const clubs = await this.prisma.club.findMany({
      orderBy: { name: 'asc' },
    });
    return clubs.map((club) => ({
      id: club.id,
      name: club.name,
      slug: club.slug,
      address: club.address ?? undefined,
    }));
  }

  async joinClub(user: JwtPayload, clubSlug: string, externalId?: string) {
    const membership = await this.clubMembership.joinClub(
      user.sub,
      clubSlug,
      externalId,
    );
    const crm = await this.crmLink.syncMembershipCrmLink(user.sub, {
      force: true,
    });
    return {
      club: {
        id: membership.club.id,
        name: membership.club.name,
        slug: membership.club.slug,
        address: membership.club.address ?? undefined,
      },
      externalId: crm.externalId ?? membership.externalId ?? undefined,
      crmStatus: crm.crmStatus,
      joinedAt: membership.joinedAt.toISOString(),
    };
  }

  async getMembership(user: JwtPayload) {
    const crm = await this.crmLink.syncMembershipCrmLink(user.sub);
    const activeMembership = await this.clubMembership.getActiveMembership(user.sub);
    if (!activeMembership) {
      return { membership: null, club: null, crmStatus: null };
    }

    const externalId =
      crm.externalId ??
      this.clubMembership.resolveExternalId(
        activeMembership,
        user.externalId,
      );
    const provider = this.fitness.getProvider();
    let membership: Membership | null = externalId
      ? await provider.getMembership(externalId).catch(() => null)
      : null;

    if (!membership && this.osmiCards.isEnabled()) {
      try {
        const osmiResult = await this.osmiCards.getClubCard(user);
        membership = osmiResult.card?.membership ?? null;
      } catch {
        // ignore
      }
    }

    if (!membership && externalId) {
      const visits = await provider.getVisits(externalId).catch(() => [] as Visit[]);
      membership = deriveMembershipFromVisits(visits);
    }

    return {
      membership,
      crmStatus:
        crm.crmStatus ??
        activeMembership.crmStatus ??
        (externalId ? 'LINKED' : 'PENDING_CRM'),
      club: {
        id: activeMembership.club.id,
        name: activeMembership.club.name,
        slug: activeMembership.club.slug,
        address: activeMembership.club.address ?? undefined,
      },
    };
  }

  async freezeMembership(user: JwtPayload, days: number, fromDate?: string) {
    if (!Number.isInteger(days) || days < 1) {
      throw new BadRequestException('Укажите число дней заморозки (не меньше 1)');
    }

    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const startKey = fromDate ?? todayKey;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startKey)) {
      throw new BadRequestException('fromDate must be YYYY-MM-DD');
    }
    if (startKey < todayKey) {
      throw new BadRequestException('Дата начала заморозки не может быть в прошлом');
    }

    const crm = await this.crmLink.syncMembershipCrmLink(user.sub);
    const activeMembership = await this.clubMembership.getActiveMembership(user.sub);
    if (!activeMembership) {
      throw new NotFoundException('Нет активного клуба');
    }
    const externalId =
      crm.externalId ??
      this.clubMembership.resolveExternalId(activeMembership, user.externalId);
    if (!externalId) {
      throw new BadRequestException('Клиент ещё не привязан к 1С');
    }

    const provider = this.fitness.getProvider();
    const freezeFn = provider.freezeMembership;
    if (!freezeFn) {
      throw new BadRequestException('Заморозка абонемента недоступна для этого клуба');
    }

    let current: Membership | null = null;
    try {
      current = await provider.getMembership(externalId);
    } catch {
      current = null;
    }
    if (!current) {
      throw new NotFoundException('Абонемент не найден');
    }
    if (current.freezeAllowed !== true) {
      throw new ConflictException('У этого абонемента нет функции заморозки');
    }
    if (current.status === MembershipStatus.FROZEN) {
      throw new ConflictException('Абонемент уже заморожен');
    }
    const remaining = current.freezeDaysRemaining ?? 0;
    if (days > remaining) {
      throw new BadRequestException(
        `Доступно заморозок: ${remaining} дн., запрошено ${days}`,
      );
    }

    try {
      const membership = await freezeFn.call(provider, externalId, days, startKey);
      return { membership };
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const raw =
        err instanceof Error ? err.message : 'Не удалось заморозить абонемент';
      if (status === 409) throw new ConflictException(raw);
      if (status === 404) {
        // Empty 404 from Apache/1C usually = URL template not published
        if (/FitGO 1C API error 404/i.test(raw) || /not found/i.test(raw)) {
          throw new BadRequestException(
            'Заморозка в 1С недоступна: не опубликован POST /v1/membership/freeze. Шаблон URL в FitGOIntegration должен быть с префиксом /v1, затем F7 и переопубликовать.',
          );
        }
        throw new NotFoundException(raw);
      }
      if (/Предупреждение безопасности/i.test(raw)) {
        throw new BadRequestException(
          'Заморозка в 1С заблокирована «Защитой от опасных действий» (проведение документа создаёт COM-объект WinHttp). Снимите флаг у расширения FitGOIntegration в конфигураторе.',
        );
      }
      throw new BadRequestException(raw);
    }
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
    let externalId: string;
    try {
      externalId = await this.resolveExternalId(user);
    } catch {
      throw new BadRequestException(
        'Запись на групповые доступна после оформления в 1С. Посмотрите расписание или обратитесь на ресепшен.',
      );
    }
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
    const clubId = requireClubId(user);
    const slot =
      !cancelledBooking?.title && !booking?.title
        ? await this.findScheduleSlot(clubId, sessionId)
        : null;

    const clientName = dbUser
      ? `${dbUser.firstName} ${dbUser.lastName}`.trim()
      : 'Клиент';

    await this.notifications.notifyBookingCancelled({
      clubId,
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

    await this.waitlist.onSpotOpened(clubId, sessionId, {
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

  async getClubCard(user: JwtPayload, options?: { forceRefresh?: boolean }) {
    const crm = await this.crmLink.syncMembershipCrmLink(user.sub, {
      force: options?.forceRefresh,
    });
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
      include: { club: true },
    });
    if (!dbUser) throw new NotFoundException();

    const activeMembership = await this.clubMembership.getActiveMembership(user.sub);
    const clubRecord = activeMembership?.club ?? dbUser.club;
    const externalId =
      crm.externalId ??
      this.clubMembership.resolveExternalId(
        activeMembership,
        user.externalId ?? dbUser.externalId,
      );
    const crmStatus =
      crm.crmStatus ??
      activeMembership?.crmStatus ??
      (externalId ? 'LINKED' : activeMembership ? 'PENDING_CRM' : null);

    if (!activeMembership) {
      return {
        enabled: true as const,
        card: null as ClubCardView | null,
        needsPhone: !dbUser.phone?.trim(),
        crmStatus: null,
      };
    }

    if (crmStatus === 'PENDING_CRM' || !externalId) {
      // OSMI barcode allowed for trial entry before 1C CRM link
      if (this.osmiCards.isEnabled() && dbUser.phone?.trim()) {
        try {
          const osmiResult = await this.osmiCards.getClubCard(user, {
            forceRefresh: options?.forceRefresh,
          });
          if (osmiResult.card) {
            return {
              enabled: true as const,
              card: {
                ...osmiResult.card,
                membership: null,
                source: 'osmi' as const,
              },
              needsPhone: false,
              crmStatus: 'PENDING_CRM' as const,
              syncError: osmiResult.syncError,
              anketaUrl: osmiResult.anketaUrl,
            };
          }
          return {
            enabled: true as const,
            card: null,
            needsPhone: osmiResult.needsPhone,
            crmStatus: 'PENDING_CRM' as const,
            syncError: osmiResult.syncError,
            anketaUrl: osmiResult.anketaUrl,
          };
        } catch {
          // fall through
        }
      }
      return {
        enabled: true as const,
        card: null as ClubCardView | null,
        needsPhone: !dbUser.phone?.trim(),
        crmStatus: 'PENDING_CRM' as const,
      };
    }

    const provider = this.fitness.getProvider();
    const [membershipRaw, accessCard, visits] = await Promise.all([
      provider.getMembership(externalId).catch(() => null),
      provider.getAccessCard(externalId).catch(() => null),
      provider.getVisits(externalId).catch(() => [] as Visit[]),
    ]);
    const membership =
      membershipRaw ?? deriveMembershipFromVisits(visits);

    if (accessCard?.barcode) {
      const card: ClubCardView = {
        id: accessCard.id,
        barcode: accessCard.barcode,
        barcodeFormat: 'CODE128',
        clientName: accessCard.clientName,
        clubName: accessCard.clubName,
        membership,
        syncedAt: new Date().toISOString(),
        source: '1c',
      };
      return {
        enabled: true as const,
        card,
        needsPhone: false,
        crmStatus: 'LINKED' as const,
      };
    }

    // Barcode fallback via OSMI (membership still from 1C)
    if (this.osmiCards.isEnabled() && dbUser.phone?.trim()) {
      try {
        const osmiResult = await this.osmiCards.getClubCard(user, {
          forceRefresh: options?.forceRefresh,
        });
        if (osmiResult.card) {
          const card: ClubCardView = {
            ...osmiResult.card,
            membership,
            source: 'osmi',
          };
          return {
            enabled: true as const,
            card,
            needsPhone: false,
            crmStatus: 'LINKED' as const,
            syncError: osmiResult.syncError,
            anketaUrl: osmiResult.anketaUrl,
          };
        }
        return {
          enabled: true as const,
          card: null,
          needsPhone: osmiResult.needsPhone,
          crmStatus: 'LINKED' as const,
          syncError: osmiResult.syncError,
          anketaUrl: osmiResult.anketaUrl,
        };
      } catch {
        // fall through
      }
    }

    return {
      enabled: true as const,
      card: null as ClubCardView | null,
      needsPhone: false,
      crmStatus: 'LINKED' as const,
      membership,
      clubName: clubRecord?.name,
    };
  }

  syncClubCard(user: JwtPayload) {
    return this.getClubCard(user, { forceRefresh: true });
  }

  ensureClientRole(user: JwtPayload) {
    if (!user.roles.includes(UserRole.CLIENT)) {
      throw new NotFoundException();
    }
  }
}
