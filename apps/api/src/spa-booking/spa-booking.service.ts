import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AvailabilityBlockStatus,
  Role,
  ServiceUsageStatus,
  SessionApprovalKind,
  SpaBookingOrigin,
  SpaBookingStatus,
  SpaCancelledBy,
  SpaOneCLinkStatus,
  SpaPaymentType,
  SpaWaitlistStatus,
  type SpaService as PrismaSpaService,
} from '@prisma/client';
import {
  classifyVisitKind,
  MembershipStatus,
  SessionType,
  UserRole,
  sessionApprovalLabelRu,
  toUsageControl,
  type Membership,
  type MembershipServiceQuota,
  type SpaBoardBooking,
  type SpaBoardResponse,
  type SpaBooking,
  type SpaBulkBookingResult,
  type SpaQuotaRule,
  type SpaService,
  type SpaServiceEligibility,
  type SpaWaitlistEntry,
  type SpecialistCalendarResponse,
} from '@fitgo/shared-types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { SessionApprovalService } from '../booking-control/session-approval.service';
import { ClubCrmLinkService } from '../common/club-crm-link.service';
import { ClubMembershipService } from '../common/club-membership.service';
import { normalizePhone } from '../common/phone.util';
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

/** Normalize `HH:MM` / `HH:MM:SS` from browsers to `HH:MM`. */
function normalizeHm(raw: string): string {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw.trim());
  if (!m) {
    throw new BadRequestException(`Некорректное время: ${raw}`);
  }
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) {
    throw new BadRequestException(`Некорректное время: ${raw}`);
  }
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function localDayBounds(day: string): { start: Date; end: Date; y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!match) {
    throw new BadRequestException('day must be YYYY-MM-DD');
  }
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d, 23, 59, 59, 999);
  if (Number.isNaN(start.getTime())) {
    throw new BadRequestException('Некорректная дата');
  }
  return { start, end, y, m, d };
}

