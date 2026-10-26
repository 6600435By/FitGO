import { Injectable, Logger } from '@nestjs/common';
import type {
  MembershipClientRow,
  MembershipClientsReport,
  MembershipEconomicsSettings,
  MembershipEfficiencyBasis,
  MembershipEfficiencyReport,
  MembershipEfficiencyView,
  MembershipFamilyRow,
  MembershipTrainersReport,
  MembershipUtilizationSegment,
} from '@fitgo/shared-types';
import { membershipNameFromPaymentBasis } from '@fitgo/shared-types';
import { OnexClassKind, OnexClassMemberAttendance } from '@prisma/client';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { PrismaService } from '../prisma/prisma.service';
import { PayrollService } from '../payroll/payroll.service';
import { assertPeriod, metric, rangeBounds } from './analytics-period';
import {
  defaultMembershipEconomicsSettings,
  mergeMembershipSettings,
} from './membership-efficiency.defaults';
import {
  allocateRetailPrice,
  breakevenVisits,
  buildMembershipInsights,
  buildWaterfall,
  burnedValueMinor,
  computeCostBreakdown,
  daysBetween,
  familyStatus,
  gpCostPerVisit,
  isoDay,
  matchFamily,
  matchSaleToMembership,
  median,
  monthsBetween,
  netPaidMinor,
  normalizeName,
  parseMonthsFromTitle,
  parseStartFromBasis,
  quotasForTerm,
  toMinor,
  trainerPerVisit,
  utilizationIndex,
  utilizationSegment,
  visitDistributionBuckets,
  type SaleCandidate,
} from './membership-efficiency.helpers';

const REPORT_CACHE_TTL_MS = 10 * 60 * 1000;

interface MembershipVisitRow {
  packageDocId: string;
  clientExternalId: string;
  clientName: string;
  paymentBasis: string | null;
  packageValidUntil: string | null;
  kind: OnexClassKind;
  sessionExternalId: string;
  sessionTitle: string;
  sessionStart: Date;
  attendedCount: number;
  capacity: number | null;
  employeeExternalId: string | null;
  employeeName: string | null;
  roomTitle: string | null;
  unitPriceMinor: number | null;
  durationMin: number | null;
}

interface BuiltInstance {
  packageDocId: string;
  clientExternalId: string;
  clientName: string;
  familyId: string;
  familyLabel: string;
  productName: string;
  paidMinor: number;
  priceEstimated: boolean;
  startDate: string | null;
  endDate: string | null;
  months: number;
  gpVisits: number;
  gymVisits: number;
  massageUsed: number;
  solariumMinutesUsed: number;
  personalAccountSpentMinor: number;
  personalAccountBurnedMinor: number;
  massageQuota: number;
  solariumMinutesQuota: number;
  personalAccountCreditedMinor: number;
  accessGpMinor: number;
  accessGymMinor: number;
  trainerCostMinor: number;
  costTotalMinor: number;
  costMassageMinor: number;
  costSolariumMinor: number;
  costPaMinor: number;
  costOverheadMinor: number;
  gpCostPerVisitMinor: number | null;
  trainerPerVisitMinor: number | null;
  marginMinor: number;
  burnedMinor: number;
  segment: MembershipUtilizationSegment;
  lastVisitDate: string | null;
  gpSessionIds: string[];
  valueReceivedMinor: number;
}

@Injectable()
export class MembershipEfficiencyService {
  private readonly logger = new Logger(MembershipEfficiencyService.name);

