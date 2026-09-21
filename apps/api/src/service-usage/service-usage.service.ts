import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  GroupClassBookingStatus,
  PersonalBookingStatus,
  Role,
  ServicePaymentStatus,
  ServicePerformanceStatus,
  ServicePresenceStatus,
  ServiceUsageStatus,
  SpaBookingStatus,
  SpaPaymentType,
} from '@prisma/client';
import {
  computeBookingTrust,
  computeUsageAfterGates,
  initialControlFields,
  isPayrollTrusted,
  toUsageControl,
  visitInBookingWindow,
  type ServiceUsageReviewItem,
  type SpecialistServiceDebt,
  type TrustExceptionItem,
} from '@fitgo/shared-types';
import {
  TrustBand as PrismaTrustBand,
  TrustResolution as PrismaTrustResolution,
} from '@prisma/client';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { FitnessService } from '../fitness/fitness.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ServiceUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
  ) {}

  controlFieldsForCreate(input: {
    origin: string;
    paymentType?: 'QUOTA' | 'PAID';
    isComplimentary?: boolean;
    bookedByUserId?: string;
  }) {
    const fields = initialControlFields({
      origin: input.origin,
      paymentType: input.paymentType,
      isComplimentary: input.isComplimentary,
    });
    return {
      ...fields,
      bookedByUserId: input.bookedByUserId ?? null,
    };
  }

  /**
   * Mark presence from 1C visit for client's bookings in the visit time window (±3h).
   */
  async markPresenceFromVisit(clientId: string, visitAt: Date): Promise<number> {
    const dayStart = new Date(visitAt);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    let updated = 0;

    const spa = await this.prisma.spaBooking.findMany({
      where: {
        clientId,
        status: { not: SpaBookingStatus.CANCELLED },
        startAt: { gte: dayStart, lt: dayEnd },
        presenceStatus: ServicePresenceStatus.PENDING,
      },
    });
    for (const b of spa) {
      if (!visitInBookingWindow(visitAt, b.startAt, b.endAt)) continue;
      await this.applyPresence(b.id, 'SPA', ServicePresenceStatus.VERIFIED_1C);
      updated += 1;
    }

    const pts = await this.prisma.personalTrainingBooking.findMany({
      where: {
        clientId,
        status: { not: PersonalBookingStatus.CANCELLED },
        startAt: { gte: dayStart, lt: dayEnd },
        presenceStatus: ServicePresenceStatus.PENDING,
      },
    });
    for (const b of pts) {
      if (!visitInBookingWindow(visitAt, b.startAt, b.endAt)) continue;
      await this.applyPresence(b.id, 'PT', ServicePresenceStatus.VERIFIED_1C);
      updated += 1;
    }

    const groups = await this.prisma.groupClassBooking.findMany({
      where: {
        clientId,
        status: { not: GroupClassBookingStatus.CANCELLED },
        startAt: { gte: dayStart, lt: dayEnd },
        presenceStatus: ServicePresenceStatus.PENDING,
      },
    });
    for (const b of groups) {
      if (!visitInBookingWindow(visitAt, b.startAt, b.endAt)) continue;
      await this.applyPresence(b.id, 'GROUP', ServicePresenceStatus.VERIFIED_1C);
      updated += 1;
    }

    return updated;
  }

  async adminOverridePresence(input: {
    actor: JwtPayload;
    kind: 'SPA' | 'PT' | 'GROUP';
    bookingId: string;
    note: string;
  }) {
    if (!input.note?.trim()) {
      throw new BadRequestException('Укажите причину подтверждения входа');
    }
    const clubId = requireClubId(input.actor);
    await this.prisma.staffAuditLog.create({
      data: {
        clubId,
        actorId: input.actor.sub,
        action: 'SERVICE_PRESENCE_OVERRIDE',
        targetId: input.bookingId,
        meta: { kind: input.kind, note: input.note.trim() },
      },
    });
    return this.applyPresence(
      input.bookingId,
      input.kind,
      ServicePresenceStatus.ADMIN_OVERRIDE,
      {
        note: input.note.trim(),
        byId: input.actor.sub,
      },
    );
  }

  async markPerformerConfirmed(
    bookingId: string,
    kind: 'SPA' | 'PT' | 'GROUP',
  ) {
    return this.applyPerformance(
      bookingId,
      kind,
      ServicePerformanceStatus.CONFIRMED_BY_PERFORMER,
    );
  }

  async listReviewQueue(clubId: string): Promise<ServiceUsageReviewItem[]> {
    const [spa, pts, groups] = await Promise.all([
      this.prisma.spaBooking.findMany({
        where: {
          clubId,
          reviewFlag: true,
          status: { not: SpaBookingStatus.CANCELLED },
        },
        include: {
          client: true,
          specialist: true,
          service: true,
        },
        orderBy: { startAt: 'desc' },
        take: 200,
      }),
      this.prisma.personalTrainingBooking.findMany({
        where: {
          reviewFlag: true,
          status: { not: PersonalBookingStatus.CANCELLED },
          OR: [{ trainer: { clubId } }, { client: { clubId } }],
        },
        include: { client: true, trainer: true },
        orderBy: { startAt: 'desc' },
        take: 200,
      }),
      this.prisma.groupClassBooking.findMany({
        where: {
          reviewFlag: true,
          status: { not: GroupClassBookingStatus.CANCELLED },
          OR: [{ client: { clubId } }],
        },
        include: { client: true },
        orderBy: { startAt: 'desc' },
        take: 200,
      }),
    ]);

    const items: ServiceUsageReviewItem[] = [];

    for (const b of spa) {
      items.push({
        id: b.id,
        kind: 'SPA',
        title: b.service.name,
        clientId: b.clientId,
        clientName: `${b.client.lastName} ${b.client.firstName}`.trim(),
        performerName: `${b.specialist.lastName} ${b.specialist.firstName}`.trim(),
        startAt: b.startAt.toISOString(),
        endAt: b.endAt.toISOString(),
        origin: b.origin,
        controlLevel: b.controlLevel,
        presenceStatus: b.presenceStatus,
        performanceStatus: b.performanceStatus,
        usageStatus: b.usageStatus,
        paymentStatus: b.paymentStatus,
        reviewFlag: b.reviewFlag,
        eligibleForMotivation: b.eligibleForMotivation,
      });
    }

    for (const b of pts) {
      items.push({
        id: b.id,
        kind: 'PT',
        title: b.isComplimentary ? 'Подарочная ПТ' : 'Персональная тренировка',
        clientId: b.clientId,
        clientName: `${b.client.lastName} ${b.client.firstName}`.trim(),
        performerName: `${b.trainer.lastName} ${b.trainer.firstName}`.trim(),
        startAt: b.startAt.toISOString(),
        endAt: b.endAt.toISOString(),
        origin: b.origin,
        controlLevel: b.controlLevel,
        presenceStatus: b.presenceStatus,
        performanceStatus: b.performanceStatus,
        usageStatus: b.usageStatus,
        paymentStatus: b.paymentStatus,
        reviewFlag: b.reviewFlag,
        eligibleForMotivation: b.eligibleForMotivation,
        isComplimentary: b.isComplimentary,
      });
    }

    for (const b of groups) {
      items.push({
        id: b.id,
        kind: 'GROUP',
        title: b.title,
        clientId: b.clientId,
        clientName: `${b.client.lastName} ${b.client.firstName}`.trim(),
        performerName: b.trainerName ?? '—',
        startAt: b.startAt.toISOString(),
        endAt: b.endAt.toISOString(),
        origin: b.origin,
        controlLevel: b.controlLevel,
        presenceStatus: b.presenceStatus,
        performanceStatus: b.performanceStatus,
        usageStatus: b.usageStatus,
        paymentStatus: b.paymentStatus,
        reviewFlag: b.reviewFlag,
        eligibleForMotivation: b.eligibleForMotivation,
      });
    }

    items.sort(
      (a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime(),
    );
    return items;
  }

  async acknowledgeReview(actor: JwtPayload, kind: string, bookingId: string) {
    const clubId = requireClubId(actor);
    await this.prisma.staffAuditLog.create({
      data: {
        clubId,
        actorId: actor.sub,
        action: 'SERVICE_USAGE_REVIEW_OK',
        targetId: bookingId,
        meta: { kind },
      },
    });
    if (kind === 'SPA') {
      await this.prisma.spaBooking.update({
        where: { id: bookingId },
        data: { reviewFlag: false },
      });
    } else if (kind === 'PT') {
      await this.prisma.personalTrainingBooking.update({
        where: { id: bookingId },
        data: { reviewFlag: false },
      });
    } else if (kind === 'GROUP') {
      await this.prisma.groupClassBooking.update({
        where: { id: bookingId },
        data: { reviewFlag: false },
      });
    } else {
      throw new BadRequestException('Неизвестный тип записи');
    }
    return { success: true };
  }

  /**
   * Admin exception queue: non-GREEN SPA/PT that are completed (performer confirmed).
   * GREEN items are omitted. GROUP sessions handled by group-session module.
   */
  async listTrustExceptions(clubId: string): Promise<TrustExceptionItem[]> {
    const [spa, pts] = await Promise.all([
      this.prisma.spaBooking.findMany({
        where: {
          clubId,
          status: { not: SpaBookingStatus.CANCELLED },
          performanceStatus: ServicePerformanceStatus.CONFIRMED_BY_PERFORMER,
          trustResolution: PrismaTrustResolution.NONE,
          trustBand: { in: [PrismaTrustBand.AMBER, PrismaTrustBand.RED] },
        },
        include: { client: true, specialist: true, service: true },
        orderBy: { startAt: 'desc' },
        take: 100,
      }),
      this.prisma.personalTrainingBooking.findMany({
        where: {
          status: { not: PersonalBookingStatus.CANCELLED },
          performanceStatus: ServicePerformanceStatus.CONFIRMED_BY_PERFORMER,
          trustResolution: PrismaTrustResolution.NONE,
          trustBand: { in: [PrismaTrustBand.AMBER, PrismaTrustBand.RED] },
          OR: [{ trainer: { clubId } }, { client: { clubId } }],
        },
        include: { client: true, trainer: true },
        orderBy: { startAt: 'desc' },
        take: 100,
      }),
    ]);

    const items: TrustExceptionItem[] = [];
    for (const b of spa) {
      items.push({
        id: b.id,
        kind: 'SPA',
        title: b.service.name,
        performerName: `${b.specialist.lastName} ${b.specialist.firstName}`.trim(),
        clientName: `${b.client.lastName} ${b.client.firstName}`.trim(),
        startAt: b.startAt.toISOString(),
        trustBand: b.trustBand as TrustExceptionItem['trustBand'],
        trustReasons: Array.isArray(b.trustReasons)
          ? (b.trustReasons as string[])
          : [],
      });
    }
    for (const b of pts) {
      items.push({
        id: b.id,
        kind: 'PT',
        title: b.isComplimentary ? 'Подарочная ПТ' : 'Персональная тренировка',
        performerName: `${b.trainer.lastName} ${b.trainer.firstName}`.trim(),
        clientName: `${b.client.lastName} ${b.client.firstName}`.trim(),
        startAt: b.startAt.toISOString(),
        trustBand: b.trustBand as TrustExceptionItem['trustBand'],
        trustReasons: Array.isArray(b.trustReasons)
          ? (b.trustReasons as string[])
          : [],
      });
    }
    items.sort(
      (a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime(),
    );
    return items;
  }

  async resolveTrustException(input: {
    actor: JwtPayload;
    kind: 'SPA' | 'PT';
    bookingId: string;
    note: string;
  }) {
    if (!input.note?.trim()) {
      throw new BadRequestException('Укажите причину принятия исключения');
    }
    const clubId = requireClubId(input.actor);
    const data = {
      trustResolution: PrismaTrustResolution.RESOLVED,
      trustResolveNote: input.note.trim(),
      trustResolvedAt: new Date(),
      trustResolvedById: input.actor.sub,
    };
    if (input.kind === 'SPA') {
      await this.prisma.spaBooking.update({ where: { id: input.bookingId }, data });
    } else {
      await this.prisma.personalTrainingBooking.update({
        where: { id: input.bookingId },
        data,
      });
    }
    await this.prisma.staffAuditLog.create({
      data: {
        clubId,
        actorId: input.actor.sub,
        action: 'SERVICE_TRUST_RESOLVED',
        targetId: input.bookingId,
        meta: { kind: input.kind, note: input.note.trim() },
      },
    });
    return { success: true };
  }

  private trustDataForBooking(origin: string, presence: string, performance: string) {
    const t = computeBookingTrust({
      origin,
      presenceStatus: presence,
      performanceStatus: performance,
    });
    return {
      trustBand: t.trustBand as PrismaTrustBand,
      trustReasons: t.trustReasons,
    };
  }

  /** Exposed for payroll: booking is trusted for pay. */
  bookingPayrollTrusted(row: {
    trustBand: string;
    trustResolution: string;
    eligibleForMotivation: boolean;
  }): boolean {
    return (
      row.eligibleForMotivation &&
      isPayrollTrusted({
        trustBand: row.trustBand as 'GREEN' | 'AMBER' | 'RED',
        trustResolution: row.trustResolution,
      })
    );
  }
  async listDebtPerformers(clubId: string): Promise<
    Array<{ employeeCode: string; name: string; roles: string[] }>
  > {
    const users = await this.prisma.user.findMany({
      where: {
        clubId,
        isActive: true,
        externalId: { not: null },
        roles: {
          some: { role: { in: [Role.SPECIALIST, Role.TRAINER] } },
        },
      },
      include: { roles: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    return users
      .map((u) => {
        const code = u.externalId?.trim() ?? '';
        if (!/^\d+$/.test(code)) return null;
        return {
          employeeCode: code,
          name: [u.lastName, u.firstName].filter(Boolean).join(' ').trim(),
          roles: u.roles.map((r) => r.role),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row != null);
  }

  async getSpecialistServiceDebts(input: {
    from: string;
    to: string;
    employeeCode: string;
  }): Promise<SpecialistServiceDebt[]> {
    const employeeCode = input.employeeCode?.trim() ?? '';
    if (!employeeCode) {
      throw new BadRequestException(
        'Укажите специалиста (employeeCode) — отчёт по всем запрещён (нагрузка на 1С)',
      );
    }

    const from = input.from?.trim() ?? '';
    const to = input.to?.trim() ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw new BadRequestException('from и to обязательны в формате YYYY-MM-DD');
    }

    const fromMs = Date.parse(`${from}T00:00:00`);
    const toMs = Date.parse(`${to}T00:00:00`);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
      throw new BadRequestException('Некорректные даты from/to');
    }
    if (toMs < fromMs) {
      throw new BadRequestException('Дата «по» не может быть раньше «с»');
    }
    const daysInclusive =
      Math.floor((toMs - fromMs) / (24 * 60 * 60 * 1000)) + 1;
    if (daysInclusive > 31) {
      throw new BadRequestException(
        'Период не больше 31 дня — укажите любой интервал до месяца включительно',
      );
    }

    const provider = this.fitness.getProvider();
    const fn = provider.getSpecialistServiceDebts;
    if (!fn) {
      return [];
    }
    try {
      return await fn.call(provider, {
        from,
        to,
        employeeCode,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/aborted|timeout|TimeoutError/i.test(msg)) {
        throw new BadRequestException(
          '1С не успела за период — выберите одного специалиста и сузьте даты (лучше 1 день)',
        );
      }
      throw new BadRequestException(msg || 'Ошибка загрузки долгов из 1С');
    }
  }

  /**
   * Consume SPA quota / record sale when dual-gate reached ATTENDED.
   */
  async consumeSpaIfReady(bookingId: string): Promise<void> {
    const booking = await this.prisma.spaBooking.findUnique({
      where: { id: bookingId },
      include: { specialist: true, client: true, service: true },
    });
    if (!booking) return;
    if (booking.consumedInCrmAt) return;
    if (booking.status === SpaBookingStatus.CANCELLED) return;

    const gates = computeUsageAfterGates({
      presenceStatus: booking.presenceStatus,
      performanceStatus: booking.performanceStatus,
      usageStatus: booking.usageStatus,
      consumedInCrm: false,
    });
    if (gates.usageStatus !== 'ATTENDED' && gates.usageStatus !== 'CONSUMED') {
      return;
    }

    const externalId = booking.client.externalId;
    if (!externalId) {
      throw new BadRequestException('У клиента нет CRM externalId');
    }

    const provider = this.fitness.getProvider();
    const employeeName = [booking.specialist.lastName, booking.specialist.firstName]
      .filter(Boolean)
      .join(' ')
      .trim();
    const rawCode = booking.specialist.externalId?.trim();
    const employeeCode =
      rawCode && /^\d+$/.test(rawCode) ? rawCode : undefined;

    if (booking.paymentType === SpaPaymentType.QUOTA) {
      const consume = provider.consumeMembershipService;
      if (!consume) {
        throw new BadRequestException('Списание услуги в 1С недоступно');
      }
      await consume.call(provider, externalId, {
        serviceName: booking.membershipServiceName ?? booking.service.name,
        serviceId: booking.serviceId,
        bookingRef: booking.id,
        occurredAt: booking.startAt.toISOString(),
        durationMin: booking.service.durationMin,
        employeeName: employeeName || undefined,
        employeeCode,
      });
      await this.prisma.spaBooking.update({
        where: { id: booking.id },
        data: {
          consumedInCrmAt: new Date(),
          crmDocRef: booking.id,
          usageStatus: ServiceUsageStatus.CONSUMED,
          eligibleForMotivation: true,
          paymentStatus: ServicePaymentStatus.N_A,
          status: SpaBookingStatus.COMPLETED,
        },
      });
    } else {
      const sell = provider.sellSpaService;
      if (!sell) {
        throw new BadRequestException('Продажа спа-услуги в 1С недоступна');
      }
      await sell.call(provider, externalId, {
        serviceName: booking.service.name,
        serviceId: booking.serviceId,
        bookingRef: booking.id,
        occurredAt: booking.startAt.toISOString(),
        priceMinor: booking.priceMinor ?? booking.service.priceMinor,
        currency: booking.service.currency,
        durationMin: booking.service.durationMin,
        employeeName: employeeName || undefined,
        employeeCode,
      });
      await this.prisma.spaBooking.update({
        where: { id: booking.id },
        data: {
          consumedInCrmAt: new Date(),
          crmDocRef: booking.id,
          usageStatus: ServiceUsageStatus.CONSUMED,
          eligibleForMotivation: true,
          paymentStatus: ServicePaymentStatus.DEBT,
          status: SpaBookingStatus.COMPLETED,
        },
      });
    }
  }

  private async applyPresence(
    bookingId: string,
    kind: 'SPA' | 'PT' | 'GROUP',
    status: ServicePresenceStatus,
    override?: { note: string; byId: string },
  ) {
    const overrideData = override
      ? {
          presenceOverrideNote: override.note,
          presenceOverrideAt: new Date(),
          presenceOverrideById: override.byId,
        }
      : {};

    if (kind === 'SPA') {
      const existing = await this.prisma.spaBooking.findUnique({
        where: { id: bookingId },
      });
      if (!existing) throw new NotFoundException('Запись не найдена');
      const next = computeUsageAfterGates({
        presenceStatus: status,
        performanceStatus: existing.performanceStatus,
        usageStatus: existing.usageStatus,
        consumedInCrm: Boolean(existing.consumedInCrmAt),
      });
      const trust = this.trustDataForBooking(
        existing.origin,
        status,
        existing.performanceStatus,
      );
      await this.prisma.spaBooking.update({
        where: { id: bookingId },
        data: {
          presenceStatus: status,
          usageStatus: next.usageStatus,
          eligibleForMotivation: next.eligibleForMotivation,
          ...trust,
          ...overrideData,
        },
      });
      if (next.usageStatus === 'ATTENDED') {
        await this.consumeSpaIfReady(bookingId);
      }
      return { success: true };
    }

    if (kind === 'PT') {
      const existing = await this.prisma.personalTrainingBooking.findUnique({
        where: { id: bookingId },
      });
      if (!existing) throw new NotFoundException('Запись не найдена');
      const next = computeUsageAfterGates({
        presenceStatus: status,
        performanceStatus: existing.performanceStatus,
        usageStatus: existing.usageStatus,
        isComplimentary: existing.isComplimentary,
      });
      const trust = this.trustDataForBooking(
        existing.origin,
        status,
        existing.performanceStatus,
      );
      await this.prisma.personalTrainingBooking.update({
        where: { id: bookingId },
        data: {
          presenceStatus: status,
          usageStatus: next.usageStatus,
          eligibleForMotivation: next.eligibleForMotivation,
          ...trust,
          ...overrideData,
        },
      });
      return { success: true };
    }

    const existing = await this.prisma.groupClassBooking.findUnique({
      where: { id: bookingId },
    });
    if (!existing) throw new NotFoundException('Запись не найдена');
    const next = computeUsageAfterGates({
      presenceStatus: status,
      performanceStatus: existing.performanceStatus,
      usageStatus: existing.usageStatus,
    });
    const trust = this.trustDataForBooking(
      existing.origin,
      status,
      existing.performanceStatus,
    );
    await this.prisma.groupClassBooking.update({
      where: { id: bookingId },
      data: {
        presenceStatus: status,
        usageStatus: next.usageStatus,
        eligibleForMotivation: next.eligibleForMotivation,
        ...trust,
        ...overrideData,
      },
    });
    return { success: true };
  }

  private async applyPerformance(
    bookingId: string,
    kind: 'SPA' | 'PT' | 'GROUP',
    status: ServicePerformanceStatus,
  ) {
    if (kind === 'SPA') {
      const existing = await this.prisma.spaBooking.findUnique({
        where: { id: bookingId },
      });
      if (!existing) throw new NotFoundException('Запись не найдена');
      const next = computeUsageAfterGates({
        presenceStatus: existing.presenceStatus,
        performanceStatus: status,
        usageStatus: existing.usageStatus,
        consumedInCrm: Boolean(existing.consumedInCrmAt),
      });
      const trust = this.trustDataForBooking(
        existing.origin,
        existing.presenceStatus,
        status,
      );
      await this.prisma.spaBooking.update({
        where: { id: bookingId },
        data: {
          performanceStatus: status,
          specialistCompletedAt: new Date(),
          usageStatus: next.usageStatus,
          eligibleForMotivation: next.eligibleForMotivation,
          ...trust,
        },
      });
      if (next.usageStatus === 'ATTENDED') {
        await this.consumeSpaIfReady(bookingId);
      }
      return { success: true };
    }

    if (kind === 'PT') {
      const existing = await this.prisma.personalTrainingBooking.findUnique({
        where: { id: bookingId },
      });
      if (!existing) throw new NotFoundException('Запись не найдена');
      const next = computeUsageAfterGates({
        presenceStatus: existing.presenceStatus,
        performanceStatus: status,
        usageStatus: existing.usageStatus,
        isComplimentary: existing.isComplimentary,
      });
      const trust = this.trustDataForBooking(
        existing.origin,
        existing.presenceStatus,
        status,
      );
      await this.prisma.personalTrainingBooking.update({
        where: { id: bookingId },
        data: {
          performanceStatus: status,
          usageStatus: next.usageStatus,
          eligibleForMotivation: next.eligibleForMotivation,
          ...trust,
        },
      });
      return { success: true };
    }

    const existing = await this.prisma.groupClassBooking.findUnique({
      where: { id: bookingId },
    });
    if (!existing) throw new NotFoundException('Запись не найдена');
    const next = computeUsageAfterGates({
      presenceStatus: existing.presenceStatus,
      performanceStatus: status,
      usageStatus: existing.usageStatus,
    });
    const trust = this.trustDataForBooking(
      existing.origin,
      existing.presenceStatus,
      status,
    );
    await this.prisma.groupClassBooking.update({
      where: { id: bookingId },
      data: {
        performanceStatus: status,
        usageStatus: next.usageStatus,
        eligibleForMotivation: next.eligibleForMotivation,
        ...trust,
      },
    });
    return { success: true };
  }
}
