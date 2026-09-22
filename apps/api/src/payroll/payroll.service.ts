import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GroupClassSessionStatus,
  MotivationRateKind,
  MotivationRateType,
  PersonalBookingStatus,
  Role,
  SpaBookingStatus,
  TrustBand,
  TrustResolution,
} from '@prisma/client';
import {
  isPayrollTrusted,
  payProfileSummary,
  resolvePtPercent,
  type MotivationRateDto,
  type PayrollAdjustmentDto,
  type PayrollPeriodSummary,
  type StaffCompensationDto,
  type StaffPayProfile,
  type StaffPaySummary,
  type StaffPayTrack,
  type WorkUnit,
} from '@fitgo/shared-types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { GroupSessionService } from '../group-session/group-session.service';
import { PrismaService } from '../prisma/prisma.service';
import { PtTimesheetService } from '../pt-timesheet/pt-timesheet.service';
import { ServiceUsageService } from '../service-usage/service-usage.service';
import { StaffRosterService } from '../staff-roster/staff-roster.service';

function asPayProfile(raw: unknown): StaffPayProfile | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  return raw as StaffPayProfile;
}

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly serviceUsage: ServiceUsageService,
    private readonly groupSessions: GroupSessionService,
    private readonly ptTimesheet: PtTimesheetService,
    private readonly staffRoster: StaffRosterService,
  ) {}

  async listWorkUnits(
    clubId: string,
    performerId: string,
    from: string,
    to: string,
  ): Promise<WorkUnit[]> {
    const fromD = new Date(`${from}T00:00:00`);
    const toD = new Date(`${to}T23:59:59.999`);
    const units: WorkUnit[] = [];

    const spa = await this.prisma.spaBooking.findMany({
      where: {
        clubId,
        specialistId: performerId,
        status: { not: SpaBookingStatus.CANCELLED },
        startAt: { gte: fromD, lte: toD },
        eligibleForMotivation: true,
      },
      include: { service: true, client: true },
      orderBy: { startAt: 'asc' },
    });
    for (const b of spa) {
      const trusted = this.serviceUsage.bookingPayrollTrusted(b);
      units.push({
        id: b.id,
        kind: 'SPA',
        performerId,
        title: b.service.name,
        occurredAt: b.startAt.toISOString(),
        quantity: 1,
        priceMinor: b.priceMinor ?? b.service.priceMinor,
        trustBand: b.trustBand as WorkUnit['trustBand'],
        trustResolution: b.trustResolution as WorkUnit['trustResolution'],
        payrollTrusted: trusted,
        clientName: `${b.client.lastName} ${b.client.firstName}`.trim(),
        serviceId: b.serviceId,
      });
    }

    const pts = await this.prisma.personalTrainingBooking.findMany({
      where: {
        trainerId: performerId,
        status: { not: PersonalBookingStatus.CANCELLED },
        startAt: { gte: fromD, lte: toD },
      },
      include: { client: true },
      orderBy: { startAt: 'asc' },
    });
    const fromDate = new Date(`${from}T00:00:00`);
    const toDate = new Date(`${to}T00:00:00`);
    const sheetLines = await this.prisma.trainerDaySheetLine.findMany({
      where: {
        sheet: {
          clubId,
          trainerId: performerId,
          date: { gte: fromDate, lte: toDate },
          status: { in: ['SA_APPROVED', 'LOCKED'] },
        },
      },
      select: {
        personalTrainingBookingId: true,
        payable: true,
        forceIncludeInPayroll: true,
        clientIssue: true,
      },
    });
    const sheetBookingIds = new Set(
      sheetLines.map((l) => l.personalTrainingBookingId),
    );
    const payableIds = new Set(
      sheetLines
        .filter(
          (l) =>
            l.clientIssue === 'NONE' &&
            (l.payable || l.forceIncludeInPayroll),
        )
        .map((l) => l.personalTrainingBookingId),
    );

    for (const b of pts) {
      if (sheetBookingIds.size > 0 && !sheetBookingIds.has(b.id)) continue;
      if (sheetBookingIds.size === 0 && !b.eligibleForMotivation) continue;

      const trusted =
        sheetBookingIds.size > 0
          ? b.isComplimentary || payableIds.has(b.id)
          : this.serviceUsage.bookingPayrollTrusted(b);

      units.push({
        id: b.id,
        kind: 'PT',
        performerId,
        title: b.isComplimentary
          ? 'Подарочная ПТ'
          : 'Персональная тренировка',
        occurredAt: b.startAt.toISOString(),
        quantity: 1,
        priceMinor: b.isComplimentary ? 0 : (b.priceMinor ?? undefined),
        isComplimentary: b.isComplimentary,
        trustBand: b.trustBand as WorkUnit['trustBand'],
        trustResolution: b.trustResolution as WorkUnit['trustResolution'],
        payrollTrusted: trusted,
        clientName: `${b.client.lastName} ${b.client.firstName}`.trim(),
      });
    }

    await this.groupSessions.promoteAutoReady(clubId, fromD, toD);

    const groups = await this.prisma.groupClassSession.findMany({
      where: {
        clubId,
        trainerId: performerId,
        startAt: { gte: fromD, lte: toD },
        status: {
          in: [
            GroupClassSessionStatus.AUTO_READY,
            GroupClassSessionStatus.APPROVED,
            GroupClassSessionStatus.LOCKED,
          ],
        },
      },
      orderBy: { startAt: 'asc' },
    });
    for (const s of groups) {
      const qty = s.approvedAttendedCount ?? 0;
      const trusted =
        qty > 0 &&
        (s.status === GroupClassSessionStatus.APPROVED ||
          s.status === GroupClassSessionStatus.AUTO_READY ||
          s.status === GroupClassSessionStatus.LOCKED) &&
        (s.trustBand === TrustBand.GREEN ||
          isPayrollTrusted({
            trustBand: s.trustBand as 'GREEN' | 'AMBER' | 'RED',
            trustResolution: TrustResolution.RESOLVED,
          }));
      units.push({
        id: s.id,
        kind: 'GROUP',
        performerId,
        title: s.title,
        occurredAt: s.startAt.toISOString(),
        quantity: qty,
        trustBand: s.trustBand as WorkUnit['trustBand'],
        trustResolution:
          s.trustBand === TrustBand.GREEN ? 'NONE' : 'RESOLVED',
        payrollTrusted: Boolean(trusted),
        sessionId: s.id,
      });
    }

    return units.sort(
      (a, b) =>
        new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    );
  }

  async getPeriodSummary(
    clubId: string,
    performerId: string,
    from: string,
    to: string,
  ): Promise<PayrollPeriodSummary> {
    this.assertPeriod(from, to);
    const performer = await this.prisma.user.findFirst({
      where: { id: performerId, clubId },
    });
    if (!performer) throw new NotFoundException('Сотрудник не найден');

    const workUnits = await this.listWorkUnits(clubId, performerId, from, to);

    const openGroupForUser = await this.prisma.groupClassSession.count({
      where: {
        clubId,
        trainerId: performerId,
        status: GroupClassSessionStatus.NEEDS_ADMIN,
        startAt: {
          gte: new Date(`${from}T00:00:00`),
          lte: new Date(`${to}T23:59:59`),
        },
      },
    });
    const openBookingExceptions = await this.countOpenExceptions(
      clubId,
      performerId,
      from,
      to,
    );
    const openTotal = openGroupForUser + openBookingExceptions;

    const trusted = workUnits.filter((u) => u.payrollTrusted);
    const greenCount = trusted.filter((u) => u.trustBand === 'GREEN').length;
    const resolvedCount = trusted.filter(
      (u) => u.trustResolution === 'RESOLVED',
    ).length;

    const compensation = await this.getActiveCompensation(clubId, performerId, from);
    const profile = asPayProfile(compensation?.payProfile);
    const rates = await this.listRates(clubId);
    const motivationMinor = this.calcMotivation(trusted, rates, profile, from);
    const adjustments = await this.listAdjustments(clubId, performerId, from, to);
    const adjustmentsMinor = adjustments.reduce((s, a) => s + a.amountMinor, 0);

    const fromD = new Date(`${from}T00:00:00`);
    const toD = new Date(`${to}T00:00:00`);
    const daysInclusive =
      Math.floor((toD.getTime() - fromD.getTime()) / 86400000) + 1;
    const monthDays = new Date(
      fromD.getFullYear(),
      fromD.getMonth() + 1,
      0,
    ).getDate();
    // Prefer hourly*approx if ADMIN profile has hourly and no base salary
    let baseSalaryMinor = compensation
      ? Math.round((compensation.baseSalaryMinor * daysInclusive) / monthDays)
      : 0;
    if (
      profile?.track === 'ADMIN' &&
      profile.hourlyRateMinor &&
      !compensation?.baseSalaryMinor
    ) {
      const hours = await this.staffRoster.hourlySummary(
        clubId,
        performerId,
        from,
        to,
      );
      baseSalaryMinor = hours.payMinor;
    }
    if (profile?.track === 'PT') {
      const shiftPay = await this.ptTimesheet.sumShiftPayMinor(
        clubId,
        performerId,
        from,
        to,
      );
      baseSalaryMinor += shiftPay;
    }

    const locked = await this.prisma.payrollPeriodLock.findUnique({
      where: {
        clubId_userId_periodFrom_periodTo: {
          clubId,
          userId: performerId,
          periodFrom: fromD,
          periodTo: toD,
        },
      },
    });

    const anomalyHints: string[] = [];
    const staffAddedGroups = trusted.filter(
      (u) => u.kind === 'GROUP' && u.trustResolution === 'RESOLVED',
    ).length;
    if (staffAddedGroups > 0) {
      anomalyHints.push(
        `Групповых сессий с принятыми исключениями: ${staffAddedGroups}`,
      );
    }
    const amberResolved = resolvedCount;
    if (amberResolved > 3) {
      anomalyHints.push(`Много RESOLVED исключений: ${amberResolved}`);
    }

    return {
      from,
      to,
      performerId,
      performerName: `${performer.lastName} ${performer.firstName}`.trim(),
      openExceptions: openTotal,
      greenCount,
      resolvedCount,
      workUnits,
      baseSalaryMinor,
      motivationMinor,
      adjustmentsMinor,
      totalMinor: baseSalaryMinor + motivationMinor + adjustmentsMinor,
      currency: compensation?.currency ?? 'BYN',
      canLock: openTotal === 0 && !locked,
      locked: Boolean(locked),
      anomalyHints,
    };
  }

  async lockPeriod(
    actor: JwtPayload,
    performerId: string,
    from: string,
    to: string,
  ) {
    const clubId = requireClubId(actor);
    const summary = await this.getPeriodSummary(clubId, performerId, from, to);
    if (!summary.canLock) {
      throw new BadRequestException(
        summary.locked
          ? 'Период уже зафиксирован'
          : `Сначала закройте очередь админа: открытых исключений ${summary.openExceptions}`,
      );
    }
    const fromD = new Date(`${from}T00:00:00`);
    const toD = new Date(`${to}T00:00:00`);
    await this.prisma.payrollPeriodLock.create({
      data: {
        clubId,
        userId: performerId,
        periodFrom: fromD,
        periodTo: toD,
        lockedById: actor.sub,
      },
    });
    await this.prisma.groupClassSession.updateMany({
      where: {
        clubId,
        trainerId: performerId,
        startAt: { gte: fromD, lte: new Date(`${to}T23:59:59`) },
        status: {
          in: [
            GroupClassSessionStatus.APPROVED,
            GroupClassSessionStatus.AUTO_READY,
          ],
        },
      },
      data: { status: GroupClassSessionStatus.LOCKED },
    });
    return this.getPeriodSummary(clubId, performerId, from, to);
  }

  async upsertCompensation(
    actor: JwtPayload,
    input: {
      userId: string;
      baseSalaryMinor: number;
      currency?: string;
      effectiveFrom: string;
      payProfile?: StaffPayProfile;
    },
  ): Promise<StaffCompensationDto> {
    const clubId = requireClubId(actor);
    const row = await this.prisma.staffCompensation.create({
      data: {
        clubId,
        userId: input.userId,
        baseSalaryMinor: input.baseSalaryMinor,
        currency: input.currency ?? 'BYN',
        effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00`),
        ...(input.payProfile
          ? { payProfile: input.payProfile as object }
          : {}),
      },
      include: { user: true },
    });
    const profile = asPayProfile(row.payProfile);
    return {
      id: row.id,
      userId: row.userId,
      userName: `${row.user.lastName} ${row.user.firstName}`.trim(),
      baseSalaryMinor: row.baseSalaryMinor,
      currency: row.currency,
      effectiveFrom: input.effectiveFrom,
      payProfile: profile,
      payChips: payProfileSummary(profile),
    };
  }

  async getStaffPayProfile(
    clubId: string,
    userId: string,
  ): Promise<StaffCompensationDto | null> {
    const row = await this.prisma.staffCompensation.findFirst({
      where: { clubId, userId },
      include: { user: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!row) return null;
    const profile = asPayProfile(row.payProfile);
    return {
      id: row.id,
      userId: row.userId,
      userName: `${row.user.lastName} ${row.user.firstName}`.trim(),
      baseSalaryMinor: row.baseSalaryMinor,
      currency: row.currency,
      effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
      payProfile: profile,
      payChips: payProfileSummary(profile),
    };
  }

  async saveStaffPayProfile(
    actor: JwtPayload,
    input: {
      userId: string;
      baseSalaryMinor?: number;
      payProfile: StaffPayProfile;
      effectiveFrom?: string;
    },
  ): Promise<StaffCompensationDto> {
    const clubId = requireClubId(actor);
    const effectiveFrom =
      input.effectiveFrom ?? new Date().toISOString().slice(0, 10);
    const existing = await this.getActiveCompensation(
      clubId,
      input.userId,
      effectiveFrom,
    );
    const baseSalaryMinor =
      input.baseSalaryMinor ?? existing?.baseSalaryMinor ?? 0;
    return this.upsertCompensation(actor, {
      userId: input.userId,
      baseSalaryMinor,
      effectiveFrom,
      payProfile: input.payProfile,
    });
  }

  async listStaffPaySummaries(clubId: string): Promise<StaffPaySummary[]> {
    const users = await this.prisma.user.findMany({
      where: {
        clubId,
        isActive: true,
        roles: {
          some: {
            role: { in: [Role.SPECIALIST, Role.TRAINER, Role.ADMIN] },
          },
        },
      },
      include: { roles: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const comps = await this.prisma.staffCompensation.findMany({
      where: { clubId, userId: { in: users.map((u) => u.id) } },
      orderBy: { effectiveFrom: 'desc' },
    });
    const latest = new Map<string, (typeof comps)[0]>();
    for (const c of comps) {
      if (!latest.has(c.userId)) latest.set(c.userId, c);
    }
    return users.map((u) => {
      const c = latest.get(u.id);
      const profile = asPayProfile(c?.payProfile);
      const roles = u.roles.map((r) => r.role);
      const track =
        profile?.track ??
        (roles.includes(Role.SPECIALIST)
          ? ('SPA' as StaffPayTrack)
          : roles.includes(Role.TRAINER)
            ? ('PT' as StaffPayTrack)
            : roles.includes(Role.ADMIN)
              ? ('ADMIN' as StaffPayTrack)
              : undefined);
      return {
        userId: u.id,
        name: `${u.lastName} ${u.firstName}`.trim(),
        roles,
        track,
        payChips: payProfileSummary(
          profile ?? (track ? { track } : undefined),
        ),
        baseSalaryMinor: c?.baseSalaryMinor ?? 0,
        currency: c?.currency ?? 'BYN',
      };
    });
  }

  async listCompensations(clubId: string): Promise<StaffCompensationDto[]> {
    const rows = await this.prisma.staffCompensation.findMany({
      where: { clubId },
      include: { user: true },
      orderBy: { effectiveFrom: 'desc' },
      take: 200,
    });
    return rows.map((r) => {
      const profile = asPayProfile(r.payProfile);
      return {
        id: r.id,
        userId: r.userId,
        userName: `${r.user.lastName} ${r.user.firstName}`.trim(),
        baseSalaryMinor: r.baseSalaryMinor,
        currency: r.currency,
        effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
        payProfile: profile,
        payChips: payProfileSummary(profile),
      };
    });
  }

  async upsertRate(
    actor: JwtPayload,
    input: {
      kind: MotivationRateKind;
      serviceId?: string;
      rateType: MotivationRateType;
      rateValue: number;
      currency?: string;
      effectiveFrom: string;
    },
  ): Promise<MotivationRateDto> {
    const clubId = requireClubId(actor);
    const row = await this.prisma.motivationRate.create({
      data: {
        clubId,
        kind: input.kind,
        serviceId: input.serviceId,
        rateType: input.rateType,
        rateValue: input.rateValue,
        currency: input.currency ?? 'BYN',
        effectiveFrom: new Date(`${input.effectiveFrom}T00:00:00`),
      },
    });
    return {
      id: row.id,
      kind: row.kind,
      serviceId: row.serviceId ?? undefined,
      rateType: row.rateType,
      rateValue: row.rateValue,
      currency: row.currency,
      effectiveFrom: input.effectiveFrom,
    };
  }

  async listRates(clubId: string): Promise<MotivationRateDto[]> {
    const rows = await this.prisma.motivationRate.findMany({
      where: { clubId },
      orderBy: { effectiveFrom: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      serviceId: r.serviceId ?? undefined,
      rateType: r.rateType,
      rateValue: r.rateValue,
      currency: r.currency,
      effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10),
    }));
  }

  async addAdjustment(
    actor: JwtPayload,
    input: {
      userId: string;
      amountMinor: number;
      reason: string;
      periodFrom: string;
      periodTo: string;
    },
  ): Promise<PayrollAdjustmentDto> {
    const clubId = requireClubId(actor);
    if (!input.reason?.trim()) {
      throw new BadRequestException('Укажите причину корректировки');
    }
    const row = await this.prisma.payrollAdjustment.create({
      data: {
        clubId,
        userId: input.userId,
        amountMinor: input.amountMinor,
        reason: input.reason.trim(),
        periodFrom: new Date(`${input.periodFrom}T00:00:00`),
        periodTo: new Date(`${input.periodTo}T00:00:00`),
        createdById: actor.sub,
      },
    });
    return {
      id: row.id,
      userId: row.userId,
      amountMinor: row.amountMinor,
      reason: row.reason,
      periodFrom: input.periodFrom,
      periodTo: input.periodTo,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listStaffForPayroll(clubId: string) {
    return this.listStaffPaySummaries(clubId);
  }

  async listSelfForPayroll(
    clubId: string,
    userId: string,
  ): Promise<StaffPaySummary[]> {
    const all = await this.listStaffPaySummaries(clubId);
    const self = all.find((s) => s.userId === userId);
    if (self) return [self];
    const user = await this.prisma.user.findFirst({
      where: { id: userId, clubId },
      include: { roles: true },
    });
    if (!user) return [];
    return [
      {
        userId: user.id,
        name: `${user.lastName} ${user.firstName}`.trim(),
        roles: user.roles.map((r) => r.role),
        track: 'ADMIN',
        payChips: payProfileSummary({ track: 'ADMIN' }),
        baseSalaryMinor: 0,
        currency: 'BYN',
      },
    ];
  }

  private async countOpenExceptions(
    clubId: string,
    performerId: string,
    from?: string,
    to?: string,
  ) {
    const range =
      from && to
        ? {
            startAt: {
              gte: new Date(`${from}T00:00:00`),
              lte: new Date(`${to}T23:59:59`),
            },
          }
        : {};
    const [spa, pt] = await Promise.all([
      this.prisma.spaBooking.count({
        where: {
          clubId,
          specialistId: performerId,
          performanceStatus: 'CONFIRMED_BY_PERFORMER',
          trustResolution: TrustResolution.NONE,
          trustBand: { in: [TrustBand.AMBER, TrustBand.RED] },
          status: { not: SpaBookingStatus.CANCELLED },
          ...range,
        },
      }),
      this.prisma.personalTrainingBooking.count({
        where: {
          trainerId: performerId,
          performanceStatus: 'CONFIRMED_BY_PERFORMER',
          trustResolution: TrustResolution.NONE,
          trustBand: { in: [TrustBand.AMBER, TrustBand.RED] },
          status: { not: PersonalBookingStatus.CANCELLED },
          ...range,
        },
      }),
    ]);
    return spa + pt;
  }

  private async getActiveCompensation(
    clubId: string,
    userId: string,
    asOf: string,
  ) {
    return this.prisma.staffCompensation.findFirst({
      where: {
        clubId,
        userId,
        effectiveFrom: { lte: new Date(`${asOf}T00:00:00`) },
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  private async listAdjustments(
    clubId: string,
    userId: string,
    from: string,
    to: string,
  ) {
    return this.prisma.payrollAdjustment.findMany({
      where: {
        clubId,
        userId,
        periodFrom: { lte: new Date(`${to}T00:00:00`) },
        periodTo: { gte: new Date(`${from}T00:00:00`) },
      },
    });
  }

  private calcMotivation(
    units: WorkUnit[],
    rates: MotivationRateDto[],
    profile?: StaffPayProfile,
    periodFrom?: string,
  ): number {
    if (profile) {
      return this.calcMotivationFromProfile(units, profile, periodFrom);
    }
    let total = 0;
    for (const u of units) {
      if (!u.payrollTrusted) continue;
      const rate = this.pickRate(u, rates);
      if (!rate) continue;
      if (rate.rateType === 'FIXED_PER_ATTENDEE') {
        total += rate.rateValue * u.quantity;
      } else if (rate.rateType === 'FIXED_PER_SESSION') {
        total += rate.rateValue;
      } else if (rate.rateType === 'PERCENT_OF_PRICE' && u.priceMinor != null) {
        total += Math.round((u.priceMinor * rate.rateValue) / 100);
      }
    }
    return total;
  }

  private calcMotivationFromProfile(
    units: WorkUnit[],
    profile: StaffPayProfile,
    periodFrom?: string,
  ): number {
    let total = 0;
    const trusted = units.filter((u) => u.payrollTrusted);

    if (profile.track === 'GROUP_TRAINER') {
      for (const u of trusted.filter((x) => x.kind === 'GROUP')) {
        const min = profile.groupMinAttendees ?? 1;
        if (u.quantity < min) continue;
        total += profile.groupSessionRateMinor ?? 0;
        if (profile.groupPerAttendeeMinor) {
          total += profile.groupPerAttendeeMinor * u.quantity;
        }
      }
      return total;
    }

    if (profile.track === 'SPA') {
      for (const u of trusted.filter((x) => x.kind === 'SPA')) {
        const price = u.priceMinor ?? 0;
        if (price > 0 && profile.spaSoldPercent) {
          total += Math.round((price * profile.spaSoldPercent) / 100);
        } else if (price === 0 && profile.spaQuotaRates?.length) {
          // Quota service: match by title keywords
          const title = u.title.toLowerCase();
          const match = profile.spaQuotaRates.find((r) => {
            if (r.serviceKey === 'BODY_COMPOSITION')
              return /состав|анализ|inbody|компози/i.test(title);
            if (r.serviceKey === 'CLASSIC_MASSAGE')
              return /массаж|massage|класси/i.test(title);
            return r.serviceKey === u.serviceId;
          });
          if (match) total += match.rateMinor;
        }
      }
      return total;
    }

    if (profile.track === 'PT') {
      const ptUnits = trusted.filter((x) => x.kind === 'PT');
      // Gifts count toward volume, but are not paid.
      const monthCount = ptUnits.length;
      const pct = resolvePtPercent(monthCount, profile.ptPercentTiers);
      const catalog = profile.ptSessionPriceMinor ?? 0;
      for (const u of ptUnits) {
        if (u.isComplimentary) continue;
        const price = u.priceMinor != null && u.priceMinor > 0
          ? u.priceMinor
          : catalog;
        if (price > 0) {
          total += Math.round((price * pct) / 100);
        }
      }
      void periodFrom;
      return total;
    }

    // ADMIN: membership/extra sales not in work units yet — only adjustments/hourly base
    return 0;
  }

  private pickRate(u: WorkUnit, rates: MotivationRateDto[]) {
    if (u.kind === 'SPA') {
      return (
        rates.find(
          (r) =>
            r.kind === 'SPA_SERVICE' &&
            r.serviceId &&
            r.serviceId === u.serviceId,
        ) ?? rates.find((r) => r.kind === 'SPA_KIND')
      );
    }
    if (u.kind === 'PT') return rates.find((r) => r.kind === 'PT');
    return rates.find((r) => r.kind === 'GROUP');
  }

  private assertPeriod(from: string, to: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw new BadRequestException('from/to YYYY-MM-DD');
    }
    const fromMs = Date.parse(`${from}T00:00:00`);
    const toMs = Date.parse(`${to}T00:00:00`);
    if (toMs < fromMs) throw new BadRequestException('Некорректный период');
    const days =
      Math.floor((toMs - fromMs) / 86400000) + 1;
    if (days > 31) {
      throw new BadRequestException('Период не больше 31 дня');
    }
  }
}
