import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FitgoAnalyticsHttpProvider,
  type FitgoInstallmentSale,
} from '@fitgo/1c-adapter';
import type {
  AnalyticInsight,
  AnalyticsCompareMode,
  ClubAnalyticsMoney,
  ClubAnalyticsReport,
} from '@fitgo/shared-types';
import {
  OnexClassKind,
  OnexClassStatus,
  PersonalBookingStatus,
  PtSessionPayKind,
  SpaBookingStatus,
  SpaPaymentType,
} from '@prisma/client';
import {
  classifySaleType,
  loadPayrollSegmentSets,
} from '../admin-sales/admin-sales-segments';
import { ClubRevenueService } from '../admin-sales/club-revenue.service';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { PrismaService } from '../prisma/prisma.service';
import { PayrollService } from '../payroll/payroll.service';
import {
  assertPeriod,
  metric,
  minskParts,
  rangeBounds,
  resolveCompareRange,
  weekBuckets,
} from './analytics-period';

const SEG_LABEL: Record<string, string> = {
  membership: 'Абонементы',
  training: 'ПТ / тренинги',
  spa: 'СПА',
  solarium: 'Солярий',
  shop: 'Магазин',
  corporate: 'Корпо',
  other: 'Прочее',
};

@Injectable()
export class ClubAnalyticsService {
  private readonly logger = new Logger(ClubAnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly revenue: ClubRevenueService,
    private readonly payroll: PayrollService,
    private readonly config: ConfigService,
  ) {}

