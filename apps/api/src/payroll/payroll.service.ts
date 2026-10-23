import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  allPaySlices,
  advanceHalfRange,
  DEFAULT_GROUP_RATE_TIERS,
  DEFAULT_REFORMER_RATE_TIERS,
  monthSettlementRange,
  payProfileForAdvanceHalf,
  payProfileForCalculation,
  payProfileSummary,
  resolveFixedAdvanceMinor,
  splitAdvanceWave,
  isAsdGroupSession,
  isComplimentarySessionTitle,
  classifyPtSessionOrigin,
  isMultiVisitPackSale,
  isPtAllSportsSession,
  extractPackDateIsoFromBasis,
  isSpaAllSportsBioimpedance,
  isSpaLikeSessionTitle,
  resolveGroupRoomKey,
  resolveGroupSessionRateMinor,
  resolvePackageUnitPriceMinor,
  resolvePtPercent,
  sliceForTrack,
  TRAINER_GROUP_TRACK,
  trainerPayFlags,
  type TrainerGroupId,
  inferPaymentFromBasis,
  fitgoSessionKey,
  onexSessionKey,
  paymentCountsForMoney,
  paymentCountsForVolume,
  saleSessionKey,
  sameSlicePreviousMonth,
  type ClubPayrollReport,
  type ClubPayrollRow,
  type ClubPayrollSectionId,
  type MotivationRateDto,
  type PayrollAdjustmentDto,
  type PayrollCorporateSaleDto,
  type PayrollPeriodSummary,
  type PayrollPayoutDto,
  type PayrollPayoutKind,
  type PayrollAdvanceBreakdown,
  type PayrollPayoutPreview,
  type PayrollSelfOverview,
  type PayrollStaffDebt,
  type StaffCompensationDto,
  type StaffDepartment,
  type StaffEmploymentKind,
  type StaffPayProfile,
  type StaffPaySummary,
  type StaffPayTemplateDto,
  type StaffPayTrack,
  type MotivationCategoryBreakdown,
  type StaffPayTrackSlice,
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
import { ServiceUsageService } from '../service-usage/service-usage.service';
import { StaffRosterService } from '../staff-roster/staff-roster.service';
import { AdminSalesService } from '../admin-sales/admin-sales.service';
import { ClassSessionsSyncService } from '../class-sync/class-sessions-sync.service';
import { BookingControlService } from '../booking-control/booking-control.service';
import { FitnessService } from '../fitness/fitness.service';
import { normalizePhone } from '../common/phone.util';
import { isCollectibleClientDebt } from '../admin-sales/club-revenue-debt';
import {
  createAnalyticsProvider,
  fetchStaffSalesFromAnalytics,
} from './payroll-sales.helper';
import {
  isReformerPersonalNomenclature,
  loadPayrollSegmentSets,
} from '../admin-sales/admin-sales-segments';
import {
  clubRevenueHasPaidMoney,
  loadPackSalesForUnitPrice,
  loadTrainerPtSalesFromRevenue,
  matchPackSaleForUnitPrice,
  mergeTrainerPtSaleRows,
  overlayPtSaleDebtFromRevenue,
  trainerPtSaleDocKey,
  type TrainerPtSaleRow,
} from '../admin-sales/trainer-pt-sales-from-revenue';
import {
  buildPacksSameDayMap,
  loadSpaBlockSales,
  resolveSpaBlockUnitPrice,
  resolveSpaCatalogUnitMinor,
  type SpaBlockSaleDoc,
} from './spa-block-unit-price';
import {
  dateOnly,
  localMonthStartIso,
  localTodayIso,
  rateChangeHintText,
  utcDateKey,
} from './payroll-dates';

function asPayProfile(raw: unknown): StaffPayProfile | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as StaffPayProfile;
  if (!p.track) return undefined;
  return p;
}

/** Inclusive calendar months that overlap [from, to] (ISO dates). */
function calendarMonthsOverlapping(
  from: string,
  to: string,
): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  if (!fy || !fm || !ty || !tm) return out;
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    const monthFrom = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const monthTo = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    out.push({ from: monthFrom, to: monthTo });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Club-only trainers (Роль/схема = только «Тренеры клуб») are not paid in FitGO.
 * Keep them if they also have ГП / штат / реформер or another payroll role.
 */
function isClubTrainerOnlyPayrollSkip(user: {
  roles: readonly { role: Role }[] | readonly string[];
  groupPrograms?: boolean | null;
  trainerStaff?: boolean | null;
  trainerClub?: boolean | null;
  trainerReformers?: boolean | null;
  trainerGroupsSet?: boolean | null;
}): boolean {
  const roles = user.roles.map((r) =>
    typeof r === 'string' ? r : r.role,
  );
  const flags = trainerPayFlags({
    roles,
    groupPrograms: user.groupPrograms,
    trainerStaff: user.trainerStaff,
    trainerClub: user.trainerClub,
    trainerReformers: user.trainerReformers,
    trainerGroupsSet: user.trainerGroupsSet,
  });
  if (!flags.isTrainer) return false;
  if (!flags.club || flags.gp || flags.staff || flags.reformers) return false;
  const roleSet = new Set(roles.map(String));
  const hasOtherPayRole =
    roleSet.has(Role.ADMIN) ||
    roleSet.has(Role.MANAGER) ||
    roleSet.has(Role.SPECIALIST) ||
    roleSet.has(Role.TECH);
  return !hasOtherPayRole;
}

/** 1C employee codes as stored on User (externalId and/or employeeCode). */
function staffEmployeeCodes(user: {
  externalId?: string | null;
  employeeCode?: string | null;
}): string[] {
  const out = new Set<string>();
  for (const raw of [user.externalId, user.employeeCode]) {
    const t = raw?.trim();
    if (!t) continue;
    out.add(t);
    const stripped = t.replace(/^0+/, '');
    if (stripped) out.add(stripped);
  }
  return [...out];
}

function codesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? '').trim();
  const y = (b ?? '').trim();
  if (!x || !y) return false;
  if (x === y) return true;
  const xs = x.replace(/^0+/, '');
  const ys = y.replace(/^0+/, '');
  return Boolean(xs && ys && xs === ys);
}

function saleMatchesTrainer(
  sale: TrainerPtSaleRow,
  codes: string[],
  performerName: string,
): boolean {
  if (sale.employeeCode && codes.some((c) => codesMatch(c, sale.employeeCode))) {
    return true;
  }
  const saleName = (sale.employeeName ?? '').trim().toLowerCase();
  const name = performerName.trim().toLowerCase();
  return Boolean(name && saleName && name === saleName);
}

/** Partner bio row — flag, title, or AllSports partnerSource. */
function workUnitIsSpaPartnerBio(u: WorkUnit): boolean {
  if (u.isSpaAllSportsBioimpedance) return true;
  if (
    isSpaAllSportsBioimpedance({
      serviceExternalId: u.serviceExternalId,
      title: u.title,
    })
  ) {
    return true;
  }
  return (
    u.partnerSource?.toUpperCase() === 'ALLSPORTS' &&
    /биоимпеданс|bio.?imped/i.test(u.title ?? '')
  );
}

function revenueMatchesSpaPerformer(
  sale: {
    performerExternalId?: string | null;
    performerName?: string | null;
    employeeExternalId?: string | null;
    employeeName?: string | null;
  },
  codes: string[],
  performerName: string,
): boolean {
  // Prefer Исполнитель (line), not manager/author on the document header.
  if (
    sale.performerExternalId &&
    codes.some((c) => codesMatch(c, sale.performerExternalId))
  ) {
    return true;
  }
  const perfName = (sale.performerName ?? '').trim().toLowerCase();
  const name = performerName.trim().toLowerCase();
  if (name && perfName && (name === perfName || perfName.startsWith(name.split(' ')[0]!))) {
    return true;
  }
  // Fallback when 1C left performer empty — only if employee is the specialist.
  if (
    !sale.performerExternalId?.trim() &&
    !sale.performerName?.trim() &&
    sale.employeeExternalId &&
    codes.some((c) => codesMatch(c, sale.employeeExternalId))
  ) {
    return true;
  }
  return false;
}

const SECTION_LABELS: Record<ClubPayrollSectionId, string> = {
  MANAGER: 'Управляющий',
  ADMIN: 'Администраторы',
  TRAINER: 'Тренеры (ПТ / ГП)',
  SPECIALIST: 'SPA',
  TECH: 'Техперсонал',
  EXTERNAL: 'Сторонние специалисты',
};

const PAY_TRACK_LABELS: Record<StaffPayTrack, string> = {
  ADMIN: 'Админы',
  MANAGER: 'Управляющие',
  GROUP_TRAINER: 'Тренеры ГП',
  SPA: 'SPA',
  TECH: 'Техперсонал',
  PT: 'Тренеры штат',
  CLUB: 'Тренеры клуб',
  REFORMER: 'Реформеры',
};

const ALL_PAY_TRACKS: StaffPayTrack[] = [
  'ADMIN',
  'MANAGER',
  'GROUP_TRAINER',
  'SPA',
  'TECH',
  'PT',
  'CLUB',
  'REFORMER',
];

function isPayTrack(value: string): value is StaffPayTrack {
  return (ALL_PAY_TRACKS as string[]).includes(value);
}

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

const CLUB_SUMMARY_CACHE_TTL_MS = 60_000;
const CLUB_SUMMARY_CONCURRENCY = 5;

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

@Injectable()
export class PayrollService {
  /** One DB pull per club+period while club summary loops trainers. */
  private readonly ptSalesPeriodCache = new Map<
    string,
    Promise<TrainerPtSaleRow[]>
  >();

  /** Club payroll summary cache — avoids 4× recompute from analytics. */
  private readonly clubSummaryCache = new Map<
    string,
    { at: number; value: Promise<ClubPayrollReport> }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly serviceUsage: ServiceUsageService,
    private readonly groupSessions: GroupSessionService,
    private readonly staffRoster: StaffRosterService,
    private readonly adminSales: AdminSalesService,
    private readonly classSessionsSync: ClassSessionsSyncService,
    private readonly bookingControl: BookingControlService,
    private readonly fitness: FitnessService,
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
    const remarkKeys: string[] = [];

    const performer = await this.prisma.user.findFirst({
      where: { id: performerId, clubId },
      include: { roles: true },
    });
    const performerCodes = performer ? staffEmployeeCodes(performer) : [];
    const performerName = performer
      ? `${performer.lastName} ${performer.firstName}`.trim()
      : '';
    const payFlags = performer
      ? trainerPayFlags({
          roles: performer.roles.map((r) => r.role),
          groupPrograms: performer.groupPrograms,
          trainerStaff: performer.trainerStaff,
          trainerClub: performer.trainerClub,
          trainerReformers: performer.trainerReformers,
          trainerGroupsSet: performer.trainerGroupsSet,
        })
      : null;
    const needsPtSales =
      !!payFlags?.isTrainer &&
      (!!payFlags.staff || !!payFlags.club || !!payFlags.reformers);
    const isSpecialist = Boolean(
      performer?.roles.some((r) => r.role === Role.SPECIALIST),
    );
    // Pack unit = sale/N when class sync left packageAmount empty.
    // Trainers (PT packs) + SPA specialists (massage blocks).
    const needsPackUnitSales = !!payFlags?.isTrainer || isSpecialist;
    const payrollSegments = await loadPayrollSegmentSets(this.config);

    const performerOr =
      performerCodes.length > 0 || performerName
        ? {
            OR: [
              ...performerCodes.map((c) => ({ employeeExternalId: c })),
              ...(performerName ? [{ employeeName: performerName }] : []),
            ],
          }
        : { employeeExternalId: '__none__' };

    // Pack sales lookback: unit = sale/N when class members lack packageAmount.
    const packSalesForUnit =
      performer && needsPackUnitSales
        ? await loadPackSalesForUnitPrice(this.prisma, clubId, fromD, toD)
        : [];
    // Massage SaleTransaction docs for SPA block write-offs (sale lives on
    // «Продажа», not on ЧленствоПакетУслуг — member packageAmount is empty).
    const spaBlockSales: SpaBlockSaleDoc[] =
      performer && isSpecialist
        ? await loadSpaBlockSales(this.prisma, clubId, fromD, toD)
        : [];
    const spaCatalogCache = new Map<string, number | undefined>();
    const resolveSpaCatalogCached = async (
      serviceExternalId?: string | null,
      serviceId?: string | null,
    ): Promise<number | undefined> => {
      const key = `${serviceExternalId ?? ''}|${serviceId ?? ''}`;
      if (spaCatalogCache.has(key)) return spaCatalogCache.get(key);
      const v = await resolveSpaCatalogUnitMinor(this.prisma, clubId, {
        serviceExternalId,
        serviceId,
      });
      spaCatalogCache.set(key, v);
      return v;
    };

    // ── SPA from 1C (Onex) — FitGO-only never pays ─────────────────────────
    const onexSpa = await this.prisma.onexClassSession.findMany({
      where: {
        clubId,
        kind: 'SPA',
        status: 'COMPLETED',
        isActive: true,
        startAt: { gte: fromD, lte: toD },
        ...performerOr,
      },
      include: { members: true },
      orderBy: { startAt: 'asc' },
    });
    const spaPacksSameDay = buildPacksSameDayMap(
      onexSpa.flatMap((o) =>
        o.members
          .filter((m) => !m.cancelled)
          .map((m) => ({
            clientName: m.clientName,
            paymentBasis: m.paymentBasis,
            packageDocId: m.packageDocId,
          })),
      ),
    );
    for (const o of onexSpa) {
      const key = onexSessionKey(o.externalId);
      remarkKeys.push(key);
      const primary = o.members.find((m) => !m.cancelled) ?? o.members[0];
      const matched = await this.prisma.spaBooking.findFirst({
        where: {
          clubId,
          specialistId: performerId,
          OR: [
            ...(o.fitgoBookingRef
              ? [{ id: o.fitgoBookingRef }]
              : []),
            { crmDocRef: o.externalId },
            ...(o.number ? [{ crmDocRef: o.number }] : []),
          ],
        },
        include: { service: true, client: true },
      });
      const serviceExternalId =
        o.serviceExternalId ?? matched?.service.externalId ?? undefined;
      const bioimpedance = isSpaAllSportsBioimpedance({
        serviceExternalId,
        title: o.title,
      });
      const payment = bioimpedance
        ? 'PARTNER'
        : inferPaymentFromBasis(primary?.paymentBasis);
      const writeOffOrigin = classifyPtSessionOrigin({
        paymentBasis: primary?.paymentBasis,
        sessionTitle: o.title,
        packageQty: primary?.packageQty,
      });
      const isMembershipQuota = writeOffOrigin === 'MEMBERSHIP';
      const isServiceBlock = writeOffOrigin === 'BLOCK';
      let unitFromPackage = resolvePackageUnitPriceMinor({
        unitPriceMinor: primary?.unitPriceMinor,
        packageAmountMinor: primary?.packageAmountMinor,
        packageQty: primary?.packageQty,
        paymentBasis: primary?.paymentBasis,
        sessionTitle: o.title,
      });
      let packSaleExt: string | undefined;
      let packSaleAt: string | undefined;
      // Prefer paid pack sale / N over 1C unit (often catalog÷N → 75/10=7.50).
      if (primary?.clientName) {
        const packMatch = matchPackSaleForUnitPrice(
          packSalesForUnit,
          primary.clientName,
          primary.paymentBasis,
          o.title,
        );
        if (packMatch) {
          unitFromPackage = packMatch.unitPriceMinor;
          packSaleExt = packMatch.externalId;
          packSaleAt = packMatch.occurredAt;
        }
      }
      const packDateIso = extractPackDateIsoFromBasis(primary?.paymentBasis);
      let priceMinor =
        unitFromPackage ??
        matched?.priceMinor ??
        matched?.service.priceMinor ??
        undefined;
      let spaBlockPriceSource: WorkUnit['spaBlockPriceSource'];
      let trustBand: WorkUnit['trustBand'] = 'GREEN';
      // Block write-off without 1C unit → SaleTransaction / N, else catalog −%.
      if (
        isServiceBlock &&
        !bioimpedance &&
        !(priceMinor != null && priceMinor > 0) &&
        primary?.clientName
      ) {
        const clientKey = `${primary.clientName
          .trim()
          .toLowerCase()
          .replace(/ё/g, 'е')
          .replace(/\s+/g, ' ')}|${packDateIso ?? ''}`;
        const catalogUnitMinor = await resolveSpaCatalogCached(
          serviceExternalId,
          matched?.serviceId,
        );
        const blockMatch = resolveSpaBlockUnitPrice({
          sales: spaBlockSales,
          clientName: primary.clientName,
          paymentBasis: primary.paymentBasis,
          sessionTitle: o.title,
          packsSameDay: spaPacksSameDay.get(clientKey) ?? 1,
          catalogUnitMinor,
        });
        if (blockMatch) {
          priceMinor = blockMatch.unitPriceMinor;
          spaBlockPriceSource = blockMatch.source;
          if (blockMatch.source === 'SALE') {
            packSaleExt = blockMatch.externalId ?? packSaleExt;
            packSaleAt = blockMatch.occurredAt ?? packSaleAt;
          } else {
            trustBand = 'AMBER';
          }
        }
      }
      const partner =
        payment === 'PARTNER' || bioimpedance
          ? 'ALLSPORTS'
          : matched?.partnerSource ?? undefined;
      const isPackage =
        (primary?.paySource ?? '').toUpperCase() === 'PACKAGE' ||
        payment === 'QUOTA';
      // VIP-included quota only → spaQuotaRates (price 0). Massage/PT blocks keep
      // unit price for spaSoldPercent × unit — never the membership fixed rate.
      if (
        payment === 'QUOTA' &&
        isMembershipQuota &&
        !bioimpedance &&
        !(priceMinor != null && priceMinor > 0)
      ) {
        priceMinor = 0;
      }
      const packageTitleSuffix = isMembershipQuota
        ? ' (абонемент)'
        : isServiceBlock
          ? ' (блок)'
          : isPackage
            ? ' (абонемент)'
            : '';
      units.push({
        id: matched?.id ?? `onex:${o.id}`,
        kind: 'SPA',
        performerId,
        title:
          !bioimpedance && packageTitleSuffix
            ? `${o.title || 'SPA'}${packageTitleSuffix}`
            : o.title,
        occurredAt: o.startAt.toISOString(),
        quantity: 1,
        priceMinor,
        trustBand,
        trustResolution: 'NONE',
        payrollTrusted: paymentCountsForMoney(payment) || bioimpedance,
        clientName: primary?.clientName,
        serviceId: matched?.serviceId,
        serviceExternalId,
        partnerSource: partner,
        isSpaAllSportsBioimpedance: bioimpedance,
        spaMembershipQuota:
          !bioimpedance && isPackage ? isMembershipQuota : undefined,
        spaBlockPriceSource,
        sessionId: o.id,
        sessionKey: key,
        saleExternalId:
          packSaleExt ||
          matched?.linkedSaleExternalId?.trim() ||
          undefined,
        saleOccurredAt:
          packSaleAt ||
          (packDateIso ? `${packDateIso}T12:00:00.000Z` : undefined),
      });
    }

