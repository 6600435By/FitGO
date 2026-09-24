import { Injectable, NotFoundException } from '@nestjs/common';
import {
  allPaySlices,
  type AdminMySalesResponse,
  type AdminSaleLineDto,
  type AdminSalePaymentFilter,
  type AdminSaleType,
  type AdminSalesOverviewResponse,
  type AdminSalesStaffDetailResponse,
  type AdminSalesTotals,
  type MembershipSalesAttribution,
  type StaffPayProfile,
  type StaffSalesBreakdown,
} from '@fitgo/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import {
  attributionLabel,
  endOfDayUtc,
  majorToMinor,
  startOfDayUtc,
} from './admin-sales.util';

function readPayProfile(raw: unknown): StaffPayProfile | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as StaffPayProfile;
  return p.track ? p : undefined;
}

@Injectable()
export class AdminSalesService {
  constructor(private readonly prisma: PrismaService) {}

  private async adminAttribution(
    clubId: string,
    userId: string,
  ): Promise<{
    profile?: StaffPayProfile;
    attribution: MembershipSalesAttribution;
  }> {
    const compensation = await this.prisma.staffCompensation.findFirst({
      where: { clubId, userId },
      orderBy: { effectiveFrom: 'desc' },
    });
    const profile = readPayProfile(compensation?.payProfile);
    const adminSlice = allPaySlices(profile).find((s) => s.track === 'ADMIN');
    const attribution: MembershipSalesAttribution =
      adminSlice?.membershipSalesAttribution === 'shiftShare'
        ? 'shiftShare'
        : 'individual';
    return { profile, attribution };
  }

  /**
   * ADMIN shifts on a calendar day → distinct userIds + count.
   * Split uses FitGO roster only; 1C author is display-only for membership.
   */
  private async shiftAdminsForDay(
    clubId: string,
    dayKey: string,
    cache: Map<string, string[]>,
  ): Promise<string[]> {
    if (cache.has(dayKey)) return cache.get(dayKey)!;
    const dayStart = startOfDayUtc(dayKey);
    const dayEnd = endOfDayUtc(dayKey);
    const shifts = await this.prisma.staffShift.findMany({
      where: {
        clubId,
        track: 'ADMIN',
        date: { gte: dayStart, lte: dayEnd },
      },
      select: { userId: true },
      distinct: ['userId'],
    });
    const ids = shifts.map((s) => s.userId);
    cache.set(dayKey, ids);
    return ids;
  }

  private emptyTotals(): AdminSalesTotals {
    return {
      membershipPaidMinor: 0,
      massagePaidMinor: 0,
      solariumPaidMinor: 0,
      shopPaidMinor: 0,
      unpaidMinor: 0,
      accrualMembershipMinor: 0,
      accrualExtraMinor: 0,
      accrualShopMinor: 0,
      accrualTotalMinor: 0,
    };
  }

  private applyAccrual(
    totals: AdminSalesTotals,
    profile: StaffPayProfile | undefined,
  ): AdminSalesTotals {
    const slice = allPaySlices(profile).find((s) => s.track === 'ADMIN');
    const mPct = slice?.membershipSalesPercent ?? 0;
    const ePct = slice?.extraSalesPercent ?? 0;
    const sPct = slice?.shopSalesPercent ?? 0;
    const accrualMembershipMinor = Math.round(
      (totals.membershipPaidMinor * mPct) / 100,
    );
    const accrualExtraMinor = Math.round(
      ((totals.massagePaidMinor + totals.solariumPaidMinor) * ePct) / 100,
    );
    const accrualShopMinor = Math.round((totals.shopPaidMinor * sPct) / 100);
    return {
      ...totals,
      accrualMembershipMinor,
      accrualExtraMinor,
      accrualShopMinor,
      accrualTotalMinor:
        accrualMembershipMinor + accrualExtraMinor + accrualShopMinor,
    };
  }

