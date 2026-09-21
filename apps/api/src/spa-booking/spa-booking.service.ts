import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AvailabilityBlockStatus,
  Role,
  ServiceUsageStatus,
  SpaBookingOrigin,
  SpaBookingStatus,
  SpaCancelledBy,
  SpaPaymentType,
  type SpaService as PrismaSpaService,
} from '@prisma/client';
import {
  classifyVisitKind,
  SessionType,
  toUsageControl,
  type Membership,
  type SpaBooking,
  type SpaQuotaRule,
  type SpaService,
  type SpaServiceEligibility,
  type SpecialistCalendarResponse,
} from '@fitgo/shared-types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { ClubCrmLinkService } from '../common/club-crm-link.service';
import { ClubMembershipService } from '../common/club-membership.service';
import { FitnessService } from '../fitness/fitness.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ServiceUsageService } from '../service-usage/service-usage.service';

export interface WorkSlotInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

/** Клиент может отменить SPA не позднее чем за N часов до начала. */
const SPA_CANCEL_MIN_HOURS_BEFORE = 3;

@Injectable()
export class SpaBookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
    private readonly crmLink: ClubCrmLinkService,
    private readonly clubMembership: ClubMembershipService,
    private readonly notifications: NotificationsService,
    private readonly serviceUsage: ServiceUsageService,
  ) {}

  // ─── Catalog helpers ───────────────────────────────────────────────────────

  private mapService(s: PrismaSpaService): SpaService {
    return {
      id: s.id,
      clubId: s.clubId,
      name: s.name,
      kind: s.kind,
      durationMin: s.durationMin,
      bufferMin: s.bufferMin,
      priceMinor: s.priceMinor,
      currency: s.currency,
      active: s.active,
    };
  }

  private mapBooking(booking: {
    id: string;
    clubId: string;
    specialistId: string;
    clientId: string;
    serviceId: string;
    startAt: Date;
    endAt: Date;
    status: SpaBookingStatus;
    origin: SpaBookingOrigin;
    paymentType: SpaPaymentType;
    priceMinor: number | null;
    membershipServiceName: string | null;
    consumedInCrmAt: Date | null;
    cancelledBy: SpaCancelledBy | null;
    cancelledAt: Date | null;
    controlLevel?: string;
    presenceStatus?: string;
    performanceStatus?: string;
    usageStatus?: string;
    paymentStatus?: string;
    reviewFlag?: boolean;
    eligibleForMotivation?: boolean;
    specialistCompletedAt?: Date | null;
    paidAt?: Date | null;
    specialist: { firstName: string; lastName: string };
    client: { firstName: string; lastName: string };
    service: { name: string };
  }): SpaBooking {
    const usage =
      booking.controlLevel != null
        ? toUsageControl({
            controlLevel: booking.controlLevel,
            presenceStatus: booking.presenceStatus ?? 'PENDING',
            performanceStatus: booking.performanceStatus ?? 'PENDING',
            usageStatus: booking.usageStatus ?? 'BOOKED',
            paymentStatus: booking.paymentStatus ?? 'N_A',
            reviewFlag: Boolean(booking.reviewFlag),
            eligibleForMotivation: Boolean(booking.eligibleForMotivation),
          })
        : undefined;
    return {
      id: booking.id,
      clubId: booking.clubId,
      specialistId: booking.specialistId,
      specialistName:
        `${booking.specialist.firstName} ${booking.specialist.lastName}`.trim(),
      clientId: booking.clientId,
      clientName: `${booking.client.firstName} ${booking.client.lastName}`.trim(),
      serviceId: booking.serviceId,
      serviceName: booking.service.name,
      startAt: booking.startAt.toISOString(),
      endAt: booking.endAt.toISOString(),
      status: booking.status,
      origin: booking.origin,
      paymentType: booking.paymentType,
      priceMinor: booking.priceMinor ?? undefined,
      membershipServiceName: booking.membershipServiceName ?? undefined,
      consumedInCrmAt: booking.consumedInCrmAt?.toISOString(),
      cancelledBy: booking.cancelledBy ?? undefined,
      cancelledAt: booking.cancelledAt?.toISOString(),
      usage,
      specialistCompletedAt: booking.specialistCompletedAt?.toISOString(),
      paidAt: booking.paidAt?.toISOString(),
    };
  }

  private cancelledByLabel(by: SpaCancelledBy | null | undefined): string | undefined {
    if (!by) return undefined;
    switch (by) {
      case SpaCancelledBy.CLIENT:
        return 'Отменено клиентом';
      case SpaCancelledBy.SPECIALIST:
        return 'Отменено специалистом';
      case SpaCancelledBy.ADMIN:
        return 'Отменено администратором';
      case SpaCancelledBy.CRM_ADMIN:
        return 'Отменено администратором в 1С';
      default:
        return 'Отменено';
    }
  }

  /** Подтянуть из 1С отмены/удаления визитов → CANCELLED + CRM_ADMIN. */
  private async syncCrmCancellations(
    clientId: string,
    bookings: Array<{
      id: string;
      status: SpaBookingStatus;
      consumedInCrmAt: Date | null;
      crmDocRef: string | null;
    }>,
  ) {
    const provider = this.fitness.getProvider();
    const getStatus = provider.getSpaVisitStatus;
    if (!getStatus) return;

    const candidates = bookings.filter(
      (b) =>
        b.status === SpaBookingStatus.CONFIRMED &&
        b.consumedInCrmAt != null,
    );
    if (candidates.length === 0) return;

    let externalId: string;
    try {
      ({ externalId } = await this.resolveExternalId(clientId));
    } catch {
      return;
    }

    await Promise.all(
      candidates.map(async (b) => {
        try {
          const st = await getStatus.call(provider, externalId, {
            bookingRef: b.crmDocRef ?? b.id,
          });
          if (!st.cancelled) return;
          await this.prisma.spaBooking.update({
            where: { id: b.id },
            data: {
              status: SpaBookingStatus.CANCELLED,
              cancelledBy: SpaCancelledBy.CRM_ADMIN,
              cancelledAt: new Date(),
            },
          });
        } catch {
          /* ignore single-booking sync errors */
        }
      }),
    );
  }

  private isSpaMembershipService(name: string): boolean {
    const kind = classifyVisitKind({ title: name, basisType: 'service' });
    return kind === 'SPA_MASSAGE' || kind === 'SPA_BODYCOMP';
  }

  private matchQuota(
    membership: Membership | null,
    membershipServiceName?: string,
  ): { name: string; remaining?: number; unlimited?: boolean } | null {
    if (!membership?.services?.length) return null;
    if (membershipServiceName) {
      const exact = membership.services.find(
        (s) => s.name === membershipServiceName,
      );
      if (exact) return exact;
    }
    return (
      membership.services.find((s) => this.isSpaMembershipService(s.name)) ??
      null
    );
  }

  // ─── Client: services / specialists / slots ────────────────────────────────

  async listClientSpaServices(
    user: JwtPayload,
    opts?: { membershipServiceName?: string; quotaOnly?: boolean },
  ): Promise<SpaServiceEligibility[]> {
    const clubId = requireClubId(user);
    const services = await this.prisma.spaService.findMany({
      where: { clubId, active: true },
      orderBy: [{ kind: 'asc' }, { durationMin: 'asc' }, { name: 'asc' }],
    });

    const membership = await this.loadMembership(user);
    const rules = await this.prisma.spaQuotaRule.findMany({
      where: { clubId },
      include: { services: true, specialists: true },
    });

    const membershipSpa = (membership?.services ?? []).filter((s) =>
      this.isSpaMembershipService(s.name),
    );

    const results: SpaServiceEligibility[] = [];
    for (const service of services) {
      let quotaAvailable = false;
      let quotaRemaining: number | undefined;
      let matchedName: string | undefined;

      for (const mSvc of membershipSpa) {
        if (
          opts?.membershipServiceName &&
          mSvc.name !== opts.membershipServiceName
        ) {
          continue;
        }
        const rule = rules.find((r) => r.membershipServiceName === mSvc.name);
        if (rule && !rule.services.some((s) => s.serviceId === service.id)) {
          continue;
        }
        // If no rule exists for this membership service, do not allow quota booking
        if (!rule) continue;
        const hasQuota = mSvc.unlimited || (mSvc.remaining ?? 0) > 0;
        if (!hasQuota) continue;
        quotaAvailable = true;
        quotaRemaining = mSvc.unlimited ? undefined : mSvc.remaining;
        matchedName = mSvc.name;
        break;
      }

      if (opts?.quotaOnly && !quotaAvailable) continue;

      results.push({
        service: this.mapService(service),
        quotaAvailable,
        quotaRemaining,
        membershipServiceName: matchedName,
        paidAvailable: true,
      });
    }

    return results;
  }

  async listSpecialists(
    user: JwtPayload,
    serviceId: string,
    opts?: { membershipServiceName?: string; paymentType?: 'QUOTA' | 'PAID' },
  ) {
    const clubId = requireClubId(user);
    const service = await this.prisma.spaService.findFirst({
      where: { id: serviceId, clubId, active: true },
    });
    if (!service) throw new NotFoundException('Услуга не найдена');

    let specialistIds: string[] | null = null;
    if (opts?.paymentType === 'QUOTA' && opts.membershipServiceName) {
      const rule = await this.prisma.spaQuotaRule.findUnique({
        where: {
          clubId_membershipServiceName: {
            clubId,
            membershipServiceName: opts.membershipServiceName,
          },
        },
        include: { specialists: true, services: true },
      });
      if (!rule || !rule.services.some((s) => s.serviceId === serviceId)) {
        return [];
      }
      specialistIds = rule.specialists.map((s) => s.specialistId);
    }

    const specialists = await this.prisma.user.findMany({
      where: {
        clubId,
        roles: { some: { role: Role.SPECIALIST } },
        ...(specialistIds ? { id: { in: specialistIds } } : {}),
        specialistServices: { some: { serviceId } },
      },
      include: {
        specialistServices: true,
        specialistSchedulePublications: {
          where: { periodEnd: { gte: new Date() } },
          orderBy: { publishedAt: 'desc' },
          take: 1,
        },
      },
    });

    const results = await Promise.all(
      specialists.map(async (sp) => {
        const slots = await this.getSpecialistAvailableSlots(
          clubId,
          sp.id,
          serviceId,
        );
        return {
          id: sp.id,
          firstName: sp.firstName,
          lastName: sp.lastName,
          hasSchedule: slots.length > 0,
          serviceIds: sp.specialistServices.map((s) => s.serviceId),
        };
      }),
    );

    return results.filter((s) => s.hasSchedule);
  }

  async getSpecialistAvailableSlots(
    clubId: string,
    specialistId: string,
    serviceId: string,
    from?: string,
    to?: string,
  ) {
    const specialist = await this.prisma.user.findFirst({
      where: {
        id: specialistId,
        clubId,
        roles: { some: { role: Role.SPECIALIST } },
      },
    });
    if (!specialist) throw new NotFoundException('Специалист не найден');

    const service = await this.prisma.spaService.findFirst({
      where: { id: serviceId, clubId, active: true },
    });
    if (!service) throw new NotFoundException('Услуга не найдена');

    const durationMs = (service.durationMin + service.bufferMin) * 60_000;
    const rangeStart = from ? new Date(from) : new Date();
    const rangeEnd = to
      ? new Date(to)
      : new Date(rangeStart.getTime() + 14 * 24 * 60 * 60 * 1000);

    const publishedBlocks =
      await this.prisma.specialistAvailabilityBlock.findMany({
        where: {
          specialistId,
          status: AvailabilityBlockStatus.PUBLISHED,
          startAt: { lt: rangeEnd },
          endAt: { gt: rangeStart },
        },
        orderBy: { startAt: 'asc' },
      });

    if (publishedBlocks.length === 0) return [];

    const bookings = await this.prisma.spaBooking.findMany({
      where: {
        specialistId,
        status: SpaBookingStatus.CONFIRMED,
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
      },
    });

    const slots: Array<{ startAt: string; endAt: string }> = [];
    const stepMs = Math.max(service.durationMin, 15) * 60_000;

    for (const block of publishedBlocks) {
      let slotStart = new Date(block.startAt);
      const blockEnd = new Date(block.endAt);

      while (slotStart.getTime() + durationMs <= blockEnd.getTime()) {
        const slotEnd = new Date(slotStart.getTime() + durationMs);
        const isPast = slotStart <= new Date();
        const overlaps = bookings.some(
          (b) => b.startAt < slotEnd && b.endAt > slotStart,
        );

        if (
          !isPast &&
          !overlaps &&
          slotStart >= rangeStart &&
          slotStart < rangeEnd
        ) {
          slots.push({
            startAt: slotStart.toISOString(),
            endAt: slotEnd.toISOString(),
          });
        }

        slotStart = new Date(slotStart.getTime() + stepMs);
      }
    }

    return slots.sort((a, b) => a.startAt.localeCompare(b.startAt));
  }

  async listClientSlots(
    user: JwtPayload,
    specialistId: string,
    serviceId: string,
  ) {
    return this.getSpecialistAvailableSlots(
      requireClubId(user),
      specialistId,
      serviceId,
    );
  }

  // ─── Booking create ────────────────────────────────────────────────────────

  private async loadMembership(user: JwtPayload): Promise<Membership | null> {
    const crm = await this.crmLink.syncMembershipCrmLink(user.sub);
    const active = await this.clubMembership.getActiveMembership(user.sub);
    const externalId =
      crm.externalId ??
      (active
        ? this.clubMembership.resolveExternalId(active, user.externalId)
        : user.externalId);
    if (!externalId) return null;
    try {
      return await this.fitness.getProvider().getMembership(externalId);
    } catch {
      return null;
    }
  }

  private async resolveExternalId(userId: string, jwtExternalId?: string) {
    const crm = await this.crmLink.syncMembershipCrmLink(userId);
    const active = await this.clubMembership.getActiveMembership(userId);
    if (!active) throw new NotFoundException('Нет активного клуба');
    const externalId =
      crm.externalId ??
      this.clubMembership.resolveExternalId(active, jwtExternalId);
    if (!externalId) {
      throw new BadRequestException('Клиент ещё не привязан к 1С');
    }
    return { externalId, clubId: active.clubId };
  }

  async bookSpa(
    actor: JwtPayload,
    input: {
      clientId: string;
      specialistId: string;
      serviceId: string;
      startAt: string;
      paymentType: 'QUOTA' | 'PAID';
      membershipServiceName?: string;
      origin: SpaBookingOrigin;
    },
  ): Promise<{ booking: SpaBooking; membership: Membership | null }> {
    const start = new Date(input.startAt);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Некорректная дата');
    }

    const clubId = requireClubId(actor);
    const service = await this.prisma.spaService.findFirst({
      where: { id: input.serviceId, clubId, active: true },
    });
    if (!service) throw new NotFoundException('Услуга не найдена');

    const durationMs = (service.durationMin + service.bufferMin) * 60_000;
    const end = new Date(start.getTime() + durationMs);

    const available = await this.getSpecialistAvailableSlots(
      clubId,
      input.specialistId,
      input.serviceId,
      start.toISOString(),
      end.toISOString(),
    );
    const isAvailable = available.some(
      (slot) => new Date(slot.startAt).getTime() === start.getTime(),
    );
    if (!isAvailable) {
      throw new ConflictException('Выбранный слот недоступен');
    }

    const specialistOk = await this.prisma.specialistService.findUnique({
      where: {
        specialistId_serviceId: {
          specialistId: input.specialistId,
          serviceId: input.serviceId,
        },
      },
    });
    if (!specialistOk) {
      throw new BadRequestException('Специалист не оказывает эту услугу');
    }

    const client = await this.prisma.user.findFirst({
      where: {
        id: input.clientId,
        roles: { some: { role: Role.CLIENT } },
      },
    });
    if (!client) throw new NotFoundException('Клиент не найден');

    const { externalId } = await this.resolveExternalId(
      input.clientId,
      // JWT externalId only for self-book
      actor.sub === input.clientId ? actor.externalId : client.externalId ?? undefined,
    );

    const provider = this.fitness.getProvider();
    let membership: Membership | null = null;
    try {
      membership = await provider.getMembership(externalId);
    } catch {
      membership = null;
    }

    let membershipServiceName = input.membershipServiceName;
    let priceMinor: number | null = null;

    if (input.paymentType === 'QUOTA') {
      if (!membershipServiceName) {
        const matched = this.matchQuota(membership);
        membershipServiceName = matched?.name;
      }
      if (!membershipServiceName) {
        throw new BadRequestException(
          'Нет подходящей услуги в абонементе для списания',
        );
      }
      const rule = await this.prisma.spaQuotaRule.findUnique({
        where: {
          clubId_membershipServiceName: {
            clubId,
            membershipServiceName,
          },
        },
        include: { services: true, specialists: true },
      });
      if (!rule) {
        throw new BadRequestException(
          'Для этой услуги абонемента не настроено правило записи',
        );
      }
      if (!rule.services.some((s) => s.serviceId === input.serviceId)) {
        throw new BadRequestException(
          'Этот вид услуги нельзя списать по абонементу',
        );
      }
      if (!rule.specialists.some((s) => s.specialistId === input.specialistId)) {
        throw new BadRequestException(
          'К этому специалисту нельзя записаться по абонементу',
        );
      }
      const quota = membership?.services?.find(
        (s) => s.name === membershipServiceName,
      );
      if (!quota || (!quota.unlimited && (quota.remaining ?? 0) <= 0)) {
        throw new ConflictException('Нет остатка услуги в абонементе');
      }
    } else {
      priceMinor = service.priceMinor;
    }

    let booking;
    try {
      const existing = await this.prisma.spaBooking.findUnique({
        where: {
          specialistId_startAt: {
            specialistId: input.specialistId,
            startAt: start,
          },
        },
      });

      // #region agent log
      try {
        const fs = await import('fs');
        fs.appendFileSync(
          '/Users/machome/Projects/FitGO/.cursor/debug-884e43.log',
          JSON.stringify({
            sessionId: '884e43',
            runId: 'post-fix',
            hypothesisId: 'F',
            location: 'spa-booking.service.ts:bookSpa:existing',
            message: 'existing booking at slot',
            data: {
              startAt: start.toISOString(),
              specialistId: input.specialistId,
              existingStatus: existing?.status ?? null,
              existingId: existing?.id ?? null,
            },
            timestamp: Date.now(),
          }) + '\n',
        );
      } catch {
        /* ignore */
      }
      // #endregion

      if (existing && existing.status === SpaBookingStatus.CANCELLED) {
        const control = this.serviceUsage.controlFieldsForCreate({
          origin: input.origin,
          paymentType: input.paymentType,
          bookedByUserId: actor.sub,
        });
        booking = await this.prisma.spaBooking.update({
          where: { id: existing.id },
          data: {
            clubId,
            clientId: input.clientId,
            serviceId: input.serviceId,
            endAt: end,
            origin: input.origin,
            paymentType:
              input.paymentType === 'QUOTA'
                ? SpaPaymentType.QUOTA
                : SpaPaymentType.PAID,
            priceMinor,
            membershipServiceName: membershipServiceName ?? null,
            status: SpaBookingStatus.CONFIRMED,
            consumedInCrmAt: null,
            crmDocRef: null,
            cancelledBy: null,
            cancelledAt: null,
            controlLevel: control.controlLevel,
            reviewFlag: control.reviewFlag,
            paymentStatus: control.paymentStatus,
            usageStatus: control.usageStatus,
            presenceStatus: control.presenceStatus,
            performanceStatus: control.performanceStatus,
            eligibleForMotivation: control.eligibleForMotivation,
            bookedByUserId: control.bookedByUserId,
            specialistCompletedAt: null,
            paidAt: null,
          },
          include: {
            specialist: true,
            client: true,
            service: true,
          },
        });
      } else if (existing) {
        throw new ConflictException('Слот уже занят');
      } else {
        const control = this.serviceUsage.controlFieldsForCreate({
          origin: input.origin,
          paymentType: input.paymentType,
          bookedByUserId: actor.sub,
        });
        booking = await this.prisma.spaBooking.create({
          data: {
            clubId,
            specialistId: input.specialistId,
            clientId: input.clientId,
            serviceId: input.serviceId,
            startAt: start,
            endAt: end,
            origin: input.origin,
            paymentType:
              input.paymentType === 'QUOTA'
                ? SpaPaymentType.QUOTA
                : SpaPaymentType.PAID,
            priceMinor,
            membershipServiceName: membershipServiceName ?? null,
            controlLevel: control.controlLevel,
            reviewFlag: control.reviewFlag,
            paymentStatus: control.paymentStatus,
            usageStatus: control.usageStatus,
            presenceStatus: control.presenceStatus,
            performanceStatus: control.performanceStatus,
            eligibleForMotivation: control.eligibleForMotivation,
            bookedByUserId: control.bookedByUserId,
          },
          include: {
            specialist: true,
            client: true,
            service: true,
          },
        });
      }
    } catch (err) {
      if (err instanceof ConflictException) throw err;
      if (
        err instanceof Error &&
        /Unique constraint/i.test(err.message)
      ) {
        throw new ConflictException('Слот уже занят');
      }
      throw err;
    }

    // Quota/sale consume deferred until dual-gate ATTENDED → CONSUMED (phase 3).
    // Still validate membership has quota at book time for QUOTA.
    if (input.paymentType === 'QUOTA' && membershipServiceName) {
      const quota = membership?.services?.find(
        (s) => s.name === membershipServiceName,
      );
      if (!quota || (quota.remaining != null && quota.remaining <= 0 && !quota.unlimited)) {
        await this.prisma.spaBooking.delete({ where: { id: booking.id } }).catch(
          () => undefined,
        );
        throw new ConflictException('Нет остатка услуги в абонементе');
      }
    }

    if (
      input.origin === SpaBookingOrigin.SPECIALIST_ASSIGNED ||
      input.origin === SpaBookingOrigin.ADMIN_ASSIGNED
    ) {
      const specialistName =
        `${booking.specialist.firstName} ${booking.specialist.lastName}`.trim();
      await this.notifications.notifySpaAssigned({
        clientId: input.clientId,
        specialistId: input.specialistId,
        specialistName: specialistName || 'Специалист',
        serviceName: booking.service.name,
        startAt: start,
      });
    }

    return { booking: this.mapBooking(booking), membership };
  }

  async clientBookSpa(
    user: JwtPayload,
    dto: {
      serviceId: string;
      specialistId: string;
      startAt: string;
      paymentType: 'QUOTA' | 'PAID';
      membershipServiceName?: string;
    },
  ) {
    return this.bookSpa(user, {
      ...dto,
      clientId: user.sub,
      origin: SpaBookingOrigin.CLIENT_BOOKED,
    });
  }

  async specialistAssign(
    user: JwtPayload,
    dto: {
      clientId: string;
      serviceId: string;
      startAt: string;
      paymentType: 'QUOTA' | 'PAID';
      membershipServiceName?: string;
    },
  ) {
    return this.bookSpa(user, {
      ...dto,
      specialistId: user.sub,
      origin: SpaBookingOrigin.SPECIALIST_ASSIGNED,
    });
  }

  async adminAssign(
    user: JwtPayload,
    dto: {
      clientId: string;
      specialistId: string;
      serviceId: string;
      startAt: string;
      paymentType: 'QUOTA' | 'PAID';
      membershipServiceName?: string;
    },
  ) {
    return this.bookSpa(user, {
      ...dto,
      origin: SpaBookingOrigin.ADMIN_ASSIGNED,
    });
  }

  /** Specialist confirms the service was performed (dual-gate performer). */
  async specialistComplete(user: JwtPayload, bookingId: string) {
    const booking = await this.prisma.spaBooking.findFirst({
      where: { id: bookingId, specialistId: user.sub },
      include: { specialist: true, client: true, service: true },
    });
    if (!booking) throw new NotFoundException('Запись не найдена');
    if (booking.status === SpaBookingStatus.CANCELLED) {
      throw new BadRequestException('Запись отменена');
    }
    await this.serviceUsage.markPerformerConfirmed(bookingId, 'SPA');
    const refreshed = await this.prisma.spaBooking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { specialist: true, client: true, service: true },
    });
    return this.mapBooking(refreshed);
  }

  async listClientBookings(
    user: JwtPayload,
    options?: { upcomingOnly?: boolean; includeAll?: boolean },
  ) {
    const where: {
      clientId: string;
      status?: { in: SpaBookingStatus[] } | SpaBookingStatus;
      startAt?: { gte: Date };
    } = { clientId: user.sub };

    if (options?.includeAll) {
      // all statuses
    } else if (options?.upcomingOnly) {
      where.status = SpaBookingStatus.CONFIRMED;
      where.startAt = { gte: new Date() };
    } else {
      where.status = {
        in: [SpaBookingStatus.CONFIRMED, SpaBookingStatus.COMPLETED],
      };
    }

    const bookings = await this.prisma.spaBooking.findMany({
      where,
      include: { specialist: true, client: true, service: true },
      orderBy: { startAt: 'asc' },
    });

    // Синхронизация отмен/удалений из 1С → статус CANCELLED + CRM_ADMIN
    const toSync =
      options?.includeAll
        ? await this.prisma.spaBooking.findMany({
            where: {
              clientId: user.sub,
              status: SpaBookingStatus.CONFIRMED,
              consumedInCrmAt: { not: null },
            },
            select: {
              id: true,
              status: true,
              consumedInCrmAt: true,
              crmDocRef: true,
            },
          })
        : bookings;
    await this.syncCrmCancellations(user.sub, toSync);

    const refreshed = await this.prisma.spaBooking.findMany({
      where,
      include: { specialist: true, client: true, service: true },
      orderBy: { startAt: 'asc' },
    });
    return refreshed.map((b) => this.mapBooking(b));
  }

  toBookingItems(
    bookings: Awaited<ReturnType<SpaBookingService['listClientBookings']>>,
  ) {
    const now = Date.now();
    return bookings.map((booking) => {
      let lifecycle: 'UPCOMING' | 'COMPLETED' | 'CANCELLED' | 'AWAITING_CONFIRMATION';
      if (booking.status === 'CANCELLED') {
        lifecycle = 'CANCELLED';
      } else if (booking.status === 'COMPLETED') {
        lifecycle = 'COMPLETED';
      } else if (new Date(booking.endAt).getTime() > now) {
        lifecycle = 'UPCOMING';
      } else {
        lifecycle = 'COMPLETED';
      }

      return {
        id: booking.id,
        sessionId: booking.id,
        title: booking.serviceName,
        type: SessionType.SPA,
        trainerName: booking.specialistName,
        startAt: booking.startAt,
        endAt: booking.endAt,
        source: 'fitgo' as const,
        origin: booking.origin,
        lifecycle,
        cancelledBy: booking.cancelledBy,
        cancelledByLabel: this.cancelledByLabel(booking.cancelledBy ?? null),
        usage: booking.usage,
      };
    });
  }

  async cancelClientBooking(user: JwtPayload, bookingId: string) {
    const booking = await this.prisma.spaBooking.findFirst({
      where: { id: bookingId, clientId: user.sub },
      include: {
        specialist: true,
        client: true,
        service: true,
      },
    });
    if (!booking) throw new NotFoundException('Запись не найдена');
    if (booking.status === SpaBookingStatus.CANCELLED) {
      return { success: true };
    }

    const now = new Date();
    if (booking.startAt <= now) {
      throw new BadRequestException(
        'Нельзя отменить начавшуюся или прошедшую запись. Свяжитесь с администратором.',
      );
    }
    const msBeforeStart = booking.startAt.getTime() - now.getTime();
    const hoursBeforeStart = msBeforeStart / (60 * 60 * 1000);
    if (hoursBeforeStart < SPA_CANCEL_MIN_HOURS_BEFORE) {
      throw new BadRequestException(
        `Отмена возможна не позднее чем за ${SPA_CANCEL_MIN_HOURS_BEFORE} часа до начала. Свяжитесь с администратором.`,
      );
    }

    if (booking.consumedInCrmAt) {
      const provider = this.fitness.getProvider();
      const restore = provider.restoreSpaVisit;
      if (!restore) {
        throw new BadRequestException(
          'Отмена в 1С недоступна. Свяжитесь с администратором.',
        );
      }
      const { externalId } = await this.resolveExternalId(
        booking.clientId,
        user.sub === booking.clientId ? user.externalId : booking.client.externalId ?? undefined,
      );
      try {
        await restore.call(provider, externalId, {
          bookingRef: booking.crmDocRef ?? booking.id,
        });
      } catch (err) {
        const raw =
          err instanceof Error ? err.message : 'Не удалось отменить занятие в 1С';
        throw new BadRequestException(
          `${raw}. Свяжитесь с администратором.`,
        );
      }
    }

    await this.prisma.spaBooking.update({
      where: { id: bookingId },
      data: {
        status: SpaBookingStatus.CANCELLED,
        cancelledBy: SpaCancelledBy.CLIENT,
        cancelledAt: new Date(),
        usageStatus: ServiceUsageStatus.CANCELLED,
        eligibleForMotivation: false,
      },
    });

    const clientName =
      `${booking.client.lastName} ${booking.client.firstName}`.trim() ||
      booking.client.email;
    await this.notifications
      .notifyBookingCancelled({
        clubId: booking.clubId,
        clientId: booking.clientId,
        clientName,
        clientPhone: booking.client.phone ?? undefined,
        sessionTitle: booking.service.name,
        startAt: booking.startAt,
        sessionType: 'spa',
        trainerId: booking.specialistId,
      })
      .catch(() => undefined);

    return { success: true };
  }

  // ─── Specialist schedule ───────────────────────────────────────────────────

  async listSpecialistOwnServices(user: JwtPayload) {
    const links = await this.prisma.specialistService.findMany({
      where: { specialistId: user.sub },
      include: { service: true },
    });
    return links
      .filter((l) => l.service.active)
      .map((l) => this.mapService(l.service));
  }

  async getWorkSchedule(user: JwtPayload) {
    const slots = await this.prisma.specialistWorkSlot.findMany({
      where: { specialistId: user.sub },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
    return slots.map((s) => ({
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
    }));
  }

  async setWorkSchedule(user: JwtPayload, slots: WorkSlotInput[]) {
    this.validateWorkSlots(slots);
    await this.prisma.$transaction([
      this.prisma.specialistWorkSlot.deleteMany({
        where: { specialistId: user.sub },
      }),
      this.prisma.specialistWorkSlot.createMany({
        data: slots.map((slot) => ({
          specialistId: user.sub,
          dayOfWeek: slot.dayOfWeek,
          startTime: slot.startTime,
          endTime: slot.endTime,
        })),
      }),
    ]);
    return this.getWorkSchedule(user);
  }

  private validateWorkSlots(slots: WorkSlotInput[]) {
    for (const slot of slots) {
      if (slot.startTime >= slot.endTime) {
        throw new BadRequestException('startTime must be before endTime');
      }
    }
  }

  async getAvailabilityBlocks(user: JwtPayload, from: string, to: string) {
    const rangeStart = new Date(from);
    const rangeEnd = new Date(to);
    const blocks = await this.prisma.specialistAvailabilityBlock.findMany({
      where: {
        specialistId: user.sub,
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
      },
      orderBy: { startAt: 'asc' },
    });
    return blocks.map((b) => ({
      id: b.id,
      startAt: b.startAt.toISOString(),
      endAt: b.endAt.toISOString(),
      status: b.status as 'DRAFT' | 'PUBLISHED',
    }));
  }

  async setAvailabilityBlocks(
    user: JwtPayload,
    periodStart: string,
    periodEnd: string,
    blocks: Array<{ startAt: string; endAt: string }>,
  ) {
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    await this.prisma.$transaction(async (tx) => {
      await tx.specialistAvailabilityBlock.deleteMany({
        where: {
          specialistId: user.sub,
          startAt: { gte: start },
          endAt: { lte: end },
          status: AvailabilityBlockStatus.DRAFT,
        },
      });
      if (blocks.length > 0) {
        await tx.specialistAvailabilityBlock.createMany({
          data: blocks.map((b) => ({
            specialistId: user.sub,
            startAt: new Date(b.startAt),
            endAt: new Date(b.endAt),
            status: AvailabilityBlockStatus.DRAFT,
          })),
        });
      }
    });
    return this.getAvailabilityBlocks(user, periodStart, periodEnd);
  }

  async fillFromTemplate(
    user: JwtPayload,
    periodStart: string,
    periodEnd: string,
  ) {
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    const template = await this.prisma.specialistWorkSlot.findMany({
      where: { specialistId: user.sub },
    });
    if (template.length === 0) {
      throw new BadRequestException('Сначала задайте шаблон расписания');
    }

    const blocks: Array<{ startAt: Date; endAt: Date }> = [];
    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    const endDay = new Date(end);
    endDay.setHours(23, 59, 59, 999);

    while (cursor <= endDay) {
      for (const slot of template) {
        if (slot.dayOfWeek !== cursor.getDay()) continue;
        const [sh, sm] = slot.startTime.split(':').map(Number);
        const [eh, em] = slot.endTime.split(':').map(Number);
        const startAt = new Date(cursor);
        startAt.setHours(sh, sm, 0, 0);
        const endAt = new Date(cursor);
        endAt.setHours(eh, em, 0, 0);
        blocks.push({ startAt, endAt });
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.specialistAvailabilityBlock.deleteMany({
        where: {
          specialistId: user.sub,
          startAt: { gte: start },
          endAt: { lte: end },
          status: AvailabilityBlockStatus.DRAFT,
        },
      });
      if (blocks.length > 0) {
        await tx.specialistAvailabilityBlock.createMany({
          data: blocks.map((b) => ({
            specialistId: user.sub,
            startAt: b.startAt,
            endAt: b.endAt,
            status: AvailabilityBlockStatus.DRAFT,
          })),
        });
      }
    });

    return { createdBlocks: blocks.length };
  }

  async publishSchedule(
    user: JwtPayload,
    periodStart: string,
    periodEnd: string,
  ) {
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    const result = await this.prisma.specialistAvailabilityBlock.updateMany({
      where: {
        specialistId: user.sub,
        status: AvailabilityBlockStatus.DRAFT,
        startAt: { gte: start },
        endAt: { lte: end },
      },
      data: { status: AvailabilityBlockStatus.PUBLISHED },
    });
    await this.prisma.specialistSchedulePublication.create({
      data: {
        specialistId: user.sub,
        periodStart: start,
        periodEnd: end,
      },
    });
    return { publishedBlocks: result.count };
  }

  async getSpecialistCalendar(
    user: JwtPayload,
    from: string,
    to: string,
  ): Promise<SpecialistCalendarResponse> {
    const rangeStart = new Date(from);
    const rangeEnd = new Date(to);
    if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
      throw new BadRequestException('Некорректный период');
    }

    const [bookings, blocks, lastPublication] = await Promise.all([
      this.prisma.spaBooking.findMany({
        where: {
          specialistId: user.sub,
          status: SpaBookingStatus.CONFIRMED,
          startAt: { lt: rangeEnd },
          endAt: { gt: rangeStart },
        },
        include: { client: true, service: true },
      }),
      this.prisma.specialistAvailabilityBlock.findMany({
        where: {
          specialistId: user.sub,
          startAt: { lt: rangeEnd },
          endAt: { gt: rangeStart },
        },
        orderBy: { startAt: 'asc' },
      }),
      this.prisma.specialistSchedulePublication.findFirst({
        where: { specialistId: user.sub },
        orderBy: { publishedAt: 'desc' },
      }),
    ]);

    const events = [
      ...bookings.map((b) => ({
        id: `spa-${b.id}`,
        kind: 'SPA' as const,
        title: b.service.name,
        startAt: b.startAt.toISOString(),
        endAt: b.endAt.toISOString(),
        clientId: b.clientId,
        clientName: `${b.client.firstName} ${b.client.lastName}`.trim(),
        bookingId: b.id,
        serviceId: b.serviceId,
        serviceName: b.service.name,
        origin: b.origin as SpaBooking['origin'],
        paymentType: b.paymentType as SpaBooking['paymentType'],
      })),
      ...blocks
        .filter((b) => b.status === AvailabilityBlockStatus.PUBLISHED)
        .map((b) => ({
          id: `open-${b.id}`,
          kind: 'OPEN_SLOT' as const,
          title: 'Свободно',
          startAt: b.startAt.toISOString(),
          endAt: b.endAt.toISOString(),
          available: true,
        })),
      ...blocks
        .filter((b) => b.status === AvailabilityBlockStatus.DRAFT)
        .map((b) => ({
          id: `draft-${b.id}`,
          kind: 'DRAFT_SLOT' as const,
          title: 'Черновик',
          startAt: b.startAt.toISOString(),
          endAt: b.endAt.toISOString(),
        })),
    ];

    return {
      events,
      availabilityBlocks: blocks.map((b) => ({
        id: b.id,
        startAt: b.startAt.toISOString(),
        endAt: b.endAt.toISOString(),
        status: b.status as 'DRAFT' | 'PUBLISHED',
      })),
      draftBlockCount: blocks.filter(
        (b) => b.status === AvailabilityBlockStatus.DRAFT,
      ).length,
      lastPublication: lastPublication
        ? {
            periodStart: lastPublication.periodStart.toISOString(),
            periodEnd: lastPublication.periodEnd.toISOString(),
            publishedAt: lastPublication.publishedAt.toISOString(),
          }
        : undefined,
    };
  }

  async listSpecialistBookings(user: JwtPayload) {
    const bookings = await this.prisma.spaBooking.findMany({
      where: {
        specialistId: user.sub,
        status: SpaBookingStatus.CONFIRMED,
        startAt: { gte: new Date() },
      },
      include: { specialist: true, client: true, service: true },
      orderBy: { startAt: 'asc' },
    });
    return bookings.map((b) => this.mapBooking(b));
  }

  async cancelSpecialistBooking(user: JwtPayload, bookingId: string) {
    const booking = await this.prisma.spaBooking.findFirst({
      where: { id: bookingId, specialistId: user.sub },
    });
    if (!booking) throw new NotFoundException('Запись не найдена');
    await this.prisma.spaBooking.update({
      where: { id: bookingId },
      data: {
        status: SpaBookingStatus.CANCELLED,
        cancelledBy: SpaCancelledBy.SPECIALIST,
        cancelledAt: new Date(),
      },
    });
    return { ok: true };
  }

  // ─── Admin config ──────────────────────────────────────────────────────────

  async adminListServices(user: JwtPayload) {
    const clubId = requireClubId(user);
    const services = await this.prisma.spaService.findMany({
      where: { clubId },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
    return services.map((s) => this.mapService(s));
  }

  async adminUpsertService(
    user: JwtPayload,
    dto: {
      id?: string;
      name: string;
      kind: 'MASSAGE' | 'BODY_COMPOSITION' | 'WRAP';
      durationMin: number;
      bufferMin?: number;
      priceMinor: number;
      currency?: string;
      active?: boolean;
    },
  ) {
    const clubId = requireClubId(user);
    if (dto.id) {
      const updated = await this.prisma.spaService.update({
        where: { id: dto.id },
        data: {
          name: dto.name,
          kind: dto.kind,
          durationMin: dto.durationMin,
          bufferMin: dto.bufferMin ?? 0,
          priceMinor: dto.priceMinor,
          currency: dto.currency ?? 'BYN',
          active: dto.active ?? true,
        },
      });
      return this.mapService(updated);
    }
    const created = await this.prisma.spaService.create({
      data: {
        clubId,
        name: dto.name,
        kind: dto.kind,
        durationMin: dto.durationMin,
        bufferMin: dto.bufferMin ?? 0,
        priceMinor: dto.priceMinor,
        currency: dto.currency ?? 'BYN',
        active: dto.active ?? true,
      },
    });
    return this.mapService(created);
  }

  async adminListQuotaRules(user: JwtPayload): Promise<SpaQuotaRule[]> {
    const clubId = requireClubId(user);
    const rules = await this.prisma.spaQuotaRule.findMany({
      where: { clubId },
      include: { services: true, specialists: true },
      orderBy: { membershipServiceName: 'asc' },
    });
    return rules.map((r) => ({
      id: r.id,
      clubId: r.clubId,
      membershipServiceName: r.membershipServiceName,
      allowedServiceIds: r.services.map((s) => s.serviceId),
      allowedSpecialistIds: r.specialists.map((s) => s.specialistId),
    }));
  }

  async adminSetQuotaRules(
    user: JwtPayload,
    rules: Array<{
      membershipServiceName: string;
      allowedServiceIds: string[];
      allowedSpecialistIds: string[];
    }>,
  ) {
    const clubId = requireClubId(user);
    await this.prisma.$transaction(async (tx) => {
      await tx.spaQuotaRule.deleteMany({ where: { clubId } });
      for (const rule of rules) {
        await tx.spaQuotaRule.create({
          data: {
            clubId,
            membershipServiceName: rule.membershipServiceName.trim(),
            services: {
              create: rule.allowedServiceIds.map((serviceId) => ({
                serviceId,
              })),
            },
            specialists: {
              create: rule.allowedSpecialistIds.map((specialistId) => ({
                specialistId,
              })),
            },
          },
        });
      }
    });
    return this.adminListQuotaRules(user);
  }

  async adminListSpecialists(user: JwtPayload) {
    const clubId = requireClubId(user);
    const specialists = await this.prisma.user.findMany({
      where: {
        clubId,
        roles: { some: { role: Role.SPECIALIST } },
      },
      include: { specialistServices: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    return specialists.map((s) => ({
      id: s.id,
      firstName: s.firstName,
      lastName: s.lastName,
      hasSchedule: true,
      serviceIds: s.specialistServices.map((x) => x.serviceId),
    }));
  }

  async adminSetSpecialistServices(
    user: JwtPayload,
    specialistId: string,
    serviceIds: string[],
  ) {
    const clubId = requireClubId(user);
    const specialist = await this.prisma.user.findFirst({
      where: {
        id: specialistId,
        clubId,
        roles: { some: { role: Role.SPECIALIST } },
      },
    });
    if (!specialist) throw new NotFoundException('Специалист не найден');

    await this.prisma.$transaction([
      this.prisma.specialistService.deleteMany({ where: { specialistId } }),
      this.prisma.specialistService.createMany({
        data: serviceIds.map((serviceId) => ({ specialistId, serviceId })),
      }),
    ]);
    return this.adminListSpecialists(user);
  }

  async adminCalendar(user: JwtPayload, from: string, to: string) {
    const clubId = requireClubId(user);
    const rangeStart = new Date(from);
    const rangeEnd = new Date(to);
    const bookings = await this.prisma.spaBooking.findMany({
      where: {
        clubId,
        status: SpaBookingStatus.CONFIRMED,
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
      },
      include: { specialist: true, client: true, service: true },
      orderBy: { startAt: 'asc' },
    });
    return bookings.map((b) => this.mapBooking(b));
  }

  async adminListClients(user: JwtPayload) {
    const clubId = requireClubId(user);
    const clients = await this.prisma.user.findMany({
      where: {
        clubId,
        roles: { some: { role: Role.CLIENT } },
        isActive: true,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 200,
    });
    return clients.map((c) => ({
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      phone: c.phone ?? undefined,
    }));
  }
}