    // ── SPA from linked reception sales (no 1C visit / onex row) ────────────
    const spaPaidViaOnex = new Set(
      units.filter((u) => u.kind === 'SPA').map((u) => u.id),
    );
    const linkedSpaBookings = await this.prisma.spaBooking.findMany({
      where: {
        clubId,
        specialistId: performerId,
        linkedSaleExternalId: { not: null },
        startAt: { gte: fromD, lte: toD },
        status: { not: 'CANCELLED' },
        paymentStatus: 'PAID',
      },
      include: { service: true, client: true },
    });
    for (const b of linkedSpaBookings) {
      if (spaPaidViaOnex.has(b.id)) continue;
      // Visit already in units (matched onex) — do not pay twice from the sale.
      if (
        b.crmDocRef?.trim() &&
        onexSpa.some(
          (o) =>
            o.externalId === b.crmDocRef || o.number === b.crmDocRef,
        )
      ) {
        continue;
      }
      const saleExt = b.linkedSaleExternalId!.trim();
      const sale = await this.prisma.clubRevenueEntry.findFirst({
        where: { clubId, externalId: saleExt, isActive: true },
      });
      if (!sale) continue;
      const bioimpedance = isSpaAllSportsBioimpedance({
        serviceExternalId: b.service.externalId,
        title: b.service.name,
      });
      // Debt / unpaid: never pay SPA from saleAmount. Only real money counts
      // (same rule as PT one-shots and admin % from SaleTransaction paidAt).
      if (!clubRevenueHasPaidMoney(sale) && !bioimpedance) continue;
      // Multi-visit pack sale («Блок массажа 10») is not SPA motivation —
      // only conducted write-offs pay (pack amount / N).
      if (isMultiVisitPackSale(sale.productName)) continue;
      const amountMajor =
        Number(sale.paidAmount) ||
        Number(sale.personalAccount) ||
        (Number(sale.cash) || 0) +
          (Number(sale.card) || 0) +
          (Number(sale.cashless) || 0) ||
        0;
      // Free AllSports биоимпеданс: 0 BYN in 1C, pay spaPartnerRateMinor from profile.
      if (amountMajor < 0.01 && !bioimpedance) continue;
      const priceMinor = Math.round(amountMajor * 100);
      const clientName = b.client
        ? `${b.client.lastName} ${b.client.firstName}`.trim()
        : b.guestName ?? undefined;
      units.push({
        id: b.id,
        kind: 'SPA',
        performerId,
        title: b.service.name,
        occurredAt: b.startAt.toISOString(),
        quantity: 1,
        priceMinor,
        trustBand: 'GREEN',
        trustResolution: 'NONE',
        payrollTrusted: true,
        clientName,
        serviceId: b.serviceId,
        serviceExternalId: b.service.externalId ?? undefined,
        partnerSource:
          bioimpedance || b.partnerSource?.toUpperCase() === 'ALLSPORTS'
            ? 'ALLSPORTS'
            : b.partnerSource ?? undefined,
        isSpaAllSportsBioimpedance: bioimpedance,
        sessionKey: fitgoSessionKey('SPA', b.id),
        saleExternalId: saleExt,
      });
      spaPaidViaOnex.add(b.id);
    }

    // FitGO SPA AllSports биоимпеданс без onex / без денежной продажи в 1С.
    const partnerSpaBookings = await this.prisma.spaBooking.findMany({
      where: {
        clubId,
        specialistId: performerId,
        startAt: { gte: fromD, lte: toD },
        status: { not: 'CANCELLED' },
      },
      include: { service: true, client: true },
    });
    for (const b of partnerSpaBookings) {
      if (spaPaidViaOnex.has(b.id)) continue;
      const bioimpedance = isSpaAllSportsBioimpedance({
        serviceExternalId: b.service.externalId,
        title: b.service.name,
      });
      if (!bioimpedance) continue;
      const clientName = b.client
        ? `${b.client.lastName} ${b.client.firstName}`.trim()
        : b.guestName ?? undefined;
      units.push({
        id: b.id,
        kind: 'SPA',
        performerId,
        title: b.service.name,
        occurredAt: b.startAt.toISOString(),
        quantity: 1,
        priceMinor: 0,
        trustBand: 'GREEN',
        trustResolution: 'NONE',
        payrollTrusted: true,
        clientName,
        serviceId: b.serviceId,
        serviceExternalId: b.service.externalId ?? undefined,
        partnerSource: 'ALLSPORTS',
        isSpaAllSportsBioimpedance: true,
        sessionKey: fitgoSessionKey('SPA', b.id),
        saleExternalId: b.linkedSaleExternalId?.trim() || undefined,
      });
      spaPaidViaOnex.add(b.id);
    }

    // Free AllSports биоимпеданс from ClubRevenue by Исполнитель (sale alone).
    // Sale doc has manager + performer; motivation goes to performer, not author.
    if (isSpecialist) {
      const bioRevenue = await this.prisma.clubRevenueEntry.findMany({
        where: {
          clubId,
          isActive: true,
          occurredAt: { gte: fromD, lte: toD },
          OR: [
            { productName: { contains: 'биоимпеданс', mode: 'insensitive' } },
            { productName: { contains: 'bioimped', mode: 'insensitive' } },
          ],
        },
      });
      const takenSaleExt = new Set(
        units
          .filter((u) => u.kind === 'SPA' && u.saleExternalId)
          .map((u) => u.saleExternalId!.trim()),
      );
      const takenDayClient = new Set(
        units
          .filter((u) => u.kind === 'SPA')
          .map((u) => {
            const day = u.occurredAt.slice(0, 10);
            const client = (u.clientName ?? '').trim().toLowerCase();
            return `${day}|${client}`;
          }),
      );
      for (const sale of bioRevenue) {
        if (
          !isSpaAllSportsBioimpedance({
            serviceExternalId: sale.productExternalId,
            title: sale.productName,
          })
        ) {
          continue;
        }
        if (!revenueMatchesSpaPerformer(sale, performerCodes, performerName)) {
          continue;
        }
        const money =
          Math.abs(Number(sale.saleAmount) || 0) +
          Math.abs(Number(sale.paidAmount) || 0) +
          Math.abs(Number(sale.amount) || 0) +
          Math.abs(Number(sale.cash) || 0) +
          Math.abs(Number(sale.card) || 0) +
          Math.abs(Number(sale.cashless) || 0) +
          Math.abs(Number(sale.personalAccount) || 0);
        // Paid bioimpedance (rare) is handled via linked SpaBooking / onex %.
        if (money > 0.01) continue;
        const saleExt = sale.externalId?.trim();
        if (saleExt && takenSaleExt.has(saleExt)) continue;
        const day = sale.occurredAt.toISOString().slice(0, 10);
        const client = (sale.clientName ?? '').trim().toLowerCase();
        const dayClient = `${day}|${client}`;
        if (client && takenDayClient.has(dayClient)) continue;
        const unitId = `revbio:${saleExt || sale.id}`;
        if (spaPaidViaOnex.has(unitId)) continue;
        units.push({
          id: unitId,
          kind: 'SPA',
          performerId,
          title: sale.productName || 'Allsports БИОИМПЕДАНС',
          occurredAt: sale.occurredAt.toISOString(),
          quantity: 1,
          priceMinor: 0,
          trustBand: 'GREEN',
          trustResolution: 'NONE',
          payrollTrusted: true,
          clientName: sale.clientName ?? undefined,
          serviceExternalId: sale.productExternalId ?? undefined,
          partnerSource: 'ALLSPORTS',
          isSpaAllSportsBioimpedance: true,
          sessionKey: fitgoSessionKey('SPA', unitId),
          saleExternalId: saleExt || undefined,
        });
        spaPaidViaOnex.add(unitId);
        if (saleExt) takenSaleExt.add(saleExt);
        if (client) takenDayClient.add(dayClient);
      }
    }

    // ── PT from 1C class docs (block/package → unitPriceMinor = blockPrice/N) ─
    // SOLARIUM never enters trainer payroll (admin % of paid solarium sales only).
    const onexPt = await this.prisma.onexClassSession.findMany({
      where: {
        clubId,
        kind: 'PT',
        status: 'COMPLETED',
        isActive: true,
        startAt: { gte: fromD, lte: toD },
        ...performerOr,
      },
      include: { members: true },
      orderBy: { startAt: 'asc' },
    });
    // SPA-like PT rows (massage stored as kind=PT) share pack-day counts.
    for (const [k, n] of buildPacksSameDayMap(
      onexPt.flatMap((o) =>
        o.members
          .filter((m) => !m.cancelled)
          .map((m) => ({
            clientName: m.clientName,
            paymentBasis: m.paymentBasis,
            packageDocId: m.packageDocId,
          })),
      ),
    )) {
      spaPacksSameDay.set(k, Math.max(spaPacksSameDay.get(k) ?? 0, n));
    }
    // Load sales early: skip multi-visit packs in sale pay; also fill unit = sale/N
    // when class members lack packageAmount (legacy sync).
    const trainerPtSales =
      performer && needsPtSales
        ? await this.loadTrainerPtSalesForPeriod(clubId, from, to)
        : [];
    const coveredSaleDays = new Set<string>();
    for (const o of onexPt) {
      const key = onexSessionKey(o.externalId);
      remarkKeys.push(key);
      const primary = o.members.find((m) => !m.cancelled) ?? o.members[0];
      const serviceExternalIdEarly = o.serviceExternalId ?? undefined;
      const bioimpedanceEarly = isSpaAllSportsBioimpedance({
        serviceExternalId: serviceExternalIdEarly,
        title: o.title,
      });
      // Free AllSports биоимпеданс: never treat as gift PT even if basis has «беспл.»
      const payment = bioimpedanceEarly
        ? 'PARTNER'
        : inferPaymentFromBasis(primary?.paymentBasis);
      const paySource = (primary?.paySource ?? '').toUpperCase();
      const matched = await this.prisma.personalTrainingBooking.findFirst({
        where: {
          trainerId: performerId,
          OR: [
            { crmDocRef: o.externalId },
            ...(o.number ? [{ crmDocRef: o.number }] : []),
          ],
        },
        include: { client: true },
      });
      const isGift =
        !bioimpedanceEarly &&
        (payment === 'GIFT' ||
          matched?.isComplimentary === true ||
          isComplimentarySessionTitle(o.title) ||
          isComplimentarySessionTitle(primary?.paymentBasis));
      let unitFromPackage = resolvePackageUnitPriceMinor({
        unitPriceMinor: primary?.unitPriceMinor,
        packageAmountMinor: primary?.packageAmountMinor,
        packageQty: primary?.packageQty,
        paymentBasis: primary?.paymentBasis,
        sessionTitle: o.title,
      });
      let packSaleExt: string | undefined;
      let packSaleAt: string | undefined;
      // Prefer paid pack sale / N (same as SPA massage blocks).
      if (primary?.clientName) {
        const packMatch = matchPackSaleForUnitPrice(
          packSalesForUnit,
          primary.clientName,
          primary.paymentBasis,
          o.title,
        );
        if (packMatch) {
          unitFromPackage = packMatch.unitPriceMinor;
          packSaleExt = packMatch.externalId;
          packSaleAt = packMatch.occurredAt;
        }
      }
      const packDateIso = extractPackDateIsoFromBasis(primary?.paymentBasis);
      // Package/block write-offs pay from unit price; one-time cash sales pay via sale lines below
      const isPackage = paySource === 'PACKAGE' || payment === 'QUOTA';
      const trusted =
        paymentCountsForVolume(payment) &&
        (isGift ||
          (isPackage && paymentCountsForMoney(payment)) ||
          (!isPackage &&
            paySource !== 'SALE' &&
            paymentCountsForMoney(payment) &&
            (unitFromPackage != null || (matched?.priceMinor ?? 0) > 0)));
      const priceMinor = isGift
        ? 0
        : (unitFromPackage ?? matched?.priceMinor ?? undefined);
      const roomTitle = o.roomTitle ?? undefined;
      const roomKey = resolveGroupRoomKey(roomTitle);
      const serviceExternalId = serviceExternalIdEarly;
      const isPtAllSports = isPtAllSportsSession({
        serviceExternalId,
        title: o.title,
      });
      const isReformerPersonal =
        isReformerPersonalNomenclature(
          o.title,
          serviceExternalId,
          payrollSegments,
        ) || roomKey === 'REFORMER';
      // 1C often stores massage / биоимпеданс as kind=PT — pay via SPA scheme.
      const asSpa =
        isSpecialist &&
        !isReformerPersonal &&
        (bioimpedanceEarly ||
          (!isGift && isSpaLikeSessionTitle(o.title)));
      const bioimpedance = asSpa && bioimpedanceEarly;
      const writeOffOrigin = classifyPtSessionOrigin({
        paymentBasis: primary?.paymentBasis,
        sessionTitle: o.title,
        packageQty: primary?.packageQty,
        isComplimentary: isGift,
      });
      const isMembershipQuota = writeOffOrigin === 'MEMBERSHIP';
      const isServiceBlock = writeOffOrigin === 'BLOCK';
      let spaPriceMinor = priceMinor;
      let spaBlockPriceSource: WorkUnit['spaBlockPriceSource'];
      let trustBand: WorkUnit['trustBand'] = 'GREEN';
      if (
        asSpa &&
        isServiceBlock &&
        !bioimpedance &&
        !isGift &&
        !(spaPriceMinor != null && spaPriceMinor > 0) &&
        primary?.clientName
      ) {
        const clientKey = `${primary.clientName
          .trim()
          .toLowerCase()
          .replace(/ё/g, 'е')
          .replace(/\s+/g, ' ')}|${packDateIso ?? ''}`;
        const catalogUnitMinor = await resolveSpaCatalogCached(
          serviceExternalId,
          undefined,
        );
        const blockMatch = resolveSpaBlockUnitPrice({
          sales: spaBlockSales,
          clientName: primary.clientName,
          paymentBasis: primary.paymentBasis,
          sessionTitle: o.title,
          packsSameDay: spaPacksSameDay.get(clientKey) ?? 1,
          catalogUnitMinor,
        });
        if (blockMatch) {
          spaPriceMinor = blockMatch.unitPriceMinor;
          spaBlockPriceSource = blockMatch.source;
          if (blockMatch.source === 'SALE') {
            packSaleExt = blockMatch.externalId ?? packSaleExt;
            packSaleAt = blockMatch.occurredAt ?? packSaleAt;
          } else {
            trustBand = 'AMBER';
          }
        }
      }
      // VIP-included only → spaQuotaRates. Massage blocks keep unit for %.
      if (
        asSpa &&
        payment === 'QUOTA' &&
        isMembershipQuota &&
        !bioimpedance &&
        !(spaPriceMinor != null && spaPriceMinor > 0)
      ) {
        spaPriceMinor = 0;
      }
      const packageTitleSuffix = isMembershipQuota
        ? ' (абонемент)'
        : isServiceBlock
          ? ' (блок)'
          : ' (абонемент)';
      units.push({
        id: matched?.id ?? `onex:${o.id}`,
        kind: asSpa ? 'SPA' : 'PT',
        performerId,
        title: isGift
          ? 'Подарочная ПТ'
          : isPackage
            ? `${o.title || (asSpa ? 'SPA' : 'ПТ')}${packageTitleSuffix}`
            : o.title || (asSpa ? 'SPA' : 'Персональная тренировка'),
        occurredAt: o.startAt.toISOString(),
        quantity: 1,
        priceMinor: asSpa ? spaPriceMinor : priceMinor,
        isComplimentary: isGift,
        trustBand,
        trustResolution: 'NONE',
        payrollTrusted: Boolean(
          asSpa
            ? paymentCountsForMoney(payment) || bioimpedance
            : trusted,
        ),
        clientName:
          primary?.clientName ??
          (matched
            ? `${matched.client.lastName} ${matched.client.firstName}`.trim()
            : undefined),
        sessionId: o.id,
        sessionKey: key,
        roomTitle: asSpa ? undefined : roomTitle,
        roomKey: asSpa ? undefined : roomKey,
        serviceExternalId,
        isAsd: asSpa
          ? false
          : isAsdGroupSession({
              serviceExternalId,
              title: o.title,
            }),
        isPtAllSports: asSpa ? false : isPtAllSports,
        isReformerPersonal: asSpa ? false : isReformerPersonal,
        isSpaAllSportsBioimpedance: bioimpedance || undefined,
        spaMembershipQuota:
          asSpa && !bioimpedance && isPackage ? isMembershipQuota : undefined,
        spaBlockPriceSource: asSpa ? spaBlockPriceSource : undefined,
        saleExternalId: packSaleExt || undefined,
        saleOccurredAt:
          packSaleAt ||
          (packDateIso ? `${packDateIso}T12:00:00.000Z` : undefined),
      });
      if (
        trusted &&
        !asSpa &&
        isPackage &&
        (priceMinor ?? 0) > 0 &&
        primary?.clientName
      ) {
        coveredSaleDays.add(
          `${o.startAt.toISOString().slice(0, 10)}|${primary.clientName.trim().toLowerCase()}`,
        );
      }
    }