  private async buildLinesAndTotals(params: {
    clubId: string;
    userId: string;
    employeeCodes: string[];
    from: string;
    to: string;
    saleTypes?: AdminSaleType[];
    payment?: AdminSalePaymentFilter;
    attribution: MembershipSalesAttribution;
    profile?: StaffPayProfile;
    /** For list view: filter by soldAt. Accrual uses paidAt in period. */
    periodField: 'soldAt' | 'paidAt';
  }): Promise<{ lines: AdminSaleLineDto[]; totals: AdminSalesTotals }> {
    const fromDt = startOfDayUtc(params.from);
    const toDt = endOfDayUtc(params.to);
    const shiftCache = new Map<string, string[]>();
    const wantsMembership =
      !params.saleTypes?.length || params.saleTypes.includes('membership');
    const individualTypes = (params.saleTypes ?? [
      'membership',
      'massage',
      'solarium',
      'shop',
    ]).filter((t) => t !== 'membership' || params.attribution === 'individual');

    const dateFilter =
      params.periodField === 'paidAt'
        ? { paidAt: { gte: fromDt, lte: toDt } }
        : { soldAt: { gte: fromDt, lte: toDt } };

    const orBranches: object[] = [];

    // Individual types (and membership in individual mode): by 1C author
    if (individualTypes.length && params.employeeCodes.length) {
      orBranches.push({
        saleType: { in: individualTypes },
        employeeExternalId: { in: params.employeeCodes },
      });
    }

    // shiftShare membership: all authors; filter to days this admin is on roster
    if (params.attribution === 'shiftShare' && wantsMembership) {
      orBranches.push({ saleType: 'membership' });
    }

    if (!orBranches.length) {
      return {
        lines: [],
        totals: this.applyAccrual(this.emptyTotals(), params.profile),
      };
    }

    const rows = await this.prisma.saleTransaction.findMany({
      where: {
        clubId: params.clubId,
        isActive: true,
        OR: orBranches,
        ...dateFilter,
      },
      orderBy: [{ soldAt: 'desc' }, { externalSaleId: 'desc' }],
    });

    const totals = this.emptyTotals();
    const lines: AdminSaleLineDto[] = [];

    for (const row of rows) {
      const paid = row.paidAt != null;
      if (params.payment === 'paid' && !paid) continue;
      if (params.payment === 'unpaid' && paid) continue;

      const amountMinor = majorToMinor(row.amount);
      let attributed = amountMinor;
      const isMembershipShift =
        row.saleType === 'membership' && params.attribution === 'shiftShare';

      if (isMembershipShift) {
        const dayKey = row.soldAt.toISOString().slice(0, 10);
        const onShift = await this.shiftAdminsForDay(
          params.clubId,
          dayKey,
          shiftCache,
        );
        // Not on FitGO roster that day → no share (1C author ignored for money)
        if (!onShift.includes(params.userId)) continue;
        const n = onShift.length; // ≥1 because we are included
        attributed = Math.round(amountMinor / n);
      }

      const paidInPeriod =
        paid && row.paidAt! >= fromDt && row.paidAt! <= toDt;

      if (!paid) {
        totals.unpaidMinor += attributed;
      } else if (paidInPeriod) {
        if (row.saleType === 'membership')
          totals.membershipPaidMinor += attributed;
        else if (row.saleType === 'massage')
          totals.massagePaidMinor += attributed;
        else if (row.saleType === 'solarium')
          totals.solariumPaidMinor += attributed;
        else if (row.saleType === 'shop') totals.shopPaidMinor += attributed;
      }

      const pushLine =
        params.periodField === 'soldAt' ||
        (paidInPeriod && params.periodField === 'paidAt');

      if (pushLine) {
        lines.push({
          id: row.id,
          externalSaleId: row.externalSaleId,
          soldAt: row.soldAt.toISOString(),
          paidAt: row.paidAt?.toISOString() ?? null,
          amountMinor,
          attributedMinor: attributed,
          saleType: row.saleType as AdminSaleType,
          productName: row.productName,
          clientName: row.clientName,
          employeeExternalId: row.employeeExternalId,
          employeeName: row.employeeName,
          paid,
        });
      }
    }

    return {
      lines,
      totals: this.applyAccrual(totals, params.profile),
    };
  }

