import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type {
  GroupRoomKey,
  MembershipClientRow,
  MembershipClientsReport,
  MembershipCostBreakdown,
  MembershipDataQuality,
  MembershipDiscountRow,
  MembershipDiscountsReport,
  MembershipEconomicsSettings,
  MembershipEfficiencyBasis,
  MembershipEfficiencyReport,
  MembershipEfficiencyView,
  MembershipFamilyConfig,
  MembershipFamilyRow,
  MembershipPayrollHints,
  MembershipProductCatalogRow,
  MembershipProductDetail,
  MembershipProductProfileDto,
  MembershipProductsReport,
  MembershipScenarioResult,
  MembershipServicePromiseRow,
  MembershipTrainerEfficiencyRow,
  MembershipTrainersReport,
  MembershipUtilizationSegment,
  StaffPayProfile,
  StaffPayTrackSlice,
} from "@fitgo/shared-types";
import {
  allPaySlices,
  DEFAULT_GROUP_RATE_TIERS,
  DEFAULT_REFORMER_RATE_TIERS,
  membershipNameFromPaymentBasis,
  resolveGroupRoomKey,
  resolveGroupSessionRateMinor,
} from "@fitgo/shared-types";
import type { MembershipProductProfile, Prisma } from "@prisma/client";
import { OnexClassKind, OnexClassMemberAttendance } from "@prisma/client";
import { preferredSaleBasisId } from "../admin-sales/payment-basis-products";
import type { JwtPayload } from "../auth/jwt.strategy";
import { requireClubId } from "../auth/require-club-id";
import { PayrollService } from "../payroll/payroll.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  addDaysIso,
  assertPeriod,
  metric,
  rangeBounds,
} from "./analytics-period";
/** Payroll rejects periods longer than 31 days — chunk earnings fetches. */
const EARNINGS_CHUNK_DAYS = 31;
import {
  defaultMembershipEconomicsSettings,
  emptyPayrollHints,
  inferGroupLabel,
  mergeMembershipSettings,
} from "./membership-efficiency.defaults";
import {
  addMonthsIso,
  allocatePriceFromProfile,
  allocateRetailPrice,
  breakevenVisits,
  buildMembershipInsights,
  buildScenarioResults,
  buildWaterfall,
  burnedValueMinor,
  classifyPackServiceName,
  computeFullCostBreakdown,
  daysBetween,
  familyStatus,
  gpCostPerVisit,
  isoDay,
  matchFamily,
  median,
  monthsBetween,
  normalizeName,
  parseMonthsFromTitle,
  parseStartFromBasis,
  productStatus,
  profileCompositionComplete,
  quotasForTerm,
  quotasFromProfile,
  toMinor,
  trainerPerVisit,
  utilizationIndex,
  utilizationSegment,
  visitDistributionBuckets,
} from "./membership-efficiency.helpers";

const REPORT_CACHE_TTL_MS = 10 * 60 * 1000;
const ENSURE_PROFILES_TTL_MS = 5 * 60 * 1000;
/** Visits / PA / sales are read this many years before `from`. */
const LOOKBACK_YEARS = 2;
const MINSK_OFFSET_MS = 3 * 60 * 60 * 1000;
/** Tiers used to estimate / marginalise trainer pay when no earn row exists. */
const ESTIMATE_TIERS = [
  ...DEFAULT_GROUP_RATE_TIERS,
  ...DEFAULT_REFORMER_RATE_TIERS,
];
/** Profile fields whose auto-fill needs a human confirmation. */
const REVIEW_FIELDS = new Set<string>([
  "termMonths",
  "accessGp",
  "accessGym",
  "ptIncluded",
  "massageIncluded",
  "bodyCompositionIncluded",
  "solariumMinutes",
  "personalAccountCreditMinor",
]);
const BODY_TITLE_RE = /состав|inbody|инбоди|биоимпеданс/i;

const PROFILE_EDITABLE_FIELDS = [
  "name",
  "groupLabel",
  "termMonths",
  "accessGp",
  "accessGym",
  "gpVisitsLimit",
  "ptIncluded",
  "massageIncluded",
  "bodyCompositionIncluded",
  "solariumMinutes",
  "personalAccountCreditMinor",
  "retailPriceOverrideMinor",
  "excluded",
] as const;
type ProfileEditableField = (typeof PROFILE_EDITABLE_FIELDS)[number];

export type MembershipProductProfilePatch = Partial<
  Pick<MembershipProductProfileDto, ProfileEditableField>
>;

// ── Internal types ──────────────────────────────────────────────────────────

type EarningsMap = Map<
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

interface VisitRow {
  packageDocId: string | null;
  clientExternalId: string;
  clientName: string;
  paymentBasis: string | null;
  packageValidUntil: string | null;
  kind: OnexClassKind;
  sessionExternalId: string;
  sessionTitle: string;
  sessionStart: Date;
  day: string;
  attendedCount: number;
  employeeExternalId: string | null;
  roomTitle: string | null;
  durationMin: number | null;
}

interface VisitGroup {
  key: string;
  clientExternalId: string;
  pkgId: string | null;
  basisName: string | null;
  basisStart: string | null;
  visits: VisitRow[];
  firstDay: string;
  validUntil: string | null;
}

interface SaleDoc {
  key: string;
  documentId: string | null;
  productExternalId: string | null;
  productName: string;
  paidMinor: number;
  saleMinor: number;
  refundMinor: number;
  occurredAt: Date;
  clientExternalId: string;
  clientName: string;
}

interface DiscountRow {
  id: string;
  occurredAt: Date;
  productExternalId: string | null;
  productName: string | null;
  clientExternalId: string | null;
  discountName: string | null;
  discountAmount: number;
  discountPercent: number | null;
  saleDocumentId: string | null;
}

interface CatalogInfo {
  externalId: string;
  name: string;
  priceMinor: number;
  active: boolean;
}

interface PreInstance {
  doc: SaleDoc;
  productKey: string;
  profile: MembershipProductProfileDto | null;
  family: MembershipFamilyConfig | null;
  startDay: string;
  termMonths: number;
  endEstimate: string;
  groups: VisitGroup[];
  linkedViaPackage: boolean;
}

interface Quotas {
  pt: number;
  massage: number;
  body: number;
  solariumMinutes: number;
  paCreditMinor: number;
  complete: boolean;
}

interface ResolvedCosts {
  massageRetailMinor: number;
  solariumMinuteRetailMinor: number;
  massageCostMinor: number;
  bodyCompositionCostMinor: number;
  ptCostMinor: number;
  solariumMinuteCostMinor: number;
  salesCommissionPct: number;
  overheadPerVisitMinor: number;
}

interface BuiltInstance {
  saleKey: string;
  documentId: string | null;
  packageDocId: string | null;
  clientExternalId: string;
  clientName: string;
  productKey: string;
  hasRealProductId: boolean;
  productName: string;
  groupLabel: string | null;
  familyId: string;
  familyLabel: string;
  compositionComplete: boolean;
  paidMinor: number;
  priceEstimated: boolean;
  retailPriceMinor: number | null;
  discountName: string | null;
  discountAmountMinor: number;
  startDate: string;
  endDate: string;
  ended: boolean;
  /** Contract term in months (quotas / cost scale on this). */
  months: number;
  /** Months actually elapsed in the observation window (utilisation). */
  monthsObserved: number;
  gpVisits: number;
  gymVisits: number;
  ptUsed: number;
  massageUsed: number;
  bodyUsed: number;
  solariumMinutesUsed: number;
  personalAccountSpentMinor: number;
  personalAccountBurnedMinor: number;
  ptQuota: number;
  massageQuota: number;
  bodyQuota: number;
  solariumMinutesQuota: number;
  personalAccountCreditedMinor: number;
  accessGpMinor: number;
  accessGymMinor: number;
  trainerCostMinor: number;
  gpActualVisits: number;
  gpEstimatedVisits: number;
  cost: MembershipCostBreakdown;
  gpCostPerVisitMinor: number | null;
  trainerPerVisitMinor: number | null;
  marginMinor: number;
  burnedMinor: number;
  segment: MembershipUtilizationSegment;
  lastVisitDate: string | null;
  gpSessionIds: string[];
  valueReceivedMinor: number;
  hasVisitLink: boolean;
  gpPerMonth: number;
}

interface ReportContext {
  settings: MembershipEconomicsSettings;
  hints: MembershipPayrollHints;
  costs: ResolvedCosts;
  /** Club-wide trainer pay per GP visit (fallback for scenarios). */
  clubTrainerPerVisitMinor: number;
}

interface BuildResult {
  instances: BuiltInstance[];
  earnings: EarningsMap;
  profiles: Map<string, MembershipProductProfileDto>;
  catalog: Map<string, CatalogInfo>;
  ctx: ReportContext;
  dataQuality: Omit<MembershipDataQuality, "warning"> & {
    visitLinkCoverage: number;
  };
}

interface GroupSummary {
  count: number;
  paidSum: number;
  avgPaid: number;
  avgRetail: number | null;
  avgDiscountPct: number | null;
  soldWithDiscountShare: number | null;
  avgMonths: number;
  avgGpPerMonth: number;
  avgGymPerMonth: number;
  gpVisits: number;
  trainerSum: number;
  avgTrainerPerVisit: number | null;
  avgTrainerCost: number;
  gpAccessPerVisit: number | null;
  ptUsePct: number | null;
  massageUsePct: number | null;
  solariumUsePct: number | null;
  personalAccountUsePct: number | null;
  burnedMinor: number;
  burnedPct: number | null;
  cost: MembershipCostBreakdown;
  marginSum: number;
  marginPct: number | null;
  breakevenVisits: number | null;
  scenarios: MembershipScenarioResult[];
  estimatedGpShare: number | null;
}

type FamilyFilterParams = { family?: string | string[] };
type PeriodParams = {
  from: string;
  to: string;
  basis?: MembershipEfficiencyBasis;
};

@Injectable()
export class MembershipEfficiencyService {
  private readonly logger = new Logger(MembershipEfficiencyService.name);