    // ── One-time PT from 1C sale lines (Исполнитель + сумма) × PT% ───────────
    // Match by employeeCode (1C) — User.externalId is often empty for trainers.
    const ptSaleUnitKeys = new Map<string, string>();
    const seenPtSaleUnits = new Set<string>();
    for (const sale of trainerPtSales) {
      if (!saleMatchesTrainer(sale, performerCodes, performerName)) continue;
      if (sale.paymentStatus !== 'PAID') continue;
      const amountMinor = Math.round((Number(sale.amount) || 0) * 100);
      if (amountMinor <= 0) continue;
      const day = (sale.occurredAt || '').slice(0, 10);
      const clientKey = `${day}|${(sale.clientName ?? '').trim().toLowerCase()}`;
      if (coveredSaleDays.has(clientKey)) continue;
      const docKey =
        trainerPtSaleDocKey(sale) ||
        sale.externalId ||
        `${day}-${sale.clientName}`;
      const unitId = `ptsale:${docKey}`;
      if (seenPtSaleUnits.has(unitId)) continue;
      seenPtSaleUnits.add(unitId);
      const sk = saleSessionKey('PT', docKey);
      remarkKeys.push(sk);
      const isPtAllSports = isPtAllSportsSession({
        title: sale.serviceName,
        serviceName: sale.serviceName,
      });
      // Sale of ALL SPORTS / multi-visit packs (N ПТ, реформер N, …) is not paid
      // here — only conducted write-offs (pack amount / N). Still track remarks.
      if (isPtAllSports) continue;
      if (isMultiVisitPackSale(sale.serviceName, sale.quantity)) continue;
      // Massage / SPA one-shots are paid via SPA scheme, not PT%.
      if (isSpaLikeSessionTitle(sale.serviceName)) continue;
      const isReformerPersonal = isReformerPersonalNomenclature(
        sale.serviceName,
        null,
        payrollSegments,
      );
      units.push({
        id: unitId,
        kind: 'PT',
        performerId,
        title: `${sale.serviceName || 'Разовая ПТ'} (продажа)`,
        occurredAt: sale.occurredAt?.includes('T')
          ? sale.occurredAt
          : `${day}T12:00:00.000Z`,
        quantity: 1,
        priceMinor: amountMinor,
        trustBand: 'GREEN',
        trustResolution: 'NONE',
        payrollTrusted: true,
        clientName: sale.clientName,
        isPtAllSports: false,
        isReformerPersonal,
        sessionKey: sk,
        saleExternalId:
          (sale.externalId || sale.docRef || docKey || '').trim() || undefined,
      });
      ptSaleUnitKeys.set(unitId, sk);
    }