@Injectable()
export class SpaBookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
    private readonly crmLink: ClubCrmLinkService,
    private readonly clubMembership: ClubMembershipService,
    private readonly notifications: NotificationsService,
    private readonly serviceUsage: ServiceUsageService,
    private readonly sessionApproval: SessionApprovalService,
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
      priceFromOneCMinor: s.priceFromOneCMinor ?? undefined,
      priceOverrideMinor: s.priceOverrideMinor ?? undefined,
      bookable: s.bookable,
      currency: s.currency,
      active: s.active,
    };
  }

  private mapBooking(booking: {
    id: string;
    clubId: string;
    specialistId: string;
    clientId: string | null;
    guestName?: string | null;
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
    client: { firstName: string; lastName: string } | null;
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
      clientId: booking.clientId ?? '',
      clientName: this.spaClientName(booking.client, booking.guestName),
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

  /**
   * Подтянуть из 1С отмены/удаления визитов.
   * — found + cancelled → CANCELLED + CRM_ADMIN
   * — previously consumed but document missing / deletionMark → unlock CRM link
   *   (можно снова редактировать и удалять в FitGO)
   */
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
          // В комментарии 1С всегда FitGO booking.id; crmDocRef после списания = UUID документа.
          const st = await getStatus.call(provider, externalId, {
            bookingRef: b.id,
          });
          if (st.found && st.cancelled) {
            await this.prisma.spaBooking.update({
              where: { id: b.id },
              data: {
                status: SpaBookingStatus.CANCELLED,
                cancelledBy: SpaCancelledBy.CRM_ADMIN,
                cancelledAt: new Date(),
              },
            });
            return;
          }
          // Документ удалён / пометён на удаление / не найден — снять блокировку CRM.
          const deleted =
            Boolean(st.deletionMark) ||
            (!st.found && b.consumedInCrmAt != null);
          if (!deleted) return;
          await this.prisma.spaBooking.update({
            where: { id: b.id },
            data: {
              consumedInCrmAt: null,
              crmDocRef: null,
            },
          });
        } catch {
          /* ignore single-booking sync errors */
        }
      }),
    );
  }

  /** Best-effort CRM unlock/cancel for board rows (grouped by client). */
  private async syncCrmCancellationsForBookings(
    bookings: Array<{
      id: string;
      status: SpaBookingStatus;
      consumedInCrmAt: Date | null;
      crmDocRef: string | null;
      clientId: string | null;
    }>,
  ) {
    const byClient = new Map<string, typeof bookings>();
    for (const b of bookings) {
      if (!b.clientId || !b.consumedInCrmAt) continue;
      const list = byClient.get(b.clientId) ?? [];
      list.push(b);
      byClient.set(b.clientId, list);
    }
    await Promise.all(
      [...byClient.entries()].map(([clientId, list]) =>
        this.syncCrmCancellations(clientId, list),
      ),
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

  /** Prefer higher remaining / unlimited when the same service name appears twice. */
  private mergeServiceQuotas(
    lists: Array<MembershipServiceQuota[] | undefined>,
  ): MembershipServiceQuota[] {
    const byName = new Map<string, MembershipServiceQuota>();
    for (const list of lists) {
      for (const svc of list ?? []) {
        const key = svc.name.trim().toLowerCase();
        if (!key) continue;
        const prev = byName.get(key);
        if (!prev) {
          byName.set(key, svc);
          continue;
        }
        if (svc.unlimited && !prev.unlimited) {
          byName.set(key, svc);
          continue;
        }
        if (!svc.unlimited && !prev.unlimited) {
          if ((svc.remaining ?? 0) > (prev.remaining ?? 0)) {
            byName.set(key, svc);
          }
        }
      }
    }
    return [...byName.values()];
  }

  /**
   * Membership + optional GET /packages (massage block as separate package).
   * After 1C update, getMembership already merges; packages is belt-and-suspenders.
   */
  private async loadMembershipWithAllPackageQuotas(
    externalId: string,
  ): Promise<Membership | null> {
    const provider = this.fitness.getProvider();
    let membership: Membership | null = null;
    try {
      membership = await provider.getMembership(externalId);
    } catch {
      membership = null;
    }

    let packageQuotas: MembershipServiceQuota[] = [];
    if (provider.getClientPackages) {
      try {
        const packages = await provider.getClientPackages(externalId);
        packageQuotas = packages.flatMap((p) => p.serviceQuotas ?? []);
      } catch {
        packageQuotas = [];
      }
    }

    const merged = this.mergeServiceQuotas([
      membership?.services,
      packageQuotas,
    ]);
    if (!membership && merged.length === 0) return null;
    if (!membership) {
      return {
        id: `packages:${externalId}`,
        name: 'Пакеты услуг',
        status: MembershipStatus.ACTIVE,
        validFrom: new Date().toISOString().slice(0, 10),
        validUntil: new Date().toISOString().slice(0, 10),
        services: merged,
      };
    }
    return {
      ...membership,
      services: merged.length > 0 ? merged : membership.services,
    };
  }

  /** Catalog services / specialists allowed to consume any SPA membership quota. */
  private async loadQuotaAllowlist(clubId: string) {
    const rules = await this.prisma.spaQuotaRule.findMany({
      where: { clubId },
      include: { services: true, specialists: true },
    });
    const serviceIds = new Set(
      rules.flatMap((r) => r.services.map((s) => s.serviceId)),
    );
    const specialistIds = new Set(
      rules.flatMap((r) => r.specialists.map((s) => s.specialistId)),
    );
    return { rules, serviceIds, specialistIds };
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
    const { serviceIds: allowedServiceIds } =
      await this.loadQuotaAllowlist(clubId);

    const membershipSpa = (membership?.services ?? []).filter((s) =>
      this.isSpaMembershipService(s.name),
    );

    const results: SpaServiceEligibility[] = [];
    for (const service of services) {
      let quotaAvailable = false;
      let quotaRemaining: number | undefined;
      let matchedName: string | undefined;

      if (allowedServiceIds.has(service.id)) {
        for (const mSvc of membershipSpa) {
          if (
            opts?.membershipServiceName &&
            mSvc.name !== opts.membershipServiceName
          ) {
            continue;
          }
          const hasQuota = mSvc.unlimited || (mSvc.remaining ?? 0) > 0;
          if (!hasQuota) continue;
          quotaAvailable = true;
          quotaRemaining = mSvc.unlimited ? undefined : mSvc.remaining;
          matchedName = mSvc.name;
          break;
        }
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
    if (opts?.paymentType === 'QUOTA') {
      const { serviceIds, specialistIds: allowedSpecialists } =
        await this.loadQuotaAllowlist(clubId);
      if (!serviceIds.has(serviceId)) {
        return [];
      }
      specialistIds =
        allowedSpecialists.size > 0 ? [...allowedSpecialists] : null;
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

  private spaClientName(
    client: { firstName: string; lastName: string } | null | undefined,
    guestName?: string | null,
  ) {
    if (client) {
      const name = `${client.lastName} ${client.firstName}`.trim();
      if (name) return name;
    }
    return guestName?.trim() || 'Гость';
  }

  /**
   * Local user first, then a short 1C lookup. A slow 1C does not block the form:
   * the caller can still save a guest with the phone.
   */
  async lookupClientByPhone(actor: JwtPayload, rawPhone: string) {
    const clubId = requireClubId(actor);
    const phone = normalizePhone(rawPhone);
    if (phone.length < 9) {
      throw new BadRequestException('Введите номер полностью');
    }

    const local = await this.prisma.user.findFirst({
      where: { phoneNormalized: phone },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        externalId: true,
      },
    });
    if (local?.externalId) {
      return {
        found: true as const,
        pending: false,
        source: 'local' as const,
        phone,
        clientId: local.id,
        externalId: local.externalId,
        firstName: local.firstName,
        lastName: local.lastName,
      };
    }

    const now = new Date();
    const cached = await this.prisma.spaPhoneLookupCache.findUnique({
      where: { clubId_phoneNormalized: { clubId, phoneNormalized: phone } },
    });
    if (cached && cached.expiresAt > now) {
      return {
        found: cached.found,
        pending: false,
        source: cached.found ? ('1c' as const) : ('none' as const),
        phone,
        clientId: cached.localUserId ?? local?.id,
        externalId: cached.externalId ?? undefined,
        firstName: cached.firstName ?? local?.firstName,
        lastName: cached.lastName ?? local?.lastName,
      };
    }

    const provider = this.fitness.getProvider();
    let remote: Awaited<
      ReturnType<NonNullable<typeof provider.findClientByPhone>>
    > | 'timeout' | null = null;
    if (provider.findClientByPhone) {
      remote = await Promise.race([
        provider
          .findClientByPhone(phone)
          .catch(() => null),
        new Promise<'timeout'>((resolve) =>
          setTimeout(() => resolve('timeout'), 5_000),
        ),
      ]);
    }

    if (remote === 'timeout') {
      return {
        found: Boolean(local),
        pending: true,
        source: local ? ('local' as const) : ('none' as const),
        phone,
        clientId: local?.id,
        externalId: local?.externalId ?? undefined,
        firstName: local?.firstName,
        lastName: local?.lastName,
      };
    }

    const hit = remote && remote.externalId ? remote : null;
    if (hit && local && !local.externalId) {
      await this.prisma.user.update({
        where: { id: local.id },
        data: { externalId: hit.externalId },
      });
    }

    const expiresAt = new Date(
      now.getTime() + (hit ? 24 : 1) * 60 * 60 * 1000,
    );
    await this.prisma.spaPhoneLookupCache.upsert({
      where: { clubId_phoneNormalized: { clubId, phoneNormalized: phone } },
      create: {
        clubId,
        phoneNormalized: phone,
        externalId: hit?.externalId,
        firstName: hit?.firstName ?? local?.firstName,
        lastName: hit?.lastName ?? local?.lastName,
        localUserId: local?.id,
        found: Boolean(hit || local),
        expiresAt,
      },
      update: {
        externalId: hit?.externalId,
        firstName: hit?.firstName ?? local?.firstName,
        lastName: hit?.lastName ?? local?.lastName,
        localUserId: local?.id,
        found: Boolean(hit || local),
        expiresAt,
      },
    });

    if (local) {
      return {
        found: true as const,
        pending: false,
        source: hit ? ('1c' as const) : ('local' as const),
        phone,
        clientId: local.id,
        externalId: hit?.externalId ?? local.externalId ?? undefined,
        firstName: hit?.firstName || local.firstName,
        lastName: hit?.lastName || local.lastName,
      };
    }
    if (hit) {
      return {
        found: true as const,
        pending: false,
        source: '1c' as const,
        phone,
        externalId: hit.externalId,
        firstName: hit.firstName,
        lastName: hit.lastName,
      };
    }
    return {
      found: false as const,
      pending: false,
      source: 'none' as const,
      phone,
    };
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
    return this.loadMembershipWithAllPackageQuotas(externalId);
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

  private async resolveBookingClient(
    actor: JwtPayload,
    input: {
      clientId?: string;
      guestName?: string;
      guestPhone?: string;
      paymentType?: 'QUOTA' | 'PAID';
    },
  ) {
    let clientId = input.clientId?.trim() || undefined;
    let guestName = input.guestName?.trim() || undefined;
    let guestPhone = input.guestPhone?.trim() || undefined;
    let clientExternalId: string | undefined;
    let oneCLinkStatus: SpaOneCLinkStatus = SpaOneCLinkStatus.NOT_LINKED;

    if (!clientId && guestPhone) {
      const found = await this.lookupClientByPhone(actor, guestPhone);
      guestPhone = found.phone;
      if (found.clientId) {
        clientId = found.clientId;
        clientExternalId = found.externalId;
        if (found.externalId) oneCLinkStatus = SpaOneCLinkStatus.LINKED;
      } else if (found.externalId) {
        const fromCrm = `${found.lastName ?? ''} ${found.firstName ?? ''}`.trim();
        guestName = guestName || fromCrm || undefined;
        clientExternalId = found.externalId;
        oneCLinkStatus = SpaOneCLinkStatus.LINKED;
      }
    }

    if (!clientId && !guestName) {
      throw new BadRequestException('Укажите клиента из базы или ФИО');
    }

    let client: {
      id: string;
      externalId: string | null;
      firstName: string;
      lastName: string;
    } | null = null;
    let externalId: string | undefined = clientExternalId;
    if (clientId) {
      client = await this.prisma.user.findFirst({
        where: {
          id: clientId,
          roles: { some: { role: Role.CLIENT } },
        },
        select: {
          id: true,
          externalId: true,
          firstName: true,
          lastName: true,
        },
      });
      if (!client) throw new NotFoundException('Клиент не найден');
      if (input.paymentType === 'QUOTA' || client.externalId || clientExternalId) {
        try {
          const resolved = await this.resolveExternalId(
            clientId,
            actor.sub === clientId
              ? actor.externalId
              : client.externalId ?? clientExternalId,
          );
          externalId = resolved.externalId;
          oneCLinkStatus = SpaOneCLinkStatus.LINKED;
        } catch (err) {
          if (!clientExternalId) throw err;
          externalId = clientExternalId;
          oneCLinkStatus = SpaOneCLinkStatus.LINKED;
        }
      }
    }

    return {
      clientId: client?.id,
      client,
      guestName: client ? undefined : guestName,
      guestPhone: client ? guestPhone : guestPhone,
      clientExternalId: externalId,
      oneCLinkStatus,
      externalId,
    };
  }

  /**
   * Staff (specialist/admin) may pick any start that fits published hours
   * and does not overlap — not only the client self-book slot grid.
   */
  private async assertStaffBookingWindow(
    specialistId: string,
    start: Date,
    end: Date,
    excludeBookingId?: string,
  ) {
    // Past starts are allowed for staff backfill («забыли сразу добавить»).
    if (end <= start) {
      throw new BadRequestException('Некорректный интервал');
    }

    const covers = await this.prisma.specialistAvailabilityBlock.findFirst({
      where: {
        specialistId,
        status: AvailabilityBlockStatus.PUBLISHED,
        startAt: { lte: start },
        endAt: { gte: end },
      },
    });
    if (!covers) {
      throw new ConflictException(
        'Время вне рабочих часов специалиста или не опубликовано',
      );
    }

    const overlap = await this.prisma.spaBooking.findFirst({
      where: {
        specialistId,
        status: SpaBookingStatus.CONFIRMED,
        startAt: { lt: end },
        endAt: { gt: start },
        ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      },
      select: { id: true },
    });
    if (overlap) {
      throw new ConflictException('На это время уже есть запись');
    }
  }

  async bookSpa(
    actor: JwtPayload,
    input: {
      clientId?: string;
      guestName?: string;
      guestPhone?: string;
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
    if (!service.bookable) {
      throw new BadRequestException(
        'Услуга скрыта из записи — включите её в каталоге супер-админа',
      );
    }

    const durationMs = (service.durationMin + service.bufferMin) * 60_000;
    const end = new Date(start.getTime() + durationMs);

    const staffOrigin =
      input.origin === SpaBookingOrigin.SPECIALIST_ASSIGNED ||
      input.origin === SpaBookingOrigin.ADMIN_ASSIGNED;
    if (staffOrigin) {
      await this.assertStaffBookingWindow(input.specialistId, start, end);
    } else {
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

    const resolved = await this.resolveBookingClient(actor, input);
    const client = resolved.client;

    let membership: Membership | null = null;
    if (resolved.externalId) {
      membership = await this.loadMembershipWithAllPackageQuotas(
        resolved.externalId,
      );
    } else if (input.paymentType === 'QUOTA') {
      throw new BadRequestException(
        'Квоту можно списать только у клиента, найденного в 1С',
      );
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
      const { serviceIds, specialistIds } =
        await this.loadQuotaAllowlist(clubId);
      if (serviceIds.size === 0) {
        throw new BadRequestException(
          'Не настроено правило списания с абонемента',
        );
      }
      if (!serviceIds.has(input.serviceId)) {
        throw new BadRequestException(
          'Этот вид услуги нельзя списать по абонементу',
        );
      }
      if (
        specialistIds.size > 0 &&
        !specialistIds.has(input.specialistId)
      ) {
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
      const existing = await this.prisma.spaBooking.findFirst({
        where: {
          specialistId: input.specialistId,
          startAt: start,
          status: { notIn: ['CANCELLED', 'FAILED'] },
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
            clientId: resolved.clientId ?? null,
            guestName: resolved.guestName ?? null,
            guestPhone: resolved.guestPhone ?? null,
            clientExternalId: resolved.clientExternalId ?? null,
            oneCLinkStatus: resolved.oneCLinkStatus,
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
            clientId: resolved.clientId ?? null,
            guestName: resolved.guestName ?? null,
            guestPhone: resolved.guestPhone ?? null,
            clientExternalId: resolved.clientExternalId ?? null,
            oneCLinkStatus: resolved.oneCLinkStatus,
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
      if (resolved.clientId) {
        await this.notifications.notifySpaAssigned({
          clientId: resolved.clientId,
          specialistId: input.specialistId,
          specialistName: specialistName || 'Специалист',
          serviceName: booking.service.name,
          startAt: start,
        });
      }
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
      clientId?: string;
      guestName?: string;
      guestPhone?: string;
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
      clientId?: string;
      guestName?: string;
      guestPhone?: string;
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
    if (booking.endAt > new Date()) {
      throw new BadRequestException('Занятие ещё не закончилось');
    }
    await this.serviceUsage.markPerformerConfirmed(bookingId, 'SPA');
    await this.sessionApproval.confirmPerformer(
      user,
      SessionApprovalKind.SPA,
      bookingId,
    );
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
      if (!booking.clientId) {
        throw new BadRequestException(
          'Отмена в 1С доступна только для клиента из базы',
        );
      }
      const { externalId } = await this.resolveExternalId(
        booking.clientId,
        user.sub === booking.clientId
          ? user.externalId
          : booking.client?.externalId ?? booking.clientExternalId ?? undefined,
      );
      try {
        await restore.call(provider, externalId, {
          bookingRef: booking.id,
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

    const clientName = this.spaClientName(booking.client, booking.guestName);
    if (booking.clientId) {
      await this.notifications
        .notifyBookingCancelled({
          clubId: booking.clubId,
          clientId: booking.clientId,
          clientName,
          clientPhone: booking.client?.phone ?? booking.guestPhone ?? undefined,
          sessionTitle: booking.service.name,
          startAt: booking.startAt,
          sessionType: 'spa',
          trainerId: booking.specialistId,
        })
        .catch(() => undefined);
    }

    return { success: true };
  }

  // ─── Specialist schedule ───────────────────────────────────────────────────

  private async assertClubSpecialist(user: JwtPayload, specialistId: string) {
    const clubId = requireClubId(user);
    const specialist = await this.prisma.user.findFirst({
      where: {
        id: specialistId,
        clubId,
        roles: { some: { role: Role.SPECIALIST } },
      },
      select: { id: true },
    });
    if (!specialist) throw new NotFoundException('Специалист не найден');
    return specialistId;
  }

  async listSpecialistOwnServices(user: JwtPayload) {
    const links = await this.prisma.specialistService.findMany({
      where: { specialistId: user.sub },
      include: { service: true },
    });
    return links
      .filter((l) => l.service.active)
      .map((l) => this.mapService(l.service));
  }

  private async getWorkScheduleById(specialistId: string) {
    const slots = await this.prisma.specialistWorkSlot.findMany({
      where: { specialistId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
    return slots.map((s) => ({
      dayOfWeek: s.dayOfWeek,
      startTime: s.startTime,
      endTime: s.endTime,
    }));
  }

  async getWorkSchedule(user: JwtPayload) {
    return this.getWorkScheduleById(user.sub);
  }

  async adminGetWorkSchedule(user: JwtPayload, specialistId: string) {
    await this.assertClubSpecialist(user, specialistId);
    return this.getWorkScheduleById(specialistId);
  }

  private async setWorkScheduleById(
    specialistId: string,
    slots: WorkSlotInput[],
  ) {
    const normalized = slots.map((slot) => ({
      dayOfWeek: slot.dayOfWeek,
      startTime: normalizeHm(slot.startTime),
      endTime: normalizeHm(slot.endTime),
    }));
    this.validateWorkSlots(normalized);
    await this.prisma.$transaction([
      this.prisma.specialistWorkSlot.deleteMany({
        where: { specialistId },
      }),
      this.prisma.specialistWorkSlot.createMany({
        data: normalized.map((slot) => ({
          specialistId,
          dayOfWeek: slot.dayOfWeek,
          startTime: slot.startTime,
          endTime: slot.endTime,
        })),
      }),
    ]);
    return this.getWorkScheduleById(specialistId);
  }

  async setWorkSchedule(user: JwtPayload, slots: WorkSlotInput[]) {
    return this.setWorkScheduleById(user.sub, slots);
  }

  async adminSetWorkSchedule(
    user: JwtPayload,
    specialistId: string,
    slots: WorkSlotInput[],
  ) {
    await this.assertClubSpecialist(user, specialistId);
    return this.setWorkScheduleById(specialistId, slots);
  }

  private validateWorkSlots(slots: WorkSlotInput[]) {
    for (const slot of slots) {
      if (slot.startTime >= slot.endTime) {
        throw new BadRequestException('Время начала должно быть раньше окончания');
      }
    }
  }

  /**
   * Replace published/draft hours for one calendar day.
   * Pass null/empty start+end to mark the day as off.
   */
  private async setDayHoursById(
    specialistId: string,
    day: string,
    startTime?: string | null,
    endTime?: string | null,
  ) {
    const { start, end, y, m, d } = localDayBounds(day);
    const hasStart = Boolean(startTime && String(startTime).trim());
    const hasEnd = Boolean(endTime && String(endTime).trim());
    if (hasStart !== hasEnd) {
      throw new BadRequestException('Укажите и начало, и конец — или очистите оба');
    }

    let blockStart: Date | null = null;
    let blockEnd: Date | null = null;
    let hmStart: string | null = null;
    let hmEnd: string | null = null;
    if (hasStart && hasEnd) {
      hmStart = normalizeHm(String(startTime));
      hmEnd = normalizeHm(String(endTime));
      if (hmStart >= hmEnd) {
        throw new BadRequestException('Время начала должно быть раньше окончания');
      }
      const [sh, sm] = hmStart.split(':').map(Number);
      const [eh, em] = hmEnd.split(':').map(Number);
      blockStart = new Date(y, m - 1, d, sh, sm, 0, 0);
      blockEnd = new Date(y, m - 1, d, eh, em, 0, 0);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.specialistAvailabilityBlock.deleteMany({
        where: {
          specialistId,
          startAt: { gte: start },
          endAt: { lte: end },
        },
      });
      if (blockStart && blockEnd) {
        await tx.specialistAvailabilityBlock.create({
          data: {
            specialistId,
            startAt: blockStart,
            endAt: blockEnd,
            status: AvailabilityBlockStatus.PUBLISHED,
          },
        });
      }
    });

    const blocks = await this.getAvailabilityBlocksById(
      specialistId,
      start.toISOString(),
      end.toISOString(),
    );
    return {
      day,
      startTime: hmStart,
      endTime: hmEnd,
      blocks,
    };
  }

  async setDayHours(
    user: JwtPayload,
    day: string,
    startTime?: string | null,
    endTime?: string | null,
  ) {
    return this.setDayHoursById(user.sub, day, startTime, endTime);
  }

  async adminSetDayHours(
    user: JwtPayload,
    specialistId: string,
    day: string,
    startTime?: string | null,
    endTime?: string | null,
  ) {
    await this.assertClubSpecialist(user, specialistId);
    return this.setDayHoursById(specialistId, day, startTime, endTime);
  }

  private async getAvailabilityBlocksById(
    specialistId: string,
    from: string,
    to: string,
  ) {
    const rangeStart = new Date(from);
    const rangeEnd = new Date(to);
    const blocks = await this.prisma.specialistAvailabilityBlock.findMany({
      where: {
        specialistId,
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

  async getAvailabilityBlocks(user: JwtPayload, from: string, to: string) {
    return this.getAvailabilityBlocksById(user.sub, from, to);
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

  private async fillFromTemplateById(
    specialistId: string,
    periodStart: string,
    periodEnd: string,
  ) {
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    const template = await this.prisma.specialistWorkSlot.findMany({
      where: { specialistId },
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
      // Replace previous draft/published hours in the period (re-apply template).
      await tx.specialistAvailabilityBlock.deleteMany({
        where: {
          specialistId,
          startAt: { gte: start },
          endAt: { lte: end },
        },
      });
      if (blocks.length > 0) {
        await tx.specialistAvailabilityBlock.createMany({
          data: blocks.map((b) => ({
            specialistId,
            startAt: b.startAt,
            endAt: b.endAt,
            status: AvailabilityBlockStatus.DRAFT,
          })),
        });
      }
    });

    return { createdBlocks: blocks.length };
  }

  async fillFromTemplate(
    user: JwtPayload,
    periodStart: string,
    periodEnd: string,
  ) {
    return this.fillFromTemplateById(user.sub, periodStart, periodEnd);
  }

  async adminFillFromTemplate(
    user: JwtPayload,
    specialistId: string,
    periodStart: string,
    periodEnd: string,
  ) {
    await this.assertClubSpecialist(user, specialistId);
    return this.fillFromTemplateById(specialistId, periodStart, periodEnd);
  }

  private async publishScheduleById(
    specialistId: string,
    periodStart: string,
    periodEnd: string,
  ) {
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    const result = await this.prisma.specialistAvailabilityBlock.updateMany({
      where: {
        specialistId,
        status: AvailabilityBlockStatus.DRAFT,
        startAt: { gte: start },
        endAt: { lte: end },
      },
      data: { status: AvailabilityBlockStatus.PUBLISHED },
    });
    await this.prisma.specialistSchedulePublication.create({
      data: {
        specialistId,
        periodStart: start,
        periodEnd: end,
      },
    });
    return { publishedBlocks: result.count };
  }

  async publishSchedule(
    user: JwtPayload,
    periodStart: string,
    periodEnd: string,
  ) {
    return this.publishScheduleById(user.sub, periodStart, periodEnd);
  }

  async adminPublishSchedule(
    user: JwtPayload,
    specialistId: string,
    periodStart: string,
    periodEnd: string,
  ) {
    await this.assertClubSpecialist(user, specialistId);
    return this.publishScheduleById(specialistId, periodStart, periodEnd);
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
        clientId: b.clientId ?? undefined,
        clientName: this.spaClientName(b.client, b.guestName),
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

  async checkAvailabilityOverlap(
    user: JwtPayload,
    startAt: string,
    endAt: string,
  ) {
    const start = new Date(startAt);
    const end = new Date(endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
      throw new BadRequestException('Некорректный интервал');
    }

    const clubId = requireClubId(user);
    const me = await this.prisma.user.findFirst({
      where: { id: user.sub, clubId },
      select: {
        id: true,
        defaultSpaRoomId: true,
      },
    });
    if (!me) throw new NotFoundException('Специалист не найден');

    const others = await this.prisma.user.findMany({
      where: {
        clubId,
        id: { not: user.sub },
        roles: { some: { role: Role.SPECIALIST } },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        defaultSpaRoomId: true,
      },
    });
    if (!others.length) return { overlaps: [] };

    const otherIds = others.map((o) => o.id);
    const [blocks, workSlots] = await Promise.all([
      this.prisma.specialistAvailabilityBlock.findMany({
        where: {
          specialistId: { in: otherIds },
          status: AvailabilityBlockStatus.PUBLISHED,
          startAt: { lt: end },
          endAt: { gt: start },
        },
        select: { specialistId: true },
      }),
      this.prisma.specialistWorkSlot.findMany({
        where: { specialistId: { in: otherIds } },
      }),
    ]);

    const overlapping = new Map<
      string,
      { specialistId: string; specialistName: string; reason: 'PUBLISHED_BLOCK' | 'WORK_SCHEDULE'; defaultSpaRoomId?: string | null }
    >();

    const byId = new Map(others.map((o) => [o.id, o]));

    for (const block of blocks) {
      const specialist = byId.get(block.specialistId);
      if (!specialist) continue;
      if (this.shouldSkipRoomOverlap(me.defaultSpaRoomId, specialist.defaultSpaRoomId)) {
        continue;
      }
      overlapping.set(block.specialistId, {
        specialistId: specialist.id,
        specialistName: `${specialist.lastName} ${specialist.firstName}`.trim(),
        reason: 'PUBLISHED_BLOCK',
        defaultSpaRoomId: specialist.defaultSpaRoomId,
      });
    }

    const cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    const endDay = new Date(end);
    endDay.setHours(23, 59, 59, 999);

    while (cursor <= endDay) {
      for (const slot of workSlots) {
        if (slot.dayOfWeek !== cursor.getDay()) continue;
        const [sh, sm] = slot.startTime.split(':').map(Number);
        const [eh, em] = slot.endTime.split(':').map(Number);
        const slotStart = new Date(cursor);
        slotStart.setHours(sh, sm, 0, 0);
        const slotEnd = new Date(cursor);
        slotEnd.setHours(eh, em, 0, 0);
        if (slotStart >= end || slotEnd <= start) continue;

        const specialist = byId.get(slot.specialistId);
        if (!specialist) continue;
        if (this.shouldSkipRoomOverlap(me.defaultSpaRoomId, specialist.defaultSpaRoomId)) {
          continue;
        }
        overlapping.set(slot.specialistId, {
          specialistId: specialist.id,
          specialistName: `${specialist.lastName} ${specialist.firstName}`.trim(),
          reason: 'WORK_SCHEDULE',
          defaultSpaRoomId: specialist.defaultSpaRoomId,
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    return { overlaps: [...overlapping.values()] };
  }

  private shouldSkipRoomOverlap(
    myRoomId: string | null | undefined,
    otherRoomId: string | null | undefined,
  ): boolean {
    if (!myRoomId || !otherRoomId) return false;
    return myRoomId !== otherRoomId;
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
      include: { client: true },
    });
    if (!booking) throw new NotFoundException('Запись не найдена');
    if (booking.status === SpaBookingStatus.CANCELLED) {
      return { ok: true };
    }
    if (booking.clientId && booking.consumedInCrmAt) {
      await this.syncCrmCancellations(booking.clientId, [booking]);
      const refreshed = await this.prisma.spaBooking.findUniqueOrThrow({
        where: { id: bookingId },
      });
      if (refreshed.consumedInCrmAt) {
        throw new BadRequestException(
          'Запись проведена в 1С — удаление только после отмены/удаления документа в 1С',
        );
      }
    }
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

  async adminCancelBooking(user: JwtPayload, bookingId: string) {
    const clubId = requireClubId(user);
    const booking = await this.prisma.spaBooking.findFirst({
      where: { id: bookingId, clubId },
      include: { client: true },
    });
    if (!booking) throw new NotFoundException('Запись не найдена');
    if (booking.status === SpaBookingStatus.CANCELLED) {
      throw new BadRequestException('Запись уже отменена');
    }
    if (booking.clientId && booking.consumedInCrmAt) {
      await this.syncCrmCancellations(booking.clientId, [booking]);
      const refreshed = await this.prisma.spaBooking.findUniqueOrThrow({
        where: { id: bookingId },
      });
      if (refreshed.consumedInCrmAt) {
        throw new BadRequestException(
          'Запись проведена в 1С — удаление только после отмены/удаления документа в 1С',
        );
      }
    }
    await this.prisma.spaBooking.update({
      where: { id: bookingId },
      data: {
        status: SpaBookingStatus.CANCELLED,
        cancelledBy: SpaCancelledBy.ADMIN,
        cancelledAt: new Date(),
      },
    });
    return { ok: true };
  }

  /**
   * Move / edit a confirmed SPA booking (staff journal drag or card form).
   */
  async updateStaffBooking(
    actor: JwtPayload,
    bookingId: string,
    input: {
      specialistId?: string;
      serviceId?: string;
      startAt?: string;
      clientId?: string;
      guestName?: string;
      guestPhone?: string;
      paymentType?: 'QUOTA' | 'PAID';
      membershipServiceName?: string;
    },
    opts: { asSpecialist: boolean },
  ): Promise<{ booking: SpaBooking }> {
    const clubId = requireClubId(actor);
    const existing = await this.prisma.spaBooking.findFirst({
      where: { id: bookingId, clubId },
      include: { specialist: true, client: true, service: true },
    });
    if (!existing) throw new NotFoundException('Запись не найдена');
    if (existing.status === SpaBookingStatus.CANCELLED) {
      throw new BadRequestException('Запись отменена');
    }
    if (opts.asSpecialist && existing.specialistId !== actor.sub) {
      throw new ForbiddenException('Можно менять только свои записи');
    }

    // Unlock if 1C document was cancelled/deleted since last sync.
    if (existing.clientId && existing.consumedInCrmAt) {
      await this.syncCrmCancellations(existing.clientId, [existing]);
    }
    const current = await this.prisma.spaBooking.findUniqueOrThrow({
      where: { id: existing.id },
    });
    const crmLocked = Boolean(current.consumedInCrmAt);
    if (crmLocked) {
      const touchesNonTime =
        (input.serviceId != null && input.serviceId !== existing.serviceId) ||
        (input.clientId !== undefined &&
          input.clientId !== (existing.clientId ?? undefined)) ||
        (input.guestName !== undefined &&
          (input.guestName ?? null) !== (existing.guestName ?? null)) ||
        (input.guestPhone !== undefined &&
          (input.guestPhone ?? null) !== (existing.guestPhone ?? null)) ||
        (input.paymentType != null &&
          input.paymentType !==
            (existing.paymentType === SpaPaymentType.QUOTA
              ? 'QUOTA'
              : 'PAID')) ||
        (input.specialistId != null &&
          input.specialistId !== existing.specialistId &&
          !opts.asSpecialist);
      if (touchesNonTime) {
        throw new BadRequestException(
          'Запись проведена в 1С — можно менять только дату и время',
        );
      }
    }

    const specialistId = opts.asSpecialist
      ? existing.specialistId
      : (input.specialistId ?? existing.specialistId);
    if (opts.asSpecialist && input.specialistId && input.specialistId !== existing.specialistId) {
      throw new BadRequestException('Специалист не может переносить к коллеге');
    }

    const serviceId = input.serviceId ?? existing.serviceId;
    const service = await this.prisma.spaService.findFirst({
      where: { id: serviceId, clubId, active: true },
    });
    if (!service) throw new NotFoundException('Услуга не найдена');

    const specialistOk = await this.prisma.specialistService.findUnique({
      where: {
        specialistId_serviceId: { specialistId, serviceId },
      },
    });
    if (!specialistOk) {
      throw new BadRequestException('Специалист не оказывает эту услугу');
    }

    const start = input.startAt ? new Date(input.startAt) : existing.startAt;
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Некорректная дата');
    }
    const durationMs = (service.durationMin + service.bufferMin) * 60_000;
    const end = new Date(start.getTime() + durationMs);

    await this.assertStaffBookingWindow(
      specialistId,
      start,
      end,
      existing.id,
    );

    const paymentType = input.paymentType ?? (
      existing.paymentType === SpaPaymentType.QUOTA ? 'QUOTA' : 'PAID'
    );
    const clientTouched =
      input.clientId !== undefined ||
      input.guestName !== undefined ||
      input.guestPhone !== undefined;

    let clientId = existing.clientId;
    let guestName = existing.guestName;
    let guestPhone = existing.guestPhone;
    let clientExternalId = existing.clientExternalId;
    let oneCLinkStatus = existing.oneCLinkStatus;

    if (clientTouched) {
      const resolved = await this.resolveBookingClient(actor, {
        clientId: input.clientId,
        guestName: input.guestName,
        guestPhone: input.guestPhone,
      });
      clientId = resolved.clientId ?? null;
      guestName = resolved.guestName ?? null;
      guestPhone = resolved.guestPhone ?? null;
      clientExternalId = resolved.clientExternalId ?? null;
      oneCLinkStatus = resolved.oneCLinkStatus;
    }

    let priceMinor = existing.priceMinor;
    let membershipServiceName =
      input.membershipServiceName !== undefined
        ? input.membershipServiceName
        : existing.membershipServiceName;

    if (paymentType === 'PAID') {
      priceMinor = service.priceMinor;
      membershipServiceName = null;
    } else if (
      paymentType === 'QUOTA' &&
      (input.paymentType !== undefined ||
        input.serviceId !== undefined ||
        input.specialistId !== undefined ||
        input.membershipServiceName !== undefined)
    ) {
      // Keep existing membership name unless caller overrides; re-validate rule lightly.
      priceMinor = 0;
    }

    try {
      const updated = await this.prisma.spaBooking.update({
        where: { id: existing.id },
        data: {
          specialistId,
          serviceId,
          startAt: start,
          endAt: end,
          clientId,
          guestName,
          guestPhone,
          clientExternalId,
          oneCLinkStatus,
          paymentType:
            paymentType === 'QUOTA'
              ? SpaPaymentType.QUOTA
              : SpaPaymentType.PAID,
          priceMinor,
          membershipServiceName,
        },
        include: { specialist: true, client: true, service: true },
      });
      return { booking: this.mapBooking(updated) };
    } catch (err) {
      if (
        err instanceof Error &&
        /Unique constraint/i.test(err.message)
      ) {
        throw new ConflictException('Слот уже занят');
      }
      throw err;
    }
  }

  async specialistUpdateBooking(
    user: JwtPayload,
    bookingId: string,
    input: {
      specialistId?: string;
      serviceId?: string;
      startAt?: string;
      clientId?: string;
      guestName?: string;
      guestPhone?: string;
      paymentType?: 'QUOTA' | 'PAID';
      membershipServiceName?: string;
    },
  ) {
    return this.updateStaffBooking(user, bookingId, input, {
      asSpecialist: true,
    });
  }

  async adminUpdateBooking(
    user: JwtPayload,
    bookingId: string,
    input: {
      specialistId?: string;
      serviceId?: string;
      startAt?: string;
      clientId?: string;
      guestName?: string;
      guestPhone?: string;
      paymentType?: 'QUOTA' | 'PAID';
      membershipServiceName?: string;
    },
  ) {
    return this.updateStaffBooking(user, bookingId, input, {
      asSpecialist: false,
    });
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
      priceOverrideMinor?: number | null;
      bookable?: boolean;
      currency?: string;
      active?: boolean;
    },
  ) {
    const clubId = requireClubId(user);
    const override =
      dto.priceOverrideMinor === null
        ? null
        : dto.priceOverrideMinor !== undefined
          ? dto.priceOverrideMinor
          : undefined;
    if (dto.id) {
      const existing = await this.prisma.spaService.findFirst({
        where: { id: dto.id, clubId },
      });
      if (!existing) throw new NotFoundException('Услуга не найдена');
      const nextOverride =
        override !== undefined ? override : existing.priceOverrideMinor;
      const effective =
        nextOverride ?? existing.priceFromOneCMinor ?? dto.priceMinor;
      const updated = await this.prisma.spaService.update({
        where: { id: dto.id },
        data: {
          name: dto.name,
          kind: dto.kind,
          durationMin: dto.durationMin,
          bufferMin: dto.bufferMin ?? 0,
          priceOverrideMinor: nextOverride,
          priceMinor: effective,
          bookable: dto.bookable ?? existing.bookable,
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
        priceOverrideMinor: override ?? null,
        bookable: dto.bookable ?? true,
        currency: dto.currency ?? 'BYN',
        active: dto.active ?? true,
      },
    });
    return this.mapService(created);
  }

  /**
   * Remove SPA catalog row. Hard-delete when unused; otherwise soft-hide
   * (active=false, bookable=false) so history stays intact.
   */
  async adminDeleteService(user: JwtPayload, serviceId: string) {
    const clubId = requireClubId(user);
    const existing = await this.prisma.spaService.findFirst({
      where: { id: serviceId, clubId },
      include: { _count: { select: { bookings: true } } },
    });
    if (!existing) throw new NotFoundException('Услуга не найдена');

    if (existing._count.bookings > 0) {
      const updated = await this.prisma.spaService.update({
        where: { id: serviceId },
        data: { active: false, bookable: false },
      });
      await this.prisma.specialistService.deleteMany({
        where: { serviceId },
      });
      return { deleted: false as const, hidden: true as const, service: this.mapService(updated) };
    }

    await this.prisma.spaService.delete({ where: { id: serviceId } });
    return { deleted: true as const, hidden: false as const };
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

  // ─── Shared board ──────────────────────────────────────────────────────────

  async getSpecialistSpaBoard(
    user: JwtPayload,
    from: string,
    to: string,
  ): Promise<SpaBoardResponse> {
    const clubId = requireClubId(user);
    return this.buildSpaBoard({
      clubId,
      from,
      to,
      viewerSpecialistId: user.sub,
      revealAll: false,
    });
  }

  async getAdminSpaBoard(
    user: JwtPayload,
    from: string,
    to: string,
    filters?: {
      specialistIds?: string[];
      serviceIds?: string[];
      status?: string;
      approval?: string;
    },
  ): Promise<SpaBoardResponse> {
    const clubId = requireClubId(user);
    return this.buildSpaBoard({
      clubId,
      from,
      to,
      revealAll: true,
      specialistIds: filters?.specialistIds,
      serviceIds: filters?.serviceIds,
      status: filters?.status,
      approval: filters?.approval,
    });
  }

  private async buildSpaBoard(opts: {
    clubId: string;
    from: string;
    to: string;
    viewerSpecialistId?: string;
    revealAll: boolean;
    specialistIds?: string[];
    serviceIds?: string[];
    status?: string;
    approval?: string;
  }): Promise<SpaBoardResponse> {
    const rangeStart = new Date(opts.from);
    const rangeEnd = new Date(opts.to);
    if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
      throw new BadRequestException('Некорректный период');
    }

    const staffWhere = {
      clubId: opts.clubId,
      roles: { some: { role: Role.SPECIALIST } },
      isActive: true as const,
      ...(opts.specialistIds?.length
        ? { id: { in: opts.specialistIds } }
        : {}),
    };

    const statusFilter =
      opts.status && opts.status !== 'ALL'
        ? (opts.status as SpaBookingStatus)
        : undefined;

    const [staff, bookingsRaw] = await Promise.all([
      this.prisma.user.findMany({
        where: staffWhere,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        select: { id: true, firstName: true, lastName: true },
      }),
      this.prisma.spaBooking.findMany({
        where: {
          clubId: opts.clubId,
          startAt: { lt: rangeEnd },
          endAt: { gt: rangeStart },
          status: statusFilter
            ? statusFilter
            : { in: [SpaBookingStatus.CONFIRMED, SpaBookingStatus.COMPLETED] },
          ...(opts.specialistIds?.length
            ? { specialistId: { in: opts.specialistIds } }
            : {}),
          ...(opts.serviceIds?.length
            ? { serviceId: { in: opts.serviceIds } }
            : {}),
        },
        include: { client: true, service: true },
        orderBy: { startAt: 'asc' },
      }),
    ]);

    await this.syncCrmCancellationsForBookings(bookingsRaw);
    const bookings = await this.prisma.spaBooking.findMany({
      where: {
        clubId: opts.clubId,
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
        status: statusFilter
          ? statusFilter
          : { in: [SpaBookingStatus.CONFIRMED, SpaBookingStatus.COMPLETED] },
        ...(opts.specialistIds?.length
          ? { specialistId: { in: opts.specialistIds } }
          : {}),
        ...(opts.serviceIds?.length
          ? { serviceId: { in: opts.serviceIds } }
          : {}),
      },
      include: { client: true, service: true },
      orderBy: { startAt: 'asc' },
    });

    const staffIds = staff.map((s) => s.id);
    const staffIdSet = new Set(staffIds);
    const hours =
      staffIds.length === 0
        ? []
        : await this.prisma.specialistAvailabilityBlock.findMany({
            where: {
              specialistId: { in: staffIds },
              startAt: { lt: rangeEnd },
              endAt: { gt: rangeStart },
            },
            orderBy: { startAt: 'asc' },
          });

    const visibleHours = hours.filter((h) => {
      if (!staffIdSet.has(h.specialistId)) return false;
      if (opts.revealAll) return true;
      if (h.status === AvailabilityBlockStatus.PUBLISHED) return true;
      return (
        h.status === AvailabilityBlockStatus.DRAFT &&
        h.specialistId === opts.viewerSpecialistId
      );
    });

    const bookingIds = bookings.map((b) => b.id);
    await this.sessionApproval.ensureApprovals(
      SessionApprovalKind.SPA,
      bookingIds,
      opts.clubId,
    );
    const approvals = bookingIds.length
      ? await this.prisma.sessionApproval.findMany({
          where: {
            kind: SessionApprovalKind.SPA,
            bookingId: { in: bookingIds },
          },
        })
      : [];
    const approvalByBooking = new Map(
      approvals.map((a) => [a.bookingId, a] as const),
    );

    const now = Date.now();
    const mappedBookings: SpaBoardBooking[] = [];
    for (const b of bookings) {
      if (!staffIdSet.has(b.specialistId)) continue;
      const reveal =
        opts.revealAll || b.specialistId === opts.viewerSpecialistId;
      if (!reveal) {
        mappedBookings.push({
          id: b.id,
          specialistId: b.specialistId,
          startAt: b.startAt.toISOString(),
          endAt: b.endAt.toISOString(),
          busy: true,
        });
        continue;
      }

      const row = approvalByBooking.get(b.id);
      const ended = b.endAt.getTime() <= now;
      const cancelled = b.status === SpaBookingStatus.CANCELLED;
      const phase =
        ended && !cancelled
          ? row
            ? this.sessionApproval.phase(row)
            : ('PENDING_PERFORMER' as const)
          : undefined;

      if (opts.approval && opts.approval !== 'ALL') {
        if (opts.approval === 'PENDING') {
          if (phase !== 'PENDING_PERFORMER' && phase !== 'PENDING_ADMIN') {
            continue;
          }
        } else if (phase !== opts.approval) {
          continue;
        }
      }

      mappedBookings.push({
        id: b.id,
        specialistId: b.specialistId,
        startAt: b.startAt.toISOString(),
        endAt: b.endAt.toISOString(),
        busy: false,
        clientId: b.clientId ?? undefined,
        clientName: this.spaClientName(b.client, b.guestName),
        guestName: b.guestName ?? undefined,
        guestPhone: b.guestPhone ?? undefined,
        serviceId: b.serviceId,
        serviceName: b.service.name,
        status: b.status as SpaBoardBooking['status'],
        paymentType: b.paymentType as SpaBoardBooking['paymentType'],
        approvalPhase: phase,
        approvalLabel:
          phase === 'PENDING_PERFORMER'
            ? 'Ждёт специалиста'
            : sessionApprovalLabelRu(phase),
        crmLocked: Boolean(b.consumedInCrmAt),
        consumedInCrm: Boolean(b.consumedInCrmAt),
      });
    }

    return {
      staff: staff.map((s) => ({
        id: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
      })),
      hours: visibleHours.map((h) => ({
        id: h.id,
        specialistId: h.specialistId,
        startAt: h.startAt.toISOString(),
        endAt: h.endAt.toISOString(),
        status: h.status as 'PUBLISHED' | 'DRAFT',
      })),
      bookings: mappedBookings,
    };
  }

  private isSpaStaff(user: JwtPayload) {
    const roles = user.roles ?? [];
    return (
      roles.includes(UserRole.ADMIN) ||
      roles.includes(UserRole.MANAGER) ||
      roles.includes(UserRole.SUPER_ADMIN) ||
      roles.includes(UserRole.SPECIALIST)
    );
  }

  private mapWaitlistEntry(entry: {
    id: string;
    clubId: string;
    specialistId: string;
    serviceId: string;
    clientId: string | null;
    guestName: string | null;
    guestPhone: string | null;
    desiredStartAt: Date;
    desiredEndAt: Date;
    status: SpaWaitlistStatus;
    createdAt: Date;
    specialist: { firstName: string; lastName: string };
    client: { firstName: string; lastName: string } | null;
    service: { name: string };
  }): SpaWaitlistEntry {
    return {
      id: entry.id,
      clubId: entry.clubId,
      specialistId: entry.specialistId,
      specialistName:
        `${entry.specialist.lastName} ${entry.specialist.firstName}`.trim(),
      serviceId: entry.serviceId,
      serviceName: entry.service.name,
      clientId: entry.clientId ?? undefined,
      clientName: this.spaClientName(entry.client, entry.guestName),
      guestPhone: entry.guestPhone ?? undefined,
      desiredStartAt: entry.desiredStartAt.toISOString(),
      desiredEndAt: entry.desiredEndAt.toISOString(),
      status: entry.status,
      createdAt: entry.createdAt.toISOString(),
    };
  }

  private waitlistInclude = {
    specialist: { select: { firstName: true, lastName: true } },
    client: { select: { firstName: true, lastName: true } },
    service: { select: { name: true } },
  } as const;

  /** Expire past WAITING rows in the queried range, then return active list. */
  async listSpaWaitlist(
    user: JwtPayload,
    from: string,
    to: string,
    opts?: { specialistId?: string },
  ): Promise<SpaWaitlistEntry[]> {
    const clubId = requireClubId(user);
    const rangeStart = new Date(from);
    const rangeEnd = new Date(to);
    if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
      throw new BadRequestException('Некорректный период');
    }

    const isClientOnly =
      (user.roles ?? []).includes(UserRole.CLIENT) && !this.isSpaStaff(user);
    const specialistScope = rolesIncludesSpecialistOnly(user)
      ? user.sub
      : opts?.specialistId;

    const scopeWhere = {
      clubId,
      ...(isClientOnly ? { clientId: user.sub } : {}),
      ...(specialistScope ? { specialistId: specialistScope } : {}),
    };

    await this.prisma.spaWaitlistEntry.updateMany({
      where: {
        ...scopeWhere,
        status: SpaWaitlistStatus.WAITING,
        desiredStartAt: { lt: new Date() },
      },
      data: { status: SpaWaitlistStatus.EXPIRED },
    });

    const entries = await this.prisma.spaWaitlistEntry.findMany({
      where: {
        ...scopeWhere,
        status: SpaWaitlistStatus.WAITING,
        desiredStartAt: { gte: rangeStart, lte: rangeEnd },
      },
      include: this.waitlistInclude,
      orderBy: [{ desiredStartAt: 'asc' }, { createdAt: 'asc' }],
    });
    return entries.map((e) => this.mapWaitlistEntry(e));
  }

  async createSpaWaitlist(
    user: JwtPayload,
    input: {
      specialistId: string;
      serviceId: string;
      desiredStartAt: string;
      clientId?: string;
      guestName?: string;
      guestPhone?: string;
    },
  ): Promise<SpaWaitlistEntry> {
    const clubId = requireClubId(user);
    const start = new Date(input.desiredStartAt);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Некорректная дата');
    }
    if (start.getTime() < Date.now() - 60_000) {
      throw new BadRequestException('Нельзя добавить прошедшее время');
    }

    const isClientOnly =
      (user.roles ?? []).includes(UserRole.CLIENT) && !this.isSpaStaff(user);

    let clientId = input.clientId;
    let guestName = input.guestName;
    let guestPhone = input.guestPhone;

    if (isClientOnly) {
      clientId = user.sub;
      guestName = undefined;
      guestPhone = undefined;
    } else if (rolesIncludesSpecialistOnly(user)) {
      // specialist creates for their own column only
      if (input.specialistId !== user.sub) {
        throw new ForbiddenException('Можно добавить только к себе');
      }
    }

    const service = await this.prisma.spaService.findFirst({
      where: { id: input.serviceId, clubId, active: true },
    });
    if (!service) throw new NotFoundException('Услуга не найдена');

    const specialist = await this.prisma.user.findFirst({
      where: {
        id: input.specialistId,
        clubId,
        roles: { some: { role: Role.SPECIALIST } },
      },
    });
    if (!specialist) throw new NotFoundException('Специалист не найден');

    const link = await this.prisma.specialistService.findUnique({
      where: {
        specialistId_serviceId: {
          specialistId: input.specialistId,
          serviceId: input.serviceId,
        },
      },
    });
    if (!link) {
      throw new BadRequestException('Специалист не оказывает эту услугу');
    }

    const resolved = isClientOnly
      ? {
          clientId: user.sub,
          guestName: undefined as string | undefined,
          guestPhone: undefined as string | undefined,
        }
      : await this.resolveBookingClient(user, {
          clientId,
          guestName,
          guestPhone,
        });

    const end = new Date(
      start.getTime() + (service.durationMin + service.bufferMin) * 60_000,
    );

    const duplicate = await this.prisma.spaWaitlistEntry.findFirst({
      where: {
        clubId,
        status: SpaWaitlistStatus.WAITING,
        specialistId: input.specialistId,
        serviceId: input.serviceId,
        desiredStartAt: start,
        ...(resolved.clientId
          ? { clientId: resolved.clientId }
          : { guestName: resolved.guestName ?? '' }),
      },
    });
    if (duplicate) {
      throw new ConflictException('Уже есть заявка в листе ожидания');
    }

    const entry = await this.prisma.spaWaitlistEntry.create({
      data: {
        clubId,
        specialistId: input.specialistId,
        serviceId: input.serviceId,
        clientId: resolved.clientId,
        guestName: resolved.guestName,
        guestPhone: resolved.guestPhone,
        desiredStartAt: start,
        desiredEndAt: end,
        status: SpaWaitlistStatus.WAITING,
        createdByUserId: user.sub,
      },
      include: this.waitlistInclude,
    });
    return this.mapWaitlistEntry(entry);
  }

  async cancelSpaWaitlist(user: JwtPayload, entryId: string) {
    const clubId = requireClubId(user);
    const entry = await this.prisma.spaWaitlistEntry.findFirst({
      where: { id: entryId, clubId },
    });
    if (!entry) throw new NotFoundException('Заявка не найдена');
    if (entry.status !== SpaWaitlistStatus.WAITING) {
      throw new BadRequestException('Заявка уже закрыта');
    }

    const isClientOnly =
      (user.roles ?? []).includes(UserRole.CLIENT) && !this.isSpaStaff(user);
    if (isClientOnly && entry.clientId !== user.sub) {
      throw new ForbiddenException('Нельзя снять чужую заявку');
    }
    if (rolesIncludesSpecialistOnly(user) && entry.specialistId !== user.sub) {
      throw new ForbiddenException('Нельзя снять заявку другого специалиста');
    }

    await this.prisma.spaWaitlistEntry.update({
      where: { id: entryId },
      data: { status: SpaWaitlistStatus.CANCELLED },
    });
    return { ok: true };
  }

  async bookFromSpaWaitlist(
    user: JwtPayload,
    entryId: string,
    opts?: {
      startAt?: string;
      paymentType?: 'QUOTA' | 'PAID';
      membershipServiceName?: string;
    },
  ) {
    if (!this.isSpaStaff(user)) {
      throw new ForbiddenException('Только сотрудники могут записать из листа');
    }
    const clubId = requireClubId(user);
    const entry = await this.prisma.spaWaitlistEntry.findFirst({
      where: { id: entryId, clubId, status: SpaWaitlistStatus.WAITING },
      include: { service: true },
    });
    if (!entry) throw new NotFoundException('Заявка не найдена');
    if (rolesIncludesSpecialistOnly(user) && entry.specialistId !== user.sub) {
      throw new ForbiddenException('Можно записать только к себе');
    }

    const startAt = opts?.startAt ?? entry.desiredStartAt.toISOString();
    const paymentType = opts?.paymentType ?? SpaPaymentType.PAID;

    const result = await this.bookSpa(user, {
      clientId: entry.clientId ?? undefined,
      guestName: entry.guestName ?? undefined,
      guestPhone: entry.guestPhone ?? undefined,
      specialistId: entry.specialistId,
      serviceId: entry.serviceId,
      startAt,
      paymentType,
      membershipServiceName: opts?.membershipServiceName,
      origin: rolesIncludesSpecialistOnly(user)
        ? SpaBookingOrigin.SPECIALIST_ASSIGNED
        : SpaBookingOrigin.ADMIN_ASSIGNED,
    });

    await this.prisma.spaWaitlistEntry.update({
      where: { id: entryId },
      data: {
        status: SpaWaitlistStatus.FULFILLED,
        fulfilledBookingId: result.booking.id,
      },
    });

    return result;
  }

  async bulkAssignSpaBookings(
    user: JwtPayload,
    input: {
      clientId?: string;
      guestName?: string;
      guestPhone?: string;
      specialistId: string;
      serviceId: string;
      startAt: string;
      paymentType: 'QUOTA' | 'PAID';
      membershipServiceName?: string;
      dates: string[];
    },
  ): Promise<SpaBulkBookingResult> {
    if (!this.isSpaStaff(user)) {
      throw new ForbiddenException('Только сотрудники');
    }
    if (rolesIncludesSpecialistOnly(user) && input.specialistId !== user.sub) {
      throw new ForbiddenException('Можно создавать записи только к себе');
    }

    const template = new Date(input.startAt);
    if (Number.isNaN(template.getTime())) {
      throw new BadRequestException('Некорректное время');
    }
    const hours = template.getHours();
    const minutes = template.getMinutes();
    const seconds = template.getSeconds();

    const created: SpaBooking[] = [];
    const skipped: Array<{ date: string; reason: string }> = [];
    const origin = rolesIncludesSpecialistOnly(user)
      ? SpaBookingOrigin.SPECIALIST_ASSIGNED
      : SpaBookingOrigin.ADMIN_ASSIGNED;

    const uniqueDates = [...new Set(input.dates)];
    for (const raw of uniqueDates) {
      const day = new Date(raw);
      if (Number.isNaN(day.getTime())) {
        skipped.push({ date: raw, reason: 'Некорректная дата' });
        continue;
      }
      const start = new Date(day);
      start.setHours(hours, minutes, seconds, 0);
      try {
        const result = await this.bookSpa(user, {
          clientId: input.clientId,
          guestName: input.guestName,
          guestPhone: input.guestPhone,
          specialistId: input.specialistId,
          serviceId: input.serviceId,
          startAt: start.toISOString(),
          paymentType: input.paymentType,
          membershipServiceName: input.membershipServiceName,
          origin,
        });
        created.push(result.booking);
      } catch (err) {
        const reason =
          err instanceof Error ? err.message : 'Не удалось создать запись';
        skipped.push({ date: start.toISOString(), reason });
      }
    }

    return { created, skipped };
  }
}

function rolesIncludesSpecialistOnly(user: JwtPayload): boolean {
  const roles = user.roles ?? [];
  const isSpecialist = roles.includes(UserRole.SPECIALIST);
  if (!isSpecialist) return false;
  return !(
    roles.includes(UserRole.ADMIN) ||
    roles.includes(UserRole.MANAGER) ||
    roles.includes(UserRole.SUPER_ADMIN)
  );
}