  async getClubReport(
    user: JwtPayload,
    params: {
      from: string;
      to: string;
      compare?: AnalyticsCompareMode;
      cmpFrom?: string;
      cmpTo?: string;
      includePay?: boolean;
    },
  ): Promise<ClubAnalyticsReport> {
    const clubId = requireClubId(user);
    assertPeriod(params.from, params.to);
    const compareMode: AnalyticsCompareMode = params.compare ?? 'prev';
    const { compareFrom, compareTo } = resolveCompareRange(
      params.from,
      params.to,
      compareMode,
      params.cmpFrom,
      params.cmpTo,
    );

    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { currency: true, externalId: true },
    });

    const [
      moneyCur,
      moneyCmp,
      membersCur,
      membersCmp,
      visitsCur,
      visitsCmp,
      servicesCur,
      servicesCmp,
      dataSince,
      trainerRankings,
      fot,
      installments,
    ] = await Promise.all([
      this.moneyBlock(clubId, params.from, params.to),
      this.moneyBlock(clubId, compareFrom, compareTo),
      this.membersBlock(clubId, params.from, params.to),
      this.membersBlock(clubId, compareFrom, compareTo),
      this.visitsBlock(clubId, params.from, params.to),
      this.visitsBlock(clubId, compareFrom, compareTo),
      this.servicesBlock(clubId, params.from, params.to),
      this.servicesBlock(clubId, compareFrom, compareTo),
      this.earliestSaleDate(clubId),
      this.trainerRankings(clubId, params.from, params.to),
      params.includePay
        ? this.fotBlock(clubId, params.from, params.to, compareFrom, compareTo)
        : Promise.resolve(null),
      this.installmentsSnapshot(),
    ]);

    const money: ClubAnalyticsMoney = {
      revenue: metric(moneyCur.revenueMinor, moneyCmp.revenueMinor, {
        unit: 'money' as const,
        trend: moneyCur.revenueTrend,
      }),
      byPayment: moneyCur.byPayment,
      bySegment: moneyCur.bySegment,
      avgCheck: metric(moneyCur.avgCheckMinor, moneyCmp.avgCheckMinor, {
        unit: 'money' as const,
      }),
      refunds: metric(moneyCur.refundsMinor, moneyCmp.refundsMinor, {
        unit: 'money' as const,
      }),
      debtOutstanding: metric(moneyCur.debtMinor, moneyCmp.debtMinor, {
        unit: 'money' as const,
      }),
      installments,
    };

    const members = {
      active: metric(membersCur.active, membersCmp.active, { unit: 'count' }),
      newClients: metric(membersCur.newClients, membersCmp.newClients, {
        unit: 'count',
        hint: dataSince
          ? `История продаж с ${dataSince}`
          : 'Нет кэша продаж',
      }),
      renewals: metric(membersCur.renewals, membersCmp.renewals, {
        unit: 'count',
      }),
      renewalRate: metric(membersCur.renewalRatePct, membersCmp.renewalRatePct, {
        unit: 'percent',
      }),
      churn: metric(membersCur.churn, membersCmp.churn, { unit: 'count' }),
      frozen: metric(membersCur.frozen, membersCmp.frozen, { unit: 'count' }),
      expiring7: metric(membersCur.expiring7, membersCmp.expiring7, {
        unit: 'count',
      }),
      expiring30: metric(membersCur.expiring30, membersCmp.expiring30, {
        unit: 'count',
      }),
    };

    const visits = {
      total: metric(visitsCur.total, visitsCmp.total, {
        unit: 'count',
        trend: visitsCur.trend,
      }),
      uniqueClients: metric(visitsCur.unique, visitsCmp.unique, {
        unit: 'count',
      }),
      avgPerActiveMembership: metric(
        visitsCur.avgPerActive,
        visitsCmp.avgPerActive,
        { unit: 'count' },
      ),
      sleeping: metric(visitsCur.sleeping, visitsCmp.sleeping, {
        unit: 'count',
      }),
      heatmap: visitsCur.heatmap,
    };

    const services = {
      group: {
        sessions: metric(
          servicesCur.group.sessions,
          servicesCmp.group.sessions,
          { unit: 'count' },
        ),
        avgFillPct: metric(
          servicesCur.group.avgFillPct,
          servicesCmp.group.avgFillPct,
          { unit: 'percent' },
        ),
        topDirections: servicesCur.group.topDirections,
        bottomDirections: servicesCur.group.bottomDirections,
      },
      pt: {
        completed: metric(
          servicesCur.pt.completed,
          servicesCmp.pt.completed,
          { unit: 'count' },
        ),
        giftSharePct: metric(
          servicesCur.pt.giftSharePct,
          servicesCmp.pt.giftSharePct,
          { unit: 'percent' },
        ),
      },
      spa: {
        completed: metric(
          servicesCur.spa.completed,
          servicesCmp.spa.completed,
          { unit: 'count' },
        ),
        quota: servicesCur.spa.quota,
        paid: servicesCur.spa.paid,
        allsports: servicesCur.spa.allsports,
      },
    };

    const insights = this.buildInsights({
      money,
      members,
      visits,
      services,
    });

    return {
      from: params.from,
      to: params.to,
      compareFrom,
      compareTo,
      compareMode,
      currency: club?.currency ?? 'BYN',
      dataSince,
      money,
      members,
      visits,
      services,
      fot,
      insights,
      trainerRankings,
      integrationHealth: {
        provider: process.env.FITNESS_PROVIDER ?? 'mock',
        clubExternalId: club?.externalId ?? null,
        ok: Boolean(club?.externalId),
      },
    };
  }

  private async earliestSaleDate(clubId: string): Promise<string | null> {
    const [sale, rev] = await Promise.all([
      this.prisma.saleTransaction.findFirst({
        where: { clubId, isActive: true },
        orderBy: { soldAt: 'asc' },
        select: { soldAt: true },
      }),
      this.prisma.clubRevenueEntry.findFirst({
        where: { clubId, isActive: true },
        orderBy: { occurredAt: 'asc' },
        select: { occurredAt: true },
      }),
    ]);
    const dates = [sale?.soldAt, rev?.occurredAt]
      .filter((d): d is Date => Boolean(d))
      .map((d) => d.toISOString().slice(0, 10));
    if (!dates.length) return null;
    return dates.sort()[0] ?? null;
  }

  private analyticsProvider(): FitgoAnalyticsHttpProvider | null {
    const baseUrl = this.config.get<string>('FORMA_ANALYTICS_URL')?.trim();
    const apiKey = this.config.get<string>('FORMA_API_KEY')?.trim() ?? '';
    const basicAuth =
      this.config.get<string>('FORMA_BASIC_AUTH')?.trim() ?? '';
    if (!baseUrl || !apiKey) return null;
    return new FitgoAnalyticsHttpProvider({ baseUrl, apiKey, basicAuth });
  }

  /**
   * Snapshot of open installment schedules from 1C (Minsk calendar).
   * Failures return null so club analytics still loads.
   */
  private async installmentsSnapshot(): Promise<
    ClubAnalyticsMoney['installments']
  > {
    const provider = this.analyticsProvider();
    if (!provider?.getInstallments) return null;
    try {
      const rows = (await provider.getInstallments()) ?? [];
      return aggregateInstallments(rows);
    } catch (err) {
      this.logger.warn(
        `Installments snapshot failed: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  private async moneyBlock(clubId: string, from: string, to: string) {
    const revenueMinor = await this.revenue.cashRevenueMinor(clubId, from, to);
    const { start, end } = rangeBounds(from, to);

    const [receipts, manuals, unpaidDebt] = await Promise.all([
      this.prisma.clubRevenueEntry.findMany({
        where: {
          clubId,
          isActive: true,
          OR: [
            {
              operationType: { in: ['payment', 'refund'] },
              paidAt: { gte: start, lte: end },
            },
            {
              operationType: {
                in: ['personal_deposit', 'personal_credit', 'personal_burn'],
              },
              occurredAt: { gte: start, lte: end },
            },
            {
              operationType: 'sale',
              paidAt: { gte: start, lte: end },
              paidAmount: { gt: 0 },
            },
          ],
        },
      }),
      this.prisma.clubRevenueManualEntry.findMany({
        where: { clubId, entryDate: { gte: start, lte: end } },
      }),
      this.prisma.clubMembershipSnapshot.aggregate({
        where: { clubId, debtAmount: { gt: 0 } },
        _sum: { debtAmount: true },
      }),
    ]);

    let cash = 0;
    let card = 0;
    let cashless = 0;
    let personalAccount = 0;
    let refunds = 0;
    let paymentCount = 0;
    const byDay = new Map<string, number>();

    for (const r of receipts) {
      const day = (r.paidAt ?? r.occurredAt).toISOString().slice(0, 10);
      const cashR = Math.round((Number(r.cash) || 0) * 100);
      const cardR = Math.round((Number(r.card) || 0) * 100);
      const cashlessR = Math.round((Number(r.cashless) || 0) * 100);
      const paR = Math.round((Number(r.personalAccount) || 0) * 100);
      if (r.operationType === 'refund') {
        const ref = Math.round((Number(r.refundAmount) || Number(r.amount) || 0) * 100);
        refunds += Math.abs(ref);
        byDay.set(day, (byDay.get(day) ?? 0) - Math.abs(ref));
        continue;
      }
      cash += cashR;
      card += cardR;
      cashless += cashlessR;
      personalAccount += paR;
      const line = cashR + cardR + cashlessR + paR;
      if (line > 0) paymentCount++;
      byDay.set(day, (byDay.get(day) ?? 0) + line);
    }

    let corpoMinor = 0;
    let otherMinor = 0;
    for (const m of manuals) {
      if (m.kind === 'corpo') corpoMinor += m.amountMinor;
      else otherMinor += m.amountMinor;
    }

    const bySegment = await this.salesMix(clubId, from, to);
    const avgCheckMinor =
      paymentCount > 0 ? Math.round(revenueMinor / paymentCount) : 0;

    return {
      revenueMinor,
      avgCheckMinor,
      refundsMinor: refunds,
      debtMinor: Math.round((unpaidDebt._sum.debtAmount ?? 0) * 100),
      byPayment: {
        cashMinor: cash,
        cardMinor: card,
        cashlessMinor: cashless,
        personalAccountMinor: personalAccount,
        corpoMinor,
        otherMinor,
      },
      bySegment,
      revenueTrend: weekBuckets(from, to, byDay),
    };
  }

  private async salesMix(clubId: string, from: string, to: string) {
    const { start, end } = rangeBounds(from, to);
    const [sales, corpo, payrollSegs] = await Promise.all([
      this.prisma.saleTransaction.findMany({
        where: { clubId, isActive: true, paidAt: { gte: start, lte: end } },
        select: {
          amount: true,
          cash: true,
          card: true,
          cashless: true,
          personalAccount: true,
          saleType: true,
          productName: true,
        },
      }),
      this.prisma.clubRevenueManualEntry.aggregate({
        where: {
          clubId,
          kind: 'corpo',
          entryDate: { gte: start, lte: end },
        },
        _sum: { amountMinor: true },
      }),
      loadPayrollSegmentSets(this.config),
    ]);

    const minor: Record<string, number> = {
      membership: 0,
      training: 0,
      spa: 0,
      solarium: 0,
      shop: 0,
      corporate: corpo._sum.amountMinor ?? 0,
      other: 0,
    };
    for (const row of sales) {
      const classified = classifySaleType(
        row.saleType ?? undefined,
        row.productName,
        payrollSegs,
      );
      const key =
        classified === 'membership'
          ? 'membership'
          : classified === 'training'
            ? 'training'
            : classified === 'massage'
              ? 'spa'
              : classified === 'solarium'
                ? 'solarium'
                : classified === 'shop'
                  ? 'shop'
                  : 'other';
      const cash = Number(row.cash) || 0;
      const card = Number(row.card) || 0;
      const cashless = Number(row.cashless) || 0;
      const pa = Number(row.personalAccount) || 0;
      const split = cash + card + cashless + pa;
      const major =
        split > 0.009 ? cash + card + pa : Number(row.amount) || 0;
      if (major <= 0) continue;
      minor[key] = (minor[key] ?? 0) + Math.round(major * 100);
    }
    const total = Object.values(minor).reduce((s, n) => s + n, 0);
    const prefer = new Set(['membership', 'training', 'spa']);
    return Object.entries(minor)
      .filter(([key, v]) => v > 0 || prefer.has(key))
      .map(([key, amountMinor]) => ({
        key,
        label: SEG_LABEL[key] ?? key,
        amountMinor,
        share: total > 0 ? amountMinor / total : 0,
      }));
  }

  private async membersBlock(clubId: string, from: string, to: string) {
    const snapshots = await this.prisma.clubMembershipSnapshot.findMany({
      where: { clubId },
      select: {
        clientExternalId: true,
        status: true,
        startDate: true,
        endDate: true,
      },
    });

    const statusNorm = (s: string | null | undefined) =>
      (s ?? '').toUpperCase();

    let active = 0;
    let frozen = 0;
    let expiring7 = 0;
    let expiring30 = 0;
    let expiredInPeriod = 0;
    const expiredClients = new Set<string>();

    for (const s of snapshots) {
      const st = statusNorm(s.status);
      if (st === 'ACTIVE' || st === 'АКТИВНЫЙ' || st.includes('ACTIVE')) {
        active++;
        if (s.endDate) {
          const end = s.endDate.slice(0, 10);
          if (end >= to && end <= addDaysLocal(to, 7)) expiring7++;
          if (end >= to && end <= addDaysLocal(to, 30)) expiring30++;
        }
      }
      if (st.includes('FREEZ') || st.includes('ЗАМОРОЗ')) frozen++;
      if (s.endDate) {
        const end = s.endDate.slice(0, 10);
        if (end >= from && end <= to) {
          expiredInPeriod++;
          expiredClients.add(s.clientExternalId);
        }
      }
    }

    const { start, end } = rangeBounds(from, to);
    const membershipSales = await this.prisma.saleTransaction.findMany({
      where: {
        clubId,
        isActive: true,
        paidAt: { not: null },
        soldAt: { gte: start, lte: end },
        OR: [
          { saleType: { contains: 'abon', mode: 'insensitive' } },
          { saleType: { contains: 'member', mode: 'insensitive' } },
          { saleType: { contains: 'абонемент', mode: 'insensitive' } },
          { productName: { contains: 'абонемент', mode: 'insensitive' } },
        ],
      },
      select: {
        clientExternalId: true,
        soldAt: true,
        productName: true,
        saleType: true,
      },
    });

    // Better classification via segments when available
    const payrollSegs = await loadPayrollSegmentSets(this.config);
    const memSales = membershipSales.length
      ? membershipSales
      : await this.membershipSalesViaSegments(clubId, start, end, payrollSegs);

    const priorSales = await this.prisma.saleTransaction.findMany({
      where: {
        clubId,
        isActive: true,
        paidAt: { not: null },
        soldAt: { lt: start },
        clientExternalId: {
          in: [
            ...new Set(
              memSales
                .map((s) => s.clientExternalId)
                .filter((id): id is string => Boolean(id)),
            ),
          ],
        },
      },
      select: { clientExternalId: true, soldAt: true },
      orderBy: { soldAt: 'desc' },
    });
    const lastPrior = new Map<string, Date>();
    for (const p of priorSales) {
      if (!p.clientExternalId) continue;
      if (!lastPrior.has(p.clientExternalId)) {
        lastPrior.set(p.clientExternalId, p.soldAt);
      }
    }

    let newClients = 0;
    let renewals = 0;
    const renewedClients = new Set<string>();
    for (const sale of memSales) {
      const cid = sale.clientExternalId;
      if (!cid) continue;
      const prior = lastPrior.get(cid);
      if (!prior) {
        newClients++;
      } else {
        const gapDays =
          (sale.soldAt.getTime() - prior.getTime()) / 86400000;
        // Renewal if previous sale within ~14 months (typical membership) and gap ≤ 60d after end approx via soldAt gap
        if (gapDays <= 400) {
          renewals++;
          renewedClients.add(cid);
        } else {
          newClients++;
        }
      }
    }

    let churn = 0;
    for (const cid of expiredClients) {
      if (!renewedClients.has(cid)) churn++;
    }

    const renewalRatePct =
      expiredInPeriod > 0
        ? Math.round(
            (renewedClients.size / expiredInPeriod) * 1000,
          ) / 10
        : 0;

    return {
      active,
      frozen,
      expiring7,
      expiring30,
      newClients,
      renewals,
      renewalRatePct,
      churn,
    };
  }

  private async membershipSalesViaSegments(
    clubId: string,
    start: Date,
    end: Date,
    payrollSegs: Awaited<ReturnType<typeof loadPayrollSegmentSets>>,
  ) {
    const all = await this.prisma.saleTransaction.findMany({
      where: {
        clubId,
        isActive: true,
        paidAt: { not: null },
        soldAt: { gte: start, lte: end },
      },
      select: {
        clientExternalId: true,
        soldAt: true,
        productName: true,
        saleType: true,
      },
    });
    if (!payrollSegs) {
      return all.filter(
        (s) =>
          /абонемент|membership|abon/i.test(s.productName ?? '') ||
          /абонемент|membership|abon/i.test(s.saleType ?? ''),
      );
    }
    return all.filter((s) => {
      const t = classifySaleType(
        s.saleType ?? undefined,
        s.productName,
        payrollSegs,
      );
      return t === 'membership';
    });
  }

  private async visitsBlock(clubId: string, from: string, to: string) {
    const hall = await this.prisma.clubHallVisit.findMany({
      where: {
        clubId,
        isActive: true,
        visitDate: { gte: from, lte: to },
      },
      select: { clientExternalId: true, visitDate: true, checkIn: true },
    });

    const byDay = new Map<string, number>();
    const unique = new Set<string>();
    const heatmap: number[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => 0),
    );

    for (const v of hall) {
      byDay.set(v.visitDate, (byDay.get(v.visitDate) ?? 0) + 1);
      if (v.clientExternalId) unique.add(v.clientExternalId);
      if (v.checkIn) {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Europe/Minsk',
          weekday: 'short',
          hour: 'numeric',
          hour12: false,
        }).formatToParts(v.checkIn);
        const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon';
        const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
        const dayIdx = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(
          wd,
        );
        if (dayIdx >= 0 && hour >= 0 && hour < 24) {
          heatmap[dayIdx]![hour]! += 1;
        }
      }
    }

    const activeSnaps = await this.prisma.clubMembershipSnapshot.findMany({
      where: {
        clubId,
        OR: [
          { status: { contains: 'ACTIVE', mode: 'insensitive' } },
          { status: { contains: 'актив', mode: 'insensitive' } },
        ],
      },
      select: { clientExternalId: true },
    });
    const activeIds = new Set(activeSnaps.map((s) => s.clientExternalId));
    const visitedRecently = new Set(
      hall
        .filter((v) => v.visitDate >= addDaysLocal(to, -14) && v.clientExternalId)
        .map((v) => v.clientExternalId!),
    );
    let sleeping = 0;
    for (const id of activeIds) {
      if (!visitedRecently.has(id)) sleeping++;
    }

    const total = hall.length;
    const avgPerActive =
      activeIds.size > 0
        ? Math.round((total / activeIds.size) * 10) / 10
        : 0;

    return {
      total,
      unique: unique.size,
      avgPerActive,
      sleeping,
      heatmap,
      trend: weekBuckets(from, to, byDay),
    };
  }

  private async servicesBlock(clubId: string, from: string, to: string) {
    const { start, end } = rangeBounds(from, to);

    const [groupSessions, scheduleSlots, ptBookings, spaBookings] =
      await Promise.all([
        this.prisma.onexClassSession.findMany({
          where: {
            clubId,
            isActive: true,
            kind: OnexClassKind.GROUP,
            startAt: { gte: start, lte: end },
            status: { in: [OnexClassStatus.COMPLETED, OnexClassStatus.CANCELLED] },
          },
          select: {
            title: true,
            status: true,
            attendedCount: true,
            bookedCount: true,
            startAt: true,
            externalId: true,
          },
        }),
        this.prisma.clubScheduleSlot.findMany({
          where: { clubId, startAt: { gte: start, lte: end } },
          select: { externalId: true, capacity: true, title: true },
        }),
        this.prisma.personalTrainingBooking.findMany({
          where: {
            trainer: { clubId },
            status: PersonalBookingStatus.COMPLETED,
            startAt: { gte: start, lte: end },
          },
          select: { isComplimentary: true, payKind: true },
        }),
        this.prisma.spaBooking.findMany({
          where: {
            clubId,
            status: SpaBookingStatus.COMPLETED,
            startAt: { gte: start, lte: end },
          },
          select: { paymentType: true, partnerSource: true },
        }),
      ]);

    const capByExternal = new Map(
      scheduleSlots.map((s) => [s.externalId, s.capacity]),
    );
    const completed = groupSessions.filter(
      (s) => s.status === OnexClassStatus.COMPLETED,
    );
    let fillSum = 0;
    let fillN = 0;
    const byTitle = new Map<
      string,
      { sessions: number; attended: number; fill: number; fillN: number }
    >();
    for (const s of completed) {
      const cap = capByExternal.get(s.externalId) ?? 0;
      const fill = cap > 0 ? (s.attendedCount / cap) * 100 : 0;
      if (cap > 0) {
        fillSum += fill;
        fillN++;
      }
      const cur = byTitle.get(s.title) ?? {
        sessions: 0,
        attended: 0,
        fill: 0,
        fillN: 0,
      };
      cur.sessions++;
      cur.attended += s.attendedCount;
      if (cap > 0) {
        cur.fill += fill;
        cur.fillN++;
      }
      byTitle.set(s.title, cur);
    }
    const directions = [...byTitle.entries()]
      .map(([title, v]) => ({
        title,
        sessions: v.sessions,
        avgAttended:
          v.sessions > 0 ? Math.round((v.attended / v.sessions) * 10) / 10 : 0,
        fillPct: v.fillN > 0 ? Math.round(v.fill / v.fillN) : 0,
      }))
      .sort((a, b) => b.sessions - a.sessions);
    const topDirections = directions.slice(0, 5);
    const bottomDirections = [...directions]
      .filter((d) => d.sessions >= 2)
      .sort((a, b) => a.fillPct - b.fillPct)
      .slice(0, 5);

    const gift = ptBookings.filter(
      (b) => b.isComplimentary || b.payKind === PtSessionPayKind.GIFT,
    ).length;
    const giftSharePct =
      ptBookings.length > 0
        ? Math.round((gift / ptBookings.length) * 1000) / 10
        : 0;

    let quota = 0;
    let paid = 0;
    let allsports = 0;
    for (const s of spaBookings) {
      if ((s.partnerSource ?? '').toUpperCase().includes('ALLSPORT')) {
        allsports++;
      } else if (s.paymentType === SpaPaymentType.QUOTA) {
        quota++;
      } else if (s.paymentType === SpaPaymentType.PAID) {
        paid++;
      }
    }

    return {
      group: {
        sessions: completed.length,
        avgFillPct: fillN > 0 ? Math.round(fillSum / fillN) : 0,
        topDirections,
        bottomDirections,
      },
      pt: {
        completed: ptBookings.length,
        giftSharePct,
      },
      spa: {
        completed: spaBookings.length,
        quota,
        paid,
        allsports,
      },
    };
  }

  private async fotBlock(
    clubId: string,
    from: string,
    to: string,
    compareFrom: string,
    compareTo: string,
  ) {
    try {
      const [cur, cmp, revenueMinor, revenueCmp, staffCount] = await Promise.all([
        this.payroll.getClubSummary(clubId, from, to),
        this.payroll.getClubSummary(clubId, compareFrom, compareTo),
        this.revenue.cashRevenueMinor(clubId, from, to),
        this.revenue.cashRevenueMinor(clubId, compareFrom, compareTo),
        this.prisma.user.count({
          where: {
            clubId,
            isActive: true,
            archivedAt: null,
            roles: {
              some: {
                role: {
                  in: ['ADMIN', 'MANAGER', 'TRAINER', 'SPECIALIST', 'TECH'],
                },
              },
            },
          },
        }),
      ]);
      const fotMinor = cur.grandTotalMinor;
      const fotCmp = cmp.grandTotalMinor;
      const share =
        revenueMinor > 0
          ? Math.round((fotMinor / revenueMinor) * 1000) / 10
          : 0;
      const shareCmp =
        revenueCmp > 0
          ? Math.round((fotCmp / revenueCmp) * 1000) / 10
          : 0;
      const perStaff =
        staffCount > 0 ? Math.round(revenueMinor / staffCount) : 0;
      return {
        fotMinor: metric(fotMinor, fotCmp, { unit: 'money' as const }),
        fotShareOfRevenuePct: metric(share, shareCmp, {
          unit: 'percent' as const,
        }),
        revenuePerStaffMinor: metric(perStaff, null, {
          unit: 'money' as const,
        }),
      };
    } catch {
      return null;
    }
  }

  private async trainerRankings(clubId: string, from: string, to: string) {
    const { start, end } = rangeBounds(from, to);
    const trainers = await this.prisma.user.findMany({
      where: {
        clubId,
        isActive: true,
        roles: { some: { role: 'TRAINER' } },
      },
      select: { id: true, firstName: true, lastName: true },
    });
    const rankings = await Promise.all(
      trainers.map(async (t) => {
        const [completedPt, clients] = await Promise.all([
          this.prisma.personalTrainingBooking.count({
            where: {
              trainerId: t.id,
              status: PersonalBookingStatus.COMPLETED,
              startAt: { gte: start, lte: end },
            },
          }),
          this.prisma.personalTrainingBooking.findMany({
            where: {
              trainerId: t.id,
              status: PersonalBookingStatus.COMPLETED,
              startAt: { gte: start, lte: end },
            },
            distinct: ['clientId'],
            select: { clientId: true },
          }),
        ]);
        return {
          trainerId: t.id,
          name: `${t.lastName} ${t.firstName}`.trim(),
          score: completedPt * 2 + clients.length,
          completedPt,
          activeClients: clients.length,
        };
      }),
    );
    return rankings.sort((a, b) => b.score - a.score).slice(0, 10);
  }

  private buildInsights(input: {
    money: ClubAnalyticsReport['money'];
    members: ClubAnalyticsReport['members'];
    visits: ClubAnalyticsReport['visits'];
    services: ClubAnalyticsReport['services'];
  }): AnalyticInsight[] {
    const out: AnalyticInsight[] = [];
    const revDelta = input.money.revenue.deltaPct;
    if (revDelta != null && revDelta <= -15) {
      out.push({
        severity: 'critical',
        title: 'Снижение выручки',
        body: `Выручка на ${Math.abs(revDelta)}% ниже сравниваемого периода.`,
        action: 'Сверьте сегменты продаж и возвраты',
      });
    } else if (revDelta != null && revDelta >= 10) {
      out.push({
        severity: 'success',
        title: 'Рост выручки',
        body: `Выручка +${revDelta}% к сравниваемому периоду.`,
      });
    }
    if ((input.members.renewalRate.value ?? 0) < 60 && input.members.renewals.compareValue != null) {
      out.push({
        severity: 'warning',
        title: 'Низкий % продлений',
        body: `Процент продлений ${input.members.renewalRate.value}%. Цель ≥ 60%.`,
        action: 'Проверьте воронку задач на продление',
      });
    }
    if ((input.visits.sleeping.deltaPct ?? 0) > 20) {
      out.push({
        severity: 'warning',
        title: 'Рост «спящих»',
        body: `Активные абонементы без визитов 14+ дней: ${input.visits.sleeping.value}.`,
        action: 'Запустите кампанию возврата',
      });
    }
    if (
      input.visits.total.compareValue != null &&
      input.visits.total.value > (input.visits.total.compareValue ?? 0) &&
      (input.visits.total.deltaPct ?? 0) >= 15
    ) {
      out.push({
        severity: 'success',
        title: 'Рекорд посещаемости',
        body: `Визиты +${input.visits.total.deltaPct}% к сравниваемому периоду.`,
      });
    }
    if ((input.members.expiring7.value ?? 0) >= 5) {
      out.push({
        severity: 'warning',
        title: 'Истекают абонементы',
        body: `${input.members.expiring7.value} абонементов истекают в ближайшие 7 дней.`,
        action: 'Назначьте задачи админам',
      });
    }
    const lowDir = input.services.group.bottomDirections[0];
    if (lowDir && lowDir.fillPct < 40) {
      out.push({
        severity: 'info',
        title: 'Низкая заполняемость',
        body: `«${lowDir.title}» — заполняемость ${lowDir.fillPct}%.`,
        action: 'Пересмотрите расписание или промо',
      });
    }
    return out.slice(0, 8);
  }
}

function addDaysLocal(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Aggregate open installment schedules into Debitorka sub-metrics (amounts → minor). */
export function aggregateInstallments(
  rows: FitgoInstallmentSale[],
  now = new Date(),
): NonNullable<ClubAnalyticsMoney['installments']> {
  const { year, month, day } = minskParts(now);
  const todayIso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEndDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(monthEndDay).padStart(2, '0')}`;

  let dueThisMonth = 0;
  let soldTotal = 0;
  let overdue = 0;

  for (const row of rows) {
    soldTotal += Number(row.total || 0);
    for (const p of row.payments ?? []) {
      const planAmt = Number(p.planAmount || 0);
      const factAmt = Number(p.factAmount || 0);
      const paid = factAmt >= planAmt && planAmt > 0;
      if (paid) continue;
      const rem = Math.max(0, planAmt - factAmt);
      if (rem <= 0) continue;
      const planIso = String(p.planDate ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(planIso)) continue;
      if (planIso >= monthStart && planIso <= monthEnd) {
        dueThisMonth += rem;
      }
      if (planIso < todayIso) {
        overdue += rem;
      }
    }
  }

  return {
    dueThisMonthMinor: Math.round(dueThisMonth * 100),
    soldTotalMinor: Math.round(soldTotal * 100),
    overdueMinor: Math.round(overdue * 100),
  };
}
