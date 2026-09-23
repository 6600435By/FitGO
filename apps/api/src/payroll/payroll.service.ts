import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  allPaySlices,
  advanceHalfRange,
  DEFAULT_GROUP_RATE_TIERS,
  isPayrollTrusted,
  monthSettlementRange,
  payProfileSummary,
  resolveGroupRoomKey,
  resolveGroupSessionRateMinor,
  resolvePtPercent,
  sliceForTrack,
  type ClubPayrollReport,
  type ClubPayrollRow,
  type ClubPayrollSectionId,
  type MotivationRateDto,
  type PayrollAdjustmentDto,
  type PayrollCorporateSaleDto,
  type PayrollPeriodSummary,
  type PayrollPayoutDto,
  type PayrollPayoutKind,
  type PayrollPayoutPreview,
  type StaffCompensationDto,
  type StaffDepartment,
  type StaffEmploymentKind,
  type StaffPayProfile,
  type StaffPaySummary,
  type StaffPayTrack,
  type StaffSalesBreakdown,
  type WorkUnit,
} from '@fitgo/shared-types';
import {
  GroupClassSessionStatus,
  MotivationRateKind,
  MotivationRateType,
  PayrollPayoutKind as PrismaPayoutKind,
  PayrollPayoutStatus,
  PersonalBookingStatus,
  Role,
  SpaBookingStatus,
  StaffEmploymentKind as PrismaEmploymentKind,
  TrustBand,
  TrustResolution,
} from '@prisma/client';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { GroupSessionService } from '../group-session/group-session.service';
import { PrismaService } from '../prisma/prisma.service';
import { PtTimesheetService } from '../pt-timesheet/pt-timesheet.service';
import { ServiceUsageService } from '../service-usage/service-usage.service';
import { StaffRosterService } from '../staff-roster/staff-roster.service';
import {
  createAnalyticsProvider,
  fetchStaffSalesFromAnalytics,
} from './payroll-sales.helper';

function asPayProfile(raw: unknown): StaffPayProfile | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as StaffPayProfile;
  if (!p.track) return undefined;
  return p;
}

const SECTION_LABELS: Record<ClubPayrollSectionId, string> = {
  ADMIN: 'Администраторы / управляющая',
  TRAINER: 'Тренеры (ПТ / ГП)',
  SPECIALIST: 'SPA',
  TECH: 'Техперсонал',
  EXTERNAL: 'Сторонние специалисты',
};

