import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FitgoAnalyticsHttpProvider } from '@fitgo/1c-adapter';
import { MembershipStatus, type GrowthInsight } from '@fitgo/shared-types';
import {
  AdminTaskStatus,
  AvailabilityBlockStatus,
  OnexClassKind,
  OnexClassMemberAttendance,
  OnexClassStatus,
  PersonalBookingStatus,
  Role,
  SpaBookingStatus,
  StaffShiftTrack,
} from '@prisma/client';
import {
  classifySaleType,
  loadPayrollSegmentSets,
} from '../admin-sales/admin-sales-segments';
import { ClubRevenueService } from '../admin-sales/club-revenue.service';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { FitnessService } from '../fitness/fitness.service';
import { PrismaService } from '../prisma/prisma.service';

const CLUB_TZ = 'Europe/Minsk';

type SegmentSets = {
  massage: Set<string>;
  training: Set<string>;
  membership: Set<string>;
  shop: Set<string>;
  solarium: Set<string>;
};

type SalesMixKey =
  | 'membership'
  | 'training'
  | 'spa'
  | 'solarium'
  | 'shop'
  | 'corporate';

const SALES_MIX_LABEL: Record<SalesMixKey, string> = {
  membership: 'Абонементы',
  training: 'Тренировки',
  spa: 'СПА',
  solarium: 'Солярий',
  shop: 'Магазин',
  corporate: 'Корпо',
};