    // ── GROUP from journal + Onex fallback (dedupe) ─────────────────────────
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
      const key = onexSessionKey(s.appointmentId);
      remarkKeys.push(key);
      const qty = s.approvedAttendedCount ?? 0;
      const trusted =
        qty > 0 &&
        (s.status === GroupClassSessionStatus.APPROVED ||
          s.status === GroupClassSessionStatus.AUTO_READY ||
          s.status === GroupClassSessionStatus.LOCKED);
      const roomTitle = s.roomTitle ?? undefined;
      const serviceExternalId = s.serviceExternalId ?? undefined;
      units.push({
        id: s.id,
        kind: 'GROUP',
        performerId,
        title: s.title,
        occurredAt: s.startAt.toISOString(),
        quantity: qty,
        trustBand: 'GREEN',
        trustResolution: 'NONE',
        payrollTrusted: Boolean(trusted),
        sessionId: s.id,
        sessionKey: key,
        roomTitle,
        roomKey: resolveGroupRoomKey(roomTitle),
        serviceExternalId,
        isAsd: isAsdGroupSession({
          serviceExternalId,
          title: s.title,
        }),
      });
    }

    if (performer) {
      const seenAppt = new Set(groups.map((g) => g.appointmentId));
      const onex = await this.prisma.onexClassSession.findMany({
        where: {
          clubId,
          kind: 'GROUP',
          status: 'COMPLETED',
          isActive: true,
          startAt: { gte: fromD, lte: toD },
          ...performerOr,
        },
        orderBy: { startAt: 'asc' },
      });
      for (const o of onex) {
        if (seenAppt.has(o.externalId)) continue;
        const qty = Math.max(o.attendedCount, o.headerAttendedCount ?? 0);
        if (qty <= 0) continue;
        const key = onexSessionKey(o.externalId);
        remarkKeys.push(key);
        const roomTitle = o.roomTitle ?? undefined;
        const serviceExternalId = o.serviceExternalId ?? undefined;
        units.push({
          id: `onex:${o.id}`,
          kind: 'GROUP',
          performerId,
          title: o.title,
          occurredAt: o.startAt.toISOString(),
          quantity: qty,
          trustBand: 'GREEN',
          trustResolution: 'NONE',
          payrollTrusted: true,
          sessionId: o.id,
          sessionKey: key,
          roomTitle,
          roomKey: resolveGroupRoomKey(roomTitle),
          serviceExternalId,
          isAsd: isAsdGroupSession({
            serviceExternalId,
            title: o.title,
          }),
        });
      }
    }

    // Open remarks hold payroll; GROUP needs dual approval (admin or SA/manager override)
    const uniqueRemarkKeys = [...new Set(remarkKeys)];
    const openKeys = await this.bookingControl.openRemarkKeys(
      clubId,
      uniqueRemarkKeys,
    );
    const approvedGroupKeys =
      await this.bookingControl.approvedGroupSessionKeys(
        clubId,
        uniqueRemarkKeys,
      );
    const unitKey = new Map<string, string>();
    for (const [id, sk] of ptSaleUnitKeys) unitKey.set(id, sk);
    for (const o of onexSpa) {
      const sk = onexSessionKey(o.externalId);
      unitKey.set(`onex:${o.id}`, sk);
      for (const u of units) {
        if (u.kind === 'SPA' && u.sessionId === o.id) unitKey.set(u.id, sk);
      }
    }
    for (const o of onexPt) {
      const sk = onexSessionKey(o.externalId);
      unitKey.set(`onex:${o.id}`, sk);
      for (const u of units) {
        if (u.kind === 'PT' && u.sessionId === o.id) unitKey.set(u.id, sk);
      }
    }
    for (const g of groups) {
      unitKey.set(g.id, onexSessionKey(g.appointmentId));
    }
    const onexGroupIds = units
      .filter((u) => u.kind === 'GROUP' && String(u.id).startsWith('onex:'))
      .map((u) => u.sessionId!)
      .filter(Boolean);
    if (onexGroupIds.length) {
      const onexGroupRows = await this.prisma.onexClassSession.findMany({
        where: { id: { in: onexGroupIds } },
        select: { id: true, externalId: true },
      });
      for (const o of onexGroupRows) {
        unitKey.set(`onex:${o.id}`, onexSessionKey(o.externalId));
      }
    }

    for (const u of units) {
      const sk = unitKey.get(u.id) ?? u.sessionKey;
      if (sk && !u.sessionKey) u.sessionKey = sk;
      if (sk && openKeys.has(sk)) u.payrollTrusted = false;
      if (u.kind === 'GROUP') {
        if (!sk || !approvedGroupKeys.has(sk)) u.payrollTrusted = false;
      }
    }

    // SPA dual-approve stays in Контроль for ops, but does not gate ЗП:
    // completed 1C visits must pay unless an open remark holds them (above).
    for (const u of units) {
      if (u.kind !== 'SPA') continue;
      if (workUnitIsSpaPartnerBio(u)) {
        u.isSpaAllSportsBioimpedance = true;
      }
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
    opts?: {
      /**
       * ADVANCE_HALF: GP-only group rates (no reformer/PT), TECH hours without
       * prorated monthly оклад.
       */
      forAdvanceHalf?: boolean;
    },
  ): Promise<PayrollPeriodSummary> {
    this.assertPeriod(from, to);
    const performer = await this.prisma.user.findFirst({
      where: { id: performerId, clubId },
      include: { roles: true },
    });
    if (!performer) throw new NotFoundException('Сотрудник не найден');
    const trainerFlags = trainerPayFlags({
      roles: performer.roles.map((r) => r.role),
      groupPrograms: performer.groupPrograms,
      trainerStaff: performer.trainerStaff,
      trainerClub: performer.trainerClub,
      trainerReformers: performer.trainerReformers,
      trainerGroupsSet: performer.trainerGroupsSet,
    });

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

    const timeline = await this.loadCompensationTimeline(
      clubId,
      performerId,
      from,
      to,
    );
    const compensation =
      this.pickCompensationRow(timeline, to) ??
      (await this.resolveCompensation(clubId, performerId, from, to));
    const profileForDay = (isoDay: string) =>
      this.profileFromCompensationRow(
        this.pickCompensationRow(timeline, isoDay) ?? compensation,
        trainerFlags,
        opts,
      );
    // Chips / aggregated sales / stats: scheme at period end.
    const profile = profileForDay(to);
    const rates = await this.listRates(clubId);
    const sales = await this.resolveStaffSales(
      clubId,
      performerId,
      from,
      to,
      profile,
    );
    const motivationMinor = this.calcMotivationVersioned(
      trusted,
      rates,
      profileForDay,
      sales,
      profile,
    );
    this.annotateUnitEarningsVersioned(
      workUnits,
      rates,
      profileForDay,
    );
    const motivationBreakdown = profile
      ? this.calcMotivationBreakdownFromProfile(profile, sales)
      : undefined;
    const groupTrusted = trusted.filter((u) => u.kind === 'GROUP');
    const groupStats =
      groupTrusted.length > 0 ||
      allPaySlices(profile).some(
        (s) => s.track === 'GROUP_TRAINER' || s.track === 'REFORMER',
      )
        ? (() => {
            const classCount = groupTrusted.length;
            const attendeeTotal = groupTrusted.reduce(
              (s, u) => s + u.quantity,
              0,
            );
            return {
              classCount,
              attendeeTotal,
              avgPeople:
                classCount > 0
                  ? Math.round((attendeeTotal / classCount) * 10) / 10
                  : 0,
            };
          })()
        : undefined;
    const ptSlice = allPaySlices(profile).find(
      (s) => s.track === 'PT' || s.track === 'CLUB',
    );
    const ptStats = ptSlice
      ? (() => {
          const ptUnits = trusted.filter((x) => {
            if (x.kind !== 'PT' || x.isPtAllSports) return false;
            const dayProfile = profileForDay(x.occurredAt.slice(0, 10));
            const dayHasReformer = allPaySlices(dayProfile).some(
              (s) => s.track === 'REFORMER',
            );
            if (dayHasReformer && x.isReformerPersonal) return false;
            if (dayHasReformer && x.roomKey === 'REFORMER') return false;
            if (x.roomKey === 'REFORMER' && x.isReformerPersonal) return false;
            return true;
          });
          // Ladder % display: end-of-period tiers × full-period volume.
          return {
            sessionCount: ptUnits.length,
            percent: resolvePtPercent(ptUnits.length, ptSlice.ptPercentTiers),
          };
        })()
      : undefined;
    const adjustments = await this.listAdjustments(clubId, performerId, from, to);
    const adjustmentsMinor = adjustments.reduce((s, a) => s + a.amountMinor, 0);

    const fromD = new Date(`${from}T00:00:00`);
    const toD = new Date(`${to}T00:00:00`);
    const monthDays = new Date(
      fromD.getFullYear(),
      fromD.getMonth() + 1,
      0,
    ).getDate();
    const slices = allPaySlices(profile);
    const advanceTechHoursOnly =
      Boolean(opts?.forAdvanceHalf) &&
      slices.some((s) => s.track === 'TECH') &&
      !slices.some((s) => s.track === 'ADMIN' || s.track === 'MANAGER');
    let baseSalaryMinor =
      compensation && !advanceTechHoursOnly
        ? this.prorateBaseSalaryMinor(timeline, from, to, monthDays)
        : 0;
    const hasPtAnywhere = timeline.some((row) => {
      const p = this.profileFromCompensationRow(row, trainerFlags, opts);
      return allPaySlices(p).some((s) => s.track === 'PT');
    });
    const hasHourlyDeskAnywhere = timeline.some((row) => {
      const p = this.profileFromCompensationRow(row, trainerFlags, opts);
      return allPaySlices(p).some(
        (s) =>
          s.track !== 'PT' &&
          s.track !== 'CLUB' &&
          typeof s.hourlyRateMinor === 'number' &&
          s.hourlyRateMinor > 0,
      );
    });
    const hasPt = hasPtAnywhere || slices.some((s) => s.track === 'PT');
    const hasHourlyDesk =
      hasHourlyDeskAnywhere ||
      slices.some(
        (s) =>
          s.track !== 'PT' &&
          s.track !== 'CLUB' &&
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
      for (const s of hours.shifts) {
        const day = (s.startAt || '').slice(0, 10) || from;
        const dayProfile = profileForDay(day);
        const deskRate =
          (dayProfile
            ? sliceForTrack(dayProfile, 'ADMIN').hourlyRateMinor ||
              sliceForTrack(dayProfile, 'TECH').hourlyRateMinor ||
              sliceForTrack(dayProfile, 'GROUP_TRAINER').hourlyRateMinor
            : 0) ||
          hours.hourlyRateMinor ||
          0;
        const mins = s.minutes + (s.overtimeMinutes ?? 0);
        const pay = Math.round((mins / 60) * deskRate);
        baseSalaryMinor += pay;
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
    // Staff PT: duty hours from График (StaffShift track=TRAINER), not from
    // approved TrainerDaySheet (legacy; often empty → 0 despite roster + rate).
    if (hasPt) {
      const hours = await this.staffRoster.hourlySummary(
        clubId,
        performerId,
        from,
        to,
      );
      const alreadyShiftIds = new Set(
        workUnits.filter((u) => u.kind === 'SHIFT').map((u) => u.id),
      );
      let addedTrainerPay = 0;
      for (const s of hours.shifts) {
        if (s.track !== 'TRAINER' || alreadyShiftIds.has(s.id)) continue;
        const day = (s.startAt || '').slice(0, 10) || from;
        const dayProfile = profileForDay(day);
        const ptHourly =
          (dayProfile
            ? sliceForTrack(dayProfile, 'PT').hourlyRateMinor ||
              dayProfile.hourlyRateMinor
            : 0) || 0;
        if (ptHourly <= 0) continue;
        const mins = s.minutes + (s.overtimeMinutes ?? 0);
        const pay = Math.round((mins / 60) * ptHourly);
        addedTrainerPay += pay;
        workUnits.push({
          id: s.id,
          kind: 'SHIFT',
          performerId,
          title: `Смена TRAINER${s.overtimeMinutes ? ` (+${s.overtimeMinutes} мин)` : ''}`,
          occurredAt: s.startAt,
          quantity: Number((mins / 60).toFixed(2)),
          priceMinor: pay,
          trustBand: 'GREEN',
          trustResolution: 'NONE',
          payrollTrusted: true,
        });
      }
      if (addedTrainerPay > 0) {
        baseSalaryMinor += addedTrainerPay;
        workUnits.sort(
          (a, b) =>
            new Date(a.occurredAt).getTime() -
            new Date(b.occurredAt).getTime(),
        );
      }
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
    const spaBlockCatalog = workUnits.filter(
      (u) => u.kind === 'SPA' && u.spaBlockPriceSource === 'CATALOG',
    ).length;
    if (spaBlockCatalog > 0) {
      anomalyHints.push(
        `SPA из блока по каталогу: ${spaBlockCatalog} — продажи нет в периоде, проверьте оплату`,
      );
    }
    const spaBlockNoUnit = workUnits.filter(
      (u) =>
        u.kind === 'SPA' &&
        u.spaMembershipQuota === false &&
        !(u.priceMinor != null && u.priceMinor > 0) &&
        !u.isSpaAllSportsBioimpedance,
    ).length;
    if (spaBlockNoUnit > 0) {
      anomalyHints.push(
        `SPA из блока без цены: ${spaBlockNoUnit} визитов (нет продажи и каталожной цены)`,
      );
    }
    const splitHint = this.rateChangeHint(timeline, from, to);
    if (splitHint) anomalyHints.push(splitHint);
    if (sales.hint) anomalyHints.push(sales.hint);

    if (slices.some((s) => s.track === 'ADMIN')) {
      const debt = await this.countOpenSellerDebts(clubId, performerId, to);
      if (debt.count > 0) {
        anomalyHints.push(
          `Долг продавца: ${debt.count} поз. на ${(debt.amountMinor / 100).toFixed(2)} BYN — в мотивацию не входит до оплаты (см. «Мои долги»)`,
        );
      }
    }

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

    let outBase = baseSalaryMinor;
    let outMotivation = motivationMinor;
    if (performer.excludeFromPayrollMotivation) {
      outBase = 0;
      outMotivation = 0;
      anomalyHints.push('Без мотивации — исключён из расчёта ЗП');
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
      baseSalaryMinor: outBase,
      motivationMinor: outMotivation,
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
      totalMinor: outBase + outMotivation + adjustmentsMinor,
      currency: compensation?.currency ?? 'BYN',
      canLock: openTotal === 0 && !locked,
      locked: Boolean(locked),
      anomalyHints,
      ...(allPaySlices(profile).some(
        (s) => s.track === 'ADMIN' || s.track === 'MANAGER',
      )
        ? { sales, motivationBreakdown }
        : {}),
      ...(groupStats ? { groupStats } : {}),
      ...(ptStats ? { ptStats } : {}),
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
    await this.classSessionsSync
      .markPayrollLocked(clubId, performerId, from, to)
      .catch(() => undefined);
    this.invalidateClubSummaryCache(clubId);
    return this.getPeriodSummary(clubId, performerId, from, to);
  }

  /**
   * Preview a club pay wave.
   * - ADVANCE_HALF (25th): default days 1–15 (override via periodFrom/To).
   *   Admins, staff-only PT, reformer-only → card advance only (0 = pay nothing).
   *   TECH / SPA / GP → period accrual; card is a share of earned (max(accrual, card)).
   *   Manager with card > 0 → card only; otherwise motivation for the range.
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

    const defaultRange =
      kind === 'ADVANCE_HALF'
        ? advanceHalfRange(year, month)
        : monthSettlementRange(year, month);

    const range = {
      from: opts?.periodFrom?.trim() || defaultRange.from,
      to: opts?.periodTo?.trim() || defaultRange.to,
    };
    this.assertPeriod(range.from, range.to);

    // Card advance = version active on the wave date (period end), not a
    // future raise scheduled after the wave.
    const waveCompensation = await this.getActiveCompensation(
      clubId,
      userId,
      range.to,
    );
    const resolvedFixedAdvance = resolveFixedAdvanceMinor(
      asPayProfile(waveCompensation?.payProfile),
      roles.map(String),
      { trainerStaff: Boolean(user.trainerStaff) },
    );
    const staffOnly =
      Boolean(user.trainerStaff) && !user.groupPrograms;
    const reformerOnly =
      Boolean(user.trainerReformers) &&
      !user.groupPrograms &&
      !user.trainerStaff;
    // Card-only on 25th (no period motivation in earned).
    const usesFixedAdvance =
      kind === 'ADVANCE_HALF' &&
      (roles.includes(Role.ADMIN) ||
        staffOnly ||
        reformerOnly ||
        (resolvedFixedAdvance > 0 && roles.includes(Role.MANAGER)));
    const useAdvanceHalfAccrual =
      kind === 'ADVANCE_HALF' &&
      !usesFixedAdvance &&
      (roles.includes(Role.TECH) ||
        roles.includes(Role.SPECIALIST) ||
        Boolean(user.groupPrograms));
    const fixedAdvanceMinor = resolvedFixedAdvance;

    const hints: string[] = [];
    let earnedMinor = 0;
    const summary = await this.getPeriodSummary(
      clubId,
      userId,
      range.from,
      range.to,
      useAdvanceHalfAccrual ? { forAdvanceHalf: true } : undefined,
    );

    const periodOverridden =
      range.from !== defaultRange.from || range.to !== defaultRange.to;

    if (kind === 'ADVANCE_HALF' && !periodOverridden) {
      const accrualMinor = usesFixedAdvance ? 0 : summary.totalMinor;
      const split = splitAdvanceWave({
        accrualMinor,
        cardAdvanceMinor: fixedAdvanceMinor,
      });
      earnedMinor = split.earnedMinor;
      if (usesFixedAdvance) {
        if (fixedAdvanceMinor <= 0) {
          hints.push(
            'Выплата аванса на карту не задана в мотивации — сумма 0',
          );
        } else {
          hints.push(
            '25-е: фиксированный аванс на карту из мотивации (вычитается 15-го)',
          );
        }
      } else {
        hints.push(
          `Аванс 25-е: начисление за ${range.from}–${range.to}` +
            (fixedAdvanceMinor > 0
              ? `; на карту ${(fixedAdvanceMinor / 100).toFixed(2)}, остаток из кассы`
              : ''),
        );
        if (Boolean(user.groupPrograms) && Boolean(user.trainerReformers)) {
          hints.push(
            'ГП + реформеры: в аванс только занятия как тренер ГП (без зала реформеров)',
          );
        }
      }
    } else {
      earnedMinor = summary.totalMinor;
      if (kind === 'ADVANCE_HALF') {
        hints.push(
          `Период изменён (${range.from}–${range.to}): начисление по мотивации` +
            (fixedAdvanceMinor > 0
              ? `; карта ${(fixedAdvanceMinor / 100).toFixed(2)}`
              : ''),
        );
        if (fixedAdvanceMinor > 0) {
          earnedMinor = splitAdvanceWave({
            accrualMinor: summary.totalMinor,
            cardAdvanceMinor: fixedAdvanceMinor,
          }).earnedMinor;
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
          return s.roles.includes('MANAGER');
        }
        if (dept === 'ADMIN') {
          return section === 'ADMIN' && !s.roles.includes('MANAGER');
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

  /**
   * Remember card/cash typed on the payout sheet. Does not mark the wave paid
   * and does not move the staff balance. A later confirm replaces this draft.
   */
  async savePayoutDraft(
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
    const actualCash = Math.round(
      input.actualCashMinor ?? preview.payableMinor - card,
    );
    const kind =
      input.kind === 'ADVANCE_HALF'
        ? PrismaPayoutKind.ADVANCE_HALF
        : PrismaPayoutKind.MONTH_SETTLEMENT;
    const periodFrom = new Date(`${preview.periodFrom}T00:00:00`);
    const periodTo = new Date(`${preview.periodTo}T00:00:00`);
    const data = {
      earnedMinor: preview.earnedMinor,
      priorPaidMinor: preview.priorPaidMinor,
      totalMinor: preview.totalMinor,
      cardTransferMinor: card,
      cashMinor: preview.payableMinor - card,
      actualCashMinor: actualCash,
      carryInMinor: preview.carryInMinor,
      carryOutMinor: preview.payableMinor - (card + actualCash),
      currency: preview.currency,
      status: PayrollPayoutStatus.DRAFT,
      paidAt: null,
      note: null as string | null,
    };
    const identity = {
      clubId,
      userId: input.userId,
      kind,
      periodFrom,
      periodTo,
    };

    const updated = await this.prisma.payrollPayout.updateMany({
      where: { ...identity, status: { not: PayrollPayoutStatus.PAID } },
      data,
    });
    if (updated.count > 0) {
      const row = await this.prisma.payrollPayout.findFirst({
        where: identity,
        include: { user: true },
      });
      if (!row) throw new NotFoundException('Черновик выплаты не найден');
      return this.mapPayout(row);
    }

    const paid = await this.prisma.payrollPayout.findFirst({
      where: { ...identity, status: PayrollPayoutStatus.PAID },
    });
    if (paid) {
      throw new BadRequestException('Эта выплата уже зафиксирована');
    }

    try {
      const row = await this.prisma.payrollPayout.create({
        data: {
          ...identity,
          ...data,
          createdById: actor.sub,
        },
        include: { user: true },
      });
      return this.mapPayout(row);
    } catch (e) {
      if (
        typeof e === 'object' &&
        e !== null &&
        'code' in e &&
        (e as { code?: string }).code === 'P2002'
      ) {
        throw new BadRequestException('Эта выплата уже зафиксирована');
      }
      throw e;
    }
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

    this.invalidateClubSummaryCache(clubId);
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
        effectiveFrom: dateOnly(input.effectiveFrom),
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
    const rows = await this.prisma.staffCompensation.findMany({
      where: { clubId, userId },
      include: { user: true },
      orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }],
    });
    if (!rows.length) return null;
    const today = localTodayIso();
    const asOf =
      this.pickCompensationRow(rows, today) ?? rows[rows.length - 1]!;
    const profile = asPayProfile(asOf.payProfile);
    const rateVersions = rows.map((r) => {
      const p = asPayProfile(r.payProfile);
      return {
        effectiveFrom: utcDateKey(r.effectiveFrom),
        payChips: payProfileSummary(p),
      };
    });
    // Collapse same-day duplicates (keep last by createdAt — already ascending).
    const deduped: typeof rateVersions = [];
    for (const v of rateVersions) {
      const last = deduped[deduped.length - 1];
      if (last && last.effectiveFrom === v.effectiveFrom) {
        deduped[deduped.length - 1] = v;
      } else {
        deduped.push(v);
      }
    }
    return {
      id: asOf.id,
      userId: asOf.userId,
      userName: `${asOf.user.lastName} ${asOf.user.firstName}`.trim(),
      baseSalaryMinor: asOf.baseSalaryMinor,
      currency: asOf.currency,
      effectiveFrom: utcDateKey(asOf.effectiveFrom),
      payProfile: profile,
      payChips: payProfileSummary(profile),
      rateVersions: deduped,
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
    const latest = await this.prisma.staffCompensation.findFirst({
      where: { clubId, userId: input.userId },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
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
    const baseSalaryMinor =
      input.baseSalaryMinor ?? latest?.baseSalaryMinor ?? 0;

    // Dated version: same day updates that row; new day creates a version.
    // Default (no date) = 1st of current month so a correction covers the open period.
    const effectiveFrom = input.effectiveFrom?.trim() || localMonthStartIso();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
      throw new BadRequestException('effectiveFrom: YYYY-MM-DD');
    }
    await this.assertCompensationDateOpen(
      clubId,
      input.userId,
      effectiveFrom,
    );

    const fromDate = dateOnly(effectiveFrom);
    const sameDay = await this.prisma.staffCompensation.findFirst({
      where: {
        clubId,
        userId: input.userId,
        effectiveFrom: fromDate,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (sameDay) {
      await this.prisma.staffCompensation.update({
        where: { id: sameDay.id },
        data: {
          baseSalaryMinor,
          payProfile: payProfile as object,
        },
      });
    } else {
      await this.prisma.staffCompensation.create({
        data: {
          clubId,
          userId: input.userId,
          baseSalaryMinor,
          currency: latest?.currency ?? 'BYN',
          effectiveFrom: fromDate,
          payProfile: payProfile as object,
        },
      });
    }
    // "Действует с D" means this scheme from D forward — drop later unlocked
    // versions so an accidental mid-month row (e.g. 14.10) no longer overrides.
    await this.supersedeLaterCompensationVersions(
      clubId,
      input.userId,
      effectiveFrom,
    );
    const dto = await this.getStaffPayProfile(clubId, input.userId);
    if (!dto) throw new NotFoundException('Сотрудник не найден');
    return dto;
  }

  /**
   * Delete compensation versions after `effectiveFrom` that sit on open
   * (unlocked) days. Locked-period versions are kept.
   */
  private async supersedeLaterCompensationVersions(
    clubId: string,
    userId: string,
    effectiveFrom: string,
  ) {
    const later = await this.prisma.staffCompensation.findMany({
      where: {
        clubId,
        userId,
        effectiveFrom: { gt: dateOnly(effectiveFrom) },
      },
      select: { id: true, effectiveFrom: true },
    });
    for (const row of later) {
      const iso = utcDateKey(row.effectiveFrom);
      const locked = await this.prisma.payrollPeriodLock.findFirst({
        where: {
          clubId,
          userId,
          periodFrom: { lte: dateOnly(iso) },
          periodTo: { gte: dateOnly(iso) },
        },
      });
      if (locked) continue;
      await this.prisma.staffCompensation.delete({ where: { id: row.id } });
    }
  }

  /** Refuse saving a rate into a locked payroll period. */
  private async assertCompensationDateOpen(
    clubId: string,
    userId: string,
    effectiveFrom: string,
  ) {
    const day = dateOnly(effectiveFrom);
    const locked = await this.prisma.payrollPeriodLock.findFirst({
      where: {
        clubId,
        userId,
        periodFrom: { lte: day },
        periodTo: { gte: day },
      },
      orderBy: { periodTo: 'desc' },
    });
    if (!locked) return;
    const until = utcDateKey(locked.periodTo);
    const openFrom = (() => {
      const next = dateOnly(until);
      next.setUTCDate(next.getUTCDate() + 1);
      return utcDateKey(next);
    })();
    throw new BadRequestException(
      `Период до ${until} закрыт — ставка с ${effectiveFrom} недоступна. Выберите дату с ${openFrom}.`,
    );
  }

  async listPayTemplates(clubId: string): Promise<StaffPayTemplateDto[]> {
    const rows = await this.prisma.staffPayTemplate.findMany({
      where: { clubId },
      orderBy: { track: 'asc' },
    });
    return rows
      .filter((row) => isPayTrack(row.track))
      .map((row) => this.mapPayTemplate(row));
  }

  /**
   * Save club default for one track from a staff card.
   * Does not change other employees — only the template used on new hires.
   */
  async savePayTemplate(
    actor: JwtPayload,
    input: {
      track: StaffPayTrack;
      baseSalaryMinor?: number;
      payProfile: StaffPayProfile | StaffPayTrackSlice;
      label?: string;
    },
  ): Promise<StaffPayTemplateDto> {
    const clubId = requireClubId(actor);
    if (!isPayTrack(input.track)) {
      throw new BadRequestException('Неизвестная схема мотивации');
    }
    const slice = sliceForTrack(
      'byTrack' in input.payProfile
        ? (input.payProfile as StaffPayProfile)
        : { ...(input.payProfile as StaffPayTrackSlice), track: input.track },
      input.track,
    );
    const { byTrack: _b, ...flat } = slice as StaffPayProfile;
    const paySlice: StaffPayTrackSlice = { ...flat, track: input.track };
    const includeSalary =
      input.track === 'PT' ||
      input.track === 'ADMIN' ||
      input.track === 'MANAGER';
    const baseSalaryMinor = includeSalary
      ? Math.max(0, Math.round(input.baseSalaryMinor ?? 0))
      : 0;
    const row = await this.prisma.staffPayTemplate.upsert({
      where: { clubId_track: { clubId, track: input.track } },
      create: {
        clubId,
        track: input.track,
        label: input.label?.trim() || PAY_TRACK_LABELS[input.track],
        baseSalaryMinor,
        payProfile: paySlice as object,
      },
      update: {
        label: input.label?.trim() || PAY_TRACK_LABELS[input.track],
        baseSalaryMinor,
        payProfile: paySlice as object,
      },
    });
    return this.mapPayTemplate(row);
  }

  /**
   * Apply club templates to one user (merge tracks). Does not touch other staff.
   */
  async applyPayTemplatesToUser(
    actor: JwtPayload,
    userId: string,
    tracks?: StaffPayTrack[],
    effectiveFrom?: string,
  ): Promise<StaffCompensationDto> {
    const clubId = requireClubId(actor);
    const user = await this.prisma.user.findFirst({
      where: { id: userId, clubId },
      include: { roles: true },
    });
    if (!user) throw new NotFoundException('Сотрудник не найден');

    const wanted =
      tracks?.length && tracks.every(isPayTrack)
        ? tracks
        : this.defaultTracksForUser(user);
    if (!wanted.length) {
      throw new BadRequestException('Нет схем для применения шаблона');
    }

    const templates = await this.prisma.staffPayTemplate.findMany({
      where: { clubId, track: { in: wanted } },
    });
    if (!templates.length) {
      throw new BadRequestException(
        'Нет сохранённых шаблонов для выбранных схем. Сохраните шаблон на карточке сотрудника.',
      );
    }

    const existing = await this.getStaffPayProfile(clubId, userId);
    let merged: StaffPayProfile | undefined = existing?.payProfile;
    let baseSalaryMinor = existing?.baseSalaryMinor ?? 0;
    for (const row of templates) {
      if (!isPayTrack(row.track)) continue;
      const slice = row.payProfile as unknown as StaffPayTrackSlice;
      const asProfile: StaffPayProfile = { ...slice, track: row.track };
      merged = mergePayTracks(merged, asProfile, [row.track]);
      if (
        row.track === 'PT' ||
        row.track === 'ADMIN' ||
        row.track === 'MANAGER'
      ) {
        baseSalaryMinor = row.baseSalaryMinor;
      }
    }
    if (!merged) {
      throw new BadRequestException('Шаблон пуст');
    }
    return this.saveStaffPayProfile(actor, {
      userId,
      baseSalaryMinor,
      payProfile: merged,
      effectiveFrom,
    });
  }

  /** Tracks to seed for a newly created / synced user. */
  defaultTracksForUser(user: {
    roles: Array<{ role: Role }>;
    groupPrograms?: boolean | null;
    trainerStaff?: boolean | null;
    trainerClub?: boolean | null;
    trainerReformers?: boolean | null;
    trainerGroupsSet?: boolean | null;
  }): StaffPayTrack[] {
    const roles = user.roles.map((r) => r.role);
    const tracks: StaffPayTrack[] = [];
    if (roles.includes(Role.MANAGER)) tracks.push('MANAGER');
    if (roles.includes(Role.ADMIN)) tracks.push('ADMIN');
    if (roles.includes(Role.SPECIALIST)) tracks.push('SPA');
    if (roles.includes(Role.TECH)) tracks.push('TECH');
    if (roles.includes(Role.TRAINER)) {
      const flags = trainerPayFlags({
        roles: roles.map(String),
        groupPrograms: user.groupPrograms,
        trainerStaff: user.trainerStaff,
        trainerClub: user.trainerClub,
        trainerReformers: user.trainerReformers,
        trainerGroupsSet: user.trainerGroupsSet,
      });
      if (flags.gp) tracks.push('GROUP_TRAINER');
      if (flags.staff) tracks.push('PT');
      if (flags.club) tracks.push('CLUB');
      if (flags.reformers) tracks.push('REFORMER');
    }
    return tracks;
  }

  /**
   * Apply templates after sync/create without JWT actor (system path).
   * No-op when no templates match.
   */
  async applyPayTemplatesForNewUser(
    clubId: string,
    userId: string,
    tracks?: StaffPayTrack[],
  ): Promise<boolean> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, clubId },
      include: { roles: true },
    });
    if (!user) return false;
    const wanted = tracks?.length
      ? tracks.filter(isPayTrack)
      : this.defaultTracksForUser(user);
    if (!wanted.length) return false;
    const templates = await this.prisma.staffPayTemplate.findMany({
      where: { clubId, track: { in: wanted } },
    });
    if (!templates.length) return false;

    let merged: StaffPayProfile | undefined;
    let baseSalaryMinor = 0;
    for (const row of templates) {
      if (!isPayTrack(row.track)) continue;
      const slice = row.payProfile as unknown as StaffPayTrackSlice;
      const asProfile: StaffPayProfile = { ...slice, track: row.track };
      merged = mergePayTracks(merged, asProfile, [row.track]);
      if (
        row.track === 'PT' ||
        row.track === 'ADMIN' ||
        row.track === 'MANAGER'
      ) {
        baseSalaryMinor = row.baseSalaryMinor;
      }
    }
    if (!merged) return false;
    // Month start — same default as manual save — so a mid-month hire
    // does not create a "с 14.10" version that later overrides 01.10.
    await this.prisma.staffCompensation.create({
      data: {
        clubId,
        userId,
        baseSalaryMinor,
        currency: 'BYN',
        effectiveFrom: dateOnly(localMonthStartIso()),
        payProfile: merged as object,
      },
    });
    return true;
  }

  private mapPayTemplate(row: {
    track: string;
    label: string | null;
    baseSalaryMinor: number;
    payProfile: unknown;
    updatedAt: Date;
  }): StaffPayTemplateDto {
    const track = isPayTrack(row.track) ? row.track : 'PT';
    const slice = {
      ...(row.payProfile as StaffPayTrackSlice),
      track,
    };
    return {
      track,
      label: row.label?.trim() || PAY_TRACK_LABELS[track],
      baseSalaryMinor: row.baseSalaryMinor,
      payProfile: slice,
      payChips: payProfileSummary({ ...slice, track }),
      updatedAt: row.updatedAt.toISOString(),
    };
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
    trainerGroups?: TrainerGroupId[],
    effectiveFrom?: string,
  ): Promise<{ copied: number; skipped: number }> {
    const clubId = requireClubId(actor);
    const source = await this.getStaffPayProfile(clubId, sourceUserId);
    if (!source?.payProfile) {
      throw new BadRequestException('Сначала сохраните мотивацию у источника');
    }
    const fromDate = effectiveFrom?.trim() || localMonthStartIso();
    if (trainerGroups?.length) {
      const allowed: TrainerGroupId[] = ['GP', 'STAFF', 'CLUB', 'REFORMER'];
      const groups = [...new Set(trainerGroups)].filter((g): g is TrainerGroupId =>
        allowed.includes(g),
      );
      if (!groups.length) {
        throw new BadRequestException('Укажите группу тренеров');
      }
      const copiedIds = new Set<string>();
      const ordered = (
        ['GP', 'CLUB', 'STAFF', 'REFORMER'] as TrainerGroupId[]
      ).filter((g) => groups.includes(g));
      for (const group of ordered) {
        const track = TRAINER_GROUP_TRACK[group];
        const peers = await this.prisma.user.findMany({
          where: {
            clubId,
            isActive: true,
            id: { not: sourceUserId },
            roles: { some: { role: Role.TRAINER } },
            ...(group === 'GP' ? { groupPrograms: true } : {}),
            ...(group === 'CLUB' ? { trainerClub: true } : {}),
            ...(group === 'REFORMER' ? { trainerReformers: true } : {}),
            ...(group === 'STAFF'
              ? {
                  OR: [
                    { trainerStaff: true },
                    {
                      trainerGroupsSet: false,
                      groupPrograms: false,
                      trainerStaff: false,
                      trainerClub: false,
                      trainerReformers: false,
                    },
                  ],
                }
              : {}),
          },
          select: { id: true },
        });
        for (const peer of peers) {
          const existing = await this.getStaffPayProfile(clubId, peer.id);
          const merged = mergePayTracks(
            existing?.payProfile,
            source.payProfile,
            [track],
          );
          await this.saveStaffPayProfile(actor, {
            userId: peer.id,
            baseSalaryMinor:
              group === 'STAFF'
                ? source.baseSalaryMinor
                : (existing?.baseSalaryMinor ?? 0),
            effectiveFrom: fromDate,
            payProfile: merged,
          });
          copiedIds.add(peer.id);
        }
      }
      return { copied: copiedIds.size, skipped: 0 };
    }
    if (!departments.length) {
      throw new BadRequestException('Укажите подразделение для копирования');
    }
    const roleMap: Record<StaffDepartment, Role> = {
      ADMIN: Role.ADMIN,
      MANAGER: Role.MANAGER,
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
              : d === 'MANAGER'
                ? (['MANAGER'] as StaffPayTrack[])
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
        archivedAt: null,
        id: { not: sourceUserId },
        roles: { some: { role: { in: roles } } },
      },
      select: { id: true },
    });
    let copied = 0;
    for (const peer of peers) {
      const existing = await this.getStaffPayProfile(clubId, peer.id);
      const merged = mergePayTracks(
        existing?.payProfile,
        source.payProfile,
        tracksToCopy,
      );
      await this.saveStaffPayProfile(actor, {
        userId: peer.id,
        baseSalaryMinor: source.baseSalaryMinor,
        effectiveFrom: fromDate,
        payProfile: merged,
      });
      copied += 1;
    }
    return { copied, skipped: 0 };
  }

  async listStaffPaySummaries(
    clubId: string,
    opts?: { excludeClubTrainerOnly?: boolean },
  ): Promise<StaffPaySummary[]> {
    const users = await this.prisma.user.findMany({
      where: {
        clubId,
        isActive: true,
        archivedAt: null,
        roles: {
          some: {
            role: {
              in: [
                Role.SPECIALIST,
                Role.TECH,
                Role.TRAINER,
                Role.ADMIN,
                Role.MANAGER,
              ],
            },
          },
        },
      },
      include: { roles: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const eligible = (
      opts?.excludeClubTrainerOnly
        ? users.filter((u) => !isClubTrainerOnlyPayrollSkip(u))
        : users
    ).filter((u) => !u.excludeFromPayrollMotivation);
    const today = localTodayIso();
    const comps = await this.prisma.staffCompensation.findMany({
      where: {
        clubId,
        userId: { in: eligible.map((u) => u.id) },
        effectiveFrom: { lte: dateOnly(today) },
      },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    const latest = new Map<string, (typeof comps)[0]>();
    for (const c of comps) {
      if (!latest.has(c.userId)) latest.set(c.userId, c);
    }
    return eligible.map((u) => {
      const c = latest.get(u.id);
      const profile = asPayProfile(c?.payProfile);
      const roles = u.roles.map((r) => r.role);
      const track =
        profile?.track ??
        (roles.includes(Role.MANAGER)
          ? ('MANAGER' as StaffPayTrack)
          : roles.includes(Role.SPECIALIST)
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
        excludeFromPayrollMotivation: u.excludeFromPayrollMotivation ?? false,
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
        effectiveFrom: utcDateKey(r.effectiveFrom),
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
        effectiveFrom: dateOnly(input.effectiveFrom),
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
      effectiveFrom: utcDateKey(r.effectiveFrom),
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
    this.invalidateClubSummaryCache(clubId);
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
    this.invalidateClubSummaryCache(clubId);
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
    this.invalidateClubSummaryCache(clubId);
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

  /**
   * Resolve staff → 1C client card (phone / FIO) and load personal debt.
   * Display-only; does not affect payroll total.
   */
  async resolveStaffClientDebt(
    clubId: string,
    userId: string,
  ): Promise<PayrollStaffDebt> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, clubId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        phoneNormalized: true,
        staffClientExternalId: true,
        externalId: true,
      },
    });
    if (!user) {
      return { amountMinor: 0, currency: 'BYN', lines: [], source: 'none' };
    }

    const fio = `${user.lastName} ${user.firstName}`.trim();
    let clientExt = user.staffClientExternalId?.trim() || null;

    if (!clientExt) {
      const phone =
        user.phoneNormalized?.trim() ||
        (user.phone ? normalizePhone(user.phone) : '');
      const provider = this.fitness.getProvider();
      if (phone && provider.findClientByPhone) {
        try {
          const hit = await Promise.race([
            provider.findClientByPhone(phone),
            new Promise<null>((resolve) =>
              setTimeout(() => resolve(null), 5_000),
            ),
          ]);
          if (hit?.externalId) {
            clientExt = hit.externalId;
          }
        } catch {
          /* ignore */
        }
      }
      if (!clientExt) {
        const nameHit = await this.prisma.clubRevenueEntry.findFirst({
          where: {
            clubId,
            isActive: true,
            operationType: 'unpaid',
            clientExternalId: { not: null },
            OR: [
              { clientName: { equals: fio, mode: 'insensitive' } },
              {
                clientName: {
                  equals: `${fio} (Сотрудник)`,
                  mode: 'insensitive',
                },
              },
              {
                clientName: {
                  contains: `${user.lastName} ${user.firstName}`,
                  mode: 'insensitive',
                },
              },
            ],
          },
          select: { clientExternalId: true, clientName: true },
          orderBy: { occurredAt: 'desc' },
        });
        if (nameHit?.clientExternalId) {
          clientExt = nameHit.clientExternalId;
        }
      }
      if (clientExt) {
        await this.prisma.user
          .update({
            where: { id: user.id },
            data: { staffClientExternalId: clientExt },
          })
          .catch(() => undefined);
      }
    }

    const unpaidRows = clientExt
      ? await this.prisma.clubRevenueEntry.findMany({
          where: {
            clubId,
            isActive: true,
            operationType: 'unpaid',
            clientExternalId: clientExt,
          },
          orderBy: { occurredAt: 'desc' },
          take: 40,
        })
      : [];

    const collectible = unpaidRows.filter((r) =>
      isCollectibleClientDebt({
        externalId: r.externalId,
        productName: r.productName,
      }),
    );
    const cacheMinor = Math.round(
      collectible.reduce((s, r) => s + Math.abs(r.amount || r.saleAmount || 0), 0) *
        100,
    );
    const lines = collectible.map((r) => ({
      occurredAt: r.occurredAt.toISOString(),
      productName: r.productName?.trim() || 'Долг',
      amountMinor: Math.round(Math.abs(r.amount || r.saleAmount || 0) * 100),
    }));

    if (!clientExt) {
      return {
        amountMinor: cacheMinor,
        currency: 'BYN',
        lines,
        source: cacheMinor > 0 ? 'cache' : 'none',
        clientName: fio,
      };
    }

    let amountMinor = cacheMinor;
    let source: PayrollStaffDebt['source'] = cacheMinor > 0 ? 'cache' : 'none';
    try {
      // Short race — overview also skips live PT sales / booking 1C.
      const membership = await Promise.race([
        this.fitness.getProvider().getMembership(clientExt),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_000)),
      ]);
      if (membership && membership.debtAmount != null) {
        amountMinor = Math.round(Math.abs(Number(membership.debtAmount)) * 100);
        source = '1c';
      }
    } catch {
      /* keep cache */
    }

    return {
      amountMinor,
      currency: 'BYN',
      lines,
      source,
      clientName: fio,
      clientExternalId: clientExt,
    };
  }

  async getSelfOverview(
    user: JwtPayload,
    from: string,
    to: string,
  ): Promise<PayrollSelfOverview> {
    const clubId = requireClubId(user);
    this.assertPeriod(from, to);

    const dbUser = await this.prisma.user.findFirst({
      where: { id: user.sub, clubId },
      include: { roles: true },
    });
    if (!dbUser) throw new NotFoundException('Сотрудник не найден');

    const roles = new Set(dbUser.roles.map((r) => r.role));
    const isAdmin = roles.has(Role.ADMIN);
    const isSpecialist = roles.has(Role.SPECIALIST);
    const isTrainer = roles.has(Role.TRAINER);
    if (
      isTrainer &&
      !dbUser.groupPrograms &&
      !dbUser.trainerStaff &&
      !dbUser.trainerReformers
    ) {
      throw new ForbiddenException(
        'Расчёт ЗП доступен тренерам ГП, реформеров и штатным ПТ',
      );
    }
    if (!isAdmin && !isSpecialist && !isTrainer) {
      throw new ForbiddenException('Нет доступа к расчёту ЗП');
    }

    const [summary, staffDebt, allPayouts, unpaidItems, unpaidSalesMinor] =
      await Promise.all([
        this.getPeriodSummary(clubId, user.sub, from, to),
        this.resolveStaffClientDebt(clubId, user.sub),
        this.listPayouts(clubId, user.sub),
        this.bookingControl
          .list(clubId, {
            from,
            to,
            restrictPerformerId: user.sub,
            payment: 'DEBT',
            skipExternal: true,
          })
          .catch(() => []),
        // Seller debt from ClubRevenue unpaid (enriched seller), not stale ST.
        isAdmin
          ? this.adminSales
              .sellerOpenUnpaidMinor(clubId, user.sub, to)
              .catch(() => 0)
          : Promise.resolve(undefined as number | undefined),
      ]);

    const fromT = new Date(`${from}T00:00:00`).getTime();
    const toT = new Date(`${to}T23:59:59.999`).getTime();
    const payoutsInPeriod = allPayouts.filter((p) => {
      const a = new Date(`${p.periodFrom}T00:00:00`).getTime();
      const b = new Date(`${p.periodTo}T23:59:59.999`).getTime();
      return a <= toT && b >= fromT;
    });

    const unconfirmedCount = summary.workUnits.filter(
      (u) => !u.payrollTrusted,
    ).length;
    const unpaidCount = unpaidItems.filter(
      (i) => i.kind === 'PT' || i.kind === 'SPA',
    ).length;

    const bookingControl = isAdmin
      ? '/admin/booking-control'
      : isSpecialist
        ? '/specialist/my-sessions'
        : '/trainer/my-sessions';

    const advance = await this.buildSelfAdvanceBreakdown(
      clubId,
      dbUser,
      summary,
      from,
    );

    return {
      summary,
      staffDebt,
      payoutsInPeriod,
      unconfirmedCount,
      unpaidCount,
      unpaidSalesMinor:
        unpaidSalesMinor != null && unpaidSalesMinor > 0
          ? unpaidSalesMinor
          : undefined,
      advance,
      links: {
        bookingControl,
        sales: isAdmin ? '/admin/sales' : undefined,
      },
    };
  }

  /** Club calendar day YYYY-MM-DD (Europe/Minsk). */
  private clubDayIso(occurredAt: string): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Minsk',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(occurredAt));
  }

  private isAdvanceHalfClubDay(occurredAt: string): boolean {
    const day = Number(this.clubDayIso(occurredAt).slice(8, 10));
    return day >= 1 && day <= 15;
  }

  /**
   * Units that accrue on the 25th under forAdvanceHalf (GP hall / SPA / TECH).
   * PT and reformer settle on the 15th.
   */
  private unitAccruesInAdvanceHalf(
    u: WorkUnit,
    opts: { gp: boolean; spa: boolean; tech: boolean },
  ): boolean {
    if (u.kind === 'GROUP' && u.roomKey !== 'REFORMER' && opts.gp) return true;
    if (u.kind === 'SPA' && opts.spa) return true;
    if (u.kind === 'SHIFT' && opts.tech) return true;
    return false;
  }

  /**
   * Tag work units ADVANCE/SETTLEMENT and return 25th-wave preview for the
   * month of `from` when the employee is on advance.
   */
  private async buildSelfAdvanceBreakdown(
    clubId: string,
    dbUser: {
      id: string;
      roles: { role: Role }[];
      groupPrograms: boolean | null;
      trainerStaff: boolean | null;
      trainerReformers: boolean | null;
    },
    summary: PayrollPeriodSummary,
    from: string,
  ): Promise<PayrollAdvanceBreakdown | undefined> {
    const roleSet = new Set(dbUser.roles.map((r) => r.role));

    const year = Number(from.slice(0, 4));
    const month = Number(from.slice(5, 7));
    if (!year || !month || month < 1 || month > 12) return undefined;

    const preview = await this.previewPayout(
      clubId,
      dbUser.id,
      'ADVANCE_HALF',
      year,
      month,
    );

    const usesFixedAdvance = preview.usesFixedAdvance;
    const accruesFromSessions =
      !usesFixedAdvance &&
      (roleSet.has(Role.TECH) ||
        roleSet.has(Role.SPECIALIST) ||
        Boolean(dbUser.groupPrograms));

    // GP/SPA/TECH always see the wave; card-only roles only when card > 0.
    const eligible =
      accruesFromSessions || preview.fixedAdvanceMinor > 0;

    if (!eligible) return undefined;

    const accrualMinor = usesFixedAdvance ? 0 : preview.summary.totalMinor;
    const split = splitAdvanceWave({
      accrualMinor,
      cardAdvanceMinor: preview.fixedAdvanceMinor,
    });

    const tagOpts = {
      gp: Boolean(dbUser.groupPrograms),
      spa: roleSet.has(Role.SPECIALIST),
      tech: roleSet.has(Role.TECH),
    };

    let advanceUnitCount = 0;
    let advanceEarnMinor = 0;
    for (const u of summary.workUnits) {
      if (
        accruesFromSessions &&
        this.isAdvanceHalfClubDay(u.occurredAt) &&
        this.unitAccruesInAdvanceHalf(u, tagOpts)
      ) {
        u.payWave = 'ADVANCE';
        if (u.payrollTrusted) {
          advanceUnitCount += 1;
          advanceEarnMinor += u.earnMinor ?? 0;
        }
      } else {
        u.payWave = 'SETTLEMENT';
      }
    }

    return {
      eligible: true,
      accruesFromSessions,
      periodFrom: preview.periodFrom,
      periodTo: preview.periodTo,
      usesFixedAdvance,
      fixedAdvanceMinor: preview.fixedAdvanceMinor,
      accrualMinor,
      earnedMinor: split.earnedMinor,
      cardMinor: split.cardMinor,
      cashMinor: split.cashMinor,
      advanceUnitCount,
      advanceEarnMinor,
      hints: preview.hints,
    };
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
    // Prefer rate active by period end (chips / sales fallback).
    const byEnd = await this.getActiveCompensation(clubId, userId, to);
    if (byEnd) return byEnd;
    const byStart = await this.getActiveCompensation(clubId, userId, from);
    if (byStart) return byStart;
    // Last resort: any latest profile for this staff member.
    return this.prisma.staffCompensation.findFirst({
      where: { clubId, userId },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
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
        effectiveFrom: { lte: dateOnly(asOf) },
      },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /** All versions that can apply inside [from, to] (includes the one active at from). */
  private async loadCompensationTimeline(
    clubId: string,
    userId: string,
    from: string,
    to: string,
  ) {
    const rows = await this.prisma.staffCompensation.findMany({
      where: {
        clubId,
        userId,
        effectiveFrom: { lte: dateOnly(to) },
      },
      orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }],
    });
    void from;
    return rows;
  }

  private pickCompensationRow<
    T extends { effectiveFrom: Date; createdAt?: Date },
  >(rows: T[], asOf: string): T | undefined {
    let best: T | undefined;
    for (const row of rows) {
      if (utcDateKey(row.effectiveFrom) > asOf) break;
      best = row;
    }
    return best;
  }

  private profileFromCompensationRow(
    row: { payProfile: unknown } | null | undefined,
    trainerFlags: ReturnType<typeof trainerPayFlags>,
    opts?: { forAdvanceHalf?: boolean },
  ): StaffPayProfile | undefined {
    const raw = asPayProfile(row?.payProfile);
    if (!raw) return undefined;
    return opts?.forAdvanceHalf
      ? payProfileForAdvanceHalf(raw, trainerFlags)
      : payProfileForCalculation(raw, trainerFlags);
  }

  /** Prorate base salary across days when the monthly amount changes mid-period. */
  private prorateBaseSalaryMinor(
    rows: Array<{ effectiveFrom: Date; baseSalaryMinor: number }>,
    from: string,
    to: string,
    monthDays: number,
  ): number {
    if (!rows.length || monthDays <= 0) return 0;
    let total = 0;
    const fromD = new Date(`${from}T00:00:00`);
    const toD = new Date(`${to}T00:00:00`);
    for (
      let d = new Date(fromD);
      d.getTime() <= toD.getTime();
      d.setDate(d.getDate() + 1)
    ) {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const row = this.pickCompensationRow(rows, iso);
      if (!row) continue;
      total += row.baseSalaryMinor / monthDays;
    }
    return Math.round(total);
  }

  /** Hint when two+ rate versions apply inside the payroll period. */
  private rateChangeHint(
    rows: Array<{ effectiveFrom: Date }>,
    from: string,
    to: string,
  ): string | undefined {
    return rateChangeHintText(
      rows.map((r) => utcDateKey(r.effectiveFrom)),
      from,
      to,
    );
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

  /**
   * Paid one-time PT sales for the payroll period.
   * Prefer TrainerPtSale (club-sync); live 1C only via refreshTrainerPtSalesLive.
   * Memoized so club summary does not re-query DB per trainer.
   */
  private loadTrainerPtSalesForPeriod(
    clubId: string,
    from: string,
    to: string,
  ): Promise<TrainerPtSaleRow[]> {
    const key = `${clubId}|${from}|${to}`;
    let pending = this.ptSalesPeriodCache.get(key);
    if (!pending) {
      pending = this.loadTrainerPtSalesFromDb(clubId, from, to).finally(() => {
        setTimeout(() => this.ptSalesPeriodCache.delete(key), 120_000);
      });
      this.ptSalesPeriodCache.set(key, pending);
    }
    return pending;
  }

  /** Explicit refresh path (sync button / payroll 1C refresh). */
  async refreshTrainerPtSalesLive(
    clubId: string,
    from: string,
    to: string,
  ): Promise<TrainerPtSaleRow[]> {
    const key = `${clubId}|${from}|${to}`;
    const fromD = new Date(`${from}T00:00:00.000`);
    const toD = new Date(`${to}T23:59:59.999`);
    const pending = this.fetchTrainerPtSalesLive(from, to)
      .then(async (live) => {
        if (live.length === 0) {
          return this.loadTrainerPtSalesFromDb(clubId, from, to);
        }
        // Live Integration can still mark DEBT as PAID — same ClubRevenue
        // unpaid overlay as DB path (all trainers after «Обновить из 1С»).
        if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) {
          return live;
        }
        return overlayPtSaleDebtFromRevenue(
          this.prisma,
          clubId,
          fromD,
          toD,
          live,
        );
      })
      .finally(() => {
        setTimeout(() => this.ptSalesPeriodCache.delete(key), 120_000);
      });
    this.ptSalesPeriodCache.set(key, pending);
    this.invalidateClubSummaryCache(clubId);
    return pending;
  }

  private async fetchTrainerPtSalesLive(
    from: string,
    to: string,
  ): Promise<TrainerPtSaleRow[]> {
    const provider = this.fitness.getProvider();
    const fn = provider.getTrainerPtSales;
    if (!fn) return [];
    try {
      const rows = await Promise.race([
        fn.call(provider, { from, to }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('trainer-pt-sales timeout')),
            45_000,
          ),
        ),
      ]);
      if (!Array.isArray(rows)) return [];
      return rows.map((r) => ({
        externalId: r.externalId,
        clientName: r.clientName,
        serviceName: r.serviceName,
        occurredAt: r.occurredAt,
        amount: r.amount,
        quantity:
          r.quantity != null && Number(r.quantity) > 0
            ? Math.round(Number(r.quantity))
            : undefined,
        employeeCode: r.employeeCode,
        employeeName: r.employeeName,
        docRef: r.docRef,
        paymentStatus: r.paymentStatus,
      }));
    } catch {
      return [];
    }
  }

  private async loadTrainerPtSalesFromDb(
    clubId: string,
    from: string,
    to: string,
  ): Promise<TrainerPtSaleRow[]> {
    const fromD = new Date(`${from}T00:00:00.000`);
    const toD = new Date(`${to}T23:59:59.999`);
    if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) {
      return [];
    }
    const rows = await this.prisma.trainerPtSale.findMany({
      where: {
        clubId,
        isActive: true,
        occurredAt: { gte: fromD, lte: toD },
      },
      orderBy: { occurredAt: 'asc' },
    });
    const fromPt: TrainerPtSaleRow[] = rows.map((r) => ({
      externalId: r.externalId,
      clientName: r.clientName ?? undefined,
      serviceName: r.serviceName ?? undefined,
      occurredAt: r.occurredAt.toISOString(),
      amount: r.amount,
      employeeCode: r.employeeCode ?? undefined,
      employeeName: r.employeeName ?? undefined,
      docRef: r.docRef ?? undefined,
      paymentStatus: r.paymentStatus ?? undefined,
    }));
    // Analytics cash sales: Исполнитель → performer*. Merge so motivation
    // works even if /trainer-pt-sales is stale.
    const fromRevenue = await loadTrainerPtSalesFromRevenue(
      this.prisma,
      clubId,
      fromD,
      toD,
    );
    const merged = mergeTrainerPtSaleRows(fromPt, fromRevenue);
    // Integration may mark unpaid PT as PAID when debt remainder is missing —
    // ClubRevenue unpaid wins so debt never enters ЗП.
    return overlayPtSaleDebtFromRevenue(
      this.prisma,
      clubId,
      fromD,
      toD,
      merged,
    );
  }

  /**
   * PT work units in [from, to] with earnMinor from the calendar-month ladder
   * (full month volume), matching ЗП when the report period is a partial month.
   */
  async listPtUnitsWithMonthLadder(
    clubId: string,
    performerId: string,
    from: string,
    to: string,
  ): Promise<{
    units: WorkUnit[];
    profile?: StaffPayProfile;
    ladderPercent: number | null;
  }> {
    this.assertPeriod(from, to);
    const performer = await this.prisma.user.findFirst({
      where: { id: performerId, clubId },
      include: { roles: true },
    });
    if (!performer) throw new NotFoundException('Сотрудник не найден');
    const trainerFlags = trainerPayFlags({
      roles: performer.roles.map((r) => r.role),
      groupPrograms: performer.groupPrograms,
      trainerStaff: performer.trainerStaff,
      trainerClub: performer.trainerClub,
      trainerReformers: performer.trainerReformers,
      trainerGroupsSet: performer.trainerGroupsSet,
    });
    const compensation = await this.resolveCompensation(
      clubId,
      performerId,
      from,
      to,
    );
    const profile = payProfileForCalculation(
      asPayProfile(compensation?.payProfile),
      trainerFlags,
    );
    const rates = await this.listRates(clubId);
    const months = calendarMonthsOverlapping(from, to);
    const out: WorkUnit[] = [];
    let ladderPercent: number | null = null;
    const hasReformerScheme = allPaySlices(profile).some(
      (s) => s.track === 'REFORMER',
    );
    const ptSlice = allPaySlices(profile).find(
      (s) => s.track === 'PT' || s.track === 'CLUB',
    );

    for (const m of months) {
      const monthUnits = await this.listWorkUnits(
        clubId,
        performerId,
        m.from,
        m.to,
      );
      this.annotateUnitEarnings(monthUnits, rates, profile);
      if (ptSlice) {
        const trustedPt = monthUnits.filter(
          (x) =>
            x.payrollTrusted &&
            x.kind === 'PT' &&
            !x.isPtAllSports &&
            !(hasReformerScheme && x.isReformerPersonal) &&
            !(hasReformerScheme && x.roomKey === 'REFORMER') &&
            !(x.roomKey === 'REFORMER' && x.isReformerPersonal),
        );
        const pct = resolvePtPercent(
          trustedPt.length,
          ptSlice.ptPercentTiers,
        );
        if (ladderPercent == null || pct > ladderPercent) {
          ladderPercent = pct;
        }
      }
      for (const u of monthUnits) {
        if (u.kind !== 'PT') continue;
        const day = u.occurredAt.slice(0, 10);
        if (day >= from && day <= to) out.push(u);
      }
    }
    out.sort(
      (a, b) =>
        new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    );
    return { units: out, profile, ladderPercent };
  }

  /**
   * Fill earnMinor / ratePercent on PT+SPA+GROUP lines for the payroll table.
   * Mirrors calcMotivationFromProfile (and legacy rates) per unit.
   * Annotates untrusted rows too (display); totals still use payrollTrusted only.
   */
  private annotateUnitEarnings(
    units: WorkUnit[],
    rates: MotivationRateDto[],
    profile?: StaffPayProfile,
  ): void {
    if (!profile) {
      for (const u of units) {
        if (u.kind !== 'SPA' && u.kind !== 'PT' && u.kind !== 'GROUP') continue;
        if (u.isComplimentary) continue;
        const rate = this.pickRate(u, rates);
        if (!rate) continue;
        if (rate.rateType === 'PERCENT_OF_PRICE' && (u.priceMinor ?? 0) > 0) {
          u.ratePercent = rate.rateValue;
          u.earnMinor = Math.round((u.priceMinor! * rate.rateValue) / 100);
        } else if (rate.rateType === 'FIXED_PER_SESSION') {
          u.earnMinor = rate.rateValue;
        } else if (rate.rateType === 'FIXED_PER_ATTENDEE') {
          u.earnMinor = rate.rateValue * u.quantity;
        }
      }
      return;
    }

    const trusted = units.filter((u) => u.payrollTrusted);
    const slices = allPaySlices(profile);
    const hasReformerScheme = slices.some((s) => s.track === 'REFORMER');
    const asdRateMinor = Math.max(
      0,
      ...slices.map((s) => s.asdGroupRateMinor ?? 0),
    );
    const paidAsdIds = new Set<string>();
    const ptAllSportsRate = Math.max(
      0,
      ...slices
        .filter((s) => s.track === 'PT' || s.track === 'CLUB')
        .map((s) => s.ptAllSportsRateMinor ?? 0),
    );
    const paidPtAllSportsIds = new Set<string>();

    if (asdRateMinor > 0) {
      for (const u of units) {
        if (!u.isAsd || u.quantity < 1) continue;
        if (paidAsdIds.has(u.id)) continue;
        paidAsdIds.add(u.id);
        u.earnMinor = asdRateMinor;
      }
    }

    if (ptAllSportsRate > 0) {
      for (const u of units) {
        if (u.kind !== 'PT' || !u.isPtAllSports || u.isComplimentary) continue;
        if (paidPtAllSportsIds.has(u.id)) continue;
        paidPtAllSportsIds.add(u.id);
        u.earnMinor = ptAllSportsRate;
      }
    }

    for (const slice of slices) {
      if (slice.track === 'GROUP_TRAINER') {
        for (const u of units.filter((x) => x.kind === 'GROUP')) {
          if (u.isAsd) continue;
          if (u.roomKey === 'REFORMER') continue;
          const hasTiers = (slice.groupRateTiers?.length ?? 0) > 0;
          let pay = 0;
          if (hasTiers || u.roomKey) {
            pay = resolveGroupSessionRateMinor(
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
            if (u.quantity >= min) pay = slice.groupSessionRateMinor ?? 0;
          }
          if (slice.groupPerAttendeeMinor) {
            pay += slice.groupPerAttendeeMinor * u.quantity;
          }
          if (pay > 0) u.earnMinor = pay;
        }
      }

      if (slice.track === 'REFORMER') {
        const tiers =
          (slice.groupRateTiers?.filter((t) => t.roomKey === 'REFORMER')
            ?.length ?? 0) > 0
            ? slice.groupRateTiers
            : DEFAULT_REFORMER_RATE_TIERS;
        for (const u of units.filter(
          (x) => x.kind === 'GROUP' && x.roomKey === 'REFORMER',
        )) {
          if (u.isAsd) continue;
          if (u.quantity < 1) continue;
          const pay = resolveGroupSessionRateMinor(
            u.quantity,
            'REFORMER',
            tiers,
          );
          if (pay > 0) u.earnMinor = pay;
        }

        const refPct = slice.reformerPersonalPercent ?? 0;
        if (refPct > 0) {
          for (const u of units.filter(
            (x) =>
              x.kind === 'PT' &&
              (x.isReformerPersonal || x.roomKey === 'REFORMER') &&
              !x.isComplimentary &&
              !x.isPtAllSports,
          )) {
            const price = u.priceMinor ?? 0;
            if (price > 0) {
              u.ratePercent = refPct;
              u.earnMinor = Math.round((price * refPct) / 100);
            }
          }
        }
      }

      if (slice.track === 'SPA') {
        for (const u of units.filter((x) => x.kind === 'SPA')) {
          const partnerBio = workUnitIsSpaPartnerBio(u);
          if (u.isComplimentary && !partnerBio) continue;
          if (partnerBio) {
            u.isSpaAllSportsBioimpedance = true;
            if (slice.spaPartnerRateMinor) {
              u.earnMinor = slice.spaPartnerRateMinor;
            }
            continue;
          }
          const price = u.priceMinor ?? 0;
          if (price > 0 && slice.spaSoldPercent) {
            u.ratePercent = slice.spaSoldPercent;
            u.earnMinor = Math.round((price * slice.spaSoldPercent) / 100);
          } else if (
            price === 0 &&
            u.spaMembershipQuota === true &&
            slice.spaQuotaRates?.length
          ) {
            const title = u.title.toLowerCase();
            const match = slice.spaQuotaRates.find((r) => {
              if (r.serviceKey === 'BODY_COMPOSITION')
                return /состав|анализ|inbody|compos|биоимпеданс|bio.?imped/i.test(
                  title,
                );
              if (r.serviceKey === 'CLASSIC_MASSAGE')
                return /массаж|massage|класс/i.test(title);
              return r.serviceKey === u.serviceId;
            });
            if (match && match.rateMinor > 0) u.earnMinor = match.rateMinor;
          }
        }
      }

      if (slice.track === 'PT' || slice.track === 'CLUB') {
        const ptFilter = (x: WorkUnit) =>
          x.kind === 'PT' &&
          !x.isPtAllSports &&
          !(hasReformerScheme && x.isReformerPersonal) &&
          !(hasReformerScheme && x.roomKey === 'REFORMER') &&
          !(x.roomKey === 'REFORMER' && x.isReformerPersonal);
        // Ladder % from trusted volume; annotate every matching line for UI.
        const pct = resolvePtPercent(
          trusted.filter(ptFilter).length,
          slice.ptPercentTiers,
        );
        const catalog = slice.ptSessionPriceMinor ?? 0;
        for (const u of units.filter(ptFilter)) {
          if (u.isComplimentary) continue;
          const price =
            u.priceMinor != null && u.priceMinor > 0 ? u.priceMinor : catalog;
          if (price > 0) {
            u.ratePercent = pct;
            u.earnMinor = Math.round((price * pct) / 100);
          }
        }
      }
    }
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

  /**
   * Motivation with dated rate versions: each session/shift uses the scheme
   * active on its day. PT ladder volume is period-wide; % and catalog price
   * come from that day's version. Aggregated admin/manager sales use salesProfile.
   */
  private calcMotivationVersioned(
    units: WorkUnit[],
    rates: MotivationRateDto[],
    profileForDay: (isoDay: string) => StaffPayProfile | undefined,
    sales?: StaffSalesBreakdown,
    salesProfile?: StaffPayProfile,
  ): number {
    const trusted = units.filter((u) => u.payrollTrusted);
    if (!trusted.length && !sales) {
      return this.calcMotivation(units, rates, undefined);
    }
    let total = 0;
    if (salesProfile && sales) {
      for (const slice of allPaySlices(salesProfile)) {
        if (slice.track !== 'ADMIN' && slice.track !== 'MANAGER') continue;
        const cat = this.adminManagerCategoryContributions(slice, sales);
        total +=
          cat.membershipMinor +
          cat.spaMinor +
          cat.solariumMinor +
          cat.shopMinor +
          cat.corporateMinor;
      }
    }

    const paidAsdIds = new Set<string>();
    const paidPtAllSportsIds = new Set<string>();

    const isPtLadderUnit = (u: WorkUnit, dayProfile?: StaffPayProfile) => {
      if (u.kind !== 'PT' || u.isPtAllSports) return false;
      const hasReformer = allPaySlices(dayProfile).some(
        (s) => s.track === 'REFORMER',
      );
      if (hasReformer && u.isReformerPersonal) return false;
      if (hasReformer && u.roomKey === 'REFORMER') return false;
      if (u.roomKey === 'REFORMER' && u.isReformerPersonal) return false;
      return true;
    };

    const ptLadderUnits = trusted.filter((u) =>
      isPtLadderUnit(u, profileForDay(u.occurredAt.slice(0, 10))),
    );
    const ptMonthCount = ptLadderUnits.length;

    for (const u of trusted) {
      const day = u.occurredAt.slice(0, 10);
      const profile = profileForDay(day);
      if (!profile) {
        const rate = this.pickRate(u, rates);
        if (!rate) continue;
        if (rate.rateType === 'FIXED_PER_ATTENDEE') {
          total += rate.rateValue * u.quantity;
        } else if (rate.rateType === 'FIXED_PER_SESSION') {
          total += rate.rateValue;
        } else if (
          rate.rateType === 'PERCENT_OF_PRICE' &&
          u.priceMinor != null
        ) {
          total += Math.round((u.priceMinor * rate.rateValue) / 100);
        }
        continue;
      }
      const slices = allPaySlices(profile);
      const asdRateMinor = Math.max(
        0,
        ...slices.map((s) => s.asdGroupRateMinor ?? 0),
      );
      if (asdRateMinor > 0 && u.isAsd && u.quantity >= 1 && !paidAsdIds.has(u.id)) {
        paidAsdIds.add(u.id);
        total += asdRateMinor;
      }
      const ptAllSportsRate = Math.max(
        0,
        ...slices
          .filter((s) => s.track === 'PT' || s.track === 'CLUB')
          .map((s) => s.ptAllSportsRateMinor ?? 0),
      );
      if (
        ptAllSportsRate > 0 &&
        u.kind === 'PT' &&
        u.isPtAllSports &&
        !u.isComplimentary &&
        !paidPtAllSportsIds.has(u.id)
      ) {
        paidPtAllSportsIds.add(u.id);
        total += ptAllSportsRate;
      }

      for (const slice of slices) {
        if (slice.track === 'GROUP_TRAINER' && u.kind === 'GROUP') {
          if (u.isAsd) continue;
          if (u.roomKey === 'REFORMER') continue;
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
            if (u.quantity >= min) total += slice.groupSessionRateMinor ?? 0;
          }
          if (slice.groupPerAttendeeMinor) {
            total += slice.groupPerAttendeeMinor * u.quantity;
          }
        }

        if (slice.track === 'REFORMER') {
          if (u.kind === 'GROUP' && u.roomKey === 'REFORMER') {
            if (!u.isAsd && u.quantity >= 1) {
              const tiers =
                (slice.groupRateTiers?.filter((t) => t.roomKey === 'REFORMER')
                  ?.length ?? 0) > 0
                  ? slice.groupRateTiers
                  : DEFAULT_REFORMER_RATE_TIERS;
              total += resolveGroupSessionRateMinor(
                u.quantity,
                'REFORMER',
                tiers,
              );
            }
          }
          if (
            u.kind === 'PT' &&
            (u.isReformerPersonal || u.roomKey === 'REFORMER') &&
            !u.isComplimentary &&
            !u.isPtAllSports
          ) {
            const refPct = slice.reformerPersonalPercent ?? 0;
            const price = u.priceMinor ?? 0;
            if (refPct > 0 && price > 0) {
              total += Math.round((price * refPct) / 100);
            }
          }
        }

        if (slice.track === 'SPA' && u.kind === 'SPA') {
          if (workUnitIsSpaPartnerBio(u) && slice.spaPartnerRateMinor) {
            total += slice.spaPartnerRateMinor;
          } else if (!workUnitIsSpaPartnerBio(u)) {
            const price = u.priceMinor ?? 0;
            if (price > 0 && slice.spaSoldPercent) {
              total += Math.round((price * slice.spaSoldPercent) / 100);
            } else if (
              price === 0 &&
              u.spaMembershipQuota === true &&
              slice.spaQuotaRates?.length
            ) {
              const title = u.title.toLowerCase();
              const match = slice.spaQuotaRates.find((r) => {
                if (r.serviceKey === 'BODY_COMPOSITION')
                  return /состав|анализ|inbody|compos|биоимпеданс|bio.?imped/i.test(
                    title,
                  );
                if (r.serviceKey === 'CLASSIC_MASSAGE')
                  return /массаж|massage|класси/i.test(title);
                return r.serviceKey === u.serviceId;
              });
              if (match) total += match.rateMinor;
            }
          }
        }

        if (
          (slice.track === 'PT' || slice.track === 'CLUB') &&
          isPtLadderUnit(u, profile) &&
          !u.isComplimentary
        ) {
          const pct = resolvePtPercent(ptMonthCount, slice.ptPercentTiers);
          const catalog = slice.ptSessionPriceMinor ?? 0;
          const price =
            u.priceMinor != null && u.priceMinor > 0 ? u.priceMinor : catalog;
          if (price > 0) {
            total += Math.round((price * pct) / 100);
          }
        }
      }
    }
    return total;
  }

  private annotateUnitEarningsVersioned(
    units: WorkUnit[],
    rates: MotivationRateDto[],
    profileForDay: (isoDay: string) => StaffPayProfile | undefined,
  ): void {
    const trusted = units.filter((u) => u.payrollTrusted);
    const isPtLadderUnit = (u: WorkUnit, dayProfile?: StaffPayProfile) => {
      if (u.kind !== 'PT' || u.isPtAllSports) return false;
      const hasReformer = allPaySlices(dayProfile).some(
        (s) => s.track === 'REFORMER',
      );
      if (hasReformer && u.isReformerPersonal) return false;
      if (hasReformer && u.roomKey === 'REFORMER') return false;
      if (u.roomKey === 'REFORMER' && u.isReformerPersonal) return false;
      return true;
    };
    const ptMonthCount = trusted.filter((u) =>
      isPtLadderUnit(u, profileForDay(u.occurredAt.slice(0, 10))),
    ).length;
    const paidAsdIds = new Set<string>();
    const paidPtAllSportsIds = new Set<string>();

    for (const u of units) {
      if (u.kind !== 'SPA' && u.kind !== 'PT' && u.kind !== 'GROUP') continue;
      const partnerBio = workUnitIsSpaPartnerBio(u);
      if (u.isComplimentary && !partnerBio) continue;
      const day = u.occurredAt.slice(0, 10);
      const profile = profileForDay(day);
      if (!profile) {
        const rate = this.pickRate(u, rates);
        if (!rate) continue;
        if (rate.rateType === 'PERCENT_OF_PRICE' && (u.priceMinor ?? 0) > 0) {
          u.ratePercent = rate.rateValue;
          u.earnMinor = Math.round((u.priceMinor! * rate.rateValue) / 100);
        } else if (rate.rateType === 'FIXED_PER_SESSION') {
          u.earnMinor = rate.rateValue;
        } else if (rate.rateType === 'FIXED_PER_ATTENDEE') {
          u.earnMinor = rate.rateValue * u.quantity;
        }
        continue;
      }
      const slices = allPaySlices(profile);
      const asdRateMinor = Math.max(
        0,
        ...slices.map((s) => s.asdGroupRateMinor ?? 0),
      );
      if (asdRateMinor > 0 && u.isAsd && u.quantity >= 1 && !paidAsdIds.has(u.id)) {
        paidAsdIds.add(u.id);
        u.earnMinor = asdRateMinor;
      }
      const ptAllSportsRate = Math.max(
        0,
        ...slices
          .filter((s) => s.track === 'PT' || s.track === 'CLUB')
          .map((s) => s.ptAllSportsRateMinor ?? 0),
      );
      if (
        ptAllSportsRate > 0 &&
        u.kind === 'PT' &&
        u.isPtAllSports &&
        !paidPtAllSportsIds.has(u.id)
      ) {
        paidPtAllSportsIds.add(u.id);
        u.earnMinor = ptAllSportsRate;
      }

      for (const slice of slices) {
        if (slice.track === 'GROUP_TRAINER' && u.kind === 'GROUP') {
          if (u.isAsd || u.roomKey === 'REFORMER') continue;
          const hasTiers = (slice.groupRateTiers?.length ?? 0) > 0;
          let pay = 0;
          if (hasTiers || u.roomKey) {
            pay = resolveGroupSessionRateMinor(
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
            if (u.quantity >= min) pay = slice.groupSessionRateMinor ?? 0;
          }
          if (slice.groupPerAttendeeMinor) {
            pay += slice.groupPerAttendeeMinor * u.quantity;
          }
          if (pay > 0) u.earnMinor = pay;
        }
        if (slice.track === 'REFORMER') {
          if (u.kind === 'GROUP' && u.roomKey === 'REFORMER' && !u.isAsd) {
            if (u.quantity >= 1) {
              const tiers =
                (slice.groupRateTiers?.filter((t) => t.roomKey === 'REFORMER')
                  ?.length ?? 0) > 0
                  ? slice.groupRateTiers
                  : DEFAULT_REFORMER_RATE_TIERS;
              const pay = resolveGroupSessionRateMinor(
                u.quantity,
                'REFORMER',
                tiers,
              );
              if (pay > 0) u.earnMinor = pay;
            }
          }
          if (
            u.kind === 'PT' &&
            (u.isReformerPersonal || u.roomKey === 'REFORMER') &&
            !u.isPtAllSports
          ) {
            const refPct = slice.reformerPersonalPercent ?? 0;
            const price = u.priceMinor ?? 0;
            if (refPct > 0 && price > 0) {
              u.ratePercent = refPct;
              u.earnMinor = Math.round((price * refPct) / 100);
            }
          }
        }
        if (slice.track === 'SPA' && u.kind === 'SPA') {
          if (partnerBio) {
            u.isSpaAllSportsBioimpedance = true;
            if (slice.spaPartnerRateMinor) {
              u.earnMinor = slice.spaPartnerRateMinor;
            }
          } else {
            const price = u.priceMinor ?? 0;
            if (price > 0 && slice.spaSoldPercent) {
              u.ratePercent = slice.spaSoldPercent;
              u.earnMinor = Math.round((price * slice.spaSoldPercent) / 100);
            } else if (
              price === 0 &&
              u.spaMembershipQuota === true &&
              slice.spaQuotaRates?.length
            ) {
              const title = u.title.toLowerCase();
              const match = slice.spaQuotaRates.find((r) => {
                if (r.serviceKey === 'BODY_COMPOSITION')
                  return /состав|анализ|inbody|compos|биоимпеданс|bio.?imped/i.test(
                    title,
                  );
                if (r.serviceKey === 'CLASSIC_MASSAGE')
                  return /массаж|massage|класси/i.test(title);
                return r.serviceKey === u.serviceId;
              });
              if (match && match.rateMinor > 0) u.earnMinor = match.rateMinor;
            }
          }
        }
        if (
          (slice.track === 'PT' || slice.track === 'CLUB') &&
          isPtLadderUnit(u, profile)
        ) {
          const pct = resolvePtPercent(ptMonthCount, slice.ptPercentTiers);
          const catalog = slice.ptSessionPriceMinor ?? 0;
          const price =
            u.priceMinor != null && u.priceMinor > 0 ? u.priceMinor : catalog;
          if (price > 0) {
            u.ratePercent = pct;
            u.earnMinor = Math.round((price * pct) / 100);
          }
        }
      }
    }
  }

  private calcMotivationFromProfile(
    units: WorkUnit[],
    profile: StaffPayProfile,
    periodFrom?: string,
    sales?: StaffSalesBreakdown,
  ): number {
    let total = 0;
    const trusted = units.filter((u) => u.payrollTrusted);
    const slices = allPaySlices(profile);
    const hasReformerScheme = slices.some((s) => s.track === 'REFORMER');
    const asdRateMinor = Math.max(
      0,
      ...slices.map((s) => s.asdGroupRateMinor ?? 0),
    );
    const paidAsdIds = new Set<string>();
    const paidPtAllSportsIds = new Set<string>();

    // «АСД группа»: once per session if GP or staff scheme carries a rate.
    if (asdRateMinor > 0) {
      for (const u of trusted) {
        if (!u.isAsd || u.quantity < 1) continue;
        if (paidAsdIds.has(u.id)) continue;
        paidAsdIds.add(u.id);
        total += asdRateMinor;
      }
    }

    // PT ALL SPORTS fix — once per conducted session from any PT/CLUB slice that carries a rate.
    const ptAllSportsRate = Math.max(
      0,
      ...slices
        .filter((s) => s.track === 'PT' || s.track === 'CLUB')
        .map((s) => s.ptAllSportsRateMinor ?? 0),
    );
    if (ptAllSportsRate > 0) {
      for (const u of trusted) {
        if (u.kind !== 'PT' || !u.isPtAllSports || u.isComplimentary) continue;
        if (paidPtAllSportsIds.has(u.id)) continue;
        paidPtAllSportsIds.add(u.id);
        total += ptAllSportsRate;
      }
    }

    for (const slice of slices) {
      if (
        (slice.track === 'ADMIN' || slice.track === 'MANAGER') &&
        sales
      ) {
        const cat = this.adminManagerCategoryContributions(slice, sales);
        total +=
          cat.membershipMinor +
          cat.spaMinor +
          cat.solariumMinor +
          cat.shopMinor +
          cat.corporateMinor;
      }

      if (slice.track === 'GROUP_TRAINER') {
        for (const u of trusted.filter((x) => x.kind === 'GROUP')) {
          if (u.isAsd) continue; // already paid via asdGroupRateMinor
          // Reformer room group classes pay via REFORMER track only.
          if (u.roomKey === 'REFORMER') continue;
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

      if (slice.track === 'REFORMER') {
        const tiers =
          (slice.groupRateTiers?.filter((t) => t.roomKey === 'REFORMER')
            ?.length ?? 0) > 0
            ? slice.groupRateTiers
            : DEFAULT_REFORMER_RATE_TIERS;
        for (const u of trusted.filter(
          (x) => x.kind === 'GROUP' && x.roomKey === 'REFORMER',
        )) {
          if (u.isAsd) continue;
          if (u.quantity < 1) continue;
          total += resolveGroupSessionRateMinor(
            u.quantity,
            'REFORMER',
            tiers,
          );
        }

        const refPct = slice.reformerPersonalPercent ?? 0;
        if (refPct > 0) {
          for (const u of trusted.filter(
            (x) =>
              x.kind === 'PT' &&
              (x.isReformerPersonal || x.roomKey === 'REFORMER') &&
              !x.isComplimentary &&
              !x.isPtAllSports,
          )) {
            const price = u.priceMinor ?? 0;
            if (price > 0) {
              total += Math.round((price * refPct) / 100);
            }
          }
        }
      }

      if (slice.track === 'SPA') {
        for (const u of trusted.filter((x) => x.kind === 'SPA')) {
          if (workUnitIsSpaPartnerBio(u)) {
            if (slice.spaPartnerRateMinor) total += slice.spaPartnerRateMinor;
            continue;
          }
          const price = u.priceMinor ?? 0;
          if (price > 0 && slice.spaSoldPercent) {
            total += Math.round((price * slice.spaSoldPercent) / 100);
          } else if (
            price === 0 &&
            u.spaMembershipQuota === true &&
            slice.spaQuotaRates?.length
          ) {
            const title = u.title.toLowerCase();
            const match = slice.spaQuotaRates.find((r) => {
              if (r.serviceKey === 'BODY_COMPOSITION')
                return /состав|анализ|inbody|compos|биоимпеданс|bio.?imped/i.test(
                  title,
                );
              if (r.serviceKey === 'CLASSIC_MASSAGE')
                return /массаж|massage|класси/i.test(title);
              return r.serviceKey === u.serviceId;
            });
            if (match) total += match.rateMinor;
          }
        }
      }

      if (slice.track === 'PT' || slice.track === 'CLUB') {
        // Exclude ALL SPORTS (fixed rate) and reformer personal (REFORMER track %).
        const ptUnits = trusted.filter(
          (x) =>
            x.kind === 'PT' &&
            !x.isPtAllSports &&
            !(hasReformerScheme && x.isReformerPersonal) &&
            !(hasReformerScheme && x.roomKey === 'REFORMER') &&
            // Legacy: room-based reformer exclusion when reformer scheme absent
            // but still tagged as reformer room (avoid double-count with old GP %).
            !(x.roomKey === 'REFORMER' && x.isReformerPersonal),
        );
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

  /**
   * Split ADMIN/MANAGER motivation into category contributions.
   * Massage+solarium share one %; split proportionally by sales bases.
   */
  private adminManagerCategoryContributions(
    slice: StaffPayTrackSlice,
    sales: StaffSalesBreakdown,
  ): MotivationCategoryBreakdown {
    const membershipMinor = slice.membershipSalesPercent
      ? Math.round((sales.membershipMinor * slice.membershipSalesPercent) / 100)
      : 0;
    const shopMinor =
      slice.track === 'ADMIN' && slice.shopSalesPercent
        ? Math.round((sales.shopMinor * slice.shopSalesPercent) / 100)
        : 0;
    const corporateMinor = slice.corporateSalesPercent
      ? Math.round((sales.corporateMinor * slice.corporateSalesPercent) / 100)
      : 0;

    const extraTotal = slice.extraSalesPercent
      ? Math.round(
          (sales.extraServicesMinor * slice.extraSalesPercent) / 100,
        )
      : 0;
    const massageBase = sales.massageMinor ?? 0;
    const solariumBase = sales.solariumMinor ?? 0;
    const splitKnown =
      sales.massageMinor != null || sales.solariumMinor != null;
    const splitBase = massageBase + solariumBase;
    let spaMinor = 0;
    let solariumMinor = 0;
    if (extraTotal > 0) {
      if (splitKnown && splitBase > 0) {
        spaMinor = Math.round((extraTotal * massageBase) / splitBase);
        solariumMinor = extraTotal - spaMinor;
      } else {
        // Analytics fallback has no massage/solarium split — attribute to Спа.
        spaMinor = extraTotal;
      }
    }

    return {
      membershipMinor,
      spaMinor,
      solariumMinor,
      shopMinor,
      corporateMinor,
    };
  }

  private calcMotivationBreakdownFromProfile(
    profile: StaffPayProfile,
    sales: StaffSalesBreakdown,
  ): MotivationCategoryBreakdown | undefined {
    const deskSlices = allPaySlices(profile).filter(
      (s) => s.track === 'ADMIN' || s.track === 'MANAGER',
    );
    if (deskSlices.length === 0) return undefined;

    const out: MotivationCategoryBreakdown = {
      membershipMinor: 0,
      spaMinor: 0,
      solariumMinor: 0,
      shopMinor: 0,
      corporateMinor: 0,
    };
    for (const slice of deskSlices) {
      const cat = this.adminManagerCategoryContributions(slice, sales);
      out.membershipMinor += cat.membershipMinor;
      out.spaMinor += cat.spaMinor;
      out.solariumMinor += cat.solariumMinor;
      out.shopMinor += cat.shopMinor;
      out.corporateMinor += cat.corporateMinor;
    }
    return out;
  }

  private async countOpenSellerDebts(
    clubId: string,
    userId: string,
    asOfYmd: string,
  ): Promise<{ count: number; amountMinor: number }> {
    // Same source as admin «Неоплаченные» / self-payroll — all open debts.
    const debt = await this.adminSales.sellerOpenUnpaid(
      clubId,
      userId,
      asOfYmd,
    );
    return {
      count: debt.lines.length,
      amountMinor: debt.unpaidMinor,
    };
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
        (s.track === 'ADMIN' || s.track === 'MANAGER') &&
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
        massageMinor: 0,
        solariumMinor: 0,
        shopMinor: 0,
        corporateMinor,
        fromAnalytics: false,
      };
    }

    const user = await this.prisma.user.findFirst({
      where: { id: userId, clubId },
      select: { employeeCode: true },
    });

    const cached = await this.adminSales.paidBreakdownForPayroll(
      clubId,
      userId,
      from,
      to,
    );
    if (cached.source === 'cache') {
      return {
        membershipMinor: cached.membershipMinor,
        extraServicesMinor: cached.extraServicesMinor,
        massageMinor: cached.massageMinor ?? 0,
        solariumMinor: cached.solariumMinor ?? 0,
        shopMinor: cached.shopMinor,
        corporateMinor,
        fromAnalytics: true,
        source: 'cache',
        hint: cached.hint,
      };
    }

    const provider = createAnalyticsProvider({
      baseUrl: this.config.get<string>('FORMA_ANALYTICS_URL'),
      apiKey: this.config.get<string>('FORMA_API_KEY'),
      basicAuth: this.config.get<string>('FORMA_BASIC_AUTH'),
    });

    if (!provider) {
      return {
        membershipMinor: 0,
        extraServicesMinor: 0,
        massageMinor: 0,
        solariumMinor: 0,
        shopMinor: 0,
        corporateMinor,
        fromAnalytics: false,
        source: 'none',
        hint:
          cached.hint ??
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
      massageMinor: remote?.massageMinor,
      solariumMinor: remote?.solariumMinor,
      shopMinor: remote?.shopMinor ?? 0,
      corporateMinor,
      fromAnalytics: remote?.fromAnalytics ?? false,
      source: remote?.fromAnalytics ? 'analytics' : 'none',
      hint: remote?.hint ?? cached.hint,
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
    if (roles.includes('MANAGER') || track === 'MANAGER') return 'MANAGER';
    if (roles.includes('ADMIN') || track === 'ADMIN') return 'ADMIN';
    if (roles.includes('SPECIALIST') || track === 'SPA') return 'SPECIALIST';
    if (roles.includes('TECH') || track === 'TECH') return 'TECH';
    return 'TRAINER';
  }

  invalidateClubSummaryCache(clubId?: string) {
    if (!clubId) {
      this.clubSummaryCache.clear();
      return;
    }
    const prefix = `${clubId}|`;
    for (const key of this.clubSummaryCache.keys()) {
      if (key.startsWith(prefix)) this.clubSummaryCache.delete(key);
    }
  }

  async getClubSummary(
    clubId: string,
    from: string,
    to: string,
    department?: ClubPayrollSectionId | 'ALL' | 'MANAGER',
  ): Promise<ClubPayrollReport> {
    this.assertPeriod(from, to);
    // Cache only the full club report; department filters slice in memory.
    const cacheKey = `${clubId}|${from}|${to}`;
    const cached = this.clubSummaryCache.get(cacheKey);
    if (cached && Date.now() - cached.at < CLUB_SUMMARY_CACHE_TTL_MS) {
      const full = await cached.value;
      return this.filterClubSummaryByDepartment(full, department);
    }

    const value = this.computeClubSummary(clubId, from, to).finally(() => {
      setTimeout(() => {
        const cur = this.clubSummaryCache.get(cacheKey);
        if (cur?.value === value) this.clubSummaryCache.delete(cacheKey);
      }, CLUB_SUMMARY_CACHE_TTL_MS);
    });
    this.clubSummaryCache.set(cacheKey, { at: Date.now(), value });
    const full = await value;
    return this.filterClubSummaryByDepartment(full, department);
  }

  private filterClubSummaryByDepartment(
    report: ClubPayrollReport,
    department?: ClubPayrollSectionId | 'ALL' | 'MANAGER',
  ): ClubPayrollReport {
    if (!department || department === 'ALL') return report;
    // MANAGER and ADMIN are distinct sections (managers no longer hide inside ADMIN).
    const sections = report.sections.filter((s) => s.id === department);
    const rows = sections.flatMap((s) => s.rows);
    return {
      ...report,
      sections,
      grandTotalMinor: rows.reduce((a, r) => a + r.totalEarnedMinor, 0),
    };
  }

  private async computeClubSummary(
    clubId: string,
    from: string,
    to: string,
  ): Promise<ClubPayrollReport> {
    const staff = await this.listStaffPaySummaries(clubId, {
      excludeClubTrainerOnly: true,
    });
    const periodFrom = new Date(`${from}T00:00:00`);
    const periodTo = new Date(`${to}T23:59:59`);
    const rows: ClubPayrollRow[] = await mapPool(
      staff,
      CLUB_SUMMARY_CONCURRENCY,
      async (s) => {
      const [summary, payouts] = await Promise.all([
        this.getPeriodSummary(clubId, s.userId, from, to),
        this.prisma.payrollPayout.findMany({
          where: {
            clubId,
            userId: s.userId,
            status: PayrollPayoutStatus.PAID,
            periodFrom: { gte: periodFrom },
            periodTo: { lte: periodTo },
          },
        }),
      ]);
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

      return {
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
        ...(summary.motivationBreakdown
          ? { motivationBreakdown: summary.motivationBreakdown }
          : {}),
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
        ...(summary.ptStats ? { ptStats: summary.ptStats } : {}),
      };
      },
    );

    const sectionIds: ClubPayrollSectionId[] = [
      'MANAGER',
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
    picture = false,
  ): Promise<Buffer> {
    if (picture) {
      return this.exportClubPictureXlsx(clubId, from, to, department);
    }
    const ExcelJS = await import('exceljs');
    const report = await this.getClubSummary(clubId, from, to, department);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('ЗП');
    ws.addRow([
      'Подразделение',
      'ФИО',
      'ПТ шт',
      'ПТ %',
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
          r.ptStats?.sessionCount ?? r.workUnitCounts.pt,
          r.ptStats?.percent ?? '',
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
        '',
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

  private sectionPaidMinor(rows: ClubPayrollRow[]): number {
    return rows.reduce((a, r) => a + r.periodPaidTotalMinor, 0);
  }

  private deltaPct(current: number, previous: number): number | null {
    if (previous === 0) return current === 0 ? 0 : null;
    return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
  }

  async exportClubPictureXlsx(
    clubId: string,
    from: string,
    to: string,
    department?: ClubPayrollSectionId | 'ALL' | 'MANAGER',
  ): Promise<Buffer> {
    const ExcelJS = await import('exceljs');
    const cmp = sameSlicePreviousMonth(from, to);
    const [cur, prev] = await Promise.all([
      this.getClubSummary(clubId, from, to, department),
      this.getClubSummary(clubId, cmp.from, cmp.to, department),
    ]);
    const wb = new ExcelJS.Workbook();
    const prevBySection = new Map(prev.sections.map((s) => [s.id, s]));
    const prevByUser = new Map(
      prev.sections.flatMap((s) => s.rows.map((r) => [r.userId, r] as const)),
    );

    const wsSummary = wb.addWorksheet('Сводка');
    wsSummary.addRow([
      'Период',
      `${from} — ${to}`,
      'Сравнение',
      `${cmp.from} — ${cmp.to}`,
    ]);
    wsSummary.addRow([]);
    wsSummary.addRow([
      'Подразделение',
      'Люди',
      'База',
      'Мотивация',
      'Премии',
      'Штрафы',
      'Начислено',
      'Выплачено',
      'К выдаче',
      'База прошл.',
      'Мотивация прошл.',
      'Премии прошл.',
      'Штрафы прошл.',
      'Начислено прошл.',
      'Выплачено прошл.',
      'К выдаче прошл.',
      'Δ% начислено',
    ]);
    for (const section of cur.sections) {
      const p = prevBySection.get(section.id);
      const paid = this.sectionPaidMinor(section.rows);
      const paidPrev = p ? this.sectionPaidMinor(p.rows) : 0;
      const earnedPrev = p?.totals.totalEarnedMinor ?? 0;
      wsSummary.addRow([
        section.label,
        section.rows.length,
        section.totals.baseSalaryMinor / 100,
        section.totals.motivationMinor / 100,
        section.totals.bonusMinor / 100,
        section.totals.fineMinor / 100,
        section.totals.totalEarnedMinor / 100,
        paid / 100,
        section.totals.toPayMinor / 100,
        (p?.totals.baseSalaryMinor ?? 0) / 100,
        (p?.totals.motivationMinor ?? 0) / 100,
        (p?.totals.bonusMinor ?? 0) / 100,
        (p?.totals.fineMinor ?? 0) / 100,
        earnedPrev / 100,
        paidPrev / 100,
        (p?.totals.toPayMinor ?? 0) / 100,
        this.deltaPct(section.totals.totalEarnedMinor, earnedPrev) ?? '',
      ]);
    }
    const paidCur = this.sectionPaidMinor(cur.sections.flatMap((s) => s.rows));
    const paidPrev = this.sectionPaidMinor(prev.sections.flatMap((s) => s.rows));
    const toPayCur = cur.sections.reduce((a, s) => a + s.totals.toPayMinor, 0);
    const toPayPrev = prev.sections.reduce((a, s) => a + s.totals.toPayMinor, 0);
    wsSummary.addRow([
      'Всего',
      cur.sections.reduce((a, s) => a + s.rows.length, 0),
      '',
      '',
      '',
      '',
      cur.grandTotalMinor / 100,
      paidCur / 100,
      toPayCur / 100,
      '',
      '',
      '',
      '',
      prev.grandTotalMinor / 100,
      paidPrev / 100,
      toPayPrev / 100,
      this.deltaPct(cur.grandTotalMinor, prev.grandTotalMinor) ?? '',
    ]);

    const wsStaff = wb.addWorksheet('Сотрудники');
    wsStaff.addRow([
      'Подразделение',
      'ФИО',
      'ПТ шт',
      'ПТ %',
      'ГП',
      'SPA',
      'Часы смены',
      'База',
      'Мотивация',
      'Премии',
      'Штрафы',
      'Начислено',
      'Выплачено',
      'К выдаче',
      'Начислено прошл.',
      'Δ% начислено',
    ]);
    for (const section of cur.sections) {
      for (const r of section.rows) {
        const p = prevByUser.get(r.userId);
        const earnedPrev = p?.totalEarnedMinor ?? 0;
        wsStaff.addRow([
          section.label,
          r.name,
          r.ptStats?.sessionCount ?? r.workUnitCounts.pt,
          r.ptStats?.percent ?? '',
          r.workUnitCounts.group,
          r.workUnitCounts.spa,
          r.workUnitCounts.shiftHours,
          r.baseSalaryMinor / 100,
          r.motivationMinor / 100,
          r.bonusMinor / 100,
          r.fineMinor / 100,
          r.totalEarnedMinor / 100,
          r.periodPaidTotalMinor / 100,
          r.toPayMinor / 100,
          earnedPrev / 100,
          this.deltaPct(r.totalEarnedMinor, earnedPrev) ?? '',
        ]);
      }
    }

    const wsSales = wb.addWorksheet('Продажи');
    wsSales.addRow([
      'Подразделение',
      'ФИО',
      'Абон. база',
      'Абон. мотивация',
      'SPA база',
      'SPA мотивация',
      'Солярий база',
      'Солярий мотивация',
      'Магазин база',
      'Магазин мотивация',
      'Корпо база',
      'Корпо мотивация',
      'Абон. база прошл.',
      'Абон. мотивация прошл.',
      'SPA база прошл.',
      'SPA мотивация прошл.',
      'Солярий база прошл.',
      'Солярий мотивация прошл.',
      'Магазин база прошл.',
      'Магазин мотивация прошл.',
      'Корпо база прошл.',
      'Корпо мотивация прошл.',
    ]);
    for (const section of cur.sections) {
      if (section.id !== 'MANAGER' && section.id !== 'ADMIN') continue;
      for (const r of section.rows) {
        const p = prevByUser.get(r.userId);
        wsSales.addRow([
          section.label,
          r.name,
          (r.sales?.membershipMinor ?? 0) / 100,
          (r.motivationBreakdown?.membershipMinor ?? 0) / 100,
          (r.sales?.massageMinor ?? 0) / 100,
          (r.motivationBreakdown?.spaMinor ?? 0) / 100,
          (r.sales?.solariumMinor ?? 0) / 100,
          (r.motivationBreakdown?.solariumMinor ?? 0) / 100,
          (r.sales?.shopMinor ?? 0) / 100,
          (r.motivationBreakdown?.shopMinor ?? 0) / 100,
          (r.sales?.corporateMinor ?? 0) / 100,
          (r.motivationBreakdown?.corporateMinor ?? 0) / 100,
          (p?.sales?.membershipMinor ?? 0) / 100,
          (p?.motivationBreakdown?.membershipMinor ?? 0) / 100,
          (p?.sales?.massageMinor ?? 0) / 100,
          (p?.motivationBreakdown?.spaMinor ?? 0) / 100,
          (p?.sales?.solariumMinor ?? 0) / 100,
          (p?.motivationBreakdown?.solariumMinor ?? 0) / 100,
          (p?.sales?.shopMinor ?? 0) / 100,
          (p?.motivationBreakdown?.shopMinor ?? 0) / 100,
          (p?.sales?.corporateMinor ?? 0) / 100,
          (p?.motivationBreakdown?.corporateMinor ?? 0) / 100,
        ]);
      }
    }

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

  async setMotivationExclusion(
    actor: JwtPayload,
    userId: string,
    excludeFromPayrollMotivation: boolean,
  ) {
    const clubId = requireClubId(actor);
    const user = await this.prisma.user.findFirst({
      where: { id: userId, clubId },
      include: { roles: true },
    });
    if (!user) throw new NotFoundException('Сотрудник не найден');
    if (excludeFromPayrollMotivation) {
      const isManager = user.roles.some((r) => r.role === Role.MANAGER);
      const isClubTrainer = Boolean(user.trainerClub);
      if (!isManager && !isClubTrainer) {
        throw new BadRequestException(
          'Без мотивации только для управляющего или тренера клуба',
        );
      }
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { excludeFromPayrollMotivation },
    });
    return { userId, excludeFromPayrollMotivation };
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