  private readonly reportCache = new Map<
    string,
    { at: number; value: Promise<MembershipEfficiencyReport> }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly payroll: PayrollService,
  ) {}

  async getSettings(user: JwtPayload): Promise<MembershipEconomicsSettings> {
    const clubId = requireClubId(user);
    const row = await this.prisma.membershipEconomicsSettings.findUnique({
      where: { clubId },
    });
    return row
      ? mergeMembershipSettings(row.json)
      : defaultMembershipEconomicsSettings();
  }

  async putSettings(
    user: JwtPayload,
    body: Partial<MembershipEconomicsSettings>,
  ): Promise<MembershipEconomicsSettings> {
    const clubId = requireClubId(user);
    const current = await this.getSettings(user);
    const next = mergeMembershipSettings({ ...current, ...body });
    await this.prisma.membershipEconomicsSettings.upsert({
      where: { clubId },
      create: {
        clubId,
        json: next as object,
        updatedBy: user.sub,
      },
      update: {
        json: next as object,
        updatedBy: user.sub,
      },
    });
    this.reportCache.clear();
    return next;
  }

  async getReport(
    user: JwtPayload,
    params: {
      from: string;
      to: string;
      basis?: MembershipEfficiencyBasis;
      view?: MembershipEfficiencyView;
      family?: string | string[];
    },
  ): Promise<MembershipEfficiencyReport> {
    const clubId = requireClubId(user);
    assertPeriod(params.from, params.to);
    const basis = params.basis === 'active' ? 'active' : 'ended';
    const view = params.view === 'cost' ? 'cost' : 'retail';
    const familyFilter = normalizeFamilyFilter(params.family);
    const cacheKey = `${clubId}|${params.from}|${params.to}|${basis}|${view}|${familyFilter.join(',')}`;
    const cached = this.reportCache.get(cacheKey);
    if (cached && Date.now() - cached.at < REPORT_CACHE_TTL_MS) {
      return cached.value;
    }
    const value = this.computeReport(user, {
      from: params.from,
      to: params.to,
      basis,
      view,
      familyFilter,
    }).finally(() => {
      setTimeout(() => {
        const cur = this.reportCache.get(cacheKey);
        if (cur?.value === value) this.reportCache.delete(cacheKey);
      }, REPORT_CACHE_TTL_MS);
    });
    this.reportCache.set(cacheKey, { at: Date.now(), value });
    return value;
  }

  async getTrainersReport(
    user: JwtPayload,
    params: {
      from: string;
      to: string;
      basis?: MembershipEfficiencyBasis;
      family?: string | string[];
    },
  ): Promise<MembershipTrainersReport> {
    const clubId = requireClubId(user);
    assertPeriod(params.from, params.to);
    const basis = params.basis === 'active' ? 'active' : 'ended';
    const settings = await this.getSettings(user);
    const familyFilter = normalizeFamilyFilter(params.family);
    const built = await this.buildInstances(clubId, {
      from: params.from,
      to: params.to,
      basis,
      settings,
      familyFilter,
      asOf: params.to,
    });

    const earnings = built.earnings;
    const byTrainer = new Map<
      string,
      {
        name: string;
        sessions: Map<
          string,
          {
            title: string;
            attended: number;
            capacity: number | null;
            earnMinor: number;
            economicRevenueMinor: number;
            below: boolean;
          }
        >;
      }
    >();

    const gpCostByClientVisit = new Map<string, number>();
    for (const inst of built.instances) {
      const per = inst.gpCostPerVisitMinor;
      if (per == null) continue;
      for (const sid of inst.gpSessionIds) {
        gpCostByClientVisit.set(`${inst.clientExternalId}|${sid}`, per);
      }
    }

    const sessions = await this.prisma.onexClassSession.findMany({
      where: {
        clubId,
        kind: OnexClassKind.GROUP,
        status: 'COMPLETED',
        isActive: true,
        startAt: {
          gte: rangeBounds(params.from, params.to).start,
          lte: rangeBounds(params.from, params.to).end,
        },
      },
      include: {
        members: {
          where: {
            cancelled: false,
            attendance: OnexClassMemberAttendance.ATTENDED,
          },
        },
      },
    });

    const users = await this.prisma.user.findMany({
      where: { clubId, isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        externalId: true,
        employeeCode: true,
      },
    });
    const byExt = new Map<string, (typeof users)[0]>();
    for (const u of users) {
      if (u.externalId) byExt.set(u.externalId, u);
      if (u.employeeCode) byExt.set(u.employeeCode, u);
    }

    const clubBreakeven = median(
      built.instances
        .map((i) =>
          breakevenVisits(i.accessGpMinor, i.trainerPerVisitMinor),
        )
        .filter((n): n is number => n != null),
    );

    for (const s of sessions) {
      const earn = earnings.get(s.externalId);
      const trainerUserId =
        earn?.trainerUserId ??
        byExt.get(s.employeeExternalId ?? '')?.id ??
        'unknown';
      const trainerName =
        earn != null
          ? users.find((u) => u.id === earn.trainerUserId)
          : byExt.get(s.employeeExternalId ?? '');
      const name = trainerName
        ? `${trainerName.lastName} ${trainerName.firstName}`.trim()
        : s.employeeName ?? 'Без тренера';

      let economic = 0;
      for (const m of s.members) {
        const key = `${m.externalId}|${s.externalId}`;
        const fromAbon = gpCostByClientVisit.get(key);
        if (fromAbon != null) economic += fromAbon;
        else if (m.unitPriceMinor != null && m.unitPriceMinor > 0)
          economic += m.unitPriceMinor;
      }

      const attended = Math.max(s.attendedCount, s.members.length);
      const earnMinor = earn?.earnMinor ?? 0;
      const minPeople =
        clubBreakeven != null && earnMinor > 0 && attended > 0
          ? Math.ceil(
              (earnMinor / Math.max(1, attended)) /
                Math.max(1, (economic || 1) / Math.max(1, attended)),
            )
          : clubBreakeven;
      // Simpler below-breakeven: attended < club average breakeven people needed
      // Use: margin = economic - earn; below if margin < 0
      const below = economic < earnMinor;

      let bucket = byTrainer.get(trainerUserId);
      if (!bucket) {
        bucket = { name, sessions: new Map() };
        byTrainer.set(trainerUserId, bucket);
      }
      const classKey = s.title.trim() || 'Без названия';
      const prev = bucket.sessions.get(classKey);
      if (!prev) {
        bucket.sessions.set(classKey, {
          title: classKey,
          attended,
          capacity: s.capacity,
          earnMinor,
          economicRevenueMinor: economic,
          below,
        });
      } else {
        prev.attended += attended;
        prev.earnMinor += earnMinor;
        prev.economicRevenueMinor += economic;
        if (below) prev.below = true;
        if (s.capacity != null) {
          prev.capacity =
            (prev.capacity ?? 0) + s.capacity;
        }
      }
      // track session count via a side field — recreate with count
      const cur = bucket.sessions.get(classKey)!;
      (cur as { sessions?: number }).sessions =
        ((cur as { sessions?: number }).sessions ?? 0) + 1;
      void minPeople;
    }

    const trainers = [...byTrainer.entries()]
      .map(([trainerId, t]) => {
        const classes = [...t.sessions.values()].map((c) => {
          const sessions = (c as { sessions?: number }).sessions ?? 1;
          const avgAttended = sessions > 0 ? c.attended / sessions : 0;
          const avgFill =
            c.capacity != null && c.capacity > 0 && sessions > 0
              ? Math.round((c.attended / c.capacity) * 1000) / 10
              : null;
          const margin = c.economicRevenueMinor - c.earnMinor;
          return {
            title: c.title,
            sessions,
            avgAttended: Math.round(avgAttended * 10) / 10,
            avgFillPct: avgFill,
            earnMinor: c.earnMinor,
            economicRevenueMinor: c.economicRevenueMinor,
            marginMinor: margin,
            marginPerPersonMinor:
              c.attended > 0 ? Math.round(margin / c.attended) : null,
            belowBreakeven: c.below,
            minPeopleForBreakeven: clubBreakeven,
          };
        });
        const sessions = classes.reduce((a, c) => a + c.sessions, 0);
        const attended = classes.reduce(
          (a, c) => a + c.avgAttended * c.sessions,
          0,
        );
        const earnMinor = classes.reduce((a, c) => a + c.earnMinor, 0);
        const economic = classes.reduce(
          (a, c) => a + c.economicRevenueMinor,
          0,
        );
        const margin = economic - earnMinor;
        const belowN = classes.filter((c) => c.belowBreakeven).length;
        const fillVals = classes
          .map((c) => c.avgFillPct)
          .filter((x): x is number => x != null);
        return {
          trainerId,
          name: t.name,
          sessions,
          avgAttended:
            sessions > 0 ? Math.round((attended / sessions) * 10) / 10 : 0,
          avgFillPct: fillVals.length
            ? Math.round(
                (fillVals.reduce((a, b) => a + b, 0) / fillVals.length) * 10,
              ) / 10
            : null,
          earnMinor,
          economicRevenueMinor: economic,
          marginMinor: margin,
          marginPerPersonMinor:
            attended > 0 ? Math.round(margin / attended) : null,
          belowBreakevenShare:
            classes.length > 0
              ? Math.round((belowN / classes.length) * 1000) / 10
              : null,
          classes: classes.sort((a, b) => a.marginMinor - b.marginMinor),
        };
      })
      .sort((a, b) => a.marginMinor - b.marginMinor);

    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { currency: true },
    });
    return {
      from: params.from,
      to: params.to,
      basis,
      currency: club?.currency ?? 'BYN',
      trainers,
    };
  }

  async getClientsReport(
    user: JwtPayload,
    params: {
      from: string;
      to: string;
      basis?: MembershipEfficiencyBasis;
      family?: string | string[];
      segment?: MembershipUtilizationSegment | 'ALL';
      page?: number;
      pageSize?: number;
      sort?: string;
    },
  ): Promise<MembershipClientsReport> {
    const clubId = requireClubId(user);
    assertPeriod(params.from, params.to);
    const basis = params.basis === 'active' ? 'active' : 'ended';
    const settings = await this.getSettings(user);
    const familyFilter = normalizeFamilyFilter(params.family);
    const built = await this.buildInstances(clubId, {
      from: params.from,
      to: params.to,
      basis,
      settings,
      familyFilter,
      asOf: params.to,
    });

    let rows: MembershipClientRow[] = built.instances.map((i) => ({
      clientExternalId: i.clientExternalId,
      clientName: i.clientName,
      familyId: i.familyId,
      familyLabel: i.familyLabel,
      packageDocId: i.packageDocId,
      productName: i.productName,
      paidMinor: i.paidMinor,
      priceEstimated: i.priceEstimated,
      startDate: i.startDate,
      endDate: i.endDate,
      months: i.months,
      gpVisits: i.gpVisits,
      gymVisits: i.gymVisits,
      gpPerMonth:
        i.months > 0
          ? Math.round((i.gpVisits / i.months) * 10) / 10
          : i.gpVisits,
      segment: i.segment,
      massageUsed: i.massageUsed,
      massageQuota: i.massageQuota,
      solariumMinutesUsed: i.solariumMinutesUsed,
      solariumMinutesQuota: i.solariumMinutesQuota,
      personalAccountSpentMinor: i.personalAccountSpentMinor,
      personalAccountBurnedMinor: i.personalAccountBurnedMinor,
      valueReceivedMinor: i.valueReceivedMinor,
      burnedMinor: i.burnedMinor,
      gpCostPerVisitMinor: i.gpCostPerVisitMinor,
      trainerCostMinor: i.trainerCostMinor,
      marginMinor: i.marginMinor,
      lastVisitDate: i.lastVisitDate,
      endsWithin30d: i.endDate
        ? daysBetween(params.to, i.endDate) >= 0 &&
          daysBetween(params.to, i.endDate) <= 30
        : false,
    }));

    const bySegment: Record<MembershipUtilizationSegment, number> = {
      max: 0,
      normal: 0,
      under: 0,
      sleeping: 0,
    };
    for (const r of rows) bySegment[r.segment]++;

    if (params.segment && params.segment !== 'ALL') {
      rows = rows.filter((r) => r.segment === params.segment);
    }

    const sort = params.sort ?? 'gpPerMonth_desc';
    rows.sort((a, b) => {
      switch (sort) {
        case 'gpPerMonth_asc':
          return a.gpPerMonth - b.gpPerMonth;
        case 'burned_desc':
          return b.burnedMinor - a.burnedMinor;
        case 'margin_asc':
          return a.marginMinor - b.marginMinor;
        case 'end_asc':
          return (a.endDate ?? '').localeCompare(b.endDate ?? '');
        default:
          return b.gpPerMonth - a.gpPerMonth;
      }
    });

    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 50));
    const total = rows.length;
    const slice = rows.slice((page - 1) * pageSize, page * pageSize);

    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { currency: true },
    });
    return {
      from: params.from,
      to: params.to,
      basis,
      currency: club?.currency ?? 'BYN',
      total,
      page,
      pageSize,
      clients: slice,
      bySegment,
    };
  }

  async exportXlsx(
    user: JwtPayload,
    params: {
      from: string;
      to: string;
      basis?: MembershipEfficiencyBasis;
      view?: MembershipEfficiencyView;
      family?: string | string[];
    },
  ): Promise<Buffer> {
    const [report, trainers, clients] = await Promise.all([
      this.getReport(user, params),
      this.getTrainersReport(user, params),
      this.getClientsReport(user, {
        ...params,
        page: 1,
        pageSize: 100,
      }),
    ]);
    // fetch all clients pages
    const allClients = [...clients.clients];
    while (allClients.length < clients.total) {
      const next = await this.getClientsReport(user, {
        ...params,
        page: Math.floor(allClients.length / 100) + 1,
        pageSize: 100,
      });
      if (!next.clients.length) break;
      allClients.push(...next.clients);
      if (next.clients.length < 100) break;
    }

    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    const summary = wb.addWorksheet('Сводка');
    summary.addRow(['Период', report.from, report.to]);
    summary.addRow(['Базис', report.basis]);
    summary.addRow(['Экземпляров', report.instanceCount]);
    summary.addRow([]);
    summary.addRow([
      'Тип',
      'Кол-во',
      'Ср. цена',
      'ГП/мес',
      'Стоимость визита',
      'Тренер/визит',
      'Маржа %',
      'Сгорело',
    ]);
    for (const f of report.families) {
      summary.addRow([
        f.label,
        f.count,
        f.avgPaidMinor / 100,
        f.avgGpPerMonth,
        f.avgGpCostPerVisitMinor != null
          ? f.avgGpCostPerVisitMinor / 100
          : null,
        f.avgTrainerPerVisitMinor != null
          ? f.avgTrainerPerVisitMinor / 100
          : null,
        f.marginPct,
        f.burnedMinor / 100,
      ]);
    }

    const tr = wb.addWorksheet('Тренеры');
    tr.addRow([
      'Тренер',
      'Занятий',
      'Ср. людей',
      'Начисление',
      'Экон. выручка',
      'Маржа',
    ]);
    for (const t of trainers.trainers) {
      tr.addRow([
        t.name,
        t.sessions,
        t.avgAttended,
        t.earnMinor / 100,
        t.economicRevenueMinor / 100,
        t.marginMinor / 100,
      ]);
    }

    const cl = wb.addWorksheet('Клиенты');
    cl.addRow([
      'Клиент',
      'Тип',
      'Оплачено',
      'ГП',
      'ГП/мес',
      'Сегмент',
      'Сгорело',
      'Маржа',
      'Окончание',
    ]);
    for (const c of allClients) {
      cl.addRow([
        c.clientName,
        c.familyLabel,
        c.paidMinor / 100,
        c.gpVisits,
        c.gpPerMonth,
        c.segment,
        c.burnedMinor / 100,
        c.marginMinor / 100,
        c.endDate,
      ]);
    }

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  private async computeReport(
    user: JwtPayload,
    params: {
      from: string;
      to: string;
      basis: MembershipEfficiencyBasis;
      view: MembershipEfficiencyView;
      familyFilter: string[];
    },
  ): Promise<MembershipEfficiencyReport> {
    const clubId = requireClubId(user);
    const settings = await this.getSettings(user);
    const built = await this.buildInstances(clubId, {
      from: params.from,
      to: params.to,
      basis: params.basis,
      settings,
      familyFilter: params.familyFilter,
      asOf: params.to,
    });
    const instances = built.instances;
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { currency: true },
    });

    const byFamily = new Map<string, BuiltInstance[]>();
    for (const i of instances) {
      const list = byFamily.get(i.familyId) ?? [];
      list.push(i);
      byFamily.set(i.familyId, list);
    }

    const families: MembershipFamilyRow[] = [];
    for (const [familyId, list] of byFamily) {
      const label = list[0]?.familyLabel ?? familyId;
      const count = list.length;
      const avgPaid = avg(list.map((x) => x.paidMinor));
      const avgMonths = avg(list.map((x) => x.months));
      const avgGpPerMonth = avg(
        list.map((x) => (x.months > 0 ? x.gpVisits / x.months : x.gpVisits)),
      );
      const avgGymPerMonth = avg(
        list.map((x) => (x.months > 0 ? x.gymVisits / x.months : x.gymVisits)),
      );
      const gpCosts = list
        .map((x) => x.gpCostPerVisitMinor)
        .filter((x): x is number => x != null);
      const trainerCosts = list
        .map((x) => x.trainerPerVisitMinor)
        .filter((x): x is number => x != null);
      const margins = list.map((x) => x.marginMinor);
      const paidSum = list.reduce((a, x) => a + x.paidMinor, 0);
      const marginSum = margins.reduce((a, b) => a + b, 0);
      const marginPct =
        paidSum > 0 ? Math.round((marginSum / paidSum) * 1000) / 10 : null;
      const massageUse = avgPct(
        list.map((x) =>
          x.massageQuota > 0 ? x.massageUsed / x.massageQuota : null,
        ),
      );
      const solUse = avgPct(
        list.map((x) =>
          x.solariumMinutesQuota > 0
            ? x.solariumMinutesUsed / x.solariumMinutesQuota
            : null,
        ),
      );
      const paUse = avgPct(
        list.map((x) =>
          x.personalAccountCreditedMinor > 0
            ? x.personalAccountSpentMinor / x.personalAccountCreditedMinor
            : null,
        ),
      );
      const burned = list.reduce((a, x) => a + x.burnedMinor, 0);
      const burnedPct =
        paidSum > 0 ? Math.round((burned / paidSum) * 1000) / 10 : null;
      const be = median(
        list
          .map((x) =>
            breakevenVisits(x.accessGpMinor, x.trainerPerVisitMinor),
          )
          .filter((x): x is number => x != null),
      );
      const avgGpCost = gpCosts.length ? avg(gpCosts) : null;
      const avgTrainer = trainerCosts.length ? avg(trainerCosts) : null;
      families.push({
        familyId,
        label,
        count,
        avgPaidMinor: Math.round(avgPaid),
        avgMonths: Math.round(avgMonths * 10) / 10,
        avgGpPerMonth: Math.round(avgGpPerMonth * 10) / 10,
        avgGymPerMonth: Math.round(avgGymPerMonth * 10) / 10,
        avgGpCostPerVisitMinor:
          avgGpCost != null ? Math.round(avgGpCost) : null,
        avgTrainerPerVisitMinor:
          avgTrainer != null ? Math.round(avgTrainer) : null,
        avgMarginPerVisitMinor:
          avgGpCost != null && avgTrainer != null
            ? Math.round(avgGpCost - avgTrainer)
            : null,
        marginPct,
        massageUsePct: massageUse,
        solariumUsePct: solUse,
        personalAccountUsePct: paUse,
        burnedMinor: burned,
        burnedPctOfPaid: burnedPct,
        breakevenVisits: be,
        status: familyStatus(marginPct, burnedPct),
      });
    }
    families.sort((a, b) => b.count - a.count);

    const paidSum = instances.reduce((a, x) => a + x.paidMinor, 0);
    const trainerSum = instances.reduce((a, x) => a + x.trainerCostMinor, 0);
    const massageCostSum = instances.reduce(
      (a, x) => a + x.costMassageMinor,
      0,
    );
    const solCostSum = instances.reduce((a, x) => a + x.costSolariumMinor, 0);
    const paCostSum = instances.reduce((a, x) => a + x.costPaMinor, 0);
    const overheadSum = instances.reduce(
      (a, x) => a + x.costOverheadMinor,
      0,
    );
    const burnedSum = instances.reduce((a, x) => a + x.burnedMinor, 0);
    const gpVisitsSum = instances.reduce((a, x) => a + x.gpVisits, 0);
    const accessGpSum = instances.reduce((a, x) => a + x.accessGpMinor, 0);

    const waterfall = buildWaterfall({
      paidMinor: paidSum,
      trainerMinor: trainerSum,
      massageMinor: massageCostSum,
      solariumMinor: solCostSum,
      personalAccountCogsMinor: paCostSum,
      overheadMinor: overheadSum,
    });

    const servicePromise = [
      {
        key: 'gp' as const,
        label: 'ГП (доступ)',
        promisedMinor: accessGpSum,
        usedMinor: accessGpSum,
        burnedMinor: 0,
      },
      {
        key: 'gym' as const,
        label: 'Зал (доступ)',
        promisedMinor: instances.reduce((a, x) => a + x.accessGymMinor, 0),
        usedMinor: instances.reduce((a, x) => a + x.accessGymMinor, 0),
        burnedMinor: 0,
      },
      {
        key: 'massage' as const,
        label: 'Массаж',
        promisedMinor: instances.reduce(
          (a, x) =>
            a +
            x.massageQuota *
              (settings.massageRetailMinor ??
                built.derived.massageRetailMinor),
          0,
        ),
        usedMinor: instances.reduce(
          (a, x) =>
            a +
            x.massageUsed *
              (settings.massageRetailMinor ??
                built.derived.massageRetailMinor),
          0,
        ),
        burnedMinor: instances.reduce(
          (a, x) =>
            a +
            Math.max(0, x.massageQuota - x.massageUsed) *
              (settings.massageRetailMinor ??
                built.derived.massageRetailMinor),
          0,
        ),
      },
      {
        key: 'solarium' as const,
        label: 'Солярий',
        promisedMinor: instances.reduce(
          (a, x) =>
            a +
            x.solariumMinutesQuota *
              (settings.solariumMinuteRetailMinor ??
                built.derived.solariumMinuteRetailMinor),
          0,
        ),
        usedMinor: instances.reduce(
          (a, x) =>
            a +
            x.solariumMinutesUsed *
              (settings.solariumMinuteRetailMinor ??
                built.derived.solariumMinuteRetailMinor),
          0,
        ),
        burnedMinor: instances.reduce(
          (a, x) =>
            a +
            Math.max(0, x.solariumMinutesQuota - x.solariumMinutesUsed) *
              (settings.solariumMinuteRetailMinor ??
                built.derived.solariumMinuteRetailMinor),
          0,
        ),
      },
      {
        key: 'personalAccount' as const,
        label: 'Лицевой счёт',
        promisedMinor: instances.reduce(
          (a, x) => a + x.personalAccountCreditedMinor,
          0,
        ),
        usedMinor: instances.reduce(
          (a, x) => a + x.personalAccountSpentMinor,
          0,
        ),
        burnedMinor: instances.reduce(
          (a, x) => a + x.personalAccountBurnedMinor,
          0,
        ),
      },
    ];

    const gpPerMonthValues = instances.map((x) =>
      x.months > 0 ? x.gpVisits / x.months : x.gpVisits,
    );
    const visitDistribution = visitDistributionBuckets(gpPerMonthValues);
    const be = median(
      instances
        .map((x) =>
          breakevenVisits(x.accessGpMinor, x.trainerPerVisitMinor),
        )
        .filter((x): x is number => x != null),
    );

    const avgPaid = instances.length ? paidSum / instances.length : 0;
    const avgGpMonth = instances.length
      ? gpPerMonthValues.reduce((a, b) => a + b, 0) / instances.length
      : 0;
    const gpCost =
      gpVisitsSum > 0 ? Math.round(accessGpSum / gpVisitsSum) : null;
    const trainerPv =
      gpVisitsSum > 0 ? Math.round(trainerSum / gpVisitsSum) : null;
    const marginPv =
      gpCost != null && trainerPv != null ? gpCost - trainerPv : null;

    const dq = built.dataQuality;
    const warning =
      dq.packageDocCoverage < 0.8 || dq.saleMatchCoverage < 0.8
        ? `Покрытие packageDocId ${Math.round(dq.packageDocCoverage * 100)}%, продаж ${Math.round(dq.saleMatchCoverage * 100)}%. Цифры оценочные.`
        : null;

    const insightFamilies = families.map((f) => {
      const list = byFamily.get(f.familyId) ?? [];
      const under = list.filter(
        (x) => x.segment === 'under' || x.segment === 'sleeping',
      ).length;
      const paBurn = list.reduce((a, x) => a + x.personalAccountBurnedMinor, 0);
      const paCred = list.reduce(
        (a, x) => a + x.personalAccountCreditedMinor,
        0,
      );
      return {
        label: f.label,
        count: f.count,
        underOrSleepingShare: list.length ? under / list.length : 0,
        personalAccountBurnPct: paCred > 0 ? paBurn / paCred : null,
        marginPct: f.marginPct,
      };
    });

    const insights = buildMembershipInsights({
      families: insightFamilies,
      lowFillClassTitles: [],
      dataQualityWarning: warning,
    });

    return {
      from: params.from,
      to: params.to,
      basis: params.basis,
      view: params.view,
      currency: club?.currency ?? 'BYN',
      instanceCount: instances.length,
      kpis: {
        avgPaidMinor: metric(Math.round(avgPaid), null, {
          unit: 'money',
          hint: 'Средняя оплата экземпляра абонемента за период',
          skipCompare: true,
        }),
        avgGpPerMonth: metric(Math.round(avgGpMonth * 10) / 10, null, {
          unit: 'count',
          hint: 'Среднее число посещений ГП в месяц на абонемент',
          skipCompare: true,
        }),
        gpCostPerVisitMinor: metric(gpCost ?? 0, null, {
          unit: 'money',
          hint: 'Доля «доступа» на ГП / число посещений ГП',
          unavailable: gpCost == null,
          skipCompare: true,
        }),
        trainerPerVisitMinor: metric(trainerPv ?? 0, null, {
          unit: 'money',
          hint: 'Начисление тренеру за занятие / число посетивших, среднее',
          unavailable: trainerPv == null,
          skipCompare: true,
        }),
        marginPerVisitMinor: metric(marginPv ?? 0, null, {
          unit: 'money',
          hint: 'Стоимость визита минус оплата тренеру на человека',
          unavailable: marginPv == null,
          skipCompare: true,
        }),
        burnedMinor: metric(burnedSum, null, {
          unit: 'money',
          hint: 'Сгоревший ЛС + неиспользованные квоты по прайсу',
          skipCompare: true,
        }),
      },
      families,
      waterfall,
      servicePromise,
      visitDistribution,
      breakevenVisits: be,
      insights,
      dataQuality: { ...dq, warning },
      settings,
    };
  }

  private async buildInstances(
    clubId: string,
    params: {
      from: string;
      to: string;
      basis: MembershipEfficiencyBasis;
      settings: MembershipEconomicsSettings;
      familyFilter: string[];
      asOf: string;
    },
  ): Promise<{
    instances: BuiltInstance[];
    earnings: Map<
      string,
      {
        earnMinor: number;
        quantity: number;
        title: string;
        trainerUserId: string;
        occurredAt: string;
        roomTitle?: string;
        sessionKey: string;
      }
    >;
    dataQuality: {
      packageDocCoverage: number;
      saleMatchCoverage: number;
      personalAccountCoverage: number;
    };
    derived: {
      massageRetailMinor: number;
      solariumMinuteRetailMinor: number;
      massageCostMinor: number;
      solariumMinuteCostMinor: number;
    };
  }> {
    const settings = params.settings;
    const families = settings.families.filter(
      (f) =>
        params.familyFilter.length === 0 ||
        params.familyFilter.includes(f.id),
    );
    if (!families.length) {
      return {
        instances: [],
        earnings: new Map(),
        dataQuality: {
          packageDocCoverage: 1,
          saleMatchCoverage: 1,
          personalAccountCoverage: 1,
        },
        derived: {
          massageRetailMinor: 4000,
          solariumMinuteRetailMinor: 50,
          massageCostMinor: 1500,
          solariumMinuteCostMinor: 10,
        },
      };
    }

    // Broad window: memberships ending in period may have started earlier.
    const lookbackFrom = addYears(params.from, -2);
    const bounds = rangeBounds(lookbackFrom, params.to);

    const [members, hallVisits, sales, paRows, earnings, retailPrices] =
      await Promise.all([
        this.prisma.onexClassSessionMember.findMany({
          where: {
            cancelled: false,
            attendance: OnexClassMemberAttendance.ATTENDED,
            session: {
              clubId,
              isActive: true,
              kind: {
                in: [
                  OnexClassKind.GROUP,
                  OnexClassKind.SPA,
                  OnexClassKind.SOLARIUM,
                ],
              },
              startAt: { gte: bounds.start, lte: bounds.end },
            },
          },
          select: {
            packageDocId: true,
            externalId: true,
            clientName: true,
            paymentBasis: true,
            packageValidUntil: true,
            unitPriceMinor: true,
            session: {
              select: {
                externalId: true,
                kind: true,
                title: true,
                startAt: true,
                attendedCount: true,
                capacity: true,
                employeeExternalId: true,
                employeeName: true,
                roomTitle: true,
                durationMin: true,
              },
            },
          },
        }),
        this.prisma.clubHallVisit.findMany({
          where: {
            clubId,
            isActive: true,
            visitDate: { gte: lookbackFrom, lte: params.to },
          },
          select: {
            clientExternalId: true,
            visitDate: true,
          },
        }),
        this.prisma.clubRevenueEntry.findMany({
          where: {
            clubId,
            isActive: true,
            saleType: 'membership',
            occurredAt: {
              gte: rangeBounds(lookbackFrom, params.to).start,
              lte: rangeBounds(lookbackFrom, params.to).end,
            },
          },
          select: {
            productName: true,
            paidAmount: true,
            saleAmount: true,
            refundAmount: true,
            occurredAt: true,
            clientExternalId: true,
            clientName: true,
          },
        }),
        this.prisma.clubRevenueEntry.findMany({
          where: {
            clubId,
            isActive: true,
            OR: [
              { operationType: 'personal_credit' },
              { operationType: 'personal_burn' },
              { personalAccount: { gt: 0 } },
            ],
            occurredAt: {
              gte: rangeBounds(lookbackFrom, params.to).start,
              lte: rangeBounds(lookbackFrom, params.to).end,
            },
          },
          select: {
            operationType: true,
            amount: true,
            personalAccount: true,
            occurredAt: true,
            clientExternalId: true,
          },
        }),
        this.payroll
          .listGroupSessionEarningsForClub(clubId, lookbackFrom, params.to)
          .catch((err) => {
            this.logger.warn(
              `group earnings unavailable: ${err instanceof Error ? err.message : err}`,
            );
            return new Map();
          }),
        this.deriveRetailPrices(clubId, params.from, params.to),
      ]);

    const massageRetail =
      settings.massageRetailMinor ?? retailPrices.massageRetailMinor;
    const solariumMinuteRetail =
      settings.solariumMinuteRetailMinor ??
      retailPrices.solariumMinuteRetailMinor;
    const massageCost =
      settings.massageCostMinor ?? retailPrices.massageCostMinor;
    const solariumMinuteCost =
      settings.solariumMinuteCostMinor ??
      retailPrices.solariumMinuteCostMinor;

    let groupAttended = 0;
    let groupWithPkg = 0;
    const visits: MembershipVisitRow[] = [];
    for (const m of members) {
      if (m.session.kind === OnexClassKind.GROUP) {
        groupAttended++;
        if (m.packageDocId) groupWithPkg++;
      }
      if (!m.packageDocId) continue;
      const family = matchFamily(m.paymentBasis, families);
      if (!family) continue;
      visits.push({
        packageDocId: m.packageDocId,
        clientExternalId: m.externalId,
        clientName: m.clientName,
        paymentBasis: m.paymentBasis,
        packageValidUntil: m.packageValidUntil,
        kind: m.session.kind,
        sessionExternalId: m.session.externalId,
        sessionTitle: m.session.title,
        sessionStart: m.session.startAt,
        attendedCount: m.session.attendedCount,
        capacity: m.session.capacity,
        employeeExternalId: m.session.employeeExternalId,
        employeeName: m.session.employeeName,
        roomTitle: m.session.roomTitle,
        unitPriceMinor: m.unitPriceMinor,
        durationMin: m.session.durationMin,
      });
    }

    const byPkg = new Map<string, MembershipVisitRow[]>();
    for (const v of visits) {
      const list = byPkg.get(v.packageDocId) ?? [];
      list.push(v);
      byPkg.set(v.packageDocId, list);
    }

    const saleCandidates: SaleCandidate[] = sales.map((s) => ({
      productName: s.productName,
      paidAmount: s.paidAmount,
      saleAmount: s.saleAmount,
      refundAmount: s.refundAmount,
      occurredAt: s.occurredAt,
      clientExternalId: s.clientExternalId,
      clientName: s.clientName,
    }));

    const familyMedians = new Map<string, number>();
    for (const f of families) {
      const amounts = saleCandidates
        .filter((s) => matchFamily(s.productName, [f]))
        .map((s) => netPaidMinor(s))
        .filter((n) => n > 0);
      const med = median(amounts);
      if (med != null) familyMedians.set(f.id, med);
    }

    // Hall visit days by client
    const hallByClient = new Map<string, Set<string>>();
    for (const h of hallVisits) {
      if (!h.clientExternalId) continue;
      const set = hallByClient.get(h.clientExternalId) ?? new Set();
      set.add(h.visitDate);
      hallByClient.set(h.clientExternalId, set);
    }

    const paByClient = new Map<
      string,
      { credit: number; burn: number; spent: number; rows: typeof paRows }
    >();
    for (const r of paRows) {
      if (!r.clientExternalId) continue;
      const cur = paByClient.get(r.clientExternalId) ?? {
        credit: 0,
        burn: 0,
        spent: 0,
        rows: [],
      };
      cur.rows.push(r);
      if (r.operationType === 'personal_credit') {
        cur.credit += Math.abs(toMinor(r.amount));
      } else if (r.operationType === 'personal_burn') {
        cur.burn += Math.abs(toMinor(r.amount));
      }
      if ((r.personalAccount ?? 0) > 0) {
        cur.spent += toMinor(r.personalAccount);
      }
      paByClient.set(r.clientExternalId, cur);
    }

    const instances: BuiltInstance[] = [];
    let saleMatched = 0;
    let paCovered = 0;
    let paEligible = 0;

    for (const [packageDocId, pkgVisits] of byPkg) {
      const first = pkgVisits[0]!;
      const family = matchFamily(first.paymentBasis, families);
      if (!family) continue;

      const endDate =
        isoDay(first.packageValidUntil) ??
        isoDay(
          pkgVisits
            .map((v) => v.packageValidUntil)
            .filter(Boolean)
            .sort()
            .at(-1) ?? null,
        );
      const startFromBasis = parseStartFromBasis(first.paymentBasis);
      const firstVisit = isoDay(
        [...pkgVisits].sort(
          (a, b) => a.sessionStart.getTime() - b.sessionStart.getTime(),
        )[0]!.sessionStart,
      );
      const startDate = startFromBasis ?? firstVisit;

      if (params.basis === 'ended') {
        if (!endDate || endDate < params.from || endDate > params.to) continue;
      } else {
        // active: still valid as of `to`
        if (endDate && endDate < params.asOf) continue;
        if (startDate && startDate > params.to) continue;
      }

      const productName =
        membershipNameFromPaymentBasis(first.paymentBasis) ??
        first.paymentBasis ??
        family.label;
      const monthsFromDates =
        startDate && endDate ? monthsBetween(startDate, endDate) : null;
      const months = Math.max(
        1,
        monthsFromDates ??
          parseMonthsFromTitle(productName, family.defaultMonths),
      );

      const matched = matchSaleToMembership({
        clientExternalId: first.clientExternalId,
        family,
        startDate,
        sales: saleCandidates,
      });
      let paidMinor: number;
      let priceEstimated = false;
      if (matched) {
        paidMinor = netPaidMinor(matched.sale);
        priceEstimated = matched.estimated;
        saleMatched++;
      } else {
        paidMinor = familyMedians.get(family.id) ?? 0;
        priceEstimated = true;
      }

      const gpVisits = pkgVisits.filter(
        (v) => v.kind === OnexClassKind.GROUP,
      );
      const spaVisits = pkgVisits.filter((v) => v.kind === OnexClassKind.SPA);
      const solVisits = pkgVisits.filter(
        (v) => v.kind === OnexClassKind.SOLARIUM,
      );

      const gpDays = new Set(
        gpVisits.map((v) => isoDay(v.sessionStart)!).filter(Boolean),
      );
      const spaDays = new Set(
        [...spaVisits, ...solVisits]
          .map((v) => isoDay(v.sessionStart)!)
          .filter(Boolean),
      );
      const hallDays = hallByClient.get(first.clientExternalId) ?? new Set();
      let gymVisits = 0;
      for (const d of hallDays) {
        if (startDate && d < startDate) continue;
        if (endDate && d > endDate) continue;
        if (gpDays.has(d) || spaDays.has(d)) continue;
        gymVisits++;
      }

      const quotas = quotasForTerm(family, months);
      const massageUsed = spaVisits.length;
      const solariumMinutesUsed = solVisits.reduce(
        (a, v) => a + (v.durationMin && v.durationMin > 0 ? v.durationMin : 10),
        0,
      );

      const pa = paByClient.get(first.clientExternalId);
      let personalAccountSpentMinor = 0;
      let personalAccountBurnedMinor = 0;
      let personalAccountCreditedMinor = quotas.personalAccountCreditedMinor;
      if (family.personalAccountPerMonthMajor > 0) {
        paEligible++;
        if (pa) {
          paCovered++;
          // Filter PA rows roughly to membership window
          for (const r of pa.rows) {
            const day = isoDay(r.occurredAt);
            if (!day) continue;
            if (startDate && day < startDate) continue;
            if (endDate && day > endDate) continue;
            if (r.operationType === 'personal_credit') {
              // keep settings-based credit as promised; track actual separately
            } else if (r.operationType === 'personal_burn') {
              personalAccountBurnedMinor += Math.abs(toMinor(r.amount));
            }
            if ((r.personalAccount ?? 0) > 0) {
              personalAccountSpentMinor += toMinor(r.personalAccount);
            }
          }
          if (pa.credit > 0) {
            personalAccountCreditedMinor = Math.max(
              personalAccountCreditedMinor,
              // only credits in window already summed into spent path; use settings default
              quotas.personalAccountCreditedMinor,
            );
          }
        }
        // If no burn recorded but membership ended, estimate burn = credit - spent
        if (
          params.basis === 'ended' &&
          personalAccountBurnedMinor === 0 &&
          personalAccountCreditedMinor > personalAccountSpentMinor
        ) {
          personalAccountBurnedMinor =
            personalAccountCreditedMinor - personalAccountSpentMinor;
        }
      }

      const alloc = allocateRetailPrice({
        paidMinor,
        months,
        family,
        massageRetailMinor: massageRetail,
        solariumMinuteRetailMinor: solariumMinuteRetail,
        gpVisits: gpVisits.length,
        gymVisits,
      });

      let trainerCostMinor = 0;
      const gpSessionIds: string[] = [];
      for (const v of gpVisits) {
        gpSessionIds.push(v.sessionExternalId);
        const earn = earnings.get(v.sessionExternalId);
        if (!earn || earn.quantity <= 0) continue;
        trainerCostMinor += Math.round(earn.earnMinor / earn.quantity);
      }

      const cost = computeCostBreakdown({
        trainerMinor: trainerCostMinor,
        massageUsed,
        massageCostMinor: massageCost,
        solariumMinutesUsed,
        solariumMinuteCostMinor: solariumMinuteCost,
        personalAccountSpentMinor,
        personalAccountCogsShare: settings.personalAccountCogsShare,
        visitCount: gpVisits.length + gymVisits,
        overheadPerVisitMinor: settings.overheadPerVisitMinor,
      });

      const gpCost = gpCostPerVisit(alloc.accessGpMinor, gpVisits.length);
      const trPer = trainerPerVisit(trainerCostMinor, gpVisits.length);
      const burned = burnedValueMinor({
        personalAccountBurnedMinor,
        massageQuota: quotas.massageQuota,
        massageUsed,
        massageRetailMinor: massageRetail,
        solariumMinutesQuota: quotas.solariumMinutesQuota,
        solariumMinutesUsed,
        solariumMinuteRetailMinor: solariumMinuteRetail,
      });

      const lastVisitDate =
        [...gpDays, ...spaDays].sort().at(-1) ??
        [...hallDays].filter((d) => !startDate || d >= startDate).sort().at(-1) ??
        null;
      const daysSince = lastVisitDate
        ? daysBetween(lastVisitDate, params.asOf)
        : 999;
      const idx = utilizationIndex(
        gpVisits.length,
        months,
        settings.normVisitsPerWeek,
      );
      const segment = utilizationSegment(
        idx,
        settings.segmentThresholds,
        daysSince,
        settings.sleepingDays,
      );

      const valueReceived =
        gpVisits.length * (gpCost ?? 0) +
        massageUsed * massageRetail +
        solariumMinutesUsed * solariumMinuteRetail +
        personalAccountSpentMinor;

      instances.push({
        packageDocId,
        clientExternalId: first.clientExternalId,
        clientName: first.clientName,
        familyId: family.id,
        familyLabel: family.label,
        productName,
        paidMinor,
        priceEstimated,
        startDate,
        endDate,
        months,
        gpVisits: gpVisits.length,
        gymVisits,
        massageUsed,
        solariumMinutesUsed,
        personalAccountSpentMinor,
        personalAccountBurnedMinor,
        massageQuota: quotas.massageQuota,
        solariumMinutesQuota: quotas.solariumMinutesQuota,
        personalAccountCreditedMinor,
        accessGpMinor: alloc.accessGpMinor,
        accessGymMinor: alloc.accessGymMinor,
        trainerCostMinor,
        costTotalMinor: cost.totalMinor,
        costMassageMinor: cost.massageMinor,
        costSolariumMinor: cost.solariumMinor,
        costPaMinor: cost.personalAccountCogsMinor,
        costOverheadMinor: cost.overheadMinor,
        gpCostPerVisitMinor: gpCost,
        trainerPerVisitMinor: trPer,
        marginMinor: paidMinor - cost.totalMinor,
        burnedMinor: burned,
        segment,
        lastVisitDate,
        gpSessionIds,
        valueReceivedMinor: valueReceived,
      });
    }

    return {
      instances,
      earnings,
      dataQuality: {
        packageDocCoverage:
          groupAttended > 0 ? groupWithPkg / groupAttended : 1,
        saleMatchCoverage:
          instances.length > 0 ? saleMatched / instances.length : 1,
        personalAccountCoverage:
          paEligible > 0 ? paCovered / paEligible : 1,
      },
      derived: {
        massageRetailMinor: massageRetail,
        solariumMinuteRetailMinor: solariumMinuteRetail,
        massageCostMinor: massageCost,
        solariumMinuteCostMinor: solariumMinuteCost,
      },
    };
  }

  private async deriveRetailPrices(
    clubId: string,
    from: string,
    to: string,
  ): Promise<{
    massageRetailMinor: number;
    solariumMinuteRetailMinor: number;
    massageCostMinor: number;
    solariumMinuteCostMinor: number;
  }> {
    const bounds = rangeBounds(addYears(from, -1), to);
    const rows = await this.prisma.clubRevenueEntry.findMany({
      where: {
        clubId,
        isActive: true,
        saleType: { in: ['massage', 'solarium', 'service'] },
        occurredAt: { gte: bounds.start, lte: bounds.end },
        amount: { gt: 0 },
      },
      select: {
        saleType: true,
        productName: true,
        amount: true,
        saleAmount: true,
      },
      take: 500,
    });
    const massage: number[] = [];
    const solarium: number[] = [];
    for (const r of rows) {
      const name = normalizeName(r.productName ?? '');
      const minor = toMinor(r.saleAmount || r.amount);
      if (minor <= 0) continue;
      if (r.saleType === 'massage' || name.includes('массаж')) {
        massage.push(minor);
      } else if (r.saleType === 'solarium' || name.includes('соляр')) {
        solarium.push(minor);
      }
    }
    const massageRetail = median(massage) ?? 4000;
    const solSession = median(solarium) ?? 1500;
    return {
      massageRetailMinor: Math.round(massageRetail),
      solariumMinuteRetailMinor: Math.round(solSession / 10),
      massageCostMinor: Math.round(massageRetail * 0.4),
      solariumMinuteCostMinor: Math.max(5, Math.round(solSession / 50)),
    };
  }
}

function normalizeFamilyFilter(
  family?: string | string[],
): string[] {
  if (!family) return [];
  const arr = Array.isArray(family) ? family : family.split(',');
  return arr.map((s) => s.trim()).filter(Boolean);
}

function avg(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function avgPct(vals: Array<number | null>): number | null {
  const xs = vals.filter((v): v is number => v != null && Number.isFinite(v));
  if (!xs.length) return null;
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) / 10;
}

function addYears(iso: string, years: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