@Injectable()
export class SuperAdminAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
    private readonly revenue: ClubRevenueService,
    private readonly config: ConfigService,
  ) {}

  async getAnalytics(user: JwtPayload, periodDays = 30) {
    const clubId = requireClubId(user);
    const now = new Date();
    const periodStart = new Date(now);
    periodStart.setDate(periodStart.getDate() - periodDays);
    const prevStart = new Date(periodStart);
    prevStart.setDate(prevStart.getDate() - periodDays);

    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
    });

    const [visits, visitsPrev, reports, reportsPrev, ptCompleted, tasks, groupBookings] =
      await Promise.all([
        this.prisma.clubVisit.count({
          where: { user: { clubId: clubId }, visitedAt: { gte: periodStart } },
        }),
        this.prisma.clubVisit.count({
          where: {
            user: { clubId: clubId },
            visitedAt: { gte: prevStart, lt: periodStart },
          },
        }),
        this.prisma.dailyReport.findMany({
          where: { clubId: clubId, date: { gte: periodStart } },
        }),
        this.prisma.dailyReport.findMany({
          where: {
            clubId: clubId,
            date: { gte: prevStart, lt: periodStart },
          },
        }),
        this.prisma.personalTrainingBooking.count({
          where: {
            trainer: { clubId: clubId },
            status: PersonalBookingStatus.COMPLETED,
            endAt: { gte: periodStart },
          },
        }),
        this.prisma.adminTask.findMany({ where: { clubId: clubId } }),
        this.prisma.groupClassBooking.findMany({
          where: {
            client: { clubId: clubId },
            startAt: { gte: periodStart },
          },
        }),
      ]);

    const revenue = reports.reduce((sum, r) => sum + r.revenue, 0);
    const revenuePrev = reportsPrev.reduce((sum, r) => sum + r.revenue, 0);

    let activeMemberships = 0;
    let expiringSoon = 0;
    const provider = this.fitness.getProvider();
    const clients = await this.prisma.user.findMany({
      where: { clubId: clubId, roles: { some: { role: Role.CLIENT } } },
    });

    for (const client of clients) {
      if (!client.externalId) continue;
      const membership = await provider.getMembership(client.externalId);
      if (membership?.status === MembershipStatus.ACTIVE) {
        activeMemberships++;
        const daysLeft = Math.floor(
          (new Date(membership.validUntil).getTime() - now.getTime()) / 86400000,
        );
        if (daysLeft <= 7 && daysLeft >= 0) expiringSoon++;
      }
    }

    const trainerRankings = await this.buildTrainerRankings(clubId, periodStart);
    const groupDirectionLoad = this.buildGroupLoad(groupBookings);

    const doneTasks = tasks.filter((t) => t.status === AdminTaskStatus.DONE);
    const adminTasksDoneRate =
      tasks.length > 0 ? Math.round((doneTasks.length / tasks.length) * 100) : 100;

    const insights = this.buildInsights({
      expiringSoon,
      revenue,
      revenuePrev,
      visits,
      visitsPrev,
      trainerRankings,
      groupDirectionLoad,
      tasks,
      now,
    });

    return {
      periodDays,
      kpis: {
        visits,
        visitsPrev,
        activeMemberships,
        expiringSoon,
        revenue,
        revenuePrev,
        personalSessionsCompleted: ptCompleted,
        adminTasksDoneRate,
      },
      trainerRankings,
      groupDirectionLoad,
      insights,
      integrationHealth: {
        provider: process.env.FITNESS_PROVIDER ?? 'mock',
        clubExternalId: club?.externalId ?? null,
        ok: this.isIntegrationHealthy(club?.externalId),
      },
    };
  }

  private async buildTrainerRankings(clubId: string, since: Date) {
    const trainers = await this.prisma.user.findMany({
      where: { clubId, roles: { some: { role: Role.TRAINER } } },
    });

    const rankings = await Promise.all(
      trainers.map(async (trainer) => {
        const [completedPt, clientIds] = await Promise.all([
          this.prisma.personalTrainingBooking.count({
            where: {
              trainerId: trainer.id,
              status: PersonalBookingStatus.COMPLETED,
              endAt: { gte: since },
            },
          }),
          this.prisma.personalTrainingBooking.findMany({
            where: { trainerId: trainer.id },
            distinct: ['clientId'],
            select: { clientId: true },
          }),
        ]);

        const score = completedPt * 2 + clientIds.length;
        return {
          trainerId: trainer.id,
          name: `${trainer.firstName} ${trainer.lastName}`.trim(),
          score,
          completedPt,
          activeClients: clientIds.length,
        };
      }),
    );

    return rankings.sort((a, b) => b.score - a.score);
  }

  private buildGroupLoad(
    bookings: Array<{ title: string }>,
  ): Array<{ title: string; bookings: number; loadPercent: number }> {
    const counts = new Map<string, number>();
    for (const b of bookings) {
      counts.set(b.title, (counts.get(b.title) ?? 0) + 1);
    }
    const max = Math.max(1, ...counts.values(), 1);
    return [...counts.entries()]
      .map(([title, count]) => ({
        title,
        bookings: count,
        loadPercent: Math.round((count / max) * 100),
      }))
      .sort((a, b) => b.bookings - a.bookings)
      .slice(0, 10);
  }

  private buildInsights(input: {
    expiringSoon: number;
    revenue: number;
    revenuePrev: number;
    visits: number;
    visitsPrev: number;
    trainerRankings: Array<{ name: string; completedPt: number }>;
    groupDirectionLoad: Array<{ title: string; loadPercent: number }>;
    tasks: Array<{ status: AdminTaskStatus; dueAt: Date | null }>;
    now: Date;
  }): GrowthInsight[] {
    const insights: GrowthInsight[] = [];

    if (input.expiringSoon >= 5) {
      insights.push({
        severity: 'warning',
        title: 'Много истекающих абонементов',
        body: `${input.expiringSoon} абонементов истекают в ближайшие 7 дней.`,
        action: 'Запустите кампанию продления через админов',
      });
    }

    if (input.revenuePrev > 0 && input.revenue < input.revenuePrev * 0.85) {
      insights.push({
        severity: 'critical',
        title: 'Снижение выручки',
        body: `Выручка за период на ${Math.round((1 - input.revenue / input.revenuePrev) * 100)}% ниже предыдущего.`,
        action: 'Проверьте DailyReport.problems и воронку',
      });
    }

    if (input.visitsPrev > 0 && input.visits < input.visitsPrev * 0.9) {
      insights.push({
        severity: 'warning',
        title: 'Меньше визитов',
        body: 'Посещаемость ниже прошлого периода.',
        action: 'Активируйте push-напоминания неактивным клиентам',
      });
    }

    const idleTrainer = input.trainerRankings.find((t) => t.completedPt === 0);
    if (idleTrainer) {
      insights.push({
        severity: 'info',
        title: 'Тренер без PT',
        body: `${idleTrainer.name} не провёл персональных тренировок за период.`,
        action: 'Проверьте график work slots',
      });
    }

    const lowLoad = input.groupDirectionLoad.find((g) => g.loadPercent < 40);
    if (lowLoad) {
      insights.push({
        severity: 'info',
        title: 'Низкая загрузка направления',
        body: `«${lowLoad.title}» — низкий спрос.`,
        action: 'Пересмотрите расписание или промо',
      });
    }

    const overdue = input.tasks.filter(
      (t) =>
        t.status !== AdminTaskStatus.DONE &&
        t.status !== AdminTaskStatus.CANCELLED &&
        t.dueAt &&
        t.dueAt < input.now,
    ).length;
    if (overdue > 0) {
      insights.push({
        severity: 'warning',
        title: 'Просроченные задачи админов',
        body: `${overdue} задач просрочено.`,
        action: 'Откройте раздел задач',
      });
    }

    return insights.slice(0, 8);
  }

  async getClubOverview(user: JwtPayload) {
    const clubId = requireClubId(user);
    const today = minskParts();
    const current = periodToDay(today.year, today.month, today.day);
    const prevMonthDate =
      today.month === 1
        ? { year: today.year - 1, month: 12 }
        : { year: today.year, month: today.month - 1 };
    const prevMonth = periodToDay(
      prevMonthDate.year,
      prevMonthDate.month,
      today.day,
    );
    const prevYear = periodToDay(today.year - 1, today.month, today.day);

    const safe = async <T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        // One broken subquery must not blank the whole home page.
        console.error(
          `[overview] ${label}:`,
          err instanceof Error ? err.message : err,
        );
        return fallback;
      }
    };

    const emptyVisits = {
      available: false as const,
      current: null,
      prevMonth: null,
      prevYear: null,
      hint: 'Не удалось загрузить визиты',
    };
    const emptyMix = (
      ['membership', 'training', 'spa', 'solarium', 'shop', 'corporate'] as const
    ).map((key) => ({
      key,
      label: SALES_MIX_LABEL[key],
      amountMinor: 0,
      share: 0,
    }));

    const [
      revenueCurrent,
      revenuePrevMonth,
      revenuePrevYear,
      visits,
      salesMix,
      onShift,
      openTasks,
      club,
    ] = await Promise.all([
      safe('revenueCurrent', () => this.revenue.cashRevenueMinor(clubId, current.from, current.to), 0),
      safe('revenuePrevMonth', () => this.revenue.cashRevenueMinor(clubId, prevMonth.from, prevMonth.to), 0),
      safe('revenuePrevYear', () => this.revenue.cashRevenueMinor(clubId, prevYear.from, prevYear.to), 0),
      safe('visits', () => this.visitCounts(clubId, current, prevMonth, prevYear), emptyVisits),
      safe('salesMix', () => this.salesMix(clubId, current.from, current.to), emptyMix),
      safe('onShift', () => this.onShiftToday(clubId, current.to), []),
      safe(
        'openTasks',
        () =>
          this.prisma.adminTask.count({
            where: {
              clubId,
              status: { in: [AdminTaskStatus.OPEN, AdminTaskStatus.IN_PROGRESS] },
            },
          }),
        0,
      ),
      safe(
        'club',
        () =>
          this.prisma.club.findUnique({
            where: { id: clubId },
            select: { currency: true },
          }),
        null,
      ),
    ]);

    return {
      asOf: current.to,
      currency: club?.currency ?? 'BYN',
      onShift,
      openTasks,
      revenue: {
        currentMinor: revenueCurrent,
        prevMonthMinor: revenuePrevMonth,
        prevYearMinor: revenuePrevYear,
        from: current.from,
        to: current.to,
        prevMonthTo: prevMonth.to,
        prevYearTo: prevYear.to,
      },
      visits,
      salesMix,
    };
  }

  private async onShiftToday(clubId: string, date: string) {
    const from = new Date(`${date}T00:00:00.000Z`);
    const to = new Date(`${date}T23:59:59.999Z`);
    const rows = await this.prisma.staffShift.findMany({
      where: { clubId, date: { gte: from, lte: to } },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            groupPrograms: true,
            roles: { select: { role: true } },
          },
        },
      },
      orderBy: { startAt: 'asc' },
    });
    const roster = rows.map((row) => ({
      userId: row.userId,
      name: `${row.user.lastName} ${row.user.firstName}`.trim(),
      role: shiftRoleLabel(row.track, row.user),
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
    }));
    const spa = await this.spaOnShift(clubId, date, new Set(roster.map((r) => r.userId)));
    return [...roster, ...spa].sort((a, b) => a.startAt.localeCompare(b.startAt));
  }

  /**
   * SPA is not a StaffShift track. Published availability blocks are the
   * working hours for that day; the weekly slot is the fallback template.
   */
  private async spaOnShift(clubId: string, date: string, already: Set<string>) {
    const dayStart = new Date(minskLocalIso(date, '00:00'));
    const dayEnd = new Date(minskLocalIso(date, '23:59'));
    const specialist = {
      clubId,
      isActive: true,
      roles: { some: { role: Role.SPECIALIST } },
    };
    const blocks = await this.prisma.specialistAvailabilityBlock.findMany({
      where: {
        status: AvailabilityBlockStatus.PUBLISHED,
        startAt: { lt: dayEnd },
        endAt: { gt: dayStart },
        specialist,
      },
      include: {
        specialist: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { startAt: 'asc' },
    });
    const listed = new Set(already);
    const out: Array<{
      userId: string;
      name: string;
      role: string;
      startAt: string;
      endAt: string;
    }> = [];
    for (const block of blocks) {
      if (listed.has(block.specialistId)) continue;
      listed.add(block.specialistId);
      out.push({
        userId: block.specialistId,
        name: `${block.specialist.lastName} ${block.specialist.firstName}`.trim(),
        role: 'СПА',
        startAt: block.startAt.toISOString(),
        endAt: block.endAt.toISOString(),
      });
    }
    const slots = await this.prisma.specialistWorkSlot.findMany({
      where: { dayOfWeek: minskWeekday(date), specialist },
      include: {
        specialist: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    for (const slot of slots) {
      if (listed.has(slot.specialistId)) continue;
      listed.add(slot.specialistId);
      const startAt = minskLocalIso(date, slot.startTime);
      let endAt = minskLocalIso(date, slot.endTime);
      if (endAt <= startAt) {
        const end = new Date(endAt);
        end.setUTCDate(end.getUTCDate() + 1);
        endAt = end.toISOString();
      }
      out.push({
        userId: slot.specialistId,
        name: `${slot.specialist.lastName} ${slot.specialist.firstName}`.trim(),
        role: 'СПА',
        startAt,
        endAt,
      });
    }
    return out;
  }

  private async salesMix(clubId: string, fromIso: string, toIso: string) {
    const from = new Date(`${fromIso}T00:00:00.000Z`);
    const to = new Date(`${toIso}T23:59:59.999Z`);
    // paidAt — same cash/card window as club revenue / payroll motivation.
    const [sales, corpo, payrollSegs] = await Promise.all([
      this.prisma.saleTransaction.findMany({
        where: {
          clubId,
          isActive: true,
          paidAt: { gte: from, lte: to },
        },
        select: {
          amount: true,
          cash: true,
          card: true,
          cashless: true,
          personalAccount: true,
          paymentMethod: true,
          saleType: true,
          productName: true,
        },
      }),
      this.prisma.clubRevenueManualEntry.aggregate({
        where: {
          clubId,
          kind: 'corpo',
          entryDate: { gte: from, lte: to },
        },
        _sum: { amountMinor: true },
      }),
      loadPayrollSegmentSets(this.config),
    ]);
    const segments: SegmentSets | null = payrollSegs
      ? {
          massage: payrollSegs.spa,
          membership: payrollSegs.membership,
          shop: payrollSegs.shop,
          solarium: payrollSegs.solarium,
          training: payrollSegs.training,
        }
      : null;
    const minor: Record<SalesMixKey, number> = {
      membership: 0,
      training: 0,
      spa: 0,
      solarium: 0,
      shop: 0,
      corporate: corpo._sum.amountMinor ?? 0,
    };
    for (const row of sales) {
      const key = salesMixKey(row.saleType, row.productName, segments);
      if (!key) continue;
      const cash = Number(row.cash) || 0;
      const card = Number(row.card) || 0;
      const cashless = Number(row.cashless) || 0;
      const pa = Number(row.personalAccount) || 0;
      const split = cash + card + cashless + pa;
      const major =
        split > 0.009 ? cash + card + pa : Number(row.amount) || 0;
      if (major <= 0) continue;
      minor[key] += Math.round(major * 100);
    }
    const total = Object.values(minor).reduce((s, n) => s + n, 0);
    const keys: SalesMixKey[] = [
      'membership',
      'training',
      'spa',
      'solarium',
      'shop',
      'corporate',
    ];
    return keys.map((key) => ({
      key,
      label: SALES_MIX_LABEL[key],
      amountMinor: minor[key],
      share: total > 0 ? minor[key] / total : 0,
    }));
  }

  /**
   * Unique (clientExternalId, calendar day) across hall entries + PT/SPA.
   * Primary: Postgres after club sync. Analytics /stats/visits = hall fallback only.
   */
  private async visitCounts(
    clubId: string,
    current: { from: string; to: string },
    prevMonth: { from: string; to: string },
    prevYear: { from: string; to: string },
  ) {
    const [currentCount, prevMonthCount, prevYearCount] = await Promise.all([
      this.uniqueClientDays(clubId, current.from, current.to),
      this.uniqueClientDays(clubId, prevMonth.from, prevMonth.to),
      this.uniqueClientDays(clubId, prevYear.from, prevYear.to),
    ]);

    if (
      currentCount.count == null &&
      prevMonthCount.count == null &&
      prevYearCount.count == null
    ) {
      return {
        available: false,
        current: null,
        prevMonth: null,
        prevYear: null,
        hint:
          currentCount.hint ??
          prevMonthCount.hint ??
          prevYearCount.hint ??
          'Визиты ещё не в кэше FitGO — дождитесь «Обновить из 1С» / ночной выгрузки. Для fallback зала: шаблон GET /v1/stats/visits в FitGOAnalytics.',
      };
    }

    return {
      available: true,
      current: currentCount.count,
      prevMonth: prevMonthCount.count,
      prevYear: prevYearCount.count,
      hint: null as string | null,
    };
  }

  private async uniqueClientDays(
    clubId: string,
    from: string,
    to: string,
  ): Promise<{ count: number | null; hint: string | null }> {
    const keys = new Set<string>();
    const rangeStart = new Date(`${from}T00:00:00+03:00`);
    const rangeEnd = new Date(`${to}T23:59:59.999+03:00`);

    const hallRows = await this.prisma.clubHallVisit.findMany({
      where: {
        clubId,
        isActive: true,
        visitDate: { gte: from, lte: to },
        clientExternalId: { not: null },
      },
      select: { clientExternalId: true, visitDate: true },
    });
    for (const row of hallRows) {
      const id = row.clientExternalId?.trim();
      if (!id) continue;
      keys.add(`${id}|${row.visitDate.slice(0, 10)}`);
    }
    const hallFromCache = hallRows.length > 0;

    const [onexSessions, ptSales, spaBookings, ptBookings] = await Promise.all([
      this.prisma.onexClassSession.findMany({
        where: {
          clubId,
          isActive: true,
          kind: { in: [OnexClassKind.PT, OnexClassKind.SPA] },
          startAt: { gte: rangeStart, lte: rangeEnd },
          status: { not: OnexClassStatus.CANCELLED },
        },
        select: {
          startAt: true,
          members: {
            where: {
              cancelled: false,
              attendance: OnexClassMemberAttendance.ATTENDED,
            },
            select: { externalId: true },
          },
        },
      }),
      this.prisma.trainerPtSale.findMany({
        where: {
          clubId,
          isActive: true,
          occurredAt: { gte: rangeStart, lte: rangeEnd },
        },
        select: {
          externalId: true,
          clientName: true,
          bookingRef: true,
          occurredAt: true,
        },
      }),
      this.prisma.spaBooking.findMany({
        where: {
          clubId,
          status: { not: SpaBookingStatus.CANCELLED },
          startAt: { gte: rangeStart, lte: rangeEnd },
          OR: [
            { status: SpaBookingStatus.COMPLETED },
            { consumedInCrmAt: { not: null } },
          ],
        },
        select: {
          clientExternalId: true,
          clientId: true,
          startAt: true,
          client: { select: { externalId: true } },
        },
      }),
      this.prisma.personalTrainingBooking.findMany({
        where: {
          status: PersonalBookingStatus.COMPLETED,
          startAt: { gte: rangeStart, lte: rangeEnd },
          trainer: { clubId },
        },
        select: {
          startAt: true,
          client: { select: { externalId: true } },
        },
      }),
    ]);

    for (const session of onexSessions) {
      const day = moscowDayKey(session.startAt);
      for (const m of session.members) {
        const id = m.externalId?.trim();
        if (!id) continue;
        keys.add(`${id}|${day}`);
      }
    }

    for (const sale of ptSales) {
      const day = moscowDayKey(sale.occurredAt);
      const name = (sale.clientName ?? '').trim().toLowerCase();
      const id =
        (sale.bookingRef?.trim() ? `bref:${sale.bookingRef.trim()}` : '') ||
        (name ? `name:${name}` : '') ||
        `ptsale:${sale.externalId}`;
      keys.add(`${id}|${day}`);
    }

    for (const spa of spaBookings) {
      const day = moscowDayKey(spa.startAt);
      const id =
        spa.clientExternalId?.trim() ||
        spa.client?.externalId?.trim() ||
        (spa.clientId ? `uid:${spa.clientId}` : '');
      if (!id) continue;
      keys.add(`${id}|${day}`);
    }

    for (const pt of ptBookings) {
      const day = moscowDayKey(pt.startAt);
      const id = pt.client?.externalId?.trim() || '';
      if (!id) continue;
      keys.add(`${id}|${day}`);
    }

    const serviceOnlySize = (() => {
      // Approx PT/SPA contribution when hall cache empty (Analytics hall is a scalar).
      const serviceKeys = new Set<string>();
      for (const session of onexSessions) {
        const day = moscowDayKey(session.startAt);
        for (const m of session.members) {
          const id = m.externalId?.trim();
          if (id) serviceKeys.add(`${id}|${day}`);
        }
      }
      for (const sale of ptSales) {
        const day = moscowDayKey(sale.occurredAt);
        const name = (sale.clientName ?? '').trim().toLowerCase();
        const id =
          (sale.bookingRef?.trim() ? `bref:${sale.bookingRef.trim()}` : '') ||
          (name ? `name:${name}` : '') ||
          `ptsale:${sale.externalId}`;
        serviceKeys.add(`${id}|${day}`);
      }
      for (const spa of spaBookings) {
        const day = moscowDayKey(spa.startAt);
        const id =
          spa.clientExternalId?.trim() ||
          spa.client?.externalId?.trim() ||
          (spa.clientId ? `uid:${spa.clientId}` : '');
        if (id) serviceKeys.add(`${id}|${day}`);
      }
      for (const pt of ptBookings) {
        const day = moscowDayKey(pt.startAt);
        const id = pt.client?.externalId?.trim() || '';
        if (id) serviceKeys.add(`${id}|${day}`);
      }
      return serviceKeys.size;
    })();

    if (hallFromCache || keys.size > 0) {
      // Prefer full union from cache when hall rows exist.
      if (hallFromCache) {
        return { count: keys.size, hint: null };
      }
      // No hall rows but PT/SPA present — try Analytics hall add-on.
      const provider = this.analyticsProvider();
      if (provider) {
        try {
          const hall = await provider.getVisitCount({ from, to });
          if (hall != null) {
            return { count: hall + serviceOnlySize, hint: null };
          }
        } catch {
          /* fall through */
        }
      }
      return { count: keys.size, hint: null };
    }

    // Empty cache: hall-only Analytics fallback.
    const provider = this.analyticsProvider();
    if (!provider) {
      return {
        count: null,
        hint: 'Нет кэша визитов и нет FitGO Analytics (FORMA_ANALYTICS_URL).',
      };
    }
    try {
      const hall = await provider.getVisitCount({ from, to });
      if (hall == null) {
        return {
          count: null,
          hint: '1С не вернула число визитов зала.',
        };
      }
      return { count: hall, hint: null };
    } catch {
      return {
        count: null,
        hint: 'В публикации analytics нет GET /v1/stats/visits (Документ.Посещение). Добавьте шаблон StatsVisits и обновите модули продаж.',
      };
    }
  }

  private analyticsProvider(): FitgoAnalyticsHttpProvider | null {
    const baseUrl = this.config.get<string>('FORMA_ANALYTICS_URL')?.trim();
    const apiKey = this.config.get<string>('FORMA_API_KEY')?.trim();
    const basicAuth = this.config.get<string>('FORMA_BASIC_AUTH')?.trim();
    if (!baseUrl || !apiKey || !basicAuth) return null;
    return new FitgoAnalyticsHttpProvider({ baseUrl, apiKey, basicAuth });
  }

  private isIntegrationHealthy(clubExternalId?: string | null) {
    const provider = process.env.FITNESS_PROVIDER ?? 'mock';
    if (provider === 'mock') return true;
    return !!clubExternalId;
  }
}

function minskParts(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLUB_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** Calendar day YYYY-MM-DD in club TZ (Europe/Minsk). */
function moscowDayKey(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CLUB_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function periodToDay(year: number, month: number, day: number) {
  const end = Math.min(day, lastDayOfMonth(year, month));
  return { from: isoDate(year, month, 1), to: isoDate(year, month, end) };
}

function shiftRoleLabel(
  track: StaffShiftTrack,
  user: { groupPrograms: boolean; roles: Array<{ role: Role }> },
) {
  if (track === StaffShiftTrack.TECH) return 'Техперсонал';
  if (track === StaffShiftTrack.TRAINER) {
    return user.groupPrograms ? 'Тренер ГП' : 'Тренер';
  }
  if (user.roles.some((r) => r.role === Role.MANAGER)) return 'Управляющий';
  return 'Администратор';
}

function normNom(name: string) {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, '');
}

function excludedFromSalesMix(name: string) {
  const n = name.toLowerCase();
  return (
    n.includes('прочие поступления') ||
    n.includes('взнос на лицевой') ||
    n.includes('начисление на лс') ||
    n.includes('оплата от клиента') ||
    n.includes('сгорание лицевого')
  );
}

/**
 * App segments win (Магазин / Спа / Солярий / Абонементы / Тренировки).
 * Aligns with payroll classifySaleType + club cash revenue period.
 */
function salesMixKey(
  saleType: string,
  productName: string | null,
  segments: SegmentSets | null,
): SalesMixKey | null {
  const name = productName ?? '';
  if (excludedFromSalesMix(name)) return null;
  const key = normNom(name);
  if (segments && key) {
    if (segments.shop.has(key)) return 'shop';
    if (segments.massage.has(key)) return 'spa';
    if (segments.solarium.has(key)) return 'solarium';
    if (segments.training.has(key)) return 'training';
    if (segments.membership.has(key)) return 'membership';
  }
  if (/корпор/.test(name.toLowerCase())) return 'corporate';
  const payroll = segments
    ? {
        membership: segments.membership,
        spa: segments.massage,
        shop: segments.shop,
        solarium: segments.solarium,
        training: segments.training,
      }
    : null;
  const bucket = classifySaleType(saleType, productName, payroll);
  if (bucket === 'shop') return 'shop';
  if (bucket === 'massage') return 'spa';
  if (bucket === 'solarium') return 'solarium';
  if (bucket === 'training') return 'training';
  if (bucket === 'membership') return 'membership';
  if (saleType.toLowerCase() === 'training') return 'training';
  return null;
}

function minskWeekday(isoDate: string) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const noonMinsk = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1, 9));
  const wd = new Intl.DateTimeFormat('en-US', {
    timeZone: CLUB_TZ,
    weekday: 'short',
  }).format(noonMinsk);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
}

/** Europe/Minsk is UTC+3 all year. */
function minskLocalIso(isoDate: string, hhmm: string) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const [h, min] = hhmm.split(':').map(Number);
  return new Date(
    Date.UTC(y!, (m ?? 1) - 1, d ?? 1, (h ?? 0) - 3, min ?? 0, 0),
  ).toISOString();
}
