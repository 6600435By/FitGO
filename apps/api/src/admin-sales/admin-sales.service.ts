import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FitgoAnalyticsHttpProvider } from '@fitgo/1c-adapter';
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
import { moscowDayKey } from '../club-sync/moscow-time';
import { PrismaService } from '../prisma/prisma.service';
import {
  attributionLabel,
  endOfDayUtc,
  majorToMinor,
  motivationAmountMajor,
  startOfDayUtc,
} from './admin-sales.util';
import {
  classifySaleType,
  loadPayrollSegmentSets,
} from './admin-sales-segments';
import { isCollectibleClientDebt } from './club-revenue-debt';
import {
  attachEmployeeToRevenueRow,
  buildStaffBySaleDoc,
  saleDocIdsForRevenueRow,
} from './club-revenue-staff';

function readPayProfile(raw: unknown): StaffPayProfile | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const p = raw as StaffPayProfile;
  return p.track ? p : undefined;
}

@Injectable()
export class AdminSalesService {
  private readonly logger = new Logger(AdminSalesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private createAnalytics(): FitgoAnalyticsHttpProvider | null {
    const baseUrl = this.config.get<string>('FORMA_ANALYTICS_URL')?.trim();
    const apiKey = this.config.get<string>('FORMA_API_KEY')?.trim();
    const basicAuth = this.config.get<string>('FORMA_BASIC_AUTH')?.trim();
    if (!baseUrl || !apiKey || !basicAuth) return null;
    return new FitgoAnalyticsHttpProvider({ baseUrl, apiKey, basicAuth });
  }

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
    /** soldAt = list by sale date; paidAt = accrual; openDebt = unpaid sold ≤ period end */
    periodField: 'soldAt' | 'paidAt' | 'openDebt';
  }): Promise<{ lines: AdminSaleLineDto[]; totals: AdminSalesTotals }> {
    const fromDt = startOfDayUtc(params.from);
    const toDt = endOfDayUtc(params.to);
    const shiftCache = new Map<string, string[]>();
    const allowedTypes = new Set<AdminSaleType>(
      params.saleTypes?.length
        ? params.saleTypes
        : ['membership', 'massage', 'solarium', 'shop'],
    );

    const dateFilter =
      params.periodField === 'paidAt'
        ? { paidAt: { gte: fromDt, lte: toDt } }
        : params.periodField === 'openDebt'
          ? { soldAt: { lte: toDt }, paidAt: null }
          : { soldAt: { gte: fromDt, lte: toDt } };

    // shiftShare: load all club rows in period (saleType in DB may be stale vs
    // app segments). individual: only this seller's rows.
    const where =
      params.attribution === 'shiftShare'
        ? {
            clubId: params.clubId,
            isActive: true,
            ...dateFilter,
          }
        : params.employeeCodes.length
          ? {
              clubId: params.clubId,
              isActive: true,
              employeeExternalId: { in: params.employeeCodes },
              ...dateFilter,
            }
          : null;

    if (!where) {
      return {
        lines: [],
        totals: this.applyAccrual(this.emptyTotals(), params.profile),
      };
    }

    const [rows, segments] = await Promise.all([
      this.prisma.saleTransaction.findMany({
        where,
        orderBy: [{ soldAt: 'desc' }, { externalSaleId: 'desc' }],
      }),
      loadPayrollSegmentSets(this.config),
    ]);

    const totals = this.emptyTotals();
    const lines: AdminSaleLineDto[] = [];
    const codeSet = new Set(params.employeeCodes);

    for (const row of rows) {
      const paid = row.paidAt != null;
      if (params.payment === 'paid' && !paid) continue;
      if (params.payment === 'unpaid' && paid) continue;

      const bucket = classifySaleType(
        row.saleType,
        row.productName,
        segments,
      );
      // «Тренировки» — дашборд / ПТ, не мотивация админа
      if (bucket === 'training' || !allowedTypes.has(bucket)) continue;
      const saleType = bucket;

      const amountMinor = majorToMinor(row.amount);
      const motivationMinor = majorToMinor(motivationAmountMajor(row));
      let attributed = motivationMinor;
      const isMembershipShift =
        saleType === 'membership' && params.attribution === 'shiftShare';

      if (isMembershipShift) {
        // Club calendar day (Minsk), not UTC — else 00:00–02:59 local
        // attaches to yesterday's roster. Roster = FitGO StaffShift ADMIN,
        // not 1C schedule (may differ → different bases vs FFS report).
        const dayKey = moscowDayKey(row.soldAt);
        const onShift = await this.shiftAdminsForDay(
          params.clubId,
          dayKey,
          shiftCache,
        );
        // Not on FitGO roster that day → no share (1C author ignored for money)
        if (!onShift.includes(params.userId)) continue;
        // 1 admin → 100%; 2 or 3+ → equal split
        const n = onShift.length;
        attributed = Math.round(motivationMinor / n);
      } else if (params.attribution === 'shiftShare') {
        // Massage / solarium / shop: only the 1C seller (no shift split).
        const emp = row.employeeExternalId?.trim() || '';
        if (!emp || !codeSet.has(emp)) continue;
      }

      const paidInPeriod =
        paid && row.paidAt! >= fromDt && row.paidAt! <= toDt;

      if (!paid) {
        totals.unpaidMinor += attributed;
      } else if (paidInPeriod) {
        if (saleType === 'membership') totals.membershipPaidMinor += attributed;
        else if (saleType === 'massage') totals.massagePaidMinor += attributed;
        else if (saleType === 'solarium')
          totals.solariumPaidMinor += attributed;
        else if (saleType === 'shop') totals.shopPaidMinor += attributed;
      }

      const pushLine =
        params.periodField === 'soldAt' ||
        params.periodField === 'openDebt' ||
        (paidInPeriod && params.periodField === 'paidAt');

      if (pushLine) {
        lines.push({
          id: row.id,
          externalSaleId: row.externalSaleId,
          soldAt: row.soldAt.toISOString(),
          paidAt: row.paidAt?.toISOString() ?? null,
          amountMinor,
          attributedMinor: attributed,
          saleType,
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
   * Admin «Мои продажи»:
   * - приход/начисление ЗП — только оплаты с paidAt в периоде (продажа могла быть раньше);
   * - долг — неоплаченные с soldAt ≤ конец периода (переносится, пока не закроется);
   * - в списке: продажи периода ∪ оплаты периода ∪ открытый долг.
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

    const common = {
      clubId,
      userId,
      employeeCodes,
      from: params.from,
      to: params.to,
      saleTypes,
      attribution,
      profile,
    } as const;

    // Accrual: paidAt in period (incl. sales from earlier months)
    const accrual = await this.buildLinesAndTotals({
      ...common,
      payment: 'paid',
      periodField: 'paidAt',
    });

    // Paid sales with soldAt in period (for «all» list). Do NOT pull
    // SaleTransaction unpaid — cache is stale vs 1C debt register.
    const listedPaid =
      params.payment === 'unpaid'
        ? { lines: [] as AdminSaleLineDto[], totals: this.emptyTotals() }
        : await this.buildLinesAndTotals({
            ...common,
            payment: 'paid',
            periodField: 'soldAt',
          });

    // Open seller debt = ClubRevenue unpaid snapshot (1C «Неоплаченные»),
    // enriched with SaleTransaction seller when cash export left staff empty.
    const sellerDebt = await this.sellerOpenUnpaid(clubId, userId, params.to);

    let totals: AdminSalesTotals = {
      ...accrual.totals,
      unpaidMinor: sellerDebt.unpaidMinor,
    };

    let lines = listedPaid.lines;
    if (params.payment === 'unpaid') {
      totals = this.applyAccrual(
        {
          ...this.emptyTotals(),
          unpaidMinor: sellerDebt.unpaidMinor,
        },
        profile,
      );
      lines = sellerDebt.lines;
    } else if (params.payment === 'paid') {
      totals = { ...accrual.totals, unpaidMinor: 0 };
      lines = accrual.lines;
    } else {
      const byId = new Map(listedPaid.lines.map((l) => [l.id, l]));
      for (const l of accrual.lines) {
        if (!byId.has(l.id)) byId.set(l.id, l);
      }
      for (const l of sellerDebt.lines) {
        if (!byId.has(l.id)) byId.set(l.id, l);
      }
      lines = [...byId.values()].sort(
        (a, b) =>
          new Date(b.paidAt ?? b.soldAt).getTime() -
          new Date(a.paidAt ?? a.soldAt).getTime(),
      );
    }

    if (!hint) {
      hint =
        'ЗП — только с оплат в периоде. Долг продавца — из 1С «Неоплаченные продажи» (live Analytics или кэш).';
    }

    return {
      from: params.from,
      to: params.to,
      attribution,
      attributionLabel: attributionLabel(attribution),
      totals,
      lines,
      currency: 'BYN',
      hint,
    };
  }

  /**
   * Open seller debt ≈ 1C «Неоплаченные продажи» for this employee.
   * Prefer live Analytics scope=debt&employeeId (after BSL fills seller from
   * ПродажиСебестоимость). Fallback: ClubRevenue unpaid + SaleTransaction map.
   */
  async sellerOpenUnpaid(
    clubId: string,
    userId: string,
    to: string,
  ): Promise<{ unpaidMinor: number; lines: AdminSaleLineDto[] }> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, clubId },
      select: {
        employeeCode: true,
        firstName: true,
        lastName: true,
      },
    });
    const code = user?.employeeCode?.trim();
    if (!code || !user) {
      return { unpaidMinor: 0, lines: [] };
    }

    const live = await this.sellerOpenUnpaidLive(code, to).catch((err) => {
      this.logger.warn(
        `Live seller debt failed: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    });
    if (live) return live;

    return this.sellerOpenUnpaidFromCache(clubId, code, user.lastName, to);
  }

  /** Live Analytics debt for one seller. Null → use cache. */
  private async sellerOpenUnpaidLive(
    employeeCode: string,
    to: string,
  ): Promise<{ unpaidMinor: number; lines: AdminSaleLineDto[] } | null> {
    const provider = this.createAnalytics();
    if (!provider) return null;

    const page = await Promise.race([
      provider.getSales({
        from: '2010-01-01',
        to,
        scope: 'debt',
        employeeId: employeeCode,
        pageSize: 0,
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 12_000)),
    ]);
    if (!page?.items?.length) return null;

    const items = page.items.filter(
      (i) =>
        (i.operationType ?? 'unpaid') === 'unpaid' &&
        isCollectibleClientDebt({
          externalId: i.saleDocumentId,
          productName: i.productName,
        }),
    );
    const withEmp = items.filter((i) =>
      Boolean(i.employeeExternalId?.trim()),
    );
    const mineByCode = withEmp.filter(
      (i) => i.employeeExternalId!.trim() === employeeCode,
    );

    // BSL filled employee → trust code filter.
    let chosen = mineByCode;
    if (!chosen.length && withEmp.length === 0 && items.length < 400) {
      // Server filtered by employeeId but left emp fields empty.
      chosen = items;
    }
    if (!chosen.length) return null;

    const lines: AdminSaleLineDto[] = [];
    let unpaidMinor = 0;
    for (const item of chosen) {
      const major = Math.abs(Number(item.saleAmount ?? item.amount) || 0);
      const amountMinor = majorToMinor(major);
      if (amountMinor <= 0) continue;
      unpaidMinor += amountMinor;
      const soldAt = item.soldAt?.includes('T')
        ? item.soldAt
        : `${(item.soldAt || to).slice(0, 10)}T12:00:00.000Z`;
      lines.push({
        id: `live:${item.saleDocumentId}`,
        externalSaleId: item.saleDocumentId,
        soldAt,
        paidAt: null,
        amountMinor,
        attributedMinor: amountMinor,
        saleType: (() => {
          const b = classifySaleType(item.saleType, item.productName, null);
          return b === 'training' ? 'shop' : b;
        })(),
        productName: item.productName ?? null,
        clientName: item.clientName ?? null,
        employeeExternalId: item.employeeExternalId?.trim() || employeeCode,
        employeeName: item.employeeName ?? null,
        paid: false,
      });
    }
    if (!lines.length) return null;
    this.logger.log(
      `Live seller debt employee=${employeeCode} lines=${lines.length} unpaid=${(unpaidMinor / 100).toFixed(2)}`,
    );
    return { unpaidMinor, lines };
  }

  private async sellerOpenUnpaidFromCache(
    clubId: string,
    code: string,
    lastName: string,
    to: string,
  ): Promise<{ unpaidMinor: number; lines: AdminSaleLineDto[] }> {
    const toDt = endOfDayUtc(to);
    const last = lastName.trim().toLowerCase();

    // Prefer rows already tagged with this seller (after Analytics re-sync).
    const direct = await this.prisma.clubRevenueEntry.findMany({
      where: {
        clubId,
        isActive: true,
        operationType: 'unpaid',
        occurredAt: { lte: toDt },
        employeeExternalId: code,
      },
      orderBy: { occurredAt: 'desc' },
    });
    const directCollectible = direct.filter((r) =>
      isCollectibleClientDebt({
        externalId: r.externalId,
        productName: r.productName,
      }),
    );
    if (directCollectible.length > 0) {
      return this.mapRevenueRowsToSellerLines(directCollectible, code);
    }

    const debtRows = await this.prisma.clubRevenueEntry.findMany({
      where: {
        clubId,
        isActive: true,
        operationType: 'unpaid',
        occurredAt: { lte: toDt },
      },
      orderBy: { occurredAt: 'desc' },
    });
    const collectible = debtRows.filter((r) =>
      isCollectibleClientDebt({
        externalId: r.externalId,
        productName: r.productName,
      }),
    );

    // Full ST staff map (chunked startsWith missed many docs).
    const saleStaff = await this.prisma.saleTransaction.findMany({
      where: {
        clubId,
        isActive: true,
        employeeExternalId: { not: null },
        NOT: { employeeExternalId: '' },
      },
      select: {
        externalSaleId: true,
        employeeExternalId: true,
        employeeName: true,
      },
    });
    // Prefer this seller's docs when several ST rows share a sale doc.
    const ordered = [
      ...saleStaff.filter((s) => s.employeeExternalId === code),
      ...saleStaff.filter((s) => s.employeeExternalId !== code),
    ];
    const staffBySaleDoc = buildStaffBySaleDoc(ordered);

    const matched = [];
    for (const raw of collectible) {
      const row = attachEmployeeToRevenueRow(raw, staffBySaleDoc);
      const empId = row.employeeExternalId?.trim() || '';
      const empName = (row.employeeName ?? '').trim().toLowerCase();
      const isMine =
        empId === code || (!!last && empName.includes(last));
      if (!isMine) continue;
      matched.push(row);
    }
    return this.mapRevenueRowsToSellerLines(matched, code);
  }

  private mapRevenueRowsToSellerLines(
    rows: Array<{
      id: string;
      externalId: string;
      occurredAt: Date;
      amount: number;
      saleAmount: number;
      saleType: string | null;
      productName: string | null;
      clientName: string | null;
      employeeExternalId: string | null;
      employeeName: string | null;
    }>,
    code: string,
  ): { unpaidMinor: number; lines: AdminSaleLineDto[] } {
    const lines: AdminSaleLineDto[] = [];
    let unpaidMinor = 0;
    for (const row of rows) {
      const major = Math.abs(Number(row.saleAmount || row.amount) || 0);
      const amountMinor = majorToMinor(major);
      if (amountMinor <= 0) continue;
      unpaidMinor += amountMinor;
      lines.push({
        id: row.id,
        externalSaleId: row.externalId,
        soldAt: row.occurredAt.toISOString(),
        paidAt: null,
        amountMinor,
        attributedMinor: amountMinor,
        saleType: (() => {
          const b = classifySaleType(
            row.saleType ?? undefined,
            row.productName,
            null,
          );
          return b === 'training' ? 'shop' : b;
        })(),
        productName: row.productName,
        clientName: row.clientName,
        employeeExternalId: row.employeeExternalId?.trim() || code,
        employeeName: row.employeeName,
        paid: false,
      });
    }
    return { unpaidMinor, lines };
  }

  async sellerOpenUnpaidMinor(
    clubId: string,
    userId: string,
    to: string,
  ): Promise<number> {
    const { unpaidMinor } = await this.sellerOpenUnpaid(clubId, userId, to);
    return unpaidMinor;
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
        massageMinor: 0,
        solariumMinor: 0,
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
        massageMinor: 0,
        solariumMinor: 0,
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
    const isManager = allPaySlices(profile).some((s) => s.track === 'MANAGER');
    if (isManager) {
      return this.paidClubBreakdownForPayroll(clubId, from, to);
    }

    const employeeCodes = user.employeeCode ? [user.employeeCode] : [];
    if (attribution === 'individual' && !user.employeeCode) {
      return {
        membershipMinor: 0,
        extraServicesMinor: 0,
        massageMinor: 0,
        solariumMinor: 0,
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
      massageMinor: totals.massagePaidMinor,
      solariumMinor: totals.solariumPaidMinor,
      shopMinor: totals.shopPaidMinor,
      fromAnalytics: true,
      source: 'cache',
    };
  }

  /**
   * Club-wide paid sales for manager % (cash+card+ЛС, no cashless).
   */
  async paidClubBreakdownForPayroll(
    clubId: string,
    from: string,
    to: string,
  ): Promise<Omit<StaffSalesBreakdown, 'corporateMinor'>> {
    const fromDt = startOfDayUtc(from);
    const toDt = endOfDayUtc(to);
    const [rows, segments] = await Promise.all([
      this.prisma.saleTransaction.findMany({
        where: {
          clubId,
          isActive: true,
          paidAt: { gte: fromDt, lte: toDt },
        },
      }),
      loadPayrollSegmentSets(this.config),
    ]);

    let membershipMinor = 0;
    let massagePaidMinor = 0;
    let solariumPaidMinor = 0;
    let shopMinor = 0;
    for (const row of rows) {
      const saleType = classifySaleType(
        row.saleType,
        row.productName,
        segments,
      );
      if (saleType === 'training') continue;
      if (
        saleType !== 'membership' &&
        saleType !== 'massage' &&
        saleType !== 'solarium' &&
        saleType !== 'shop'
      ) {
        continue;
      }
      const minor = majorToMinor(motivationAmountMajor(row));
      if (minor <= 0) continue;
      if (saleType === 'membership') membershipMinor += minor;
      else if (saleType === 'massage') massagePaidMinor += minor;
      else if (saleType === 'solarium') solariumPaidMinor += minor;
      else if (saleType === 'shop') shopMinor += minor;
    }

    return {
      membershipMinor,
      extraServicesMinor: massagePaidMinor + solariumPaidMinor,
      massageMinor: massagePaidMinor,
      solariumMinor: solariumPaidMinor,
      shopMinor,
      fromAnalytics: true,
      source: 'cache',
    };
  }
}