  private readonly reportCache = new Map<
    string,
    { at: number; value: Promise<MembershipEfficiencyReport> }
  >();
  private readonly buildCache = new Map<
    string,
    { at: number; value: Promise<BuildResult> }
  >();
  private readonly earningsCache = new Map<
    string,
    { at: number; value: Promise<EarningsMap> }
  >();
  private readonly hintsCache = new Map<
    string,
    { at: number; value: Promise<MembershipPayrollHints> }
  >();
  private readonly ensureAt = new Map<
    string,
    { at: number; value: Promise<void> }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly payroll: PayrollService,
  ) {}

  // ── Settings ──────────────────────────────────────────────────────────────

  async getSettings(user: JwtPayload): Promise<MembershipEconomicsSettings> {
    return this.loadSettings(requireClubId(user));
  }

  async putSettings(
    user: JwtPayload,
    body: Partial<MembershipEconomicsSettings>,
  ): Promise<MembershipEconomicsSettings> {
    const clubId = requireClubId(user);
    const current = await this.loadSettings(clubId);
    const next = mergeMembershipSettings({ ...current, ...body });
    await this.prisma.membershipEconomicsSettings.upsert({
      where: { clubId },
      create: { clubId, json: next as object, updatedBy: user.sub },
      update: { json: next as object, updatedBy: user.sub },
    });
    this.clearCaches();
    return next;
  }

  private async loadSettings(
    clubId: string,
  ): Promise<MembershipEconomicsSettings> {
    const row = await this.prisma.membershipEconomicsSettings.findUnique({
      where: { clubId },
    });
    return row
      ? mergeMembershipSettings(row.json)
      : defaultMembershipEconomicsSettings();
  }

  private clearCaches(): void {
    this.reportCache.clear();
    this.buildCache.clear();
    this.hintsCache.clear();
  }

  // ── Main report ───────────────────────────────────────────────────────────

  async getReport(
    user: JwtPayload,
    params: PeriodParams &
      FamilyFilterParams & { view?: MembershipEfficiencyView },
  ): Promise<MembershipEfficiencyReport> {
    const clubId = requireClubId(user);
    assertPeriod(params.from, params.to);
    const basis = normalizeBasis(params.basis);
    const view = params.view === "cost" ? "cost" : "retail";
    const familyFilter = normalizeFamilyFilter(params.family);
    const cacheKey = `${clubId}|${params.from}|${params.to}|${basis}|${view}|${familyFilter.join(",")}`;
    return this.cached(this.reportCache, cacheKey, () =>
      this.computeReport(clubId, {
        from: params.from,
        to: params.to,
        basis,
        view,
        familyFilter,
      }),
    );
  }

  private async computeReport(
    clubId: string,
    params: {
      from: string;
      to: string;
      basis: MembershipEfficiencyBasis;
      view: MembershipEfficiencyView;
      familyFilter: string[];
    },
  ): Promise<MembershipEfficiencyReport> {
    const built = await this.getBuilt(clubId, params);
    const { ctx } = built;
    const instances = filterByFamily(built.instances, params.familyFilter);
    const currency = await this.getCurrency(clubId);

    const byFamily = groupBy(instances, (i) => i.familyId);
    const families: MembershipFamilyRow[] = [];
    for (const [familyId, list] of byFamily) {
      const s = summarizeGroup(list, ctx);
      const fact = s.scenarios[0];
      families.push({
        familyId,
        label: list[0]?.familyLabel ?? familyId,
        count: s.count,
        avgPaidMinor: Math.round(s.avgPaid),
        avgRetailMinor: s.avgRetail != null ? Math.round(s.avgRetail) : null,
        avgDiscountPct: s.avgDiscountPct,
        soldWithDiscountShare: s.soldWithDiscountShare,
        avgMonths: round1(s.avgMonths),
        avgGpPerMonth: round1(s.avgGpPerMonth),
        avgGymPerMonth: round1(s.avgGymPerMonth),
        avgGpCostPerVisitMinor: s.gpAccessPerVisit,
        avgTrainerPerVisitMinor: s.avgTrainerPerVisit,
        avgMarginPerVisitMinor:
          s.gpAccessPerVisit != null && s.avgTrainerPerVisit != null
            ? s.gpAccessPerVisit - s.avgTrainerPerVisit
            : null,
        marginPct: s.marginPct,
        massageUsePct: s.massageUsePct,
        ptUsePct: s.ptUsePct,
        solariumUsePct: s.solariumUsePct,
        personalAccountUsePct: s.personalAccountUsePct,
        burnedMinor: s.burnedMinor,
        burnedPctOfPaid: s.burnedPct,
        breakevenVisits: s.breakevenVisits,
        maxGpVisitsPerMonth: fact?.maxGpVisitsPerMonth ?? null,
        breakevenPriceMinor: fact?.breakevenPriceMinor ?? null,
        status: familyStatus(s.marginPct, s.burnedPct),
      });
    }
    families.sort((a, b) => b.count - a.count);

    const products = this.buildProductRows(
      built,
      instances,
      params.familyFilter,
    );
    const discountRows = buildDiscountRows(instances);
    const total = summarizeGroup(instances, ctx);
    const sums = sumCosts(instances);

    const waterfall = buildWaterfall({
      paidMinor: total.paidSum,
      salesCommissionMinor: sums.salesCommissionMinor,
      acquiringMinor: sums.acquiringMinor,
      taxMinor: sums.taxMinor,
      trainerMinor: sums.trainerMinor,
      ptMinor: sums.ptMinor,
      massageMinor: sums.massageMinor,
      bodyCompositionMinor: sums.bodyCompositionMinor,
      solariumMinor: sums.solariumMinor,
      personalAccountCogsMinor: sums.personalAccountCogsMinor,
      overheadMinor: sums.overheadMinor,
      fixedOverheadMinor: 0,
    });

    const gpPerMonthValues = instances.map((x) => bucketValue(x.gpPerMonth));
    const sleeping = instances.filter((x) => x.segment === "sleeping").length;
    const gpCost = total.gpAccessPerVisit;
    const trainerPv = total.avgTrainerPerVisit;
    const marginPv =
      gpCost != null && trainerPv != null ? gpCost - trainerPv : null;

    const dq = built.dataQuality;
    const warning = dataQualityWarning(dq);
    const dataQuality: MembershipDataQuality = {
      packageDocCoverage: dq.packageDocCoverage,
      saleMatchCoverage: dq.visitLinkCoverage,
      visitLinkCoverage: dq.visitLinkCoverage,
      personalAccountCoverage: dq.personalAccountCoverage,
      discountMatchCoverage: dq.discountMatchCoverage,
      gpTrainerRateCoverage: dq.gpTrainerRateCoverage,
      profilesNeedingReview: dq.profilesNeedingReview,
      warning,
    };

    const insights = buildMembershipInsights({
      families: families.map((f) => {
        const list = byFamily.get(f.familyId) ?? [];
        const under = list.filter(
          (x) => x.segment === "under" || x.segment === "sleeping",
        ).length;
        const paBurn = list.reduce(
          (a, x) => a + x.personalAccountBurnedMinor,
          0,
        );
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
      }),
      products: products
        .filter((p) => p.soldCount > 0)
        .map((p) => ({
          name: p.name,
          soldCount: p.soldCount,
          marginPct: p.marginPct,
          breakevenPriceMinor: p.breakevenPriceMinor,
          avgPaidMinor: p.avgPaidMinor,
          compositionComplete: p.compositionComplete,
          ptUsePct: p.ptUsePct,
          personalAccountUsePct: p.personalAccountUsePct,
          soldWithDiscountShare: p.soldWithDiscountShare,
          priceHeadroomPct: p.priceHeadroomPct,
        })),
      discounts: discountRows.discounts.map((d) => ({
        discountName: d.discountName,
        marginPct: d.marginPct,
        salesCount: d.salesCount,
      })),
      lowFillClassTitles: [],
      dataQualityWarning: warning,
    });

    const ranked = products
      .filter((p) => p.soldCount > 0)
      .map((p) => ({ p, total: p.marginMinor * p.soldCount }));
    const topLossMaking = ranked
      .filter((r) => r.total < 0)
      .sort((a, b) => a.total - b.total)
      .slice(0, 5)
      .map((r) => r.p);
    const topProfitable = ranked
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map((r) => r.p);

    const n = instances.length;
    return {
      from: params.from,
      to: params.to,
      basis: params.basis,
      view: params.view,
      currency,
      instanceCount: n,
      kpis: {
        avgPaidMinor: metric(Math.round(total.avgPaid), null, {
          unit: "money",
          hint: "Средняя оплата абонемента (по продажам за период)",
          skipCompare: true,
        }),
        revenueMinor: metric(total.paidSum, null, {
          unit: "money",
          hint: "Сумма оплат по абонементам в выборке",
          skipCompare: true,
        }),
        soldWithDiscountShare: metric(total.soldWithDiscountShare ?? 0, null, {
          unit: "percent",
          hint: "Доля продаж со скидкой / акцией",
          unavailable: total.soldWithDiscountShare == null,
          skipCompare: true,
        }),
        avgDiscountPct: metric(total.avgDiscountPct ?? 0, null, {
          unit: "percent",
          hint: "Средняя скидка среди продаж со скидкой",
          unavailable: total.avgDiscountPct == null,
          skipCompare: true,
        }),
        marginPct: metric(total.marginPct ?? 0, null, {
          unit: "percent",
          hint: "Маржа после комиссий, тренеров и услуг / оплачено",
          unavailable: total.marginPct == null,
          skipCompare: true,
        }),
        avgGpPerMonth: metric(round1(total.avgGpPerMonth), null, {
          unit: "count",
          hint: "Среднее число посещений ГП в месяц на абонемент",
          skipCompare: true,
        }),
        gpCostPerVisitMinor: metric(gpCost ?? 0, null, {
          unit: "money",
          hint: "Доля «доступа» на ГП / число посещений ГП",
          unavailable: gpCost == null,
          skipCompare: true,
        }),
        trainerPerVisitMinor: metric(trainerPv ?? 0, null, {
          unit: "money",
          hint: "Затраты на тренера ГП на одно посещение",
          unavailable: trainerPv == null,
          skipCompare: true,
        }),
        marginPerVisitMinor: metric(marginPv ?? 0, null, {
          unit: "money",
          hint: "Стоимость визита минус оплата тренеру на человека",
          unavailable: marginPv == null,
          skipCompare: true,
        }),
        burnedMinor: metric(total.burnedMinor, null, {
          unit: "money",
          hint: "Сгоревший ЛС + неиспользованные квоты по прайсу",
          skipCompare: true,
        }),
        sleepingShare: metric(n > 0 ? round1((sleeping / n) * 100) : 0, null, {
          unit: "percent",
          hint: "Доля спящих абонементов (нет визитов / давно не ходят)",
          unavailable: n === 0,
          skipCompare: true,
        }),
      },
      families,
      products,
      waterfall,
      servicePromise: buildServicePromise(instances, ctx.costs),
      visitDistribution: visitDistributionBuckets(gpPerMonthValues),
      breakevenVisits: total.breakevenVisits,
      insights,
      dataQuality,
      settings: ctx.settings,
      payrollHints: ctx.hints,
      topLossMaking,
      topProfitable,
    };
  }

  // ── Trainers ──────────────────────────────────────────────────────────────

  async getTrainersReport(
    user: JwtPayload,
    params: PeriodParams & FamilyFilterParams,
  ): Promise<MembershipTrainersReport> {
    const clubId = requireClubId(user);
    assertPeriod(params.from, params.to);
    const basis = normalizeBasis(params.basis);
    const familyFilter = normalizeFamilyFilter(params.family);
    const built = await this.getBuilt(clubId, {
      from: params.from,
      to: params.to,
      basis,
    });
    const instances = filterByFamily(built.instances, familyFilter);
    const earnings = built.earnings;

    // Access value each client visit is worth to the club (per session).
    const accessByClientVisit = new Map<string, number>();
    for (const inst of instances) {
      const per = inst.gpCostPerVisitMinor;
      if (per == null) continue;
      for (const sid of inst.gpSessionIds) {
        accessByClientVisit.set(`${inst.clientExternalId}|${sid}`, per);
      }
    }

    const bounds = rangeBounds(params.from, params.to);
    const [sessions, users] = await Promise.all([
      this.prisma.onexClassSession.findMany({
        where: {
          clubId,
          kind: OnexClassKind.GROUP,
          status: "COMPLETED",
          isActive: true,
          startAt: { gte: bounds.start, lte: bounds.end },
        },
        include: {
          members: {
            where: {
              cancelled: false,
              attendance: OnexClassMemberAttendance.ATTENDED,
            },
          },
        },
      }),
      this.prisma.user.findMany({
        where: { clubId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          externalId: true,
          employeeCode: true,
          isActive: true,
        },
      }),
    ]);

    const userById = new Map(users.map((u) => [u.id, u]));
    const userByExt = new Map<string, (typeof users)[number]>();
    for (const u of users) {
      if (u.externalId) userByExt.set(u.externalId, u);
      if (u.employeeCode) userByExt.set(u.employeeCode, u);
    }

    interface ClassAgg {
      title: string;
      sessions: number;
      attended: number;
      capacity: number;
      capacitySessions: number;
      earnMinor: number;
      economicMinor: number;
      below: boolean;
    }
    const byTrainer = new Map<
      string,
      { name: string; classes: Map<string, ClassAgg> }
    >();

    for (const s of sessions) {
      const attended = Math.max(s.attendedCount, s.members.length);
      const earn = earnings.get(s.externalId);
      const staffUser = earn
        ? userById.get(earn.trainerUserId)
        : userByExt.get(s.employeeExternalId ?? "");
      const trainerId =
        earn?.trainerUserId ??
        staffUser?.id ??
        (s.employeeExternalId ? `ext:${s.employeeExternalId}` : "unknown");
      const name = staffUser
        ? `${staffUser.lastName} ${staffUser.firstName}`.trim()
        : (s.employeeName ?? "Без тренера");

      // No payroll earn (inactive / unmatched trainer): estimate from tiers.
      const earnMinor =
        earn != null
          ? earn.earnMinor
          : estimateGroupSessionRateMinor(
              attended,
              resolveGroupRoomKey(s.roomTitle),
            );

      let economic = 0;
      for (const m of s.members) {
        const fromAccess = accessByClientVisit.get(
          `${m.externalId}|${s.externalId}`,
        );
        if (fromAccess != null) economic += fromAccess;
        else if (m.unitPriceMinor != null && m.unitPriceMinor > 0) {
          economic += m.unitPriceMinor;
        }
      }

      let bucket = byTrainer.get(trainerId);
      if (!bucket) {
        bucket = { name, classes: new Map() };
        byTrainer.set(trainerId, bucket);
      }
      const classKey = s.title.trim() || "Без названия";
      const agg = bucket.classes.get(classKey) ?? {
        title: classKey,
        sessions: 0,
        attended: 0,
        capacity: 0,
        capacitySessions: 0,
        earnMinor: 0,
        economicMinor: 0,
        below: false,
      };
      agg.sessions += 1;
      agg.attended += attended;
      agg.earnMinor += earnMinor;
      agg.economicMinor += economic;
      if (economic < earnMinor) agg.below = true;
      if (s.capacity != null && s.capacity > 0) {
        agg.capacity += s.capacity;
        agg.capacitySessions += 1;
      }
      bucket.classes.set(classKey, agg);
    }

    const trainers: MembershipTrainerEfficiencyRow[] = [...byTrainer.entries()]
      .map(([trainerId, t]) => {
        const classes = [...t.classes.values()].map((c) => {
          const margin = c.economicMinor - c.earnMinor;
          const econPerPerson =
            c.attended > 0 ? c.economicMinor / c.attended : 0;
          const avgEarnPerSession =
            c.sessions > 0 ? c.earnMinor / c.sessions : 0;
          return {
            title: c.title,
            sessions: c.sessions,
            avgAttended: round1(c.sessions > 0 ? c.attended / c.sessions : 0),
            avgFillPct:
              c.capacity > 0 ? round1((c.attended / c.capacity) * 100) : null,
            earnMinor: c.earnMinor,
            economicRevenueMinor: c.economicMinor,
            marginMinor: margin,
            marginPerPersonMinor:
              c.attended > 0 ? Math.round(margin / c.attended) : null,
            belowBreakeven: c.below,
            minPeopleForBreakeven:
              econPerPerson > 0
                ? Math.max(1, Math.ceil(avgEarnPerSession / econPerPerson))
                : null,
          };
        });
        const sessionsN = sum(classes.map((c) => c.sessions));
        const attendedN = sum([...t.classes.values()].map((c) => c.attended));
        const earn = sum(classes.map((c) => c.earnMinor));
        const economic = sum(classes.map((c) => c.economicRevenueMinor));
        const margin = economic - earn;
        const belowN = classes.filter((c) => c.belowBreakeven).length;
        const fillVals = classes
          .map((c) => c.avgFillPct)
          .filter((x): x is number => x != null);
        return {
          trainerId,
          name: t.name,
          sessions: sessionsN,
          avgAttended: sessionsN > 0 ? round1(attendedN / sessionsN) : 0,
          avgFillPct: fillVals.length ? round1(avg(fillVals)) : null,
          earnMinor: earn,
          economicRevenueMinor: economic,
          marginMinor: margin,
          marginPerPersonMinor:
            attendedN > 0 ? Math.round(margin / attendedN) : null,
          belowBreakevenShare:
            classes.length > 0 ? round1((belowN / classes.length) * 100) : null,
          classes: classes.sort((a, b) => a.marginMinor - b.marginMinor),
        };
      })
      .sort((a, b) => a.marginMinor - b.marginMinor);

    return {
      from: params.from,
      to: params.to,
      basis,
      currency: await this.getCurrency(clubId),
      trainers,
    };
  }

  // ── Clients ───────────────────────────────────────────────────────────────

  async getClientsReport(
    user: JwtPayload,
    params: PeriodParams &
      FamilyFilterParams & {
        productExternalId?: string;
        segment?: MembershipUtilizationSegment | "ALL";
        page?: number;
        pageSize?: number;
        sort?: string;
      },
  ): Promise<MembershipClientsReport> {
    const clubId = requireClubId(user);
    assertPeriod(params.from, params.to);
    const basis = normalizeBasis(params.basis);
    const familyFilter = normalizeFamilyFilter(params.family);
    const built = await this.getBuilt(clubId, {
      from: params.from,
      to: params.to,
      basis,
    });
    let instances = filterByFamily(built.instances, familyFilter);
    if (params.productExternalId) {
      instances = instances.filter(
        (i) => i.productKey === params.productExternalId,
      );
    }

    let rows: MembershipClientRow[] = instances.map((i) => ({
      clientExternalId: i.clientExternalId,
      clientName: i.clientName,
      familyId: i.familyId,
      familyLabel: i.familyLabel,
      productExternalId: i.hasRealProductId ? i.productKey : null,
      packageDocId: i.packageDocId ?? i.documentId,
      productName: i.productName,
      paidMinor: i.paidMinor,
      retailPriceMinor: i.retailPriceMinor,
      discountName: i.discountName,
      discountAmountMinor: i.discountAmountMinor,
      priceEstimated: i.priceEstimated,
      startDate: i.startDate,
      endDate: i.endDate,
      months: i.months,
      gpVisits: i.gpVisits,
      gymVisits: i.gymVisits,
      gpPerMonth: round1(i.gpPerMonth),
      ptUsed: i.ptUsed,
      ptQuota: i.ptQuota,
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
      endsWithin30d: (() => {
        const d = daysBetween(params.to, i.endDate);
        return d >= 0 && d <= 30;
      })(),
    }));

    const bySegment: Record<MembershipUtilizationSegment, number> = {
      max: 0,
      normal: 0,
      under: 0,
      sleeping: 0,
    };
    for (const r of rows) bySegment[r.segment]++;

    if (params.segment && params.segment !== "ALL") {
      rows = rows.filter((r) => r.segment === params.segment);
    }

    const sort = params.sort ?? "gpPerMonth_desc";
    rows.sort((a, b) => {
      switch (sort) {
        case "gpPerMonth_asc":
          return a.gpPerMonth - b.gpPerMonth;
        case "burned_desc":
          return b.burnedMinor - a.burnedMinor;
        case "margin_asc":
          return a.marginMinor - b.marginMinor;
        case "margin_desc":
          return b.marginMinor - a.marginMinor;
        case "paid_desc":
          return b.paidMinor - a.paidMinor;
        case "end_asc":
          return (a.endDate ?? "").localeCompare(b.endDate ?? "");
        default:
          return b.gpPerMonth - a.gpPerMonth;
      }
    });

    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 50));
    return {
      from: params.from,
      to: params.to,
      basis,
      currency: await this.getCurrency(clubId),
      total: rows.length,
      page,
      pageSize,
      clients: rows.slice((page - 1) * pageSize, page * pageSize),
      bySegment,
    };
  }

  // ── XLSX ──────────────────────────────────────────────────────────────────

  async exportXlsx(
    user: JwtPayload,
    params: PeriodParams &
      FamilyFilterParams & { view?: MembershipEfficiencyView },
  ): Promise<Buffer> {
    const [report, trainers] = await Promise.all([
      this.getReport(user, params),
      this.getTrainersReport(user, params),
    ]);
    const allClients: MembershipClientRow[] = [];
    for (let page = 1; ; page++) {
      const chunk = await this.getClientsReport(user, {
        from: params.from,
        to: params.to,
        basis: params.basis,
        family: params.family,
        page,
        pageSize: 100,
      });
      allClients.push(...chunk.clients);
      if (chunk.clients.length < 100 || allClients.length >= chunk.total) {
        break;
      }
    }

    const money = (minor: number | null | undefined) =>
      minor == null ? null : minor / 100;

    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();

    const summary = wb.addWorksheet("Сводка");
    summary.addRow(["Период", report.from, report.to]);
    summary.addRow(["Базис", report.basis]);
    summary.addRow(["Экземпляров", report.instanceCount]);
    summary.addRow([]);
    summary.addRow([
      "Тип",
      "Кол-во",
      "Ср. цена",
      "Ср. прайс",
      "Скидка %",
      "ГП/мес",
      "Стоимость визита",
      "Тренер/визит",
      "Маржа %",
      "Сгорело",
      "Макс. ГП/мес",
      "Мин. цена",
    ]);
    for (const f of report.families) {
      summary.addRow([
        f.label,
        f.count,
        money(f.avgPaidMinor),
        money(f.avgRetailMinor),
        f.avgDiscountPct,
        f.avgGpPerMonth,
        money(f.avgGpCostPerVisitMinor),
        money(f.avgTrainerPerVisitMinor),
        f.marginPct,
        money(f.burnedMinor),
        f.maxGpVisitsPerMonth,
        money(f.breakevenPriceMinor),
      ]);
    }

    const pr = wb.addWorksheet("Абонементы");
    pr.addRow([
      "Абонемент",
      "Группа",
      "Продано",
      "Прайс",
      "Ср. оплата",
      "Скидка %",
      "Со скидкой %",
      "ГП/мес",
      "Тренер/визит",
      "Маржа",
      "Маржа %",
      "Мин. цена",
      "Макс. ГП/мес",
      "Выше лимита %",
      "Состав заполнен",
    ]);
    for (const p of report.products) {
      pr.addRow([
        p.name,
        p.groupLabel,
        p.soldCount,
        money(p.retailPriceMinor),
        money(p.avgPaidMinor),
        p.avgDiscountPct,
        p.soldWithDiscountShare,
        p.avgGpPerMonth,
        money(p.avgTrainerPerVisitMinor),
        money(p.marginMinor),
        p.marginPct,
        money(p.breakevenPriceMinor),
        p.maxGpVisitsPerMonth,
        p.aboveLimitShare,
        p.compositionComplete ? "да" : "нет",
      ]);
    }

    const tr = wb.addWorksheet("Тренеры");
    tr.addRow([
      "Тренер",
      "Занятий",
      "Ср. людей",
      "Начисление",
      "Экон. выручка",
      "Маржа",
    ]);
    for (const t of trainers.trainers) {
      tr.addRow([
        t.name,
        t.sessions,
        t.avgAttended,
        money(t.earnMinor),
        money(t.economicRevenueMinor),
        money(t.marginMinor),
      ]);
    }

    const cl = wb.addWorksheet("Клиенты");
    cl.addRow([
      "Клиент",
      "Абонемент",
      "Тип",
      "Оплачено",
      "Прайс",
      "Скидка",
      "Начало",
      "Окончание",
      "ГП",
      "ГП/мес",
      "ПТ (исп./квота)",
      "Сегмент",
      "Тренер ГП",
      "Сгорело",
      "Маржа",
    ]);
    for (const c of allClients) {
      cl.addRow([
        c.clientName,
        c.productName,
        c.familyLabel,
        money(c.paidMinor),
        money(c.retailPriceMinor),
        c.discountName,
        c.startDate,
        c.endDate,
        c.gpVisits,
        c.gpPerMonth,
        `${c.ptUsed}/${c.ptQuota}`,
        c.segment,
        money(c.trainerCostMinor),
        money(c.burnedMinor),
        money(c.marginMinor),
      ]);
    }

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  // ── Product profiles / catalog ────────────────────────────────────────────

  /**
   * Create / refresh MembershipProductProfile rows from
   * CatalogProduct(kind=membership), sold product names and
   * ClubMembershipSnapshot.servicesJson (max remaining per pack service).
   * Only fields still listed in `autoFilledFields` are refreshed.
   */
  async ensureProductProfiles(
    clubId: string,
  ): Promise<MembershipProductProfileDto[]> {
    const settings = await this.loadSettings(clubId);
    const salesFrom = rangeBounds(
      addYears(minskDay(new Date()), -LOOKBACK_YEARS),
      minskDay(new Date()),
    ).start;

    const [catalog, sold, soldByName, snapshots, existing] = await Promise.all([
      this.prisma.catalogProduct.findMany({
        where: { clubId, kind: "membership" },
        select: { externalId: true, name: true },
      }),
      this.prisma.clubRevenueEntry.groupBy({
        by: ["productExternalId", "productName"],
        where: {
          clubId,
          isActive: true,
          saleType: "membership",
          productExternalId: { not: null },
          occurredAt: { gte: salesFrom },
        },
      }),
      this.prisma.clubRevenueEntry.groupBy({
        by: ["productName"],
        where: {
          clubId,
          isActive: true,
          saleType: "membership",
          productExternalId: null,
          productName: { not: null },
          occurredAt: { gte: salesFrom },
        },
      }),
      this.prisma.clubMembershipSnapshot.findMany({
        where: { clubId, packageName: { not: null } },
        select: { packageName: true, servicesJson: true },
      }),
      this.prisma.membershipProductProfile.findMany({ where: { clubId } }),
    ]);

    const candidates = new Map<string, string>();
    for (const c of catalog) {
      if (c.externalId && c.name.trim())
        candidates.set(c.externalId, c.name.trim());
    }
    for (const s of sold) {
      if (
        s.productExternalId &&
        s.productName?.trim() &&
        !candidates.has(s.productExternalId)
      ) {
        candidates.set(s.productExternalId, s.productName.trim());
      }
    }
    // Prefer UUID keys: map normalized name → productExternalId from sales
    // that already have an id, so we don't create a parallel name: profile.
    const nameToId = new Map<string, string>();
    for (const s of sold) {
      if (!s.productExternalId || !s.productName?.trim()) continue;
      const nk = normalizeName(s.productName);
      if (nk && !nameToId.has(nk)) nameToId.set(nk, s.productExternalId);
    }
    for (const s of soldByName) {
      const name = s.productName?.trim();
      if (!name) continue;
      const nk = normalizeName(name);
      const uuid = nameToId.get(nk);
      if (uuid) {
        if (!candidates.has(uuid)) candidates.set(uuid, name);
        continue;
      }
      const key = `name:${nk}`;
      if (!candidates.has(key)) candidates.set(key, name);
    }

    const evidenceByName = new Map<string, QuotaEvidence>();
    for (const snap of snapshots) {
      if (!snap.packageName) continue;
      const key = squashName(snap.packageName);
      const ev = evidenceByName.get(key) ?? {
        pt: 0,
        massage: 0,
        body: 0,
        solariumMinutes: 0,
      };
      for (const line of parseServicesJson(snap.servicesJson)) {
        const rem = line.remaining;
        if (rem == null || rem <= 0) continue;
        const kind = classifyPackServiceName(line.name).kind;
        if (kind === "pt") ev.pt = Math.max(ev.pt, rem);
        else if (kind === "massage") ev.massage = Math.max(ev.massage, rem);
        else if (kind === "body") ev.body = Math.max(ev.body, rem);
        else if (kind === "solarium") {
          ev.solariumMinutes = Math.max(ev.solariumMinutes, rem);
        }
      }
      evidenceByName.set(key, ev);
    }

    const existingById = new Map(
      existing.map((p) => [p.productExternalId, p] as const),
    );
    const toCreate: Prisma.MembershipProductProfileCreateManyInput[] = [];
    const updates: Array<Prisma.PrismaPromise<MembershipProductProfile>> = [];

    for (const [productExternalId, name] of candidates) {
      const draft = draftProfile(
        name,
        evidenceByName.get(squashName(name)) ?? null,
        settings.families,
      );
      const row = existingById.get(productExternalId);
      if (!row) {
        toCreate.push({
          clubId,
          productExternalId,
          name,
          groupLabel: draft.values.groupLabel,
          termMonths: draft.values.termMonths,
          accessGp: draft.values.accessGp,
          accessGym: draft.values.accessGym,
          ptIncluded: draft.values.ptIncluded,
          massageIncluded: draft.values.massageIncluded,
          bodyCompositionIncluded: draft.values.bodyCompositionIncluded,
          solariumMinutes: draft.values.solariumMinutes,
          personalAccountCreditMinor: draft.values.personalAccountCreditMinor,
          excluded: draft.values.excluded,
          autoFilledFields: draft.auto,
        });
        continue;
      }
      const auto = parseStringArray(row.autoFilledFields);
      const patch: Record<string, unknown> = {};
      for (const field of auto) {
        if (!draft.auto.includes(field) && field !== "name") continue;
        const next =
          field === "name" ? name : draft.values[field as keyof DraftValues];
        const cur = row[field as keyof MembershipProductProfile];
        if (next !== undefined && next !== cur) patch[field] = next;
      }
      if (Object.keys(patch).length) {
        updates.push(
          this.prisma.membershipProductProfile.update({
            where: { id: row.id },
            data: patch as Prisma.MembershipProductProfileUpdateInput,
          }),
        );
      }
    }

    if (toCreate.length) {
      await this.prisma.membershipProductProfile.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
    }
    if (updates.length) await this.prisma.$transaction(updates);
    if (toCreate.length || updates.length) this.buildCache.clear();

    const rows = await this.prisma.membershipProductProfile.findMany({
      where: { clubId },
      orderBy: { name: "asc" },
    });
    return rows.map(toProfileDto);
  }

  async listProducts(
    user: JwtPayload,
    params: PeriodParams & FamilyFilterParams,
  ): Promise<MembershipProductsReport> {
    const clubId = requireClubId(user);
    assertPeriod(params.from, params.to);
    const basis = normalizeBasis(params.basis);
    const familyFilter = normalizeFamilyFilter(params.family);
    const built = await this.getBuilt(clubId, {
      from: params.from,
      to: params.to,
      basis,
    });
    const instances = filterByFamily(built.instances, familyFilter);
    return {
      from: params.from,
      to: params.to,
      basis,
      currency: await this.getCurrency(clubId),
      products: this.buildProductRows(built, instances, familyFilter),
      payrollHints: built.ctx.hints,
    };
  }

  async getProductDetail(
    user: JwtPayload,
    productExternalId: string,
    params: PeriodParams,
  ): Promise<MembershipProductDetail> {
    const clubId = requireClubId(user);
    assertPeriod(params.from, params.to);
    const basis = normalizeBasis(params.basis);
    const built = await this.getBuilt(clubId, {
      from: params.from,
      to: params.to,
      basis,
    });
    const list = built.instances.filter(
      (i) => i.productKey === productExternalId,
    );
    const profile = built.profiles.get(productExternalId) ?? null;
    const catalog = built.catalog.get(productExternalId) ?? null;
    if (!list.length && !profile && !catalog) {
      throw new NotFoundException("Membership product not found");
    }
    const product = this.buildProductRow(
      built.ctx,
      productExternalId,
      list,
      profile,
      catalog,
    );
    const ctx = built.ctx;
    const sums = sumCosts(list);
    const paidSum = sum(list.map((x) => x.paidMinor));

    const gpPerMonthValues = list.map((x) => x.gpPerMonth);
    const visitDistribution = visitDistributionBuckets(
      gpPerMonthValues.map(bucketValue),
    );
    const marginByGpBucket = visitDistribution.map((b) => {
      const inBucket = list.filter((x) =>
        inVisitBucket(bucketValue(x.gpPerMonth), b.minPerMonth, b.maxPerMonth),
      );
      return {
        key: b.key,
        label: b.label,
        count: inBucket.length,
        avgMarginMinor: inBucket.length
          ? Math.round(avg(inBucket.map((x) => x.marginMinor)))
          : 0,
      };
    });

    const gpVisits = sum(list.map((x) => x.gpVisits));
    const estimated = sum(list.map((x) => x.gpEstimatedVisits));
    const fact = product.scenarios[0];

    return {
      product,
      profile,
      retailPriceMinor: product.retailPriceMinor,
      waterfall: buildWaterfall({
        paidMinor: paidSum,
        salesCommissionMinor: sums.salesCommissionMinor,
        acquiringMinor: sums.acquiringMinor,
        taxMinor: sums.taxMinor,
        trainerMinor: sums.trainerMinor,
        ptMinor: sums.ptMinor,
        massageMinor: sums.massageMinor,
        bodyCompositionMinor: sums.bodyCompositionMinor,
        solariumMinor: sums.solariumMinor,
        personalAccountCogsMinor: sums.personalAccountCogsMinor,
        overheadMinor: sums.overheadMinor,
        fixedOverheadMinor: 0,
      }),
      servicePromise: buildServicePromise(list, ctx.costs),
      visitDistribution,
      marginByGpBucket,
      discounts: buildDiscountRows(list).discounts,
      scenarios: product.scenarios,
      gpTrainer: {
        visits: gpVisits,
        trainerCostMinor: sums.trainerMinor,
        avgPerVisitMinor:
          gpVisits > 0 ? Math.round(sums.trainerMinor / gpVisits) : null,
        shareOfPaidPct:
          paidSum > 0 ? round1((sums.trainerMinor / paidSum) * 100) : null,
        estimatedShare:
          gpVisits > 0 ? round1((estimated / gpVisits) * 100) : null,
        maxGpVisitsPerMonth: fact?.maxGpVisitsPerMonth ?? null,
      },
      currency: await this.getCurrency(clubId),
    };
  }

  async putProductProfile(
    user: JwtPayload,
    productExternalId: string,
    body: MembershipProductProfilePatch,
  ): Promise<MembershipProductProfileDto> {
    const clubId = requireClubId(user);
    const key = productExternalId?.trim();
    if (!key) throw new BadRequestException("productExternalId is required");
    const patch = sanitizeProfilePatch(body);

    await this.ensureProductProfiles(clubId);
    const existing = await this.prisma.membershipProductProfile.findUnique({
      where: { clubId_productExternalId: { clubId, productExternalId: key } },
    });

    const manual = Object.keys(patch);
    let row: MembershipProductProfile;
    if (existing) {
      const auto = parseStringArray(existing.autoFilledFields).filter(
        (f) => !manual.includes(f),
      );
      row = await this.prisma.membershipProductProfile.update({
        where: { id: existing.id },
        data: {
          ...patch,
          autoFilledFields: auto,
          updatedBy: user.sub,
        },
      });
    } else {
      const catalog = await this.prisma.catalogProduct.findFirst({
        where: { clubId, kind: "membership", externalId: key },
        select: { name: true },
      });
      const name = patch.name ?? catalog?.name ?? key;
      row = await this.prisma.membershipProductProfile.create({
        data: {
          clubId,
          productExternalId: key,
          ...patch,
          name,
          autoFilledFields: [],
          updatedBy: user.sub,
        },
      });
    }
    this.clearCaches();
    return toProfileDto(row);
  }

  // ── Discounts ─────────────────────────────────────────────────────────────

  async listDiscounts(
    user: JwtPayload,
    params: PeriodParams & FamilyFilterParams & { productExternalId?: string },
  ): Promise<MembershipDiscountsReport> {
    const clubId = requireClubId(user);
    assertPeriod(params.from, params.to);
    const basis = normalizeBasis(params.basis);
    const familyFilter = normalizeFamilyFilter(params.family);
    const built = await this.getBuilt(clubId, {
      from: params.from,
      to: params.to,
      basis,
    });
    let instances = filterByFamily(built.instances, familyFilter);
    if (params.productExternalId) {
      instances = instances.filter(
        (i) => i.productKey === params.productExternalId,
      );
    }
    const { discounts, withoutDiscount } = buildDiscountRows(instances);
    return {
      from: params.from,
      to: params.to,
      basis,
      currency: await this.getCurrency(clubId),
      discounts,
      withoutDiscount,
    };
  }

  // ── Payroll hints ─────────────────────────────────────────────────────────

  /**
   * Read-only motivation hints: average membership sales % of active
   * ADMIN / MANAGER staff, SPA fixed quota rates and the fixed PT rate
   * for complimentary (ALL SPORTS) sessions. Club pay templates fill gaps.
   */
  async getPayrollHints(clubId: string): Promise<MembershipPayrollHints> {
    return this.cached(this.hintsCache, clubId, async () => {
      const today = new Date();
      const [rows, templates] = await Promise.all([
        this.prisma.staffCompensation.findMany({
          where: {
            clubId,
            effectiveFrom: { lte: today },
            user: { isActive: true },
          },
          orderBy: [{ userId: "asc" }, { effectiveFrom: "desc" }],
          select: { userId: true, payProfile: true },
        }),
        this.prisma.staffPayTemplate.findMany({
          where: { clubId },
          select: { track: true, payProfile: true },
        }),
      ]);

      const admin: number[] = [];
      const manager: number[] = [];
      const massage: number[] = [];
      const body: number[] = [];
      const ptGift: number[] = [];

      const collect = (slice: StaffPayTrackSlice, into: PayrollBuckets) => {
        switch (slice.track) {
          case "ADMIN":
            if ((slice.membershipSalesPercent ?? 0) > 0) {
              into.admin.push(slice.membershipSalesPercent!);
            }
            break;
          case "MANAGER":
            if ((slice.membershipSalesPercent ?? 0) > 0) {
              into.manager.push(slice.membershipSalesPercent!);
            }
            break;
          case "SPA":
            for (const r of slice.spaQuotaRates ?? []) {
              if (r.rateMinor <= 0) continue;
              if (r.serviceKey === "CLASSIC_MASSAGE")
                into.massage.push(r.rateMinor);
              if (r.serviceKey === "BODY_COMPOSITION")
                into.body.push(r.rateMinor);
            }
            break;
          case "PT":
          case "CLUB":
            if ((slice.ptAllSportsRateMinor ?? 0) > 0) {
              into.ptGift.push(slice.ptAllSportsRateMinor!);
            }
            break;
          default:
            break;
        }
      };

      const live: PayrollBuckets = { admin, manager, massage, body, ptGift };
      const seen = new Set<string>();
      for (const r of rows) {
        if (seen.has(r.userId)) continue;
        seen.add(r.userId);
        const profile = asPayProfile(r.payProfile);
        if (!profile) continue;
        for (const slice of allPaySlices(profile)) collect(slice, live);
      }

      const fallback: PayrollBuckets = {
        admin: [],
        manager: [],
        massage: [],
        body: [],
        ptGift: [],
      };
      for (const t of templates) {
        const raw = t.payProfile as unknown;
        if (!raw || typeof raw !== "object") continue;
        collect(
          {
            ...(raw as StaffPayTrackSlice),
            track: t.track as StaffPayTrackSlice["track"],
          },
          fallback,
        );
      }

      const pick = (a: number[], b: number[]) => (a.length ? a : b);
      const avgAdmin = avgPositive(pick(admin, fallback.admin), 1);
      const avgManager = avgPositive(pick(manager, fallback.manager), 1);
      const hints = emptyPayrollHints();
      hints.avgAdminMembershipSalesPct = avgAdmin;
      hints.avgManagerMembershipSalesPct = avgManager;
      hints.combinedSalesCommissionPct =
        avgAdmin == null && avgManager == null
          ? null
          : round1((avgAdmin ?? 0) + (avgManager ?? 0));
      hints.spaMassageRateMinor = avgPositive(
        pick(massage, fallback.massage),
        0,
      );
      hints.spaBodyCompositionRateMinor = avgPositive(
        pick(body, fallback.body),
        0,
      );
      hints.ptGiftRateMinor = avgPositive(pick(ptGift, fallback.ptGift), 0);
      hints.source = "payroll";
      return hints;
    });
  }

  // ── Build instances (sale-first) ──────────────────────────────────────────

  private getBuilt(
    clubId: string,
    params: {
      from: string;
      to: string;
      basis: MembershipEfficiencyBasis;
    },
  ): Promise<BuildResult> {
    return this.cached(
      this.buildCache,
      `${clubId}|${params.from}|${params.to}|${params.basis}`,
      () => this.buildInstances(clubId, params),
    );
  }

  private ensureProfilesThrottled(clubId: string): Promise<void> {
    const cur = this.ensureAt.get(clubId);
    if (cur && Date.now() - cur.at < ENSURE_PROFILES_TTL_MS) return cur.value;
    const value = this.ensureProductProfiles(clubId)
      .then(() => undefined)
      .catch((err) => {
        this.ensureAt.delete(clubId);
        this.logger.warn(
          `ensureProductProfiles failed: ${err instanceof Error ? err.message : err}`,
        );
      });
    this.ensureAt.set(clubId, { at: Date.now(), value });
    return value;
  }

  private getEarnings(
    clubId: string,
    from: string,
    to: string,
  ): Promise<EarningsMap> {
    return this.cached(this.earningsCache, `${clubId}|${from}|${to}`, async () => {
      const chunks = splitIsoRangeInclusive(from, to, EARNINGS_CHUNK_DAYS);
      const merged: EarningsMap = new Map();
      for (const chunk of chunks) {
        try {
          const part = await this.payroll.listGroupSessionEarningsForClub(
            clubId,
            chunk.from,
            chunk.to,
          );
          for (const [k, v] of part) {
            const prev = merged.get(k);
            if (!prev || v.earnMinor >= prev.earnMinor) merged.set(k, v);
          }
        } catch (err) {
          this.logger.warn(
            `group earnings chunk ${chunk.from}…${chunk.to}: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }
      return merged;
    });
  }

  private async buildInstances(
    clubId: string,
    params: {
      from: string;
      to: string;
      basis: MembershipEfficiencyBasis;
    },
  ): Promise<BuildResult> {
    const asOf = params.to;
    const lookbackFrom = addYears(params.from, -LOOKBACK_YEARS);
    const bounds = rangeBounds(lookbackFrom, params.to);

    const settings = await this.loadSettings(clubId);
    await this.ensureProfilesThrottled(clubId);

    const [
      members,
      groupAttendedTotal,
      groupAttendedWithPkg,
      hallVisits,
      saleRows,
      paRows,
      discountRows,
      earnings,
      retailPrices,
      hints,
      profileRows,
      catalogRows,
    ] = await Promise.all([
      this.prisma.onexClassSessionMember.findMany({
        where: {
          cancelled: false,
          attendance: OnexClassMemberAttendance.ATTENDED,
          OR: [
            { packageDocId: { not: null } },
            { paymentBasis: { not: null } },
          ],
          session: {
            clubId,
            isActive: true,
            kind: {
              in: [
                OnexClassKind.GROUP,
                OnexClassKind.PT,
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
          session: {
            select: {
              externalId: true,
              kind: true,
              title: true,
              startAt: true,
              attendedCount: true,
              employeeExternalId: true,
              roomTitle: true,
              durationMin: true,
            },
          },
        },
      }),
      this.prisma.onexClassSessionMember.count({
        where: {
          cancelled: false,
          attendance: OnexClassMemberAttendance.ATTENDED,
          session: {
            clubId,
            isActive: true,
            kind: OnexClassKind.GROUP,
            startAt: { gte: bounds.start, lte: bounds.end },
          },
        },
      }),
      this.prisma.onexClassSessionMember.count({
        where: {
          cancelled: false,
          attendance: OnexClassMemberAttendance.ATTENDED,
          packageDocId: { not: null },
          session: {
            clubId,
            isActive: true,
            kind: OnexClassKind.GROUP,
            startAt: { gte: bounds.start, lte: bounds.end },
          },
        },
      }),
      this.prisma.clubHallVisit.findMany({
        where: {
          clubId,
          isActive: true,
          visitDate: { gte: lookbackFrom, lte: params.to },
        },
        select: { clientExternalId: true, visitDate: true },
      }),
      this.prisma.clubRevenueEntry.findMany({
        where: {
          clubId,
          isActive: true,
          saleType: "membership",
          operationType: { in: ["payment", "sale", "refund"] },
          occurredAt: { gte: bounds.start, lte: bounds.end },
        },
        select: {
          externalId: true,
          documentId: true,
          operationType: true,
          productName: true,
          productExternalId: true,
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
            { operationType: "personal_credit" },
            { operationType: "personal_burn" },
            { personalAccount: { gt: 0 } },
          ],
          occurredAt: { gte: bounds.start, lte: bounds.end },
        },
        select: {
          operationType: true,
          amount: true,
          personalAccount: true,
          occurredAt: true,
          clientExternalId: true,
        },
      }),
      this.prisma.providedDiscountRow.findMany({
        where: {
          clubId,
          occurredAt: { gte: bounds.start, lte: bounds.end },
        },
        select: {
          id: true,
          occurredAt: true,
          productExternalId: true,
          productName: true,
          clientExternalId: true,
          discountName: true,
          discountAmount: true,
          discountPercent: true,
          saleDocumentId: true,
        },
      }),
      // Earnings only over visit window; chunked inside getEarnings (≤31d).
      this.getEarnings(clubId, lookbackFrom, params.to),
      this.deriveRetailPrices(clubId, params.from, params.to),
      this.getPayrollHints(clubId),
      this.prisma.membershipProductProfile.findMany({ where: { clubId } }),
      this.prisma.catalogProduct.findMany({
        where: { clubId, kind: "membership" },
        select: {
          externalId: true,
          name: true,
          priceMinor: true,
          active: true,
        },
      }),
    ]);

    // ── Costs ──
    const costs: ResolvedCosts = {
      massageRetailMinor:
        settings.massageRetailMinor ?? retailPrices.massageRetailMinor,
      solariumMinuteRetailMinor:
        settings.solariumMinuteRetailMinor ??
        retailPrices.solariumMinuteRetailMinor,
      massageCostMinor:
        settings.massageCostMinor ??
        (hints.spaMassageRateMinor && hints.spaMassageRateMinor > 0
          ? hints.spaMassageRateMinor
          : retailPrices.massageCostMinor),
      bodyCompositionCostMinor:
        settings.bodyCompositionCostMinor ??
        hints.spaBodyCompositionRateMinor ??
        0,
      ptCostMinor: settings.ptGiftCostMinor ?? hints.ptGiftRateMinor ?? 0,
      solariumMinuteCostMinor:
        settings.solariumMinuteCostMinor ??
        retailPrices.solariumMinuteCostMinor,
      salesCommissionPct:
        settings.salesCommissionPctOverride ??
        hints.combinedSalesCommissionPct ??
        0,
      overheadPerVisitMinor:
        settings.gymVisitVariableCostMinor > 0
          ? settings.gymVisitVariableCostMinor
          : settings.overheadPerVisitMinor,
    };

    const profiles = new Map<string, MembershipProductProfileDto>();
    for (const p of profileRows) {
      profiles.set(p.productExternalId, toProfileDto(p));
    }
    const catalog = new Map<string, CatalogInfo>();
    for (const c of catalogRows) catalog.set(c.externalId, c);

    // ── Visits ──
    const attendedBySession = new Map<string, number>();
    const visits: VisitRow[] = [];
    for (const m of members) {
      const basisName = membershipNameFromPaymentBasis(m.paymentBasis);
      if (!m.packageDocId && !basisName) continue;
      const day = minskDay(m.session.startAt);
      if (m.session.kind === OnexClassKind.GROUP) {
        attendedBySession.set(
          m.session.externalId,
          (attendedBySession.get(m.session.externalId) ?? 0) + 1,
        );
      }
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
        day,
        attendedCount: m.session.attendedCount,
        employeeExternalId: m.session.employeeExternalId,
        roomTitle: m.session.roomTitle,
        durationMin: m.session.durationMin,
      });
    }

    // ── Sales (grouped by document + product line) ──
    const saleDocs = groupSaleRows(saleRows);

    // Collapse name-only SKUs onto a known productExternalId when present.
    const nameToProductId = new Map<string, string>();
    for (const doc of saleDocs) {
      if (!doc.productExternalId || !doc.productName) continue;
      const nk = normalizeName(doc.productName);
      if (nk && !nameToProductId.has(nk)) {
        nameToProductId.set(nk, doc.productExternalId);
      }
    }
    for (const c of catalogRows) {
      const nk = normalizeName(c.name);
      if (nk && c.externalId && !nameToProductId.has(nk)) {
        nameToProductId.set(nk, c.externalId);
      }
    }

    // ── Discounts index ──
    const discByDoc = new Map<string, DiscountRow[]>();
    const discByKey = new Map<string, DiscountRow[]>();
    for (const d of discountRows) {
      if (d.saleDocumentId) {
        pushMap(discByDoc, d.saleDocumentId, d);
      }
      if (d.clientExternalId) {
        const day = minskDay(d.occurredAt);
        const pk = d.productExternalId ?? normalizeName(d.productName ?? "");
        if (pk) pushMap(discByKey, `${d.clientExternalId}|${pk}|${day}`, d);
        const nk = normalizeName(d.productName ?? "");
        if (nk && nk !== pk) {
          pushMap(discByKey, `${d.clientExternalId}|${nk}|${day}`, d);
        }
      }
    }

    // ── Pre-instances from sales ──
    const pre: PreInstance[] = [];
    for (const doc of saleDocs) {
      const startDay = minskDay(doc.occurredAt);
      if (startDay > params.to) continue;
      if (doc.paidMinor > 0 && doc.refundMinor >= doc.paidMinor) continue;
      const resolvedProductId =
        doc.productExternalId ??
        nameToProductId.get(normalizeName(doc.productName)) ??
        null;
      if (resolvedProductId && !doc.productExternalId) {
        doc.productExternalId = resolvedProductId;
      }
      const productKey =
        resolvedProductId ?? `name:${normalizeName(doc.productName)}`;
      const profile = profiles.get(productKey) ?? null;
      if (profile?.excluded) continue;
      const family = resolveFamily(doc.productName, profile, settings.families);
      const termMonths = Math.max(
        1,
        profile?.termMonths ??
          parseMonthsFromTitle(doc.productName, family?.defaultMonths ?? 1),
      );
      pre.push({
        doc,
        productKey,
        profile,
        family,
        startDay,
        termMonths,
        endEstimate: addMonthsIso(startDay, termMonths),
        groups: [],
        linkedViaPackage: false,
      });
    }

    // ── Link visit groups → sales ──
    const groups = buildVisitGroups(visits);
    const preByDoc = new Map<string, PreInstance[]>();
    const preByClient = new Map<string, PreInstance[]>();
    for (const p of pre) {
      if (p.doc.documentId) pushMap(preByDoc, p.doc.documentId, p);
      pushMap(preByClient, p.doc.clientExternalId, p);
    }
    for (const list of preByClient.values()) {
      list.sort((a, b) => a.startDay.localeCompare(b.startDay));
    }

    for (const g of groups) {
      let target: PreInstance | null = null;
      let viaPackage = false;
      if (g.pkgId) {
        const direct = preByDoc.get(g.pkgId) ?? [];
        if (direct.length) {
          const byName = g.basisName
            ? direct.filter((p) =>
                nameMatchesExactOrContains(g.basisName!, p.doc.productName),
              )
            : [];
          // Prefer exact name match; never fall back to an unrelated line on
          // the same document (multi-SKU receipts).
          target = pickBestSaleCandidate(g, byName.length ? byName : []);
          if (!target && direct.length === 1 && !g.basisName) {
            target = direct[0]!;
          }
          if (target) viaPackage = true;
        }
      }
      if (!target && g.basisName) {
        target = pickWindowSale(g, preByClient.get(g.clientExternalId) ?? []);
      }
      if (target) {
        target.groups.push(g);
        if (viaPackage) target.linkedViaPackage = true;
      }
    }

    // ── Hall visits by client ──
    const hallByClient = new Map<string, Set<string>>();
    for (const h of hallVisits) {
      if (!h.clientExternalId) continue;
      const set = hallByClient.get(h.clientExternalId) ?? new Set<string>();
      set.add(h.visitDate.slice(0, 10));
      hallByClient.set(h.clientExternalId, set);
    }

    // ── Personal account by client ──
    const paByClient = new Map<
      string,
      Array<{
        day: string;
        operationType: string;
        amountMinor: number;
        spentMinor: number;
      }>
    >();
    for (const r of paRows) {
      if (!r.clientExternalId) continue;
      pushMap(paByClient, r.clientExternalId, {
        day: minskDay(r.occurredAt),
        operationType: r.operationType,
        amountMinor: Math.abs(toMinor(r.amount)),
        spentMinor:
          (r.personalAccount ?? 0) > 0 ? toMinor(r.personalAccount) : 0,
      });
    }

    // ── Build instances (narrowest membership window claims PA / hall first) ──
    const instances: BuiltInstance[] = [];
    let paEligible = 0;
    let paCovered = 0;
    let discountLooking = 0;
    let discountMatched = 0;
    let linkedInstances = 0;
    const claimedDiscountIds = new Set<string>();
    const claimedHallDays = new Map<string, Set<string>>();
    const claimedPaIdx = new Map<string, Set<number>>();

    type EligiblePre = {
      p: PreInstance;
      startDay: string;
      endDate: string;
      windowEnd: string;
      ended: boolean;
      months: number;
      monthsObserved: number;
      gpRows: VisitRow[];
      ptRows: VisitRow[];
      spaRows: VisitRow[];
      solRows: VisitRow[];
      hasVisitLink: boolean;
    };

    const eligible: EligiblePre[] = [];
    for (const p of pre) {
      const gpRows = dedupeBySession(
        p.groups
          .flatMap((g) => g.visits)
          .filter((v) => v.kind === OnexClassKind.GROUP),
      );
      const ptRows = dedupeBySession(
        p.groups
          .flatMap((g) => g.visits)
          .filter((v) => v.kind === OnexClassKind.PT),
      );
      const spaRows = dedupeBySession(
        p.groups
          .flatMap((g) => g.visits)
          .filter((v) => v.kind === OnexClassKind.SPA),
      );
      const solRows = dedupeBySession(
        p.groups
          .flatMap((g) => g.visits)
          .filter((v) => v.kind === OnexClassKind.SOLARIUM),
      );
      const hasVisitLink = p.groups.length > 0;
      const validUntil =
        p.groups
          .map((g) => g.validUntil)
          .filter((d): d is string => !!d)
          .sort()
          .at(-1) ?? null;
      const startDay = p.startDay;
      const endDate = validUntil ?? p.endEstimate;

      if (params.basis === "ended") {
        if (endDate < params.from || endDate > params.to) continue;
      } else {
        if (endDate < asOf) continue;
        if (startDay > params.to) continue;
      }

      const ended = endDate <= asOf;
      const months = p.termMonths;
      const windowEnd = endDate < params.to ? endDate : params.to;
      const monthsObserved = Math.max(
        1,
        Math.min(
          months,
          windowEnd >= startDay ? monthsBetween(startDay, windowEnd) : 1,
        ),
      );
      eligible.push({
        p,
        startDay,
        endDate,
        windowEnd,
        ended,
        months,
        monthsObserved,
        gpRows,
        ptRows,
        spaRows,
        solRows,
        hasVisitLink,
      });
    }

    eligible.sort((a, b) => {
      const wa = daysBetween(a.startDay, a.endDate);
      const wb = daysBetween(b.startDay, b.endDate);
      if (wa !== wb) return wa - wb;
      return a.startDay.localeCompare(b.startDay);
    });

    for (const e of eligible) {
      const { p, startDay, endDate, windowEnd, ended, months, monthsObserved } =
        e;
      const { doc, profile, family } = p;
      const { gpRows, ptRows, spaRows, solRows, hasVisitLink } = e;

      const productName = doc.productName;
      const quotas = resolveQuotas(profile, family, months);

      // Net paid (sale on credit → fall back to sale amount, flagged).
      let paidMinor = Math.max(0, doc.paidMinor - doc.refundMinor);
      let priceEstimated = false;
      if (doc.paidMinor <= 0 && doc.saleMinor > 0) {
        paidMinor = Math.max(0, doc.saleMinor - doc.refundMinor);
        priceEstimated = true;
      }

      const catalogInfo = doc.productExternalId
        ? catalog.get(doc.productExternalId)
        : undefined;
      const retailPriceMinor =
        profile?.retailPriceOverrideMinor ??
        (catalogInfo && catalogInfo.priceMinor > 0
          ? catalogInfo.priceMinor
          : null);

      // Discount link — each ProvidedDiscountRow claimed once.
      discountLooking++;
      const discounts = findDiscounts(
        doc,
        startDay,
        discByDoc,
        discByKey,
        claimedDiscountIds,
      );
      const discountAmountMinor = sum(
        discounts.map((d) => Math.abs(toMinor(d.discountAmount))),
      );
      const primaryDiscount = [...discounts].sort(
        (a, b) =>
          Math.abs(b.discountAmount) - Math.abs(a.discountAmount),
      )[0];
      const discountName =
        primaryDiscount?.discountName?.trim() ||
        (discounts.length ? "Скидка" : null);
      if (discounts.length) discountMatched++;

      // Usage.
      const gpDays = new Set(gpRows.map((v) => v.day));
      const spaDays = new Set([...spaRows, ...solRows].map((v) => v.day));
      const ptDays = new Set(ptRows.map((v) => v.day));
      const massageRows = spaRows.filter(
        (v) => !BODY_TITLE_RE.test(v.sessionTitle),
      );
      const bodyRows = spaRows.filter((v) =>
        BODY_TITLE_RE.test(v.sessionTitle),
      );
      const solariumMinutesUsed = sum(
        solRows.map((v) =>
          v.durationMin && v.durationMin > 0 ? v.durationMin : 10,
        ),
      );

      const hallDays =
        hallByClient.get(doc.clientExternalId) ?? new Set<string>();
      const claimedHall =
        claimedHallDays.get(doc.clientExternalId) ?? new Set<string>();
      if (!claimedHallDays.has(doc.clientExternalId)) {
        claimedHallDays.set(doc.clientExternalId, claimedHall);
      }
      const gymAllowed = profile
        ? profile.accessGym
        : (family?.includesGym ?? true);
      let gymVisits = 0;
      const gymDays: string[] = [];
      if (gymAllowed) {
        for (const d of hallDays) {
          if (d < startDay || d > windowEnd) continue;
          if (gpDays.has(d) || spaDays.has(d)) continue;
          if (claimedHall.has(d)) continue;
          claimedHall.add(d);
          gymVisits++;
          gymDays.push(d);
        }
      }

      // Personal account — each PA row claimed by at most one instance.
      let personalAccountSpentMinor = 0;
      let personalAccountBurnedMinor = 0;
      const personalAccountCreditedMinor = quotas.paCreditMinor;
      if (personalAccountCreditedMinor > 0) {
        paEligible++;
        const paList = paByClient.get(doc.clientExternalId) ?? [];
        const claimedIdx =
          claimedPaIdx.get(doc.clientExternalId) ?? new Set<number>();
        if (!claimedPaIdx.has(doc.clientExternalId)) {
          claimedPaIdx.set(doc.clientExternalId, claimedIdx);
        }
        let usedAny = false;
        paList.forEach((r, idx) => {
          if (r.day < startDay || r.day > endDate) return;
          if (claimedIdx.has(idx)) return;
          claimedIdx.add(idx);
          usedAny = true;
          if (r.operationType === "personal_burn") {
            personalAccountBurnedMinor += r.amountMinor;
          }
          personalAccountSpentMinor += r.spentMinor;
        });
        if (usedAny) paCovered++;
        if (
          ended &&
          personalAccountBurnedMinor === 0 &&
          personalAccountCreditedMinor > personalAccountSpentMinor
        ) {
          personalAccountBurnedMinor =
            personalAccountCreditedMinor - personalAccountSpentMinor;
        }
      }

      // Allocation.
      const allocInput = {
        paidMinor,
        massageRetailMinor: costs.massageRetailMinor,
        solariumMinuteRetailMinor: costs.solariumMinuteRetailMinor,
        gpVisits: gpRows.length,
        gymVisits,
      };
      const alloc = profile
        ? allocatePriceFromProfile({ ...allocInput, profile })
        : family
          ? allocateRetailPrice({ ...allocInput, months, family })
          : allocatePriceFromProfile({
              ...allocInput,
              profile: {
                accessGp: true,
                accessGym: true,
                massageIncluded: 0,
                solariumMinutes: 0,
                personalAccountCreditMinor: 0,
              },
            });

      // GP trainer cost.
      let trainerCostMinor = 0;
      let gpActual = 0;
      let gpEstimated = 0;
      const gpSessionIds: string[] = [];
      for (const v of gpRows) {
        gpSessionIds.push(v.sessionExternalId);
        const c = gpVisitCost(
          v,
          attendedBySession,
          earnings,
          settings.gpCostMethod,
        );
        trainerCostMinor += c.costMinor;
        if (c.estimated) gpEstimated++;
        else gpActual++;
      }

      const cost = computeFullCostBreakdown({
        paidMinor,
        salesCommissionPct: costs.salesCommissionPct,
        acquiringPct: settings.acquiringPct,
        taxPct: settings.taxPct,
        trainerMinor: trainerCostMinor,
        ptUsed: ptRows.length,
        ptCostMinor: costs.ptCostMinor,
        massageUsed: massageRows.length,
        massageCostMinor: costs.massageCostMinor,
        bodyCompositionUsed: bodyRows.length,
        bodyCompositionCostMinor: costs.bodyCompositionCostMinor,
        solariumMinutesUsed,
        solariumMinuteCostMinor: costs.solariumMinuteCostMinor,
        personalAccountSpentMinor,
        personalAccountCogsShare: settings.personalAccountCogsShare,
        visitCount: gpRows.length + gymVisits,
        overheadPerVisitMinor: costs.overheadPerVisitMinor,
        months,
        fixedOverheadPerMemberMonthMinor:
          settings.fixedOverheadPerMemberMonthMinor,
        includeFixedOverhead: false,
      });

      const gpCost = gpCostPerVisit(alloc.accessGpMinor, gpRows.length);
      const trPer = trainerPerVisit(trainerCostMinor, gpRows.length);

      // Unused quotas only "burn" once the membership has ended.
      const burnedBase = burnedValueMinor({
        personalAccountBurnedMinor,
        massageQuota: ended ? quotas.massage : massageRows.length,
        massageUsed: massageRows.length,
        massageRetailMinor: costs.massageRetailMinor,
        solariumMinutesQuota: ended
          ? quotas.solariumMinutes
          : solariumMinutesUsed,
        solariumMinutesUsed,
        solariumMinuteRetailMinor: costs.solariumMinuteRetailMinor,
        ptQuota: ended ? quotas.pt : ptRows.length,
        ptUsed: ptRows.length,
        ptRetailMinor: costs.ptCostMinor,
      });
      const burnedBody = ended
        ? Math.max(0, quotas.body - bodyRows.length) *
          costs.bodyCompositionCostMinor
        : 0;
      const burnedMinor = burnedBase + burnedBody;

      const lastVisitDate =
        [...gpDays, ...spaDays, ...ptDays, ...gymDays].sort().at(-1) ?? null;
      const refDay = ended ? endDate : asOf;
      const daysSince = daysBetween(lastVisitDate ?? startDay, refDay);
      const idx = utilizationIndex(
        gpRows.length,
        monthsObserved,
        settings.normVisitsPerWeek,
      );
      const segment = utilizationSegment(
        idx,
        settings.segmentThresholds,
        daysSince,
        settings.sleepingDays,
      );

      const valueReceivedMinor =
        gpRows.length * (gpCost ?? 0) +
        massageRows.length * costs.massageRetailMinor +
        solariumMinutesUsed * costs.solariumMinuteRetailMinor +
        personalAccountSpentMinor;

      const groupLabel = profile?.groupLabel ?? inferGroupLabel(productName);
      const familyId =
        family?.id ??
        (profile?.groupLabel
          ? `group:${normalizeName(profile.groupLabel)}`
          : "other");
      const familyLabel = family?.label ?? profile?.groupLabel ?? "Прочие";

      if (hasVisitLink) linkedInstances++;
      const firstPkg = p.groups.find((g) => g.pkgId)?.pkgId ?? null;

      instances.push({
        saleKey: doc.key,
        documentId: doc.documentId,
        packageDocId: firstPkg,
        clientExternalId: doc.clientExternalId,
        clientName: doc.clientName,
        productKey: p.productKey,
        hasRealProductId: !!doc.productExternalId,
        productName,
        groupLabel,
        familyId,
        familyLabel,
        compositionComplete:
          profileCompositionComplete(profile) &&
          !needsReview(profile) &&
          quotas.complete,
        paidMinor,
        priceEstimated,
        retailPriceMinor,
        discountName,
        discountAmountMinor,
        startDate: startDay,
        endDate,
        ended,
        months,
        monthsObserved,
        gpVisits: gpRows.length,
        gymVisits,
        ptUsed: ptRows.length,
        massageUsed: massageRows.length,
        bodyUsed: bodyRows.length,
        solariumMinutesUsed,
        personalAccountSpentMinor,
        personalAccountBurnedMinor,
        ptQuota: quotas.pt,
        massageQuota: quotas.massage,
        bodyQuota: quotas.body,
        solariumMinutesQuota: quotas.solariumMinutes,
        personalAccountCreditedMinor,
        accessGpMinor: alloc.accessGpMinor,
        accessGymMinor: alloc.accessGymMinor,
        trainerCostMinor,
        gpActualVisits: gpActual,
        gpEstimatedVisits: gpEstimated,
        cost,
        gpCostPerVisitMinor: gpCost,
        trainerPerVisitMinor: trPer,
        marginMinor: paidMinor - cost.totalMinor,
        burnedMinor,
        segment,
        lastVisitDate,
        gpSessionIds,
        valueReceivedMinor,
        hasVisitLink,
        gpPerMonth:
          monthsObserved > 0 ? gpRows.length / monthsObserved : gpRows.length,
      });
    }

    // Aggregate coverage / club-level numbers.
    const gpTotal = sum(instances.map((i) => i.gpVisits));
    const gpActualTotal = sum(instances.map((i) => i.gpActualVisits));
    const trainerTotal = sum(instances.map((i) => i.trainerCostMinor));
    const reviewProfiles = new Set<string>();
    for (const i of instances) {
      const prof = profiles.get(i.productKey);
      if (prof && !prof.excluded && needsReview(prof)) {
        reviewProfiles.add(prof.productExternalId);
      }
    }

    return {
      instances,
      earnings,
      profiles,
      catalog,
      ctx: {
        settings,
        hints,
        costs,
        clubTrainerPerVisitMinor:
          gpTotal > 0 ? Math.round(trainerTotal / gpTotal) : 0,
      },
      dataQuality: {
        packageDocCoverage:
          groupAttendedTotal > 0
            ? groupAttendedWithPkg / groupAttendedTotal
            : 1,
        saleMatchCoverage:
          instances.length > 0 ? linkedInstances / instances.length : 1,
        visitLinkCoverage:
          instances.length > 0 ? linkedInstances / instances.length : 1,
        personalAccountCoverage: paEligible > 0 ? paCovered / paEligible : 1,
        discountMatchCoverage:
          discountLooking > 0 ? discountMatched / discountLooking : 1,
        gpTrainerRateCoverage: gpTotal > 0 ? gpActualTotal / gpTotal : 1,
        profilesNeedingReview: reviewProfiles.size,
      },
    };
  }

  // ── Product rows ──────────────────────────────────────────────────────────

  private buildProductRows(
    built: BuildResult,
    instances: BuiltInstance[],
    familyFilter: string[],
  ): MembershipProductCatalogRow[] {
    const byProduct = groupBy(instances, (i) => i.productKey);
    const rows: MembershipProductCatalogRow[] = [];
    for (const [key, list] of byProduct) {
      rows.push(
        this.buildProductRow(
          built.ctx,
          key,
          list,
          built.profiles.get(key) ?? null,
          built.catalog.get(key) ?? null,
        ),
      );
    }
    // Catalog products without sales in the selected slice.
    for (const [key, profile] of built.profiles) {
      if (byProduct.has(key) || profile.excluded) continue;
      const catalog = built.catalog.get(key);
      if (!catalog?.active) continue;
      if (familyFilter.length) {
        const family = resolveFamily(
          profile.name,
          profile,
          built.ctx.settings.families,
        );
        const fid =
          family?.id ??
          (profile.groupLabel
            ? `group:${normalizeName(profile.groupLabel)}`
            : "other");
        if (!familyFilter.includes(fid)) continue;
      }
      rows.push(this.buildProductRow(built.ctx, key, [], profile, catalog));
    }
    rows.sort(
      (a, b) => b.soldCount - a.soldCount || a.name.localeCompare(b.name, "ru"),
    );
    return rows;
  }

  private buildProductRow(
    ctx: ReportContext,
    productKey: string,
    list: BuiltInstance[],
    profile: MembershipProductProfileDto | null,
    catalog: CatalogInfo | null,
  ): MembershipProductCatalogRow {
    const name =
      profile?.name ?? catalog?.name ?? list[0]?.productName ?? productKey;
    const retailPriceMinor =
      profile?.retailPriceOverrideMinor ??
      (catalog && catalog.priceMinor > 0 ? catalog.priceMinor : null) ??
      (list.length
        ? (() => {
            const r = list
              .map((x) => x.retailPriceMinor)
              .filter((x): x is number => x != null);
            return r.length ? Math.round(avg(r)) : null;
          })()
        : null);

    const quotas = profile ? profileQuotas(profile) : undefined;
    const s = summarizeGroup(list, ctx, {
      retailPriceMinor,
      quotas,
      months: profile?.termMonths,
    });
    const fact = s.scenarios[0];
    const compositionComplete = list.length
      ? list.every((x) => x.compositionComplete)
      : profileCompositionComplete(profile) && !needsReview(profile);

    const basePrice = s.avgPaid > 0 ? s.avgPaid : (retailPriceMinor ?? 0);
    const breakevenPrice = fact?.breakevenPriceMinor ?? null;
    const priceHeadroomPct =
      breakevenPrice != null && basePrice > 0
        ? round1(((basePrice - breakevenPrice) / basePrice) * 100)
        : null;

    const maxGp = fact?.maxGpVisitsPerMonth ?? null;
    let aboveLimitShare: number | null = null;
    let lossOnAboveLimitMinor: number | null = null;
    if (maxGp != null && list.length) {
      const above = list.filter((x) => x.gpPerMonth > maxGp);
      aboveLimitShare = round1((above.length / list.length) * 100);
      lossOnAboveLimitMinor = Math.abs(
        sum(above.filter((x) => x.marginMinor < 0).map((x) => x.marginMinor)),
      );
    }

    const marginMinor = Math.round(s.avgPaid - s.cost.totalMinor);
    return {
      productExternalId: productKey,
      name,
      groupLabel:
        profile?.groupLabel ?? list[0]?.groupLabel ?? inferGroupLabel(name),
      profileId: profile?.id ?? null,
      compositionComplete,
      autoFilledFields: profile?.autoFilledFields ?? [],
      soldCount: s.count,
      retailPriceMinor,
      avgPaidMinor: Math.round(s.avgPaid),
      avgDiscountPct: s.avgDiscountPct,
      soldWithDiscountShare: s.soldWithDiscountShare,
      avgMonths: round1(s.avgMonths),
      avgGpPerMonth: round1(s.avgGpPerMonth),
      avgGymPerMonth: round1(s.avgGymPerMonth),
      ptUsePct: s.ptUsePct,
      massageUsePct: s.massageUsePct,
      solariumUsePct: s.solariumUsePct,
      personalAccountUsePct: s.personalAccountUsePct,
      burnedMinor: s.burnedMinor,
      avgTrainerPerVisitMinor: s.avgTrainerPerVisit,
      avgTrainerCostMinor: Math.round(s.avgTrainerCost),
      cost: s.cost,
      marginMinor,
      marginPct: s.marginPct,
      scenarios: s.scenarios,
      breakevenPriceMinor: breakevenPrice,
      maxDiscountPctFromRetail: fact?.maxDiscountPctFromRetail ?? null,
      priceHeadroomPct,
      breakevenVisits: s.breakevenVisits,
      maxGpVisitsPerMonth: maxGp,
      aboveLimitShare,
      lossOnAboveLimitMinor,
      status: productStatus({
        marginPct: s.marginPct,
        compositionComplete,
        priceHeadroomPct,
      }),
    };
  }

  // ── Misc ──────────────────────────────────────────────────────────────────

  private async getCurrency(clubId: string): Promise<string> {
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { currency: true },
    });
    return club?.currency ?? "BYN";
  }

  /** Promise cache with TTL; failed promises are evicted immediately. */
  private cached<T>(
    map: Map<string, { at: number; value: Promise<T> }>,
    key: string,
    factory: () => Promise<T>,
  ): Promise<T> {
    const hit = map.get(key);
    if (hit && Date.now() - hit.at < REPORT_CACHE_TTL_MS) return hit.value;
    const value = factory();
    map.set(key, { at: Date.now(), value });
    value.catch(() => {
      const cur = map.get(key);
      if (cur?.value === value) map.delete(key);
    });
    const timer = setTimeout(() => {
      const cur = map.get(key);
      if (cur?.value === value) map.delete(key);
    }, REPORT_CACHE_TTL_MS);
    timer.unref?.();
    return value;
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
        saleType: { in: ["massage", "solarium", "service"] },
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
      const name = normalizeName(r.productName ?? "");
      const minor = toMinor(r.saleAmount || r.amount);
      if (minor <= 0) continue;
      if (r.saleType === "massage" || name.includes("массаж")) {
        massage.push(minor);
      } else if (r.saleType === "solarium" || name.includes("соляр")) {
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

// ── Group aggregation ───────────────────────────────────────────────────────

function summarizeGroup(
  list: BuiltInstance[],
  ctx: ReportContext,
  extra?: {
    retailPriceMinor?: number | null;
    quotas?: Pick<
      Quotas,
      "pt" | "massage" | "body" | "solariumMinutes" | "paCreditMinor"
    >;
    months?: number;
  },
): GroupSummary {
  const n = list.length;
  const paidSum = sum(list.map((x) => x.paidMinor));
  const avgPaid = n ? paidSum / n : 0;
  const gpVisits = sum(list.map((x) => x.gpVisits));
  const trainerSum = sum(list.map((x) => x.trainerCostMinor));
  const accessGpSum = sum(list.map((x) => x.accessGpMinor));
  const avgMonths = n ? avg(list.map((x) => x.months)) : (extra?.months ?? 1);

  const retailVals = list
    .map((x) => x.retailPriceMinor)
    .filter((x): x is number => x != null);
  const avgRetail = retailVals.length
    ? avg(retailVals)
    : (extra?.retailPriceMinor ?? null);

  const discounted = list.filter((x) => x.discountAmountMinor > 0);
  const discountPcts = discounted.map((x) => {
    const base = x.retailPriceMinor ?? x.paidMinor + x.discountAmountMinor;
    return base > 0 ? clampPct((x.discountAmountMinor / base) * 100) : 0;
  });

  const quotas = n
    ? {
        pt: Math.round(avg(list.map((x) => x.ptQuota))),
        massage: Math.round(avg(list.map((x) => x.massageQuota))),
        body: Math.round(avg(list.map((x) => x.bodyQuota))),
        solariumMinutes: Math.round(
          avg(list.map((x) => x.solariumMinutesQuota)),
        ),
        paCreditMinor: Math.round(
          avg(list.map((x) => x.personalAccountCreditedMinor)),
        ),
      }
    : (extra?.quotas ?? {
        pt: 0,
        massage: 0,
        body: 0,
        solariumMinutes: 0,
        paCreditMinor: 0,
      });

  const burned = sum(list.map((x) => x.burnedMinor));
  const avgCost = averageCost(list.map((x) => x.cost));
  const marginSum = sum(list.map((x) => x.marginMinor));

  const avgTrainerPerVisit =
    gpVisits > 0 ? Math.round(trainerSum / gpVisits) : null;
  const scenarioPaid = Math.round(
    avgPaid > 0 ? avgPaid : (extra?.retailPriceMinor ?? 0),
  );
  const scenarios = buildScenarioResults({
    paidMinor: scenarioPaid,
    retailPriceMinor: avgRetail != null ? Math.round(avgRetail) : null,
    months: Math.max(1, avgMonths),
    settings: ctx.settings,
    salesCommissionPct: ctx.costs.salesCommissionPct,
    avgTrainerPerVisitMinor:
      avgTrainerPerVisit ?? ctx.clubTrainerPerVisitMinor ?? 0,
    fact: {
      gpVisits: n ? Math.round(avg(list.map((x) => x.gpVisits))) : 0,
      gymVisits: n ? Math.round(avg(list.map((x) => x.gymVisits))) : 0,
      trainerMinor: n ? Math.round(trainerSum / n) : 0,
      ptUsed: n ? Math.round(avg(list.map((x) => x.ptUsed))) : 0,
      massageUsed: n ? Math.round(avg(list.map((x) => x.massageUsed))) : 0,
      bodyCompositionUsed: n ? Math.round(avg(list.map((x) => x.bodyUsed))) : 0,
      solariumMinutesUsed: n
        ? Math.round(avg(list.map((x) => x.solariumMinutesUsed)))
        : 0,
      personalAccountSpentMinor: n
        ? Math.round(avg(list.map((x) => x.personalAccountSpentMinor)))
        : 0,
    },
    quotas: {
      pt: quotas.pt,
      massage: quotas.massage,
      bodyComposition: quotas.body,
      solariumMinutes: quotas.solariumMinutes,
      personalAccountCreditMinor: quotas.paCreditMinor,
    },
    costs: {
      ptCostMinor: ctx.costs.ptCostMinor,
      massageCostMinor: ctx.costs.massageCostMinor,
      bodyCompositionCostMinor: ctx.costs.bodyCompositionCostMinor,
      solariumMinuteCostMinor: ctx.costs.solariumMinuteCostMinor,
    },
  });

  const gpEstimated = sum(list.map((x) => x.gpEstimatedVisits));
  return {
    count: n,
    paidSum,
    avgPaid,
    avgRetail,
    avgDiscountPct: discountPcts.length ? round1(avg(discountPcts)) : null,
    soldWithDiscountShare: n ? round1((discounted.length / n) * 100) : null,
    avgMonths,
    avgGpPerMonth: n ? avg(list.map((x) => x.gpPerMonth)) : 0,
    avgGymPerMonth: n
      ? avg(list.map((x) => x.gymVisits / Math.max(0.1, x.monthsObserved)))
      : 0,
    gpVisits,
    trainerSum,
    avgTrainerPerVisit,
    avgTrainerCost: n ? trainerSum / n : 0,
    gpAccessPerVisit: gpVisits > 0 ? Math.round(accessGpSum / gpVisits) : null,
    ptUsePct: avgPct(
      list.map((x) => (x.ptQuota > 0 ? x.ptUsed / x.ptQuota : null)),
    ),
    massageUsePct: avgPct(
      list.map((x) =>
        x.massageQuota > 0 ? x.massageUsed / x.massageQuota : null,
      ),
    ),
    solariumUsePct: avgPct(
      list.map((x) =>
        x.solariumMinutesQuota > 0
          ? x.solariumMinutesUsed / x.solariumMinutesQuota
          : null,
      ),
    ),
    personalAccountUsePct: avgPct(
      list.map((x) =>
        x.personalAccountCreditedMinor > 0
          ? x.personalAccountSpentMinor / x.personalAccountCreditedMinor
          : null,
      ),
    ),
    burnedMinor: burned,
    burnedPct: paidSum > 0 ? round1((burned / paidSum) * 100) : null,
    cost: avgCost,
    marginSum,
    marginPct: paidSum > 0 ? round1((marginSum / paidSum) * 100) : null,
    breakevenVisits: median(
      list
        .map((x) => breakevenVisits(x.accessGpMinor, x.trainerPerVisitMinor))
        .filter((x): x is number => x != null),
    ),
    scenarios,
    estimatedGpShare:
      gpVisits > 0 ? round1((gpEstimated / gpVisits) * 100) : null,
  };
}

function profileQuotas(
  p: MembershipProductProfileDto,
): Pick<
  Quotas,
  "pt" | "massage" | "body" | "solariumMinutes" | "paCreditMinor"
> {
  const q = quotasFromProfile(p);
  return {
    pt: q.ptQuota,
    massage: q.massageQuota,
    body: q.bodyCompositionQuota,
    solariumMinutes: q.solariumMinutesQuota,
    paCreditMinor: q.personalAccountCreditedMinor,
  };
}

function resolveQuotas(
  profile: MembershipProductProfileDto | null,
  family: MembershipFamilyConfig | null,
  months: number,
): Quotas {
  if (profile) {
    return { ...profileQuotas(profile), complete: true };
  }
  if (family) {
    const q = quotasForTerm(family, months);
    return {
      pt: 0,
      massage: q.massageQuota,
      body: 0,
      solariumMinutes: q.solariumMinutesQuota,
      paCreditMinor: q.personalAccountCreditedMinor,
      complete: false,
    };
  }
  return {
    pt: 0,
    massage: 0,
    body: 0,
    solariumMinutes: 0,
    paCreditMinor: 0,
    complete: false,
  };
}

function resolveFamily(
  productName: string,
  profile: MembershipProductProfileDto | null,
  families: MembershipFamilyConfig[],
): MembershipFamilyConfig | null {
  const byName = matchFamily(productName, families);
  if (byName) return byName;
  if (profile?.groupLabel) {
    const label = normalizeName(profile.groupLabel);
    return families.find((f) => normalizeName(f.label) === label) ?? null;
  }
  return null;
}

function needsReview(profile: MembershipProductProfileDto | null): boolean {
  if (!profile) return true;
  return profile.autoFilledFields.some((f) => REVIEW_FIELDS.has(f));
}

function sumCosts(list: BuiltInstance[]) {
  const pick = (f: (c: MembershipCostBreakdown) => number) =>
    sum(list.map((x) => f(x.cost)));
  return {
    salesCommissionMinor: pick((c) => c.salesCommissionMinor),
    acquiringMinor: pick((c) => c.acquiringMinor),
    taxMinor: pick((c) => c.taxMinor),
    trainerMinor: pick((c) => c.trainerMinor),
    ptMinor: pick((c) => c.ptMinor),
    massageMinor: pick((c) => c.massageMinor),
    bodyCompositionMinor: pick((c) => c.bodyCompositionMinor),
    solariumMinor: pick((c) => c.solariumMinor),
    personalAccountCogsMinor: pick((c) => c.personalAccountCogsMinor),
    overheadMinor: pick((c) => c.overheadMinor),
  };
}

function averageCost(
  costs: MembershipCostBreakdown[],
): MembershipCostBreakdown {
  const n = costs.length;
  const a = (f: (c: MembershipCostBreakdown) => number) =>
    n ? Math.round(sum(costs.map(f)) / n) : 0;
  return {
    salesCommissionMinor: a((c) => c.salesCommissionMinor),
    acquiringMinor: a((c) => c.acquiringMinor),
    taxMinor: a((c) => c.taxMinor),
    trainerMinor: a((c) => c.trainerMinor),
    ptMinor: a((c) => c.ptMinor),
    massageMinor: a((c) => c.massageMinor),
    bodyCompositionMinor: a((c) => c.bodyCompositionMinor),
    solariumMinor: a((c) => c.solariumMinor),
    personalAccountCogsMinor: a((c) => c.personalAccountCogsMinor),
    overheadMinor: a((c) => c.overheadMinor),
    fixedOverheadMinor: a((c) => c.fixedOverheadMinor),
    totalMinor: a((c) => c.totalMinor),
    variableTotalMinor: a((c) => c.variableTotalMinor),
  };
}

function buildServicePromise(
  list: BuiltInstance[],
  costs: ResolvedCosts,
): MembershipServicePromiseRow[] {
  const ended = list.filter((x) => x.ended);
  const unused = (
    quota: (x: BuiltInstance) => number,
    used: (x: BuiltInstance) => number,
  ) => sum(ended.map((x) => Math.max(0, quota(x) - used(x))));

  const ptQuota = sum(list.map((x) => x.ptQuota));
  const ptUsed = sum(list.map((x) => x.ptUsed));
  const ptBurned = unused(
    (x) => x.ptQuota,
    (x) => x.ptUsed,
  );
  const massageQuota = sum(list.map((x) => x.massageQuota));
  const massageUsed = sum(list.map((x) => x.massageUsed));
  const massageBurned = unused(
    (x) => x.massageQuota,
    (x) => x.massageUsed,
  );
  const bodyQuota = sum(list.map((x) => x.bodyQuota));
  const bodyUsed = sum(list.map((x) => x.bodyUsed));
  const bodyBurned = unused(
    (x) => x.bodyQuota,
    (x) => x.bodyUsed,
  );
  const solQuota = sum(list.map((x) => x.solariumMinutesQuota));
  const solUsed = sum(list.map((x) => x.solariumMinutesUsed));
  const solBurned = unused(
    (x) => x.solariumMinutesQuota,
    (x) => x.solariumMinutesUsed,
  );
  const accessGp = sum(list.map((x) => x.accessGpMinor));
  const accessGym = sum(list.map((x) => x.accessGymMinor));

  // PT / body composition have no retail price in settings → valued at club cost.
  return [
    {
      key: "gp",
      label: "ГП (доступ)",
      promisedMinor: accessGp,
      usedMinor: accessGp,
      burnedMinor: 0,
      usedQty: sum(list.map((x) => x.gpVisits)),
    },
    {
      key: "gym",
      label: "Зал (доступ)",
      promisedMinor: accessGym,
      usedMinor: accessGym,
      burnedMinor: 0,
      usedQty: sum(list.map((x) => x.gymVisits)),
    },
    {
      key: "pt",
      label: "ПТ (подарок)",
      promisedMinor: ptQuota * costs.ptCostMinor,
      usedMinor: ptUsed * costs.ptCostMinor,
      burnedMinor: ptBurned * costs.ptCostMinor,
      promisedQty: ptQuota,
      usedQty: ptUsed,
      burnedQty: ptBurned,
    },
    {
      key: "massage",
      label: "Массаж",
      promisedMinor: massageQuota * costs.massageRetailMinor,
      usedMinor: massageUsed * costs.massageRetailMinor,
      burnedMinor: massageBurned * costs.massageRetailMinor,
      promisedQty: massageQuota,
      usedQty: massageUsed,
      burnedQty: massageBurned,
    },
    {
      key: "bodyComposition",
      label: "Анализ состава тела",
      promisedMinor: bodyQuota * costs.bodyCompositionCostMinor,
      usedMinor: bodyUsed * costs.bodyCompositionCostMinor,
      burnedMinor: bodyBurned * costs.bodyCompositionCostMinor,
      promisedQty: bodyQuota,
      usedQty: bodyUsed,
      burnedQty: bodyBurned,
    },
    {
      key: "solarium",
      label: "Солярий",
      promisedMinor: solQuota * costs.solariumMinuteRetailMinor,
      usedMinor: solUsed * costs.solariumMinuteRetailMinor,
      burnedMinor: solBurned * costs.solariumMinuteRetailMinor,
      promisedQty: solQuota,
      usedQty: solUsed,
      burnedQty: solBurned,
    },
    {
      key: "personalAccount",
      label: "Лицевой счёт",
      promisedMinor: sum(list.map((x) => x.personalAccountCreditedMinor)),
      usedMinor: sum(list.map((x) => x.personalAccountSpentMinor)),
      burnedMinor: sum(list.map((x) => x.personalAccountBurnedMinor)),
    },
  ];
}

function buildDiscountRows(list: BuiltInstance[]): {
  discounts: MembershipDiscountRow[];
  withoutDiscount: MembershipDiscountsReport["withoutDiscount"];
} {
  const withDiscount = list.filter((x) => x.discountName);
  const byName = groupBy(withDiscount, (x) => x.discountName!);
  const discounts: MembershipDiscountRow[] = [];
  for (const [discountName, rows] of byName) {
    const paidSum = sum(rows.map((x) => x.paidMinor));
    const marginSum = sum(rows.map((x) => x.marginMinor));
    const pcts = rows.map((x) => {
      const base = x.retailPriceMinor ?? x.paidMinor + x.discountAmountMinor;
      return base > 0 ? clampPct((x.discountAmountMinor / base) * 100) : 0;
    });
    const retail = rows.map(
      (x) => x.retailPriceMinor ?? x.paidMinor + x.discountAmountMinor,
    );
    discounts.push({
      discountName,
      salesCount: rows.length,
      discountAmountMinor: sum(rows.map((x) => x.discountAmountMinor)),
      avgDiscountPct: pcts.length ? round1(avg(pcts)) : null,
      avgPaidMinor: Math.round(paidSum / rows.length),
      avgRetailMinor: retail.length ? Math.round(avg(retail)) : null,
      // Total club margin earned from sales under this promo.
      marginMinor: marginSum,
      marginPct: paidSum > 0 ? round1((marginSum / paidSum) * 100) : null,
      avgGpPerMonth: round1(avg(rows.map((x) => x.gpPerMonth))),
    });
  }
  discounts.sort((a, b) => b.salesCount - a.salesCount);

  const plain = list.filter((x) => !x.discountName);
  const plainPaid = sum(plain.map((x) => x.paidMinor));
  return {
    discounts,
    withoutDiscount: plain.length
      ? {
          salesCount: plain.length,
          avgPaidMinor: Math.round(plainPaid / plain.length),
          marginPct:
            plainPaid > 0
              ? round1((sum(plain.map((x) => x.marginMinor)) / plainPaid) * 100)
              : null,
          avgGpPerMonth: round1(avg(plain.map((x) => x.gpPerMonth))),
        }
      : null,
  };
}

// ── GP trainer cost ─────────────────────────────────────────────────────────

/**
 * Trainer cost attributed to one attended GP visit.
 * - share: earn / quantity from payroll (real); tier estimate when no earn.
 * - marginal: tier(attended) − tier(attended−1) with clamped tiers.
 * Does NOT mutate shared resolveGroupSessionRateMinor (payroll uses that).
 */
function gpVisitCost(
  v: VisitRow,
  attendedBySession: Map<string, number>,
  earnings: EarningsMap,
  method: MembershipEconomicsSettings["gpCostMethod"],
): { costMinor: number; estimated: boolean } {
  const earn = earnings.get(v.sessionExternalId);
  const hasEarn = !!earn && earn.quantity > 0;
  const attended = Math.max(
    v.attendedCount,
    attendedBySession.get(v.sessionExternalId) ?? 0,
  );
  const roomKey = resolveGroupRoomKey(earn?.roomTitle ?? v.roomTitle);
  const rate = (n: number) => estimateGroupSessionRateMinor(n, roomKey);

  if (method === "marginal") {
    const n = hasEarn ? earn!.quantity : attended;
    if (n <= 0) return { costMinor: 0, estimated: !hasEarn };
    return {
      costMinor: Math.max(0, rate(n) - rate(Math.max(0, n - 1))),
      estimated: !hasEarn,
    };
  }
  if (hasEarn) {
    return {
      costMinor: Math.round(earn!.earnMinor / earn!.quantity),
      estimated: false,
    };
  }
  return {
    costMinor: attended > 0 ? Math.round(rate(attended) / attended) : 0,
    estimated: true,
  };
}

/**
 * Analytics-only tier lookup: clamp attendees into the nearest tier so
 * 1–2 people and overflow rooms are not silently zero (payroll shared fn
 * returns 0 outside exact matches).
 */
function estimateGroupSessionRateMinor(
  attendees: number,
  roomKey: GroupRoomKey | undefined,
): number {
  if (attendees <= 0) return 0;
  const preferredKeys: GroupRoomKey[] = roomKey
    ? [roomKey]
    : attendees >= 11
      ? ["GROUP_LARGE", "GROUP_SMALL", "REFORMER", "GYM"]
      : ["GROUP_SMALL", "GROUP_LARGE", "REFORMER", "GYM"];

  for (const key of preferredKeys) {
    const pool = ESTIMATE_TIERS.filter((t) => t.roomKey === key).sort(
      (a, b) => a.minAttendees - b.minAttendees,
    );
    if (!pool.length) continue;
    const exact = pool.find(
      (t) =>
        attendees >= t.minAttendees &&
        (t.maxAttendees == null || attendees <= t.maxAttendees),
    );
    if (exact) return exact.rateMinor;
    if (attendees < pool[0]!.minAttendees) return pool[0]!.rateMinor;
    return pool[pool.length - 1]!.rateMinor;
  }
  // Last resort — call shared resolver without room (legacy flat path).
  return resolveGroupSessionRateMinor(attendees, undefined, ESTIMATE_TIERS);
}

function splitIsoRangeInclusive(
  from: string,
  to: string,
  maxDays: number,
): Array<{ from: string; to: string }> {
  if (from > to) return [];
  const span = Math.max(1, maxDays);
  const out: Array<{ from: string; to: string }> = [];
  let cursor = from;
  while (cursor <= to) {
    const chunkTo = (() => {
      const d = addDaysIso(cursor, span - 1);
      return d <= to ? d : to;
    })();
    out.push({ from: cursor, to: chunkTo });
    cursor = addDaysIso(chunkTo, 1);
  }
  return out;
}

// ── Sales / visit linking ───────────────────────────────────────────────────

function groupSaleRows(
  rows: Array<{
    externalId: string;
    documentId: string | null;
    operationType: string;
    productName: string | null;
    productExternalId: string | null;
    paidAmount: number;
    saleAmount: number;
    refundAmount: number;
    occurredAt: Date;
    clientExternalId: string | null;
    clientName: string | null;
  }>,
): SaleDoc[] {
  const map = new Map<string, SaleDoc>();
  for (const r of rows) {
    if (!r.clientExternalId) continue;
    const name = r.productName?.trim();
    if (!name && !r.productExternalId) continue;
    // Collapse payment registrar vs sale document into one membership instance.
    const basisId = preferredSaleBasisId({
      externalId: r.externalId,
      documentId: r.documentId,
    });
    const productPart = r.productExternalId ?? normalizeName(name ?? "");
    const key = `${basisId}|${productPart}`;
    const cur = map.get(key) ?? {
      key,
      documentId: basisId,
      productExternalId: r.productExternalId,
      productName: name ?? "",
      paidMinor: 0,
      saleMinor: 0,
      refundMinor: 0,
      occurredAt: r.occurredAt,
      clientExternalId: r.clientExternalId,
      clientName: r.clientName ?? "",
    };
    if (r.operationType !== "refund") cur.paidMinor += toMinor(r.paidAmount);
    cur.refundMinor += toMinor(r.refundAmount);
    cur.saleMinor = Math.max(cur.saleMinor, toMinor(r.saleAmount));
    if (r.occurredAt < cur.occurredAt) cur.occurredAt = r.occurredAt;
    if (!cur.productName && name) cur.productName = name;
    if (!cur.productExternalId && r.productExternalId) {
      cur.productExternalId = r.productExternalId;
    }
    if (!cur.clientName && r.clientName) cur.clientName = r.clientName;
    map.set(key, cur);
  }
  return [...map.values()];
}

function buildVisitGroups(visits: VisitRow[]): VisitGroup[] {
  const map = new Map<string, VisitGroup>();
  for (const v of visits) {
    const basisName = membershipNameFromPaymentBasis(v.paymentBasis) ?? null;
    const key = v.packageDocId
      ? `${v.clientExternalId}|pkg:${v.packageDocId}`
      : `${v.clientExternalId}|basis:${v.paymentBasis ?? ""}`;
    const valid = isoDay(v.packageValidUntil);
    const cur = map.get(key);
    if (!cur) {
      map.set(key, {
        key,
        clientExternalId: v.clientExternalId,
        pkgId: v.packageDocId,
        basisName,
        basisStart: parseStartFromBasis(v.paymentBasis),
        visits: [v],
        firstDay: v.day,
        validUntil: valid,
      });
      continue;
    }
    cur.visits.push(v);
    if (v.day < cur.firstDay) cur.firstDay = v.day;
    if (valid && (!cur.validUntil || valid > cur.validUntil)) {
      cur.validUntil = valid;
    }
    if (!cur.basisName && basisName) cur.basisName = basisName;
    if (!cur.basisStart) cur.basisStart = parseStartFromBasis(v.paymentBasis);
  }
  return [...map.values()];
}

/** Window link: same client; sale must start on/before visit day. */
function pickWindowSale(
  g: VisitGroup,
  sales: PreInstance[],
): PreInstance | null {
  const basisName = g.basisName;
  if (!basisName) return null;
  // Never accept a sale that starts after the visit.
  const candidates = sales.filter(
    (s) =>
      s.startDay <= g.firstDay &&
      g.firstDay <= addDaysIso(s.endEstimate, 45),
  );
  if (!candidates.length) return null;

  const exact = candidates.filter((s) =>
    nameMatchesExactOrContains(basisName, s.doc.productName),
  );
  const pool = exact.length
    ? exact
    : candidates.filter((s) => {
        const a = matchFamily(basisName, s.family ? [s.family] : []);
        return a != null;
      });
  return pickBestSaleCandidate(g, pool);
}

function pickBestSaleCandidate(
  g: VisitGroup,
  pool: PreInstance[],
): PreInstance | null {
  if (!pool.length) return null;
  let best: PreInstance | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const s of pool) {
    const inTerm =
      g.firstDay >= s.startDay && g.firstDay <= s.endEstimate ? 0 : 500;
    const nameExact =
      g.basisName &&
      normalizeName(g.basisName) === normalizeName(s.doc.productName)
        ? 0
        : 50;
    const startDist = Math.abs(daysBetween(s.startDay, g.firstDay));
    const basisDist =
      g.basisStart != null
        ? Math.abs(daysBetween(s.startDay, g.basisStart))
        : 0;
    const score = inTerm + nameExact + startDist + basisDist * 0.5;
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

function nameMatchesExactOrContains(a: string, b: string): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // Prefer longer contains shorter to avoid «карта 4» matching «карта 20» loosely —
  // still allow substring when one clearly embeds the other product title.
  if (x.length >= 8 && y.length >= 8 && (x.includes(y) || y.includes(x))) {
    return true;
  }
  return false;
}

function findDiscounts(
  doc: SaleDoc,
  startDay: string,
  byDoc: Map<string, DiscountRow[]>,
  byKey: Map<string, DiscountRow[]>,
  claimed: Set<string>,
): DiscountRow[] {
  const matchesProduct = (d: DiscountRow): boolean => {
    if (d.productExternalId && doc.productExternalId) {
      return d.productExternalId === doc.productExternalId;
    }
    if (d.productName && doc.productName) {
      return nameMatchesExactOrContains(d.productName, doc.productName);
    }
    // No product on either side — only accept if the document has a single
    // candidate later; here require at least one name/id side present.
    return !d.productExternalId && !d.productName;
  };

  const take = (rows: DiscountRow[]): DiscountRow[] => {
    const out: DiscountRow[] = [];
    for (const d of rows) {
      if (claimed.has(d.id)) continue;
      if (!matchesProduct(d)) continue;
      claimed.add(d.id);
      out.push(d);
    }
    return out;
  };

  if (doc.documentId) {
    const direct = take(byDoc.get(doc.documentId) ?? []);
    if (direct.length) return direct;
  }
  const keys = [doc.productExternalId, normalizeName(doc.productName)].filter(
    (k): k is string => !!k,
  );
  for (const k of keys) {
    const hit = take(byKey.get(`${doc.clientExternalId}|${k}|${startDay}`) ?? []);
    if (hit.length) return hit;
  }
  return [];
}

function dedupeBySession(rows: VisitRow[]): VisitRow[] {
  const seen = new Set<string>();
  const out: VisitRow[] = [];
  for (const r of rows) {
    if (seen.has(r.sessionExternalId)) continue;
    seen.add(r.sessionExternalId);
    out.push(r);
  }
  return out;
}

// ── Profile autofill ────────────────────────────────────────────────────────

interface QuotaEvidence {
  pt: number;
  massage: number;
  body: number;
  solariumMinutes: number;
}

interface DraftValues {
  name: string;
  groupLabel: string | null;
  termMonths: number;
  accessGp: boolean;
  accessGym: boolean;
  ptIncluded: number;
  massageIncluded: number;
  bodyCompositionIncluded: number;
  solariumMinutes: number;
  personalAccountCreditMinor: number;
  excluded: boolean;
}

/** One-shot / PT session titles that are not club memberships. */
function looksLikeNonMembershipSku(name: string): boolean {
  const n = normalizeName(name);
  if (!n) return false;
  if (/разов(ый|ое|ая)|разовый вход|single\s*entry|guest\s*pass/.test(n)) {
    return true;
  }
  if (
    /занятие с тренер|персональн(ая|ое)\s*трениров|пт\s*\d|all\s*sports/.test(
      n,
    ) &&
    !/абонемент|членств|vip|единый|безлимит|все включено|карта посещ/.test(n)
  ) {
    return true;
  }
  if (/^групповое занятие/.test(n) && !/абонемент|пакет|карта/.test(n)) {
    return true;
  }
  return false;
}

function draftProfile(
  name: string,
  evidence: QuotaEvidence | null,
  families: MembershipFamilyConfig[],
): { values: DraftValues; auto: string[] } {
  const auto = new Set<string>(["name", "termMonths"]);
  const family = matchFamily(name, families);
  const termMonths = Math.max(
    1,
    parseMonthsFromTitle(name, family?.defaultMonths ?? 1),
  );
  const groupLabel = inferGroupLabel(name) ?? family?.label ?? null;
  if (groupLabel) auto.add("groupLabel");

  const excluded = looksLikeNonMembershipSku(name);
  if (excluded) auto.add("excluded");

  const accessGp = family?.includesGp ?? !excluded;
  const accessGym = family?.includesGym ?? !excluded;
  if (family) {
    auto.add("accessGp");
    auto.add("accessGym");
  }

  const q = family ? quotasForTerm(family, termMonths) : null;
  const pick = (
    snapshotValue: number | undefined,
    familyValue: number,
    field: string,
  ): number => {
    if (snapshotValue != null && snapshotValue > 0) {
      auto.add(field);
      return snapshotValue;
    }
    if (familyValue > 0) {
      auto.add(field);
      return familyValue;
    }
    return 0;
  };

  const values: DraftValues = {
    name,
    groupLabel,
    termMonths,
    accessGp,
    accessGym,
    excluded,
    ptIncluded: pick(evidence?.pt, 0, "ptIncluded"),
    massageIncluded: pick(
      evidence?.massage,
      q?.massageQuota ?? 0,
      "massageIncluded",
    ),
    bodyCompositionIncluded: pick(evidence?.body, 0, "bodyCompositionIncluded"),
    solariumMinutes: pick(
      evidence?.solariumMinutes,
      q?.solariumMinutesQuota ?? 0,
      "solariumMinutes",
    ),
    personalAccountCreditMinor: pick(
      undefined,
      q?.personalAccountCreditedMinor ?? 0,
      "personalAccountCreditMinor",
    ),
  };
  return { values, auto: [...auto] };
}

function parseServicesJson(
  raw: unknown,
): Array<{ name: string; remaining: number | null }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ name: string; remaining: number | null }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name : "";
    if (!name) continue;
    const rem = Number(o.remaining);
    out.push({
      name,
      remaining: Number.isFinite(rem)
        ? rem
        : classifyPackServiceName(name).remaining,
    });
  }
  return out;
}

function parseStringArray(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((x): x is string => typeof x === "string")
    : [];
}

function toProfileDto(
  row: MembershipProductProfile,
): MembershipProductProfileDto {
  return {
    id: row.id,
    clubId: row.clubId,
    productExternalId: row.productExternalId,
    name: row.name,
    groupLabel: row.groupLabel,
    termMonths: row.termMonths,
    accessGp: row.accessGp,
    accessGym: row.accessGym,
    gpVisitsLimit: row.gpVisitsLimit,
    ptIncluded: row.ptIncluded,
    massageIncluded: row.massageIncluded,
    bodyCompositionIncluded: row.bodyCompositionIncluded,
    solariumMinutes: row.solariumMinutes,
    personalAccountCreditMinor: row.personalAccountCreditMinor,
    retailPriceOverrideMinor: row.retailPriceOverrideMinor,
    excluded: row.excluded,
    autoFilledFields: parseStringArray(row.autoFilledFields),
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

function sanitizeProfilePatch(
  body: MembershipProductProfilePatch,
): MembershipProductProfilePatch {
  const out: Record<string, string | number | boolean | null> = {};
  const src = (body ?? {}) as Record<string, unknown>;
  const int = (
    field: string,
    min: number,
    max: number,
    nullable = false,
  ): void => {
    if (!(field in src)) return;
    const v = src[field];
    if (v === null && nullable) {
      out[field] = null;
      return;
    }
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) {
      throw new BadRequestException(`${field} must be ${min}..${max}`);
    }
    out[field] = Math.round(n);
  };
  const bool = (field: string): void => {
    if (!(field in src)) return;
    out[field] = Boolean(src[field]);
  };

  if ("name" in src) {
    const name = String(src.name ?? "").trim();
    if (!name) throw new BadRequestException("name must not be empty");
    out.name = name;
  }
  if ("groupLabel" in src) {
    const label = src.groupLabel == null ? "" : String(src.groupLabel).trim();
    out.groupLabel = label || null;
  }
  int("termMonths", 1, 60);
  bool("accessGp");
  bool("accessGym");
  int("gpVisitsLimit", 0, 10_000, true);
  int("ptIncluded", 0, 1000);
  int("massageIncluded", 0, 1000);
  int("bodyCompositionIncluded", 0, 1000);
  int("solariumMinutes", 0, 100_000);
  int("personalAccountCreditMinor", 0, 100_000_000);
  int("retailPriceOverrideMinor", 0, 100_000_000, true);
  bool("excluded");
  return out as MembershipProductProfilePatch;
}

// ── Payroll hint helpers ────────────────────────────────────────────────────

interface PayrollBuckets {
  admin: number[];
  manager: number[];
  massage: number[];
  body: number[];
  ptGift: number[];
}

function asPayProfile(raw: unknown): StaffPayProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Partial<StaffPayProfile>;
  return typeof o.track === "string" ? (o as StaffPayProfile) : null;
}

function avgPositive(nums: number[], decimals: 0 | 1): number | null {
  const xs = nums.filter((n) => Number.isFinite(n) && n > 0);
  if (!xs.length) return null;
  const a = avg(xs);
  return decimals === 0 ? Math.round(a) : round1(a);
}

// ── Data quality ────────────────────────────────────────────────────────────

function dataQualityWarning(
  dq: Omit<MembershipDataQuality, "warning"> & { visitLinkCoverage: number },
): string | null {
  const parts: string[] = [];
  if (dq.packageDocCoverage < 0.8) {
    parts.push(
      `packageDocId у ${Math.round(dq.packageDocCoverage * 100)}% посещений ГП`,
    );
  }
  if (dq.visitLinkCoverage < 0.5) {
    parts.push(
      `визиты привязаны к ${Math.round(dq.visitLinkCoverage * 100)}% продаж`,
    );
  }
  if (dq.gpTrainerRateCoverage < 0.8) {
    parts.push(
      `оплата тренера из ЗП для ${Math.round(dq.gpTrainerRateCoverage * 100)}% визитов ГП (остальное — оценка по сетке)`,
    );
  }
  if (dq.discountMatchCoverage < 0.8) {
    parts.push(
      `скидки найдены у ${Math.round(dq.discountMatchCoverage * 100)}% продаж ниже прайса`,
    );
  }
  if (dq.profilesNeedingReview > 0) {
    parts.push(
      `${dq.profilesNeedingReview} абонементов с неподтверждённым составом`,
    );
  }
  return parts.length ? `Цифры оценочные: ${parts.join("; ")}.` : null;
}

// ── Small utilities ─────────────────────────────────────────────────────────

function normalizeBasis(
  basis?: MembershipEfficiencyBasis,
): MembershipEfficiencyBasis {
  return basis === "active" ? "active" : "ended";
}

function normalizeFamilyFilter(family?: string | string[]): string[] {
  if (!family) return [];
  const arr = Array.isArray(family) ? family : family.split(",");
  return arr.map((s) => s.trim()).filter(Boolean);
}

function filterByFamily(
  list: BuiltInstance[],
  familyFilter: string[],
): BuiltInstance[] {
  return familyFilter.length
    ? list.filter((i) => familyFilter.includes(i.familyId))
    : list;
}

function groupBy<T>(list: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of list) pushMap(map, key(item), item);
  return map;
}

function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function sum(nums: number[]): number {
  let total = 0;
  for (const n of nums) total += n;
  return total;
}

function avg(nums: number[]): number {
  return nums.length ? sum(nums) / nums.length : 0;
}

function avgPct(vals: Array<number | null>): number | null {
  const xs = vals.filter((v): v is number => v != null && Number.isFinite(v));
  if (!xs.length) return null;
  return round1(avg(xs) * 100);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clampPct(n: number): number {
  return Math.min(100, Math.max(0, n));
}

function bucketValue(v: number): number {
  return v <= 0 ? 0 : Math.ceil(v);
}

function inVisitBucket(v: number, min: number, max: number | null): boolean {
  if (max == null) return v >= min;
  if (min === 0 && max === 0) return v <= 0;
  return v >= min && v <= max;
}

function squashName(raw: string): string {
  return normalizeName(raw).replace(/[^a-zа-я0-9]+/g, "");
}

/** Calendar day in Europe/Minsk (UTC+3, no DST). */
function minskDay(d: Date): string {
  return new Date(d.getTime() + MINSK_OFFSET_MS).toISOString().slice(0, 10);
}

function addYears(iso: string, years: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString().slice(0, 10);
}