  /**
   * Admin «Мои продажи»: list by soldAt in period; totals accrual by paidAt in period;
   * unpaid still listed when sold in period.
   */
  async mySales(
    clubId: string,
    userId: string,
    params: {
      from: string;
      to: string;
      saleType?: AdminSaleType | 'all';
      payment?: AdminSalePaymentFilter;
    },
  ): Promise<AdminMySalesResponse> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, clubId },
      select: { employeeCode: true, firstName: true, lastName: true },
    });
    const { attribution, profile } = await this.adminAttribution(
      clubId,
      userId,
    );

    // shiftShare membership uses FitGO roster (userId), not 1C code.
    // employeeCode still needed for massage / solarium / shop (by author).
    if (!user) {
      return {
        from: params.from,
        to: params.to,
        attribution,
        attributionLabel: attributionLabel(attribution),
        totals: this.applyAccrual(this.emptyTotals(), profile),
        lines: [],
        currency: 'BYN',
        hint: 'Сотрудник не найден',
      };
    }

    const employeeCodes = user.employeeCode ? [user.employeeCode] : [];
    const saleTypes =
      params.saleType && params.saleType !== 'all'
        ? [params.saleType]
        : undefined;

    const needsAuthor =
      !saleTypes ||
      saleTypes.some((t) => t !== 'membership') ||
      attribution === 'individual';
    let hint: string | undefined;
    if (needsAuthor && !user.employeeCode) {
      hint =
        attribution === 'shiftShare'
          ? 'Нет кода 1С — абонементы по графику считаются, массаж/солярий/магазин без кода не видны'
          : 'У сотрудника не задан код 1С (employeeCode) — продажи не сопоставлены';
      if (attribution === 'individual') {
        return {
          from: params.from,
          to: params.to,
          attribution,
          attributionLabel: attributionLabel(attribution),
          totals: this.applyAccrual(this.emptyTotals(), profile),
          lines: [],
          currency: 'BYN',
          hint,
        };
      }
    }

    // Lines: sold in period (visible unpaid + paid)
    const listed = await this.buildLinesAndTotals({
      clubId,
      userId,
      employeeCodes,
      from: params.from,
      to: params.to,
      saleTypes,
      payment: params.payment ?? 'all',
      attribution,
      profile,
      periodField: 'soldAt',
    });

    // Accrual must use paidAt in period (may include sales sold earlier)
    const accrual = await this.buildLinesAndTotals({
      clubId,
      userId,
      employeeCodes,
      from: params.from,
      to: params.to,
      saleTypes,
      payment: 'paid',
      attribution,
      profile,
      periodField: 'paidAt',
    });

    // Merge unpaid from list into accrual totals display
    let totals: AdminSalesTotals = {
      ...accrual.totals,
      unpaidMinor: listed.totals.unpaidMinor,
    };
    if (params.payment === 'unpaid') {
      totals = this.applyAccrual(
        {
          ...this.emptyTotals(),
          unpaidMinor: listed.totals.unpaidMinor,
        },
        profile,
      );
    } else if (params.payment === 'paid') {
      totals = { ...accrual.totals, unpaidMinor: 0 };
    }

    return {
      from: params.from,
      to: params.to,
      attribution,
      attributionLabel: attributionLabel(attribution),
      totals,
      lines: listed.lines,
      currency: 'BYN',
      hint,
    };
  }

  async overview(
    clubId: string,
    params: {
      from: string;
      to: string;
      saleType?: AdminSaleType | 'all';
      payment?: AdminSalePaymentFilter;
      q?: string;
    },
  ): Promise<AdminSalesOverviewResponse> {
    const admins = await this.prisma.user.findMany({
      where: {
        clubId,
        isActive: true,
        roles: { some: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } } },
        ...(params.q?.trim()
          ? {
              OR: [
                {
                  firstName: {
                    contains: params.q.trim(),
                    mode: 'insensitive',
                  },
                },
                {
                  lastName: {
                    contains: params.q.trim(),
                    mode: 'insensitive',
                  },
                },
                {
                  employeeCode: {
                    contains: params.q.trim(),
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    const rows = [];
    for (const u of admins) {
      const detail = await this.staffDetail(clubId, u.id, {
        from: params.from,
        to: params.to,
        saleType: params.saleType,
        payment: params.payment,
      });
      rows.push({
        userId: u.id,
        name: detail.name,
        employeeCode: u.employeeCode,
        attribution: detail.attribution,
        attributionLabel: detail.attributionLabel,
        membershipPaidMinor: detail.totals.membershipPaidMinor,
        massagePaidMinor: detail.totals.massagePaidMinor,
        solariumPaidMinor: detail.totals.solariumPaidMinor,
        shopPaidMinor: detail.totals.shopPaidMinor,
        unpaidMinor: detail.totals.unpaidMinor,
        accrualTotalMinor: detail.totals.accrualTotalMinor,
      });
    }

    return {
      from: params.from,
      to: params.to,
      rows,
      currency: 'BYN',
    };
  }

  async staffDetail(
    clubId: string,
    userId: string,
    params: {
      from: string;
      to: string;
      saleType?: AdminSaleType | 'all';
      payment?: AdminSalePaymentFilter;
    },
  ): Promise<AdminSalesStaffDetailResponse> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, clubId },
      select: { firstName: true, lastName: true, employeeCode: true },
    });
    if (!user) throw new NotFoundException('Staff not found');

    const my = await this.mySales(clubId, userId, params);
    return {
      userId,
      name: `${user.lastName} ${user.firstName}`.trim(),
      from: my.from,
      to: my.to,
      attribution: my.attribution,
      attributionLabel: my.attributionLabel,
      totals: my.totals,
      lines: my.lines,
      currency: my.currency,
    };
  }

  /**
   * Paid amounts in [from,to] by paidAt for payroll motivation (with attribution).
   */
  async paidBreakdownForPayroll(
    clubId: string,
    userId: string,
    from: string,
    to: string,
  ): Promise<Omit<StaffSalesBreakdown, 'corporateMinor'>> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, clubId },
      select: { employeeCode: true },
    });
    if (!user) {
      return {
        membershipMinor: 0,
        extraServicesMinor: 0,
        shopMinor: 0,
        fromAnalytics: false,
        source: 'none',
        hint: 'Сотрудник не найден',
      };
    }

    const cacheCount = await this.prisma.saleTransaction.count({
      where: { clubId, isActive: true },
    });
    if (cacheCount === 0) {
      return {
        membershipMinor: 0,
        extraServicesMinor: 0,
        shopMinor: 0,
        fromAnalytics: false,
        source: 'none',
        hint: 'Кэш продаж пуст — дождитесь ночной выгрузки или запустите sync',
      };
    }

    const { attribution, profile } = await this.adminAttribution(
      clubId,
      userId,
    );
    const employeeCodes = user.employeeCode ? [user.employeeCode] : [];
    if (attribution === 'individual' && !user.employeeCode) {
      return {
        membershipMinor: 0,
        extraServicesMinor: 0,
        shopMinor: 0,
        fromAnalytics: false,
        source: 'none',
        hint: 'Нет employeeCode — продажи из кэша недоступны',
      };
    }

    const { totals } = await this.buildLinesAndTotals({
      clubId,
      userId,
      employeeCodes,
      from,
      to,
      payment: 'paid',
      attribution,
      profile,
      periodField: 'paidAt',
    });

    return {
      membershipMinor: totals.membershipPaidMinor,
      extraServicesMinor: totals.massagePaidMinor + totals.solariumPaidMinor,
      shopMinor: totals.shopPaidMinor,
      fromAnalytics: true,
      source: 'cache',
    };
  }
}