/** Overlay selected track slices from source onto target (multi-role safe). */
function mergePayTracks(
  target: StaffPayProfile | undefined,
  source: StaffPayProfile,
  tracks: StaffPayTrack[],
): StaffPayProfile {
  const primary = target?.track ?? tracks[0] ?? source.track;
  const byTrack: NonNullable<StaffPayProfile['byTrack']> = {
    ...(target?.byTrack ?? {}),
  };
  if (target) {
    const { byTrack: _b, ...flat } = target;
    byTrack[target.track] = flat;
  }
  for (const track of tracks) {
    const slice = sliceForTrack(source, track);
    byTrack[track] = { ...slice, track };
  }
  const primarySlice = byTrack[primary] ?? sliceForTrack(source, primary);
  return {
    ...primarySlice,
    track: primary,
    byTrack,
  };
}

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly serviceUsage: ServiceUsageService,
    private readonly groupSessions: GroupSessionService,
    private readonly ptTimesheet: PtTimesheetService,
    private readonly staffRoster: StaffRosterService,
    private readonly config: ConfigService,
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
        partnerSource: b.partnerSource ?? undefined,
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
      const roomTitle = s.roomTitle ?? undefined;
      const roomKey = resolveGroupRoomKey(roomTitle);
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
        roomTitle,
        roomKey,
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

    const compensation = await this.resolveCompensation(
      clubId,
      performerId,
      from,
      to,
    );
    const profile = asPayProfile(compensation?.payProfile);
    const rates = await this.listRates(clubId);
    const sales = await this.resolveStaffSales(
      clubId,
      performerId,
      from,
      to,
      profile,
    );
    const motivationMinor = this.calcMotivation(
      trusted,
      rates,
      profile,
      from,
      sales,
    );
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
    let baseSalaryMinor = compensation
      ? Math.round((compensation.baseSalaryMinor * daysInclusive) / monthDays)
      : 0;
    const slices = allPaySlices(profile);
    const hasPt = slices.some((s) => s.track === 'PT');
    const hasHourlyDesk = slices.some(
      (s) =>
        s.track !== 'PT' &&
        typeof s.hourlyRateMinor === 'number' &&
        s.hourlyRateMinor > 0,
    );
    if (hasHourlyDesk) {
      const hours = await this.staffRoster.hourlySummary(
        clubId,
        performerId,
        from,
        to,
      );
      const deskRate =
        sliceForTrack(profile, 'ADMIN').hourlyRateMinor ||
        sliceForTrack(profile, 'TECH').hourlyRateMinor ||
        sliceForTrack(profile, 'GROUP_TRAINER').hourlyRateMinor ||
        hours.hourlyRateMinor ||
        0;
      baseSalaryMinor += Math.round((hours.totalMinutes / 60) * deskRate);
      for (const s of hours.shifts) {
        const mins = s.minutes + (s.overtimeMinutes ?? 0);
        const pay = Math.round((mins / 60) * deskRate);
        workUnits.push({
          id: s.id,
          kind: 'SHIFT',
          performerId,
          title: `Смена ${s.track}${s.overtimeMinutes ? ` (+${s.overtimeMinutes} мин)` : ''}`,
          occurredAt: s.startAt,
          quantity: Number((mins / 60).toFixed(2)),
          priceMinor: pay,
          trustBand: 'GREEN',
          trustResolution: 'NONE',
          payrollTrusted: true,
        });
      }
      workUnits.sort(
        (a, b) =>
          new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
      );
    }
    if (hasPt) {
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
    if (!compensation) {
      anomalyHints.push(
        'Нет сохранённой схемы мотивации — задайте ставки в Staff',
      );
    } else if (!hasHourlyDesk && !hasPt && motivationMinor === 0) {
      anomalyHints.push(
        'Ставка за час / мотивация не заданы или нет проверенных работ за период',
      );
    }
    if (sales.hint) anomalyHints.push(sales.hint);
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
      adjustments: adjustments.map((a) => ({
        id: a.id,
        userId: a.userId,
        amountMinor: a.amountMinor,
        reason: a.reason,
        periodFrom: a.periodFrom.toISOString().slice(0, 10),
        periodTo: a.periodTo.toISOString().slice(0, 10),
        createdAt: a.createdAt.toISOString(),
      })),
      payChips: payProfileSummary(profile),
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

  /**
   * Preview a club pay wave.
   * - ADVANCE_HALF (25th): default days 1–15 (override via periodFrom/To).
   * - MONTH_SETTLEMENT (15th): previous calendar month minus paid ADVANCE_HALF.
   */
  async previewPayout(
    clubId: string,
    userId: string,
    kind: PayrollPayoutKind,
    year: number,
    month: number,
    opts?: { periodFrom?: string; periodTo?: string },
  ): Promise<PayrollPayoutPreview> {
    if (month < 1 || month > 12) {
      throw new BadRequestException('Месяц 1–12');
    }
    const user = await this.prisma.user.findFirst({
      where: { id: userId, clubId },
      include: { roles: true },
    });
    if (!user) throw new NotFoundException('Сотрудник не найден');

    const roles = user.roles.map((r) => r.role);
    const usesFixedAdvance =
      kind === 'ADVANCE_HALF' &&
      (roles.includes(Role.ADMIN) || roles.includes(Role.TRAINER));

    const defaultRange =
      kind === 'ADVANCE_HALF'
        ? advanceHalfRange(year, month)
        : monthSettlementRange(year, month);

    const range = {
      from: opts?.periodFrom?.trim() || defaultRange.from,
      to: opts?.periodTo?.trim() || defaultRange.to,
    };
    this.assertPeriod(range.from, range.to);

    const compensation = await this.resolveCompensation(
      clubId,
      userId,
      range.from,
      range.to,
    );
    const profile = asPayProfile(compensation?.payProfile);
    const fixedAdvanceMinor = usesFixedAdvance
      ? this.resolveFixedAdvance(profile, roles)
      : 0;

    const hints: string[] = [];
    let earnedMinor = 0;
    const summary = await this.getPeriodSummary(
      clubId,
      userId,
      range.from,
      range.to,
    );

    const periodOverridden =
      range.from !== defaultRange.from || range.to !== defaultRange.to;

    if (kind === 'ADVANCE_HALF' && usesFixedAdvance && !periodOverridden) {
      earnedMinor = fixedAdvanceMinor;
      if (fixedAdvanceMinor <= 0) {
        hints.push(
          'Фикс аванса 25-е не задан в мотивации сотрудника — сумма 0',
        );
      } else {
        hints.push(
          'Админ / штатный тренер: 25-е — фиксированная сумма из оклада',
        );
      }
    } else {
      earnedMinor = summary.totalMinor;
      if (kind === 'ADVANCE_HALF') {
        if (usesFixedAdvance && periodOverridden) {
          hints.push(
            `Период изменён (${range.from}–${range.to}): начисление по мотивации вместо фикса`,
          );
        } else {
          hints.push(
            `Аванс 25-е: начисление по мотивации за ${range.from}–${range.to}`,
          );
        }
      }
    }

    let priorPaidMinor = 0;
    if (kind === 'MONTH_SETTLEMENT') {
      const y = Number(range.from.slice(0, 4));
      const m = Number(range.from.slice(5, 7));
      const mm = String(m).padStart(2, '0');
      const monthStart = `${y}-${mm}-01`;
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const monthEnd = `${y}-${mm}-${String(last).padStart(2, '0')}`;
      const priors = await this.prisma.payrollPayout.findMany({
        where: {
          clubId,
          userId,
          kind: PrismaPayoutKind.ADVANCE_HALF,
          status: PayrollPayoutStatus.PAID,
          periodFrom: { gte: new Date(`${monthStart}T00:00:00`) },
          periodTo: { lte: new Date(`${monthEnd}T23:59:59`) },
        },
      });
      priorPaidMinor = priors.reduce((a, p) => a + p.totalMinor, 0);
      if (priorPaidMinor > 0) {
        hints.push(
          `Вычтен аванс 25-е за ${monthStart}–${monthEnd}: ${(priorPaidMinor / 100).toFixed(2)}`,
        );
      } else {
        hints.push('Аванс 25-е за этот месяц ещё не зафиксирован');
      }
    }

    const totalMinor = Math.max(0, earnedMinor - priorPaidMinor);

    const balance = await this.prisma.payrollStaffBalance.findUnique({
      where: { clubId_userId: { clubId, userId } },
    });
    const carryInMinor = balance?.balanceMinor ?? 0;
    const carryHint = balance?.hint ?? undefined;
    if (carryInMinor !== 0) {
      const sign = carryInMinor > 0 ? '+' : '';
      hints.push(
        carryHint
          ? `Перенос остатка ${sign}${(carryInMinor / 100).toFixed(2)}: ${carryHint}`
          : `Перенос остатка с прошлой выплаты: ${sign}${(carryInMinor / 100).toFixed(2)}`,
      );
    }
    const payableMinor = totalMinor + carryInMinor;

    const existing = await this.prisma.payrollPayout.findFirst({
      where: {
        clubId,
        userId,
        kind:
          kind === 'ADVANCE_HALF'
            ? PrismaPayoutKind.ADVANCE_HALF
            : PrismaPayoutKind.MONTH_SETTLEMENT,
        periodFrom: new Date(`${range.from}T00:00:00`),
        periodTo: new Date(`${range.to}T00:00:00`),
        status: { in: [PayrollPayoutStatus.PAID, PayrollPayoutStatus.DRAFT] },
      },
      include: { user: true },
    });

    if (existing?.status === PayrollPayoutStatus.PAID) {
      hints.push('Выплата уже зафиксирована — повторно не начисляется');
    }

    return {
      kind,
      periodFrom: range.from,
      periodTo: range.to,
      performerId: userId,
      performerName: `${user.lastName} ${user.firstName}`.trim(),
      usesFixedAdvance,
      fixedAdvanceMinor,
      earnedMinor,
      priorPaidMinor,
      totalMinor,
      carryInMinor,
      carryHint,
      payableMinor,
      currency: summary.currency,
      existingPayout: existing ? this.mapPayout(existing) : undefined,
      summary,
      hints,
    };
  }

  async previewPayoutBatch(
    clubId: string,
    kind: PayrollPayoutKind,
    year: number,
    month: number,
    opts?: {
      periodFrom?: string;
      periodTo?: string;
      department?: ClubPayrollSectionId | 'ALL' | 'MANAGER';
      userIds?: string[];
    },
  ): Promise<PayrollPayoutPreview[]> {
    const staff = await this.listStaffPaySummaries(clubId);
    const dept = opts?.department ?? 'ALL';
    const idSet = opts?.userIds?.length ? new Set(opts.userIds) : null;
    const filtered = staff.filter((s) => {
      if (idSet && !idSet.has(s.userId)) return false;
      if (!idSet) {
        const section = this.sectionForStaff(
          s.employmentKind ?? 'STAFF',
          s.roles,
          s.track,
        );
        if (dept === 'ALL') return true;
        if (dept === 'MANAGER') {
          return s.roles.includes('ADMIN') && s.baseSalaryMinor > 0;
        }
        if (dept === 'ADMIN') {
          return (
            section === 'ADMIN' &&
            !(s.roles.includes('ADMIN') && s.baseSalaryMinor > 0)
          );
        }
        return section === dept;
      }
      return true;
    });
    const out: PayrollPayoutPreview[] = [];
    for (const s of filtered) {
      out.push(
        await this.previewPayout(clubId, s.userId, kind, year, month, {
          periodFrom: opts?.periodFrom,
          periodTo: opts?.periodTo,
        }),
      );
    }
    return out;
  }

  async confirmPayout(
    actor: JwtPayload,
    input: {
      userId: string;
      kind: PayrollPayoutKind;
      year: number;
      month: number;
      periodFrom?: string;
      periodTo?: string;
      cardTransferMinor?: number;
      actualCashMinor?: number;
      note?: string;
    },
  ): Promise<PayrollPayoutDto> {
    const clubId = requireClubId(actor);
    const preview = await this.previewPayout(
      clubId,
      input.userId,
      input.kind,
      input.year,
      input.month,
      { periodFrom: input.periodFrom, periodTo: input.periodTo },
    );
    if (preview.existingPayout?.status === 'PAID') {
      throw new BadRequestException('Эта выплата уже зафиксирована');
    }
    const card = Math.max(0, Math.round(input.cardTransferMinor ?? 0));
    const suggestedCash = preview.payableMinor - card;
    const actualCash =
      input.actualCashMinor !== undefined && input.actualCashMinor !== null
        ? Math.round(input.actualCashMinor)
        : suggestedCash;
    if (actualCash < 0) {
      throw new BadRequestException('Сумма из кассы не может быть отрицательной');
    }
    const payable = preview.payableMinor;
    const paid = card + actualCash;
    const carryOutMinor = payable - paid;
    const kind =
      input.kind === 'ADVANCE_HALF'
        ? PrismaPayoutKind.ADVANCE_HALF
        : PrismaPayoutKind.MONTH_SETTLEMENT;

    const waveLabel =
      input.kind === 'ADVANCE_HALF' ? 'аванса 25-е' : 'расчёта 15-е';
    const carryHint =
      carryOutMinor === 0
        ? null
        : carryOutMinor > 0
          ? `недоплата ${(carryOutMinor / 100).toFixed(2)} с ${waveLabel} ${preview.periodFrom}–${preview.periodTo}`
          : `переплата ${(Math.abs(carryOutMinor) / 100).toFixed(2)} с ${waveLabel} ${preview.periodFrom}–${preview.periodTo}`;

    const data = {
      earnedMinor: preview.earnedMinor,
      priorPaidMinor: preview.priorPaidMinor,
      totalMinor: preview.totalMinor,
      cardTransferMinor: card,
      cashMinor: suggestedCash,
      actualCashMinor: actualCash,
      carryInMinor: preview.carryInMinor,
      carryOutMinor,
      currency: preview.currency,
      status: PayrollPayoutStatus.PAID,
      paidAt: new Date(),
      note: input.note?.trim() || null,
      createdById: actor.sub,
    };

    const row = await this.prisma.$transaction(async (tx) => {
      const payout = await tx.payrollPayout.upsert({
        where: {
          clubId_userId_kind_periodFrom_periodTo: {
            clubId,
            userId: input.userId,
            kind,
            periodFrom: new Date(`${preview.periodFrom}T00:00:00`),
            periodTo: new Date(`${preview.periodTo}T00:00:00`),
          },
        },
        create: {
          clubId,
          userId: input.userId,
          kind,
          periodFrom: new Date(`${preview.periodFrom}T00:00:00`),
          periodTo: new Date(`${preview.periodTo}T00:00:00`),
          ...data,
        },
        update: data,
        include: { user: true },
      });

      await tx.payrollStaffBalance.upsert({
        where: { clubId_userId: { clubId, userId: input.userId } },
        create: {
          clubId,
          userId: input.userId,
          balanceMinor: carryOutMinor,
          hint: carryHint,
        },
        update: {
          balanceMinor: carryOutMinor,
          hint: carryHint,
        },
      });

      await tx.payrollPeriodLock.upsert({
        where: {
          clubId_userId_periodFrom_periodTo: {
            clubId,
            userId: input.userId,
            periodFrom: new Date(`${preview.periodFrom}T00:00:00`),
            periodTo: new Date(`${preview.periodTo}T00:00:00`),
          },
        },
        create: {
          clubId,
          userId: input.userId,
          periodFrom: new Date(`${preview.periodFrom}T00:00:00`),
          periodTo: new Date(`${preview.periodTo}T00:00:00`),
          lockedById: actor.sub,
        },
        update: { lockedAt: new Date(), lockedById: actor.sub },
      });

      return payout;
    });

    return this.mapPayout(row);
  }

  async confirmPayoutBatch(
    actor: JwtPayload,
    input: {
      kind: PayrollPayoutKind;
      year: number;
      month: number;
      periodFrom?: string;
      periodTo?: string;
      items: Array<{
        userId: string;
        cardTransferMinor?: number;
        actualCashMinor?: number;
        note?: string;
      }>;
    },
  ): Promise<PayrollPayoutDto[]> {
    const results: PayrollPayoutDto[] = [];
    for (const item of input.items) {
      results.push(
        await this.confirmPayout(actor, {
          userId: item.userId,
          kind: input.kind,
          year: input.year,
          month: input.month,
          periodFrom: input.periodFrom,
          periodTo: input.periodTo,
          cardTransferMinor: item.cardTransferMinor,
          actualCashMinor: item.actualCashMinor,
          note: item.note,
        }),
      );
    }
    return results;
  }

  async listPayouts(
    clubId: string,
    userId: string,
  ): Promise<PayrollPayoutDto[]> {
    const rows = await this.prisma.payrollPayout.findMany({
      where: { clubId, userId, status: PayrollPayoutStatus.PAID },
      include: { user: true },
      orderBy: [{ periodFrom: 'desc' }, { kind: 'asc' }],
      take: 24,
    });
    return rows.map((r) => this.mapPayout(r));
  }

  private resolveFixedAdvance(
    profile: StaffPayProfile | undefined,
    roles: Role[],
  ): number {
    if (!profile) return 0;
    if (roles.includes(Role.ADMIN)) {
      const n = sliceForTrack(profile, 'ADMIN').fixedAdvanceMinor ?? 0;
      if (n > 0) return n;
    }
    if (roles.includes(Role.TRAINER)) {
      return (
        sliceForTrack(profile, 'PT').fixedAdvanceMinor ??
        sliceForTrack(profile, 'GROUP_TRAINER').fixedAdvanceMinor ??
        0
      );
    }
    return profile.fixedAdvanceMinor ?? 0;
  }

  private mapPayout(row: {
    id: string;
    userId: string;
    kind: PrismaPayoutKind;
    periodFrom: Date;
    periodTo: Date;
    earnedMinor: number;
    priorPaidMinor: number;
    totalMinor: number;
    cardTransferMinor: number;
    cashMinor: number;
    actualCashMinor?: number;
    carryInMinor?: number;
    carryOutMinor?: number;
    currency: string;
    status: PayrollPayoutStatus;
    paidAt: Date | null;
    note: string | null;
    createdAt: Date;
    user: { firstName: string; lastName: string };
  }): PayrollPayoutDto {
    return {
      id: row.id,
      userId: row.userId,
      userName: `${row.user.lastName} ${row.user.firstName}`.trim(),
      kind: row.kind as PayrollPayoutKind,
      periodFrom: row.periodFrom.toISOString().slice(0, 10),
      periodTo: row.periodTo.toISOString().slice(0, 10),
      earnedMinor: row.earnedMinor,
      priorPaidMinor: row.priorPaidMinor,
      totalMinor: row.totalMinor,
      cardTransferMinor: row.cardTransferMinor,
      cashMinor: row.cashMinor,
      actualCashMinor: row.actualCashMinor ?? row.cashMinor,
      carryInMinor: row.carryInMinor ?? 0,
      carryOutMinor: row.carryOutMinor ?? 0,
      currency: row.currency,
      status: row.status as PayrollPayoutDto['status'],
      paidAt: row.paidAt?.toISOString(),
      note: row.note ?? undefined,
      createdAt: row.createdAt.toISOString(),
    };
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
    let payProfile = input.payProfile;
    const slices = allPaySlices(payProfile);
    if (
      slices.some((s) => s.track === 'GROUP_TRAINER') &&
      !sliceForTrack(payProfile, 'GROUP_TRAINER').groupRateTiers?.length
    ) {
      const packed = { ...payProfile };
      const gt = sliceForTrack(packed, 'GROUP_TRAINER');
      const withTiers = {
        ...gt,
        groupRateTiers: DEFAULT_GROUP_RATE_TIERS.map((t) => ({ ...t })),
      };
      if (packed.track === 'GROUP_TRAINER') {
        payProfile = { ...packed, ...withTiers, byTrack: packed.byTrack };
      } else {
        payProfile = {
          ...packed,
          byTrack: {
            ...(packed.byTrack ?? {}),
            GROUP_TRAINER: withTiers,
          },
        };
      }
    }
    return this.upsertCompensation(actor, {
      userId: input.userId,
      baseSalaryMinor,
      effectiveFrom,
      payProfile,
    });
  }

  /**
   * Copy source pay slices (+ base salary) to peers in the given departments.
   * Merges only the matching track(s) so multi-role peers keep other schemes.
   */
  async copyStaffPayProfile(
    actor: JwtPayload,
    sourceUserId: string,
    departments: StaffDepartment[],
    tracks?: StaffPayTrack[],
  ): Promise<{ copied: number; skipped: number }> {
    const clubId = requireClubId(actor);
    const source = await this.getStaffPayProfile(clubId, sourceUserId);
    if (!source?.payProfile) {
      throw new BadRequestException('Сначала сохраните мотивацию у источника');
    }
    if (!departments.length) {
      throw new BadRequestException('Укажите подразделение для копирования');
    }
    const roleMap: Record<StaffDepartment, Role> = {
      ADMIN: Role.ADMIN,
      TRAINER: Role.TRAINER,
      SPECIALIST: Role.SPECIALIST,
      TECH: Role.TECH,
      EXTERNAL: Role.SPECIALIST,
    };
    const roles = departments.map((d) => roleMap[d]);
    const tracksToCopy: StaffPayTrack[] =
      tracks?.length
        ? tracks
        : departments.flatMap((d) =>
            d === 'ADMIN'
              ? (['ADMIN'] as StaffPayTrack[])
              : d === 'SPECIALIST'
                ? (['SPA'] as StaffPayTrack[])
                : d === 'TECH'
                  ? (['TECH'] as StaffPayTrack[])
                  : (['PT', 'GROUP_TRAINER'] as StaffPayTrack[]),
          );

    const peers = await this.prisma.user.findMany({
      where: {
        clubId,
        isActive: true,
        id: { not: sourceUserId },
        roles: { some: { role: { in: roles } } },
      },
      select: { id: true },
    });
    let copied = 0;
    const effectiveFrom = new Date().toISOString().slice(0, 10);
    for (const peer of peers) {
      const existing = await this.getStaffPayProfile(clubId, peer.id);
      const merged = mergePayTracks(
        existing?.payProfile,
        source.payProfile,
        tracksToCopy,
      );
      await this.upsertCompensation(actor, {
        userId: peer.id,
        baseSalaryMinor: source.baseSalaryMinor,
        effectiveFrom,
        payProfile: merged,
      });
      copied += 1;
    }
    return { copied, skipped: 0 };
  }

  async listStaffPaySummaries(clubId: string): Promise<StaffPaySummary[]> {
    const users = await this.prisma.user.findMany({
      where: {
        clubId,
        isActive: true,
        roles: {
          some: {
            role: {
              in: [Role.SPECIALIST, Role.TECH, Role.TRAINER, Role.ADMIN],
            },
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
          : roles.includes(Role.TECH)
            ? ('TECH' as StaffPayTrack)
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
        employmentKind:
          u.employmentKind === PrismaEmploymentKind.EXTERNAL
            ? 'EXTERNAL'
            : 'STAFF',
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
  ): Promise<PayrollAdjustmentDto & { redirectedFrom?: string }> {
    const clubId = requireClubId(actor);
    if (!input.reason?.trim()) {
      throw new BadRequestException('Укажите причину корректировки');
    }
    this.assertPeriod(input.periodFrom, input.periodTo);

    let periodFrom = input.periodFrom;
    let periodTo = input.periodTo;
    let reason = input.reason.trim();
    let redirectedFrom: string | undefined;

    const locked = await this.prisma.payrollPeriodLock.findUnique({
      where: {
        clubId_userId_periodFrom_periodTo: {
          clubId,
          userId: input.userId,
          periodFrom: new Date(`${input.periodFrom}T00:00:00`),
          periodTo: new Date(`${input.periodTo}T00:00:00`),
        },
      },
    });

    if (locked) {
      const now = new Date();
      const openFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const openTo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      periodFrom = openFrom;
      periodTo = openTo;
      redirectedFrom = `${input.periodFrom}–${input.periodTo}`;
      reason = `${reason} [из закрытого ${redirectedFrom}]`;
    }

    const row = await this.prisma.payrollAdjustment.create({
      data: {
        clubId,
        userId: input.userId,
        amountMinor: input.amountMinor,
        reason,
        periodFrom: new Date(`${periodFrom}T00:00:00`),
        periodTo: new Date(`${periodTo}T00:00:00`),
        createdById: actor.sub,
      },
    });
    return {
      id: row.id,
      userId: row.userId,
      amountMinor: row.amountMinor,
      reason: row.reason,
      periodFrom,
      periodTo,
      createdAt: row.createdAt.toISOString(),
      redirectedFrom,
    };
  }

  async updateAdjustment(
    actor: JwtPayload,
    id: string,
    input: { amountMinor?: number; reason?: string },
  ): Promise<PayrollAdjustmentDto> {
    const clubId = requireClubId(actor);
    const existing = await this.prisma.payrollAdjustment.findFirst({
      where: { id, clubId },
    });
    if (!existing) throw new NotFoundException('Корректировка не найдена');
    if (input.reason !== undefined && !input.reason.trim()) {
      throw new BadRequestException('Укажите причину корректировки');
    }
    const row = await this.prisma.payrollAdjustment.update({
      where: { id },
      data: {
        ...(input.amountMinor !== undefined
          ? { amountMinor: input.amountMinor }
          : {}),
        ...(input.reason !== undefined
          ? { reason: input.reason.trim() }
          : {}),
      },
    });
    return {
      id: row.id,
      userId: row.userId,
      amountMinor: row.amountMinor,
      reason: row.reason,
      periodFrom: row.periodFrom.toISOString().slice(0, 10),
      periodTo: row.periodTo.toISOString().slice(0, 10),
      createdAt: row.createdAt.toISOString(),
    };
  }

  async deleteAdjustment(actor: JwtPayload, id: string) {
    const clubId = requireClubId(actor);
    const existing = await this.prisma.payrollAdjustment.findFirst({
      where: { id, clubId },
    });
    if (!existing) throw new NotFoundException('Корректировка не найдена');
    await this.prisma.payrollAdjustment.delete({ where: { id } });
    return { success: true };
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
        employmentKind:
          user.employmentKind === PrismaEmploymentKind.EXTERNAL
            ? 'EXTERNAL'
            : 'STAFF',
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

  private async resolveCompensation(
    clubId: string,
    userId: string,
    from: string,
    to: string,
  ) {
    // Prefer rate active by period end (saved mid-month still applies).
    const byEnd = await this.getActiveCompensation(clubId, userId, to);
    if (byEnd) return byEnd;
    const byStart = await this.getActiveCompensation(clubId, userId, from);
    if (byStart) return byStart;
    // Last resort: any latest profile for this staff member.
    return this.prisma.staffCompensation.findFirst({
      where: { clubId, userId },
      orderBy: { effectiveFrom: 'desc' },
    });
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
        effectiveFrom: { lte: new Date(`${asOf}T23:59:59`) },
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
    sales?: StaffSalesBreakdown,
  ): number {
    if (profile) {
      return this.calcMotivationFromProfile(
        units,
        profile,
        periodFrom,
        sales,
      );
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
    sales?: StaffSalesBreakdown,
  ): number {
    let total = 0;
    const trusted = units.filter((u) => u.payrollTrusted);

    for (const slice of allPaySlices(profile)) {
      if (slice.track === 'ADMIN' && sales) {
        if (slice.membershipSalesPercent) {
          total += Math.round(
            (sales.membershipMinor * slice.membershipSalesPercent) / 100,
          );
        }
        if (slice.extraSalesPercent) {
          total += Math.round(
            (sales.extraServicesMinor * slice.extraSalesPercent) / 100,
          );
        }
        if (slice.shopSalesPercent) {
          total += Math.round((sales.shopMinor * slice.shopSalesPercent) / 100);
        }
        if (slice.corporateSalesPercent) {
          total += Math.round(
            (sales.corporateMinor * slice.corporateSalesPercent) / 100,
          );
        }
      }

      if (slice.track === 'GROUP_TRAINER') {
        for (const u of trusted.filter((x) => x.kind === 'GROUP')) {
          const hasTiers = (slice.groupRateTiers?.length ?? 0) > 0;
          if (hasTiers || u.roomKey) {
            total += resolveGroupSessionRateMinor(
              u.quantity,
              u.roomKey,
              slice.groupRateTiers,
              {
                rateMinor: slice.groupSessionRateMinor,
                minAttendees: slice.groupMinAttendees,
              },
            );
          } else {
            const min = slice.groupMinAttendees ?? 1;
            if (u.quantity < min) continue;
            total += slice.groupSessionRateMinor ?? 0;
          }
          if (slice.groupPerAttendeeMinor) {
            total += slice.groupPerAttendeeMinor * u.quantity;
          }
        }
      }

      if (slice.track === 'SPA') {
        for (const u of trusted.filter((x) => x.kind === 'SPA')) {
          if (
            u.partnerSource &&
            u.partnerSource.toUpperCase() === 'ALLSPORTS' &&
            slice.spaPartnerRateMinor
          ) {
            total += slice.spaPartnerRateMinor;
            continue;
          }
          const price = u.priceMinor ?? 0;
          if (price > 0 && slice.spaSoldPercent) {
            total += Math.round((price * slice.spaSoldPercent) / 100);
          } else if (price === 0 && slice.spaQuotaRates?.length) {
            const title = u.title.toLowerCase();
            const match = slice.spaQuotaRates.find((r) => {
              if (r.serviceKey === 'BODY_COMPOSITION')
                return /состав|анализ|inbody|compos/i.test(title);
              if (r.serviceKey === 'CLASSIC_MASSAGE')
                return /массаж|massage|класси/i.test(title);
              return r.serviceKey === u.serviceId;
            });
            if (match) total += match.rateMinor;
          }
        }
      }

      if (slice.track === 'PT') {
        const ptUnits = trusted.filter((x) => x.kind === 'PT');
        const monthCount = ptUnits.length;
        const pct = resolvePtPercent(monthCount, slice.ptPercentTiers);
        const catalog = slice.ptSessionPriceMinor ?? 0;
        for (const u of ptUnits) {
          if (u.isComplimentary) continue;
          const price =
            u.priceMinor != null && u.priceMinor > 0 ? u.priceMinor : catalog;
          if (price > 0) {
            total += Math.round((price * pct) / 100);
          }
        }
      }
    }

    void periodFrom;
    return total;
  }

  private async resolveStaffSales(
    clubId: string,
    userId: string,
    from: string,
    to: string,
    profile?: StaffPayProfile,
  ): Promise<StaffSalesBreakdown> {
    const needsSales = allPaySlices(profile).some(
      (s) =>
        s.track === 'ADMIN' &&
        ((s.membershipSalesPercent ?? 0) > 0 ||
          (s.extraSalesPercent ?? 0) > 0 ||
          (s.shopSalesPercent ?? 0) > 0 ||
          (s.corporateSalesPercent ?? 0) > 0),
    );

    const corporate = await this.prisma.payrollCorporateSale.findFirst({
      where: {
        clubId,
        userId,
        periodFrom: new Date(`${from}T00:00:00`),
        periodTo: new Date(`${to}T00:00:00`),
      },
    });
    const corporateMinor = corporate?.amountMinor ?? 0;

    if (!needsSales) {
      return {
        membershipMinor: 0,
        extraServicesMinor: 0,
        shopMinor: 0,
        corporateMinor,
        fromAnalytics: false,
      };
    }

    const user = await this.prisma.user.findFirst({
      where: { id: userId, clubId },
      select: { employeeCode: true },
    });
    const provider = createAnalyticsProvider({
      baseUrl: this.config.get<string>('FORMA_ANALYTICS_URL'),
      apiKey: this.config.get<string>('FORMA_API_KEY'),
      basicAuth: this.config.get<string>('FORMA_BASIC_AUTH'),
    });

    if (!provider) {
      return {
        membershipMinor: 0,
        extraServicesMinor: 0,
        shopMinor: 0,
        corporateMinor,
        fromAnalytics: false,
        hint:
          'Продажи 1С не подключены (FORMA_ANALYTICS_URL) — % от продаж = 0, корпо учитывается вручную',
      };
    }

    const remote = await fetchStaffSalesFromAnalytics(provider, {
      from,
      to,
      employeeExternalId: user?.employeeCode,
    });

    return {
      membershipMinor: remote?.membershipMinor ?? 0,
      extraServicesMinor: remote?.extraServicesMinor ?? 0,
      shopMinor: remote?.shopMinor ?? 0,
      corporateMinor,
      fromAnalytics: remote?.fromAnalytics ?? false,
      hint: remote?.hint,
    };
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
    const days = Math.floor((toMs - fromMs) / 86400000) + 1;
    if (days > 31) {
      throw new BadRequestException('Период не больше 31 дня');
    }
  }

  private sectionForStaff(
    employmentKind: StaffEmploymentKind,
    roles: string[],
    track?: StaffPayTrack,
  ): ClubPayrollSectionId {
    if (employmentKind === 'EXTERNAL') return 'EXTERNAL';
    if (roles.includes('ADMIN') || track === 'ADMIN') return 'ADMIN';
    if (roles.includes('SPECIALIST') || track === 'SPA') return 'SPECIALIST';
    if (roles.includes('TECH') || track === 'TECH') return 'TECH';
    return 'TRAINER';
  }

  async getClubSummary(
    clubId: string,
    from: string,
    to: string,
    department?: ClubPayrollSectionId | 'ALL' | 'MANAGER',
  ): Promise<ClubPayrollReport> {
    this.assertPeriod(from, to);
    const staff = await this.listStaffPaySummaries(clubId);
    const isManager = (s: (typeof staff)[0]) =>
      s.roles.includes('ADMIN') && s.baseSalaryMinor > 0;
    const filtered = staff.filter((s) => {
      const section = this.sectionForStaff(
        s.employmentKind ?? 'STAFF',
        s.roles,
        s.track,
      );
      if (!department || department === 'ALL') return true;
      if (department === 'MANAGER') return isManager(s);
      if (department === 'ADMIN') {
        return section === 'ADMIN' && !isManager(s);
      }
      return section === department;
    });

    const rows: ClubPayrollRow[] = [];
    for (const s of filtered) {
      const summary = await this.getPeriodSummary(clubId, s.userId, from, to);
      const payouts = await this.prisma.payrollPayout.findMany({
        where: {
          clubId,
          userId: s.userId,
          status: PayrollPayoutStatus.PAID,
          periodFrom: { gte: new Date(`${from}T00:00:00`) },
          periodTo: { lte: new Date(`${to}T23:59:59`) },
        },
      });
      const advancePaidMinor = payouts
        .filter((p) => p.kind === PrismaPayoutKind.ADVANCE_HALF)
        .reduce((a, p) => a + p.totalMinor, 0);
      const settlementPaidMinor = payouts
        .filter((p) => p.kind === PrismaPayoutKind.MONTH_SETTLEMENT)
        .reduce((a, p) => a + p.totalMinor, 0);
      const cardPaidMinor = payouts.reduce(
        (a, p) => a + p.cardTransferMinor,
        0,
      );
      const periodPaidTotalMinor = payouts.reduce((a, p) => {
        const cash = p.actualCashMinor ?? p.cashMinor;
        return a + p.cardTransferMinor + cash;
      }, 0);
      const priorPaidMinor = payouts.reduce((a, p) => a + p.totalMinor, 0);
      const bonusMinor = summary.adjustments
        .filter((a) => a.amountMinor > 0)
        .reduce((a, x) => a + x.amountMinor, 0);
      const fineMinor = Math.abs(
        summary.adjustments
          .filter((a) => a.amountMinor < 0)
          .reduce((a, x) => a + x.amountMinor, 0),
      );
      const employmentKind = s.employmentKind ?? 'STAFF';
      const section = this.sectionForStaff(employmentKind, s.roles, s.track);
      const comp = await this.resolveCompensation(clubId, s.userId, from, to);
      const sales = await this.resolveStaffSales(
        clubId,
        s.userId,
        from,
        to,
        asPayProfile(comp?.payProfile),
      );

      rows.push({
        userId: s.userId,
        name: s.name,
        section,
        roles: s.roles,
        track: s.track,
        employmentKind,
        baseSalaryMinor: summary.baseSalaryMinor,
        motivationMinor: summary.motivationMinor,
        bonusMinor,
        fineMinor,
        adjustmentsMinor: summary.adjustmentsMinor,
        totalEarnedMinor: summary.totalMinor,
        advancePaidMinor,
        cardPaidMinor,
        settlementPaidMinor,
        periodPaidTotalMinor,
        priorPaidMinor,
        toPayMinor: Math.max(0, summary.totalMinor - priorPaidMinor),
        openExceptions: summary.openExceptions,
        locked: summary.locked,
        currency: summary.currency,
        payChips: summary.payChips,
        anomalyHints: summary.anomalyHints,
        sales,
        workUnitCounts: {
          spa: summary.workUnits.filter(
            (u) => u.kind === 'SPA' && u.payrollTrusted,
          ).length,
          pt: summary.workUnits.filter(
            (u) => u.kind === 'PT' && u.payrollTrusted,
          ).length,
          group: summary.workUnits.filter(
            (u) => u.kind === 'GROUP' && u.payrollTrusted,
          ).length,
          shiftHours: summary.workUnits
            .filter((u) => u.kind === 'SHIFT')
            .reduce((a, u) => a + u.quantity, 0),
        },
      });
    }

    const sectionIds: ClubPayrollSectionId[] = [
      'ADMIN',
      'TRAINER',
      'SPECIALIST',
      'TECH',
      'EXTERNAL',
    ];
    const sections = sectionIds
      .map((id) => {
        const sectionRows = rows.filter((r) => r.section === id);
        const totals = {
          baseSalaryMinor: sectionRows.reduce(
            (a, r) => a + r.baseSalaryMinor,
            0,
          ),
          motivationMinor: sectionRows.reduce(
            (a, r) => a + r.motivationMinor,
            0,
          ),
          bonusMinor: sectionRows.reduce((a, r) => a + r.bonusMinor, 0),
          fineMinor: sectionRows.reduce((a, r) => a + r.fineMinor, 0),
          totalEarnedMinor: sectionRows.reduce(
            (a, r) => a + r.totalEarnedMinor,
            0,
          ),
          toPayMinor: sectionRows.reduce((a, r) => a + r.toPayMinor, 0),
        };
        return {
          id,
          label: SECTION_LABELS[id],
          rows: sectionRows,
          totals,
        };
      })
      .filter((s) => s.rows.length > 0);

    return {
      from,
      to,
      currency: rows[0]?.currency ?? 'BYN',
      sections,
      grandTotalMinor: rows.reduce((a, r) => a + r.totalEarnedMinor, 0),
    };
  }

  async exportClubSummaryXlsx(
    clubId: string,
    from: string,
    to: string,
    department?: ClubPayrollSectionId | 'ALL' | 'MANAGER',
  ): Promise<Buffer> {
    const ExcelJS = await import('exceljs');
    const report = await this.getClubSummary(clubId, from, to, department);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('ЗП');
    ws.addRow([
      'Подразделение',
      'ФИО',
      'База',
      'Мотивация',
      'Премии',
      'Штрафы',
      'Начислено',
      'Аванс',
      'Карта',
      'ЗП 15',
      'Выплачено',
      'К выдаче',
      'Исключения',
      'Комментарий',
    ]);
    for (const section of report.sections) {
      for (const r of section.rows) {
        ws.addRow([
          section.label,
          r.name,
          r.baseSalaryMinor / 100,
          r.motivationMinor / 100,
          r.bonusMinor / 100,
          r.fineMinor / 100,
          r.totalEarnedMinor / 100,
          r.advancePaidMinor / 100,
          r.cardPaidMinor / 100,
          r.settlementPaidMinor / 100,
          r.periodPaidTotalMinor / 100,
          r.toPayMinor / 100,
          r.openExceptions,
          [...r.anomalyHints, ...r.payChips].join('; '),
        ]);
      }
      ws.addRow([
        `${section.label} итого`,
        '',
        section.totals.baseSalaryMinor / 100,
        section.totals.motivationMinor / 100,
        section.totals.bonusMinor / 100,
        section.totals.fineMinor / 100,
        section.totals.totalEarnedMinor / 100,
        '',
        '',
        '',
        '',
        section.totals.toPayMinor / 100,
      ]);
    }
    ws.addRow([]);
    ws.addRow(['Всего начислено', report.grandTotalMinor / 100]);
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  async upsertCorporateSale(
    actor: JwtPayload,
    input: {
      userId: string;
      periodFrom: string;
      periodTo: string;
      amountMinor: number;
      note?: string;
    },
  ): Promise<PayrollCorporateSaleDto> {
    const clubId = requireClubId(actor);
    this.assertPeriod(input.periodFrom, input.periodTo);
    const user = await this.prisma.user.findFirst({
      where: { id: input.userId, clubId },
    });
    if (!user) throw new NotFoundException('Сотрудник не найден');
    const row = await this.prisma.payrollCorporateSale.upsert({
      where: {
        clubId_userId_periodFrom_periodTo: {
          clubId,
          userId: input.userId,
          periodFrom: new Date(`${input.periodFrom}T00:00:00`),
          periodTo: new Date(`${input.periodTo}T00:00:00`),
        },
      },
      create: {
        clubId,
        userId: input.userId,
        periodFrom: new Date(`${input.periodFrom}T00:00:00`),
        periodTo: new Date(`${input.periodTo}T00:00:00`),
        amountMinor: input.amountMinor,
        note: input.note?.trim() || null,
        createdById: actor.sub,
      },
      update: {
        amountMinor: input.amountMinor,
        note: input.note?.trim() || null,
      },
      include: { user: true },
    });
    return {
      id: row.id,
      userId: row.userId,
      userName: `${row.user.lastName} ${row.user.firstName}`.trim(),
      periodFrom: input.periodFrom,
      periodTo: input.periodTo,
      amountMinor: row.amountMinor,
      note: row.note ?? undefined,
    };
  }

  async listCorporateSales(
    clubId: string,
    from: string,
    to: string,
  ): Promise<PayrollCorporateSaleDto[]> {
    const rows = await this.prisma.payrollCorporateSale.findMany({
      where: {
        clubId,
        periodFrom: { gte: new Date(`${from}T00:00:00`) },
        periodTo: { lte: new Date(`${to}T23:59:59`) },
      },
      include: { user: true },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: `${r.user.lastName} ${r.user.firstName}`.trim(),
      periodFrom: r.periodFrom.toISOString().slice(0, 10),
      periodTo: r.periodTo.toISOString().slice(0, 10),
      amountMinor: r.amountMinor,
      note: r.note ?? undefined,
    }));
  }

  async setEmploymentKind(
    actor: JwtPayload,
    userId: string,
    employmentKind: StaffEmploymentKind,
  ) {
    const clubId = requireClubId(actor);
    const user = await this.prisma.user.findFirst({
      where: { id: userId, clubId },
    });
    if (!user) throw new NotFoundException('Сотрудник не найден');
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        employmentKind:
          employmentKind === 'EXTERNAL'
            ? PrismaEmploymentKind.EXTERNAL
            : PrismaEmploymentKind.STAFF,
      },
    });
    return { userId, employmentKind };
  }

  async setSpaPartnerSource(
    actor: JwtPayload,
    bookingId: string,
    partnerSource: string | null,
  ) {
    const clubId = requireClubId(actor);
    const booking = await this.prisma.spaBooking.findFirst({
      where: { id: bookingId, clubId },
    });
    if (!booking) throw new NotFoundException('Запись SPA не найдена');
    const normalized =
      partnerSource?.trim().toUpperCase() === 'ALLSPORTS'
        ? 'ALLSPORTS'
        : partnerSource?.trim()
          ? partnerSource.trim().toUpperCase()
          : null;
    await this.prisma.spaBooking.update({
      where: { id: bookingId },
      data: { partnerSource: normalized },
    });
    return { id: bookingId, partnerSource: normalized };
  }
}
