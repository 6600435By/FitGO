import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  AnalyticsCompareMode,
  BatchUpsertCompetitorPricesDto,
  PatchSegmentCompetitorDto,
  PricingAnalyticsReport,
  PricingCompetitorCell,
  PricingHintCard,
  PricingProductRow,
  PricingSegmentBlock,
  PricingSegmentKey,
  UpsertCompetitorPriceDto,
  UpsertSaleWindowDto,
  UpsertSegmentCompetitorDto,
} from '@fitgo/shared-types';
import type { PricingDiscountsStatus } from '@fitgo/shared-types';
import {
  classifySaleType,
  loadPayrollSegmentSets,
} from '../admin-sales/admin-sales-segments';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertPeriod,
  isoDate,
  minskParts,
  rangeBounds,
  resolveCompareRange,
} from './analytics-period';
import {
  avgToListRatio,
  buildProductHint,
  classifyMembershipFamily,
  compareMembershipCatalogRows,
  deltaPct,
  discountShareOfListPct,
  dominantSeason,
  isDiscountStuck,
  isMembershipMarketExtraTitle,
  isStaffRelatedDiscount,
  markCoreProducts,
  marketRatio,
  membershipPromoActive,
  monthBounds,
  monthsInRange,
  normalizeDiscountName,
  parseDiscountOccurredAt,
  periodCrossesSeasonBoundary,
  pickBaseline,
  priceVolumeMixBridge,
  rankHints,
  saleBucketToPricingSegment,
  seasonLabel,
  SEGMENT_LABELS,
  SHOP_TOP_N,
  takeTopByRevenue,
  windowsForYears,
  type BuiltHint,
  type SaleWindowInput,
} from './pricing-analytics.rules';
import {
  loadSegmentPriceLists,
  type PricingPriceMap,
} from './pricing-price-list';

const REPORT_CACHE_TTL_MS = 3 * 60 * 1000;
/** Re-fetch current calendar month if last sync older than this. */
const CURRENT_MONTH_STALE_MS = 60 * 60 * 1000;
/** Max wait for auto discount sync inside getReport. */
const AUTO_SYNC_BUDGET_MS = 10_000;
const STAFF_DISC_HINT_SHARE = 0.35;
const PRODUCT_SEGMENTS: Exclude<PricingSegmentKey, 'corporate'>[] = [
  'membership',
  'training',
  'shop',
  'spa',
  'solarium',
];

type AggKey = string;

type ProductAgg = {
  productExternalId: string | null;
  productName: string;
  segment: Exclude<PricingSegmentKey, 'corporate'> | 'other';
  revenueMinor: number;
  salesCount: number;
  clientIds: Set<string>;
};

@Injectable()
export class PricingAnalyticsService {
  private readonly logger = new Logger(PricingAnalyticsService.name);
  private readonly reportCache = new Map<
    string,
    { at: number; value: Promise<PricingAnalyticsReport> }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getReport(
    user: JwtPayload,
    params: {
      from: string;
      to: string;
      compare?: AnalyticsCompareMode;
    },
  ): Promise<PricingAnalyticsReport> {
    const clubId = requireClubId(user);
    assertPeriod(params.from, params.to);
    const compare = params.compare === 'yoy' ? 'yoy' : 'prev';
    const cacheKey = `${clubId}|${params.from}|${params.to}|${compare}`;
    const hit = this.reportCache.get(cacheKey);
    if (hit && Date.now() - hit.at < REPORT_CACHE_TTL_MS) {
      return hit.value;
    }
    const value = this.buildReport(clubId, params.from, params.to, compare);
    this.reportCache.set(cacheKey, { at: Date.now(), value });
    return value;
  }

  private invalidateCache(clubId: string) {
    for (const key of this.reportCache.keys()) {
      if (key.startsWith(`${clubId}|`)) this.reportCache.delete(key);
    }
  }

  private async buildReport(
    clubId: string,
    from: string,
    to: string,
    compareMode: 'prev' | 'yoy',
  ): Promise<PricingAnalyticsReport> {
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { currency: true },
    });
    const currency = club?.currency ?? 'BYN';

    const { compareFrom: rawCmpFrom, compareTo: rawCmpTo } = resolveCompareRange(
      from,
      to,
      compareMode,
    );

    const [
      payrollSegs,
      priceLists,
      customWindows,
      competitors,
      competitorPrices,
      dataSinceRow,
    ] = await Promise.all([
      loadPayrollSegmentSets(this.config),
      loadSegmentPriceLists(this.config),
      this.prisma.membershipSaleWindow.findMany({ where: { clubId } }),
      this.prisma.segmentCompetitor.findMany({
        where: { clubId },
        orderBy: [{ segmentKey: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.segmentCompetitorPrice.findMany({
        where: { competitor: { clubId } },
      }),
      this.prisma.clubRevenueEntry.findFirst({
        where: { clubId, isActive: true },
        orderBy: { occurredAt: 'asc' },
        select: { occurredAt: true },
      }),
    ]);

    const saleWindows: SaleWindowInput[] = windowsForYears(
      from,
      to,
      customWindows.map((w) => ({
        from: isoDate(w.fromDate),
        to: isoDate(w.toDate),
        segmentKey: (w.segmentKey as PricingSegmentKey) || 'membership',
      })),
    );

    const yoyRange = resolveCompareRange(from, to, 'yoy');
    const hasYoyData = dataSinceRow
      ? isoDate(dataSinceRow.occurredAt) <= yoyRange.compareFrom
      : false;

    const baseline = pickBaseline({
      from,
      to,
      compareMode,
      compareFrom: rawCmpFrom,
      compareTo: rawCmpTo,
      hasYoyData: compareMode === 'yoy' ? hasYoyData : hasYoyData,
      windows: saleWindows,
    });

    // When user asked prev but seasons block it, still try YoY if available
    let effectiveCmpFrom: string | null = baseline.useCompare
      ? rawCmpFrom
      : null;
    let effectiveCmpTo: string | null = baseline.useCompare ? rawCmpTo : null;
    let baselineKind = baseline.kind;
    let baselineLabel = baseline.label;
    if (
      !baseline.useCompare &&
      compareMode === 'prev' &&
      hasYoyData &&
      dominantSeason(from, to) !== 'mixed'
    ) {
      const yoyBase = pickBaseline({
        from,
        to,
        compareMode: 'yoy',
        compareFrom: yoyRange.compareFrom,
        compareTo: yoyRange.compareTo,
        hasYoyData: true,
        windows: saleWindows,
      });
      if (yoyBase.useCompare) {
        effectiveCmpFrom = yoyRange.compareFrom;
        effectiveCmpTo = yoyRange.compareTo;
        baselineKind = 'yoy';
        baselineLabel = yoyBase.label;
      }
    }

    const [curAgg, cmpAgg, corpoCur, corpoCmp, visits] = await Promise.all([
      this.aggregateProducts(clubId, from, to, payrollSegs),
      effectiveCmpFrom && effectiveCmpTo
        ? this.aggregateProducts(
            clubId,
            effectiveCmpFrom,
            effectiveCmpTo,
            payrollSegs,
          )
        : Promise.resolve({
            byKey: new Map<AggKey, ProductAgg>(),
            bySegment: emptySegRevenue(),
            membershipClients: new Set<string>(),
            crossSellClients: new Set<string>(),
          }),
      this.corpoSum(clubId, from, to),
      effectiveCmpFrom && effectiveCmpTo
        ? this.corpoSum(clubId, effectiveCmpFrom, effectiveCmpTo)
        : Promise.resolve({ amountMinor: 0, count: 0 }),
      this.visitCountsForSaleCheck(clubId, from, to),
    ]);

    const mixedPeriod = periodCrossesSeasonBoundary(from, to);
    const season = dominantSeason(from, to);
    const inPromo = membershipPromoActive(from, to, saleWindows);
    const modeLabel = inPromo && season !== 'mixed'
      ? season === 'august_sale'
        ? seasonLabel('august_sale')
        : seasonLabel('promo')
      : seasonLabel(season);

    let modeDetail: string | null = baseline.reasonDropped;
    if (!hasYoyData) {
      modeDetail = modeDetail
        ? `${modeDetail}. Сравниваем по календарю сезона, своего прошлого года ещё нет.`
        : 'Сравниваем по календарю сезона, своего прошлого года ещё нет.';
    }

    const neededMonths = new Set<string>([
      ...monthsInRange(from, to),
      ...(effectiveCmpFrom && effectiveCmpTo
        ? monthsInRange(effectiveCmpFrom, effectiveCmpTo)
        : []),
    ]);
    const discountCoverage = await this.ensureDiscountMonths(
      clubId,
      [...neededMonths],
      { force: false, budgetMs: AUTO_SYNC_BUDGET_MS },
    );
    const discountsReallyAvailable =
      discountCoverage.status === 'ok' || discountCoverage.status === 'partial';

    const discountRows = discountsReallyAvailable
      ? await this.prisma.providedDiscountRow.findMany({
          where: {
            clubId,
            occurredAt: {
              gte: rangeBounds(from, to).start,
              lte: rangeBounds(from, to).end,
            },
          },
        })
      : [];
    const cmpDiscountRows =
      discountsReallyAvailable && effectiveCmpFrom && effectiveCmpTo
        ? await this.prisma.providedDiscountRow.findMany({
            where: {
              clubId,
              occurredAt: {
                gte: rangeBounds(effectiveCmpFrom, effectiveCmpTo).start,
                lte: rangeBounds(effectiveCmpFrom, effectiveCmpTo).end,
              },
            },
          })
        : [];

    const discountByProduct = new Map<string, number>();
    const discountByStaff = new Map<
      string,
      { name: string; minor: number }
    >();
    const discountByType = new Map<string, number>();
    let totalDiscountMinor = 0;
    let staffRelatedMinor = 0;
    for (const d of discountRows) {
      const minor = Math.round(Number(d.discountAmount) * 100);
      if (minor <= 0) continue;
      totalDiscountMinor += minor;
      const dName = normalizeDiscountName(d.discountName);
      discountByType.set(dName, (discountByType.get(dName) ?? 0) + minor);
      if (
        isStaffRelatedDiscount({
          clientName: d.clientName,
          discountName: dName,
        })
      ) {
        staffRelatedMinor += minor;
      }
      const pid = (d.productExternalId ?? '').toLowerCase();
      if (pid) {
        discountByProduct.set(
          pid,
          (discountByProduct.get(pid) ?? 0) + minor,
        );
      }
      const eid = d.employeeExternalId ?? d.employeeName ?? 'unknown';
      const prev = discountByStaff.get(eid) ?? {
        name: d.employeeName ?? 'Без имени',
        minor: 0,
      };
      prev.minor += minor;
      discountByStaff.set(eid, prev);
    }
    let cmpTotalDiscountMinor = 0;
    for (const d of cmpDiscountRows) {
      const minor = Math.round(Number(d.discountAmount) * 100);
      if (minor > 0) cmpTotalDiscountMinor += minor;
    }
    const clientsMinor = totalDiscountMinor - staffRelatedMinor;

    const pricesByProduct = new Map<string, number>();
    for (const seg of PRODUCT_SEGMENTS) {
      const map = priceLists.bySegment[seg];
      if (!map) continue;
      for (const [id, info] of map) {
        if (info.priceMinor > 0) pricesByProduct.set(id, info.priceMinor);
      }
    }

    const competitorsBySeg = new Map<string, typeof competitors>();
    for (const c of competitors) {
      const list = competitorsBySeg.get(c.segmentKey) ?? [];
      list.push(c);
      competitorsBySeg.set(c.segmentKey, list);
    }
    const priceByCompProduct = new Map<string, (typeof competitorPrices)[0]>();
    for (const p of competitorPrices) {
      priceByCompProduct.set(`${p.competitorId}|${p.productExternalId.toLowerCase()}`, p);
    }

    const totalRevenue =
      Object.values(curAgg.bySegment).reduce((s, n) => s + n, 0) +
      corpoCur.amountMinor;

    const saleNoInflow = visits.saleNoInflow;
    const upsellGap =
      curAgg.membershipClients.size >= 5 &&
      curAgg.crossSellClients.size / Math.max(1, curAgg.membershipClients.size) <
        0.25;

    const hints: BuiltHint[] = [];
    const segments: PricingSegmentBlock[] = [];

    const membershipCatalogIds = collectMembershipCatalogIds(
      priceLists.bySegment,
    );
    const priceByName = indexPricesByName(priceLists.bySegment);

    for (const segKey of PRODUCT_SEGMENTS) {
      const segCompetitors = competitorsBySeg.get(segKey) ?? [];
      let products = [...curAgg.byKey.values()].filter(
        (p) => p.segment === segKey,
      );

      if (segKey === 'shop') {
        products = takeTopByRevenue(products, SHOP_TOP_N);
      }

      if (segKey === 'training') {
        products = products.filter(
          (p) =>
            !(
              (p.productExternalId &&
                membershipCatalogIds.has(p.productExternalId)) ||
              isMembershipMarketExtraTitle(p.productName)
            ),
        );
      }

      if (segKey === 'membership') {
        products = buildMembershipCatalogProducts({
          priceLists: priceLists.bySegment,
          curAgg: curAgg.byKey,
          catalogIds: membershipCatalogIds,
        });
      }

      const marked = markCoreProducts(products);
      const cmpSegRev = cmpAgg.bySegment[segKey] ?? 0;
      const curSegRev = curAgg.bySegment[segKey] ?? 0;

      const productRows: PricingProductRow[] = marked.map((p) => {
        const pid = (p.productExternalId ?? '').toLowerCase();
        const cmp = findAggForProduct(cmpAgg.byKey, pid, p.productName);
        const listPrice = resolveListPrice(
          pid,
          p.productName,
          pricesByProduct,
          priceLists.bySegment[segKey],
          priceByName,
        );
        const avgActual =
          p.salesCount > 0
            ? Math.round(p.revenueMinor / p.salesCount)
            : null;
        const avgCmp =
          cmp && cmp.salesCount > 0
            ? Math.round(cmp.revenueMinor / cmp.salesCount)
            : 0;
        const bridge =
          effectiveCmpFrom && cmp && p.salesCount > 0
            ? priceVolumeMixBridge({
                revenueCur: p.revenueMinor,
                revenueCmp: cmp.revenueMinor,
                avgPriceCur: avgActual ?? 0,
                avgPriceCmp: avgCmp,
                qtyCur: p.salesCount,
                qtyCmp: cmp.salesCount,
              })
            : null;

        const cells: PricingCompetitorCell[] = segCompetitors.map((c) => {
          const cell = priceByCompProduct.get(`${c.id}|${pid}`);
          return {
            competitorId: c.id,
            priceMinor: cell?.priceMinor ?? null,
            observedAt: cell ? isoDate(cell.observedAt) : null,
            theirName: cell?.theirName ?? null,
            sourceUrl: null,
          };
        });
        const filled = cells
          .map((c) => c.priceMinor)
          .filter((n): n is number => n != null && n > 0);
        const market = marketRatio(listPrice, filled);
        const discMinor = pid ? discountByProduct.get(pid) ?? null : null;
        const discShare =
          discountsReallyAvailable && discMinor != null
            ? discountShareOfListPct(discMinor, p.revenueMinor)
            : null;

        const volumeDown = Boolean(
          cmp && p.salesCount > 0 && p.salesCount < cmp.salesCount,
        );
        const volumeFlatOrUp = !cmp || p.salesCount === 0 || p.salesCount >= cmp.salesCount;
        const volumeGrowing = Boolean(
          cmp && p.salesCount > 0 && p.salesCount > cmp.salesCount,
        );
        const stuck = isDiscountStuck({
          discountSharePct: discShare,
          volumeGrowing,
        });

        const family =
          segKey === 'membership'
            ? classifyMembershipFamily(p.productName)
            : null;

        const hint =
          p.salesCount > 0
            ? buildProductHint({
                segmentKey: segKey,
                productName: p.productName,
                revenueMinor: p.revenueMinor,
                listPriceMinor: listPrice,
                marketRatio: market.ratio,
                marketLabel: market.label,
                volumeDown,
                volumeFlatOrUp,
                discountSharePct: discountsReallyAvailable ? discShare : null,
                inMembershipPromo: inPromo && segKey === 'membership',
                season: inPromo && segKey === 'membership' ? 'promo' : season,
                // Club-level signals once below — not per SKU.
                saleNoInflow: false,
                upsellGap: false,
                discountStuck: stuck,
                baselineLabel,
                ignoredNote: baseline.reasonDropped,
              })
            : null;
        if (hint) hints.push(hint);

        return {
          productExternalId: p.productExternalId,
          productName: p.productName,
          listPriceMinor: listPrice,
          avgActualMinor: avgActual,
          avgToListRatio: avgToListRatio(avgActual, listPrice),
          salesCount: p.salesCount,
          revenueMinor: p.revenueMinor,
          compareRevenueMinor: cmp?.revenueMinor ?? null,
          deltaPct:
            effectiveCmpFrom && cmp && p.salesCount > 0
              ? deltaPct(p.revenueMinor, cmp.revenueMinor)
              : null,
          isCore: p.isCore,
          discountMinor: discountsReallyAvailable ? discMinor : null,
          discountSharePct: discountsReallyAvailable ? discShare : null,
          competitorCells: cells,
          marketMedianMinor: market.medianMinor,
          marketRatio: market.ratio,
          marketLabel: market.label,
          hintAction: hint?.action ?? null,
          hintText: hint?.body ?? null,
          bridge,
          familyKey: family?.key ?? null,
          familyLabel: family?.label ?? null,
        };
      });

      if (segKey === 'membership') {
        productRows.sort(compareMembershipCatalogRows);
      }

      // orphan priced shop SKUs outside top-30
      let orphanPricedCount = 0;
      if (segKey === 'shop') {
        const topIds = new Set(
          productRows
            .map((r) => r.productExternalId?.toLowerCase())
            .filter(Boolean),
        );
        const pricedIds = new Set(
          competitorPrices
            .filter((p) =>
              segCompetitors.some((c) => c.id === p.competitorId),
            )
            .map((p) => p.productExternalId.toLowerCase()),
        );
        for (const id of pricedIds) {
          if (!topIds.has(id)) orphanPricedCount += 1;
        }
      }

      const qtyCur = productRows.reduce((s, r) => s + r.salesCount, 0);
      const qtyCmp = [...cmpAgg.byKey.values()]
        .filter((p) => p.segment === segKey)
        .reduce((s, p) => s + p.salesCount, 0);
      const segBridge =
        effectiveCmpFrom && (qtyCur > 0 || qtyCmp > 0)
          ? priceVolumeMixBridge({
              revenueCur: curSegRev,
              revenueCmp: cmpSegRev,
              avgPriceCur: qtyCur > 0 ? Math.round(curSegRev / qtyCur) : 0,
              avgPriceCmp: qtyCmp > 0 ? Math.round(cmpSegRev / qtyCmp) : 0,
              qtyCur,
              qtyCmp,
            })
          : null;

      let summaryLine = 'цены конкурентов не заполнены';
      if (segCompetitors.some((c) =>
        competitorPrices.some((p) => p.competitorId === c.id && p.priceMinor > 0),
      )) {
        summaryLine =
          segBridge?.summary ??
          (effectiveCmpFrom
            ? `к ${baselineLabel}`
            : 'продажи за период');
      } else if (segBridge) {
        summaryLine = segBridge.summary;
      } else if (curSegRev > 0) {
        summaryLine = 'продажи за период';
      }

      segments.push({
        key: segKey,
        label: SEGMENT_LABELS[segKey],
        revenueMinor: curSegRev,
        sharePct:
          totalRevenue > 0
            ? Math.round((curSegRev / totalRevenue) * 1000) / 10
            : 0,
        compareRevenueMinor: effectiveCmpFrom ? cmpSegRev : null,
        deltaPct: effectiveCmpFrom
          ? deltaPct(curSegRev, cmpSegRev)
          : null,
        bridge: segBridge,
        summaryLine,
        competitors: segCompetitors.map((c) => ({
          id: c.id,
          name: c.name,
          sortOrder: c.sortOrder,
          priceListUrl: c.priceListUrl ?? null,
        })),
        products: productRows,
        orphanPricedCount:
          segKey === 'shop' ? orphanPricedCount : undefined,
        topN: segKey === 'shop' ? SHOP_TOP_N : undefined,
      });
    }

    if (saleNoInflow) {
      const memRev = curAgg.bySegment.membership ?? 0;
      const h = buildProductHint({
        segmentKey: 'membership',
        productName: 'Абонементы',
        revenueMinor: memRev,
        listPriceMinor: null,
        marketRatio: null,
        marketLabel: null,
        volumeDown: false,
        volumeFlatOrUp: true,
        discountSharePct: null,
        inMembershipPromo: false,
        season,
        saleNoInflow: true,
        baselineLabel,
        ignoredNote:
          'Касса сентября ниже августа — так и задумано, карты продали в августе.',
      });
      if (h) hints.push(h);
    }
    if (upsellGap) {
      const memRev = curAgg.bySegment.membership ?? 0;
      const h = buildProductHint({
        segmentKey: 'membership',
        productName: 'Абонементы',
        revenueMinor: memRev,
        listPriceMinor: null,
        marketRatio: null,
        marketLabel: null,
        volumeDown: false,
        volumeFlatOrUp: true,
        discountSharePct: null,
        inMembershipPromo: inPromo,
        season: inPromo ? 'promo' : season,
        upsellGap: true,
        baselineLabel,
      });
      if (h) hints.push(h);
    }
    if (
      discountsReallyAvailable &&
      totalDiscountMinor > 0 &&
      staffRelatedMinor / totalDiscountMinor >= STAFF_DISC_HINT_SHARE
    ) {
      hints.push({
        action: 'review_discounts',
        title: 'Скидки сотрудникам',
        body: `Скидки сотрудникам и родственникам — ${Math.round((staffRelatedMinor / totalDiscountMinor) * 100)}% всех скидок за период.`,
        segmentKey: 'membership',
        productName: 'Скидки',
        weightMinor: staffRelatedMinor,
      });
    }

    const hintCards: PricingHintCard[] = rankHints(hints, 5).map((h) => ({
      action: h.action,
      title: h.title,
      body: h.body,
      ignoredNote: h.ignoredNote,
      segmentKey: h.segmentKey,
      productName: h.productName,
      weightMinor: h.weightMinor,
    }));

    const saleWindowsOut = [
      ...customWindows.map((w) => ({
        id: w.id,
        name: w.name,
        from: isoDate(w.fromDate),
        to: isoDate(w.toDate),
        segmentKey: (w.segmentKey as PricingSegmentKey) || 'membership',
        builtin: false,
      })),
      {
        id: 'builtin-august',
        name: 'Августовская распродажа абонементов',
        from: `${from.slice(0, 4)}-08-01`,
        to: `${from.slice(0, 4)}-08-31`,
        segmentKey: 'membership' as const,
        builtin: true,
      },
    ];

    return {
      from,
      to,
      compareFrom: effectiveCmpFrom,
      compareTo: effectiveCmpTo,
      baselineKind,
      baselineLabel,
      currency,
      dataSince: dataSinceRow ? isoDate(dataSinceRow.occurredAt) : null,
      hasFullYearHistory: hasYoyData,
      mode: {
        mode: inPromo && season === 'august_sale' ? 'august_sale' : season,
        label: modeLabel,
        detail: modeDetail,
      },
      mixedPeriod,
      mixedPeriodNote: mixedPeriod
        ? 'здесь разные режимы, они разделены'
        : null,
      revenueMinor: totalRevenue,
      hints: hintCards,
      segments,
      corporate: {
        revenueMinor: corpoCur.amountMinor,
        sharePct:
          totalRevenue > 0
            ? Math.round((corpoCur.amountMinor / totalRevenue) * 1000) / 10
            : 0,
        compareRevenueMinor: effectiveCmpFrom ? corpoCmp.amountMinor : null,
        deltaPct: effectiveCmpFrom
          ? deltaPct(corpoCur.amountMinor, corpoCmp.amountMinor)
          : null,
        entryCount: corpoCur.count,
        note: 'Оплаты по договорам. Прайса и конкурентов здесь нет.',
      },
      discounts: {
        available: discountsReallyAvailable,
        status: discountCoverage.status,
        message: discountCoverage.message,
        totalDiscountMinor: discountsReallyAvailable
          ? totalDiscountMinor
          : null,
        shareOfRevenuePct: discountsReallyAvailable
          ? discountShareOfListPct(totalDiscountMinor, totalRevenue)
          : null,
        compareTotalDiscountMinor:
          discountsReallyAvailable && effectiveCmpFrom
            ? cmpTotalDiscountMinor
            : null,
        deltaPct:
          discountsReallyAvailable && effectiveCmpFrom
            ? deltaPct(totalDiscountMinor, cmpTotalDiscountMinor)
            : null,
        clientsMinor: discountsReallyAvailable ? clientsMinor : null,
        staffRelatedMinor: discountsReallyAvailable
          ? staffRelatedMinor
          : null,
        byType: [...discountByType.entries()]
          .map(([discountName, discountMinor]) => ({
            discountName,
            discountMinor,
          }))
          .sort((a, b) => b.discountMinor - a.discountMinor)
          .slice(0, 8),
        byStaff: [...discountByStaff.entries()]
          .map(([id, v]) => ({
            employeeExternalId: id === 'unknown' ? null : id,
            employeeName: v.name,
            discountMinor: v.minor,
          }))
          .sort((a, b) => b.discountMinor - a.discountMinor)
          .slice(0, 15),
        syncedAt: discountCoverage.syncedAt,
        missingMonths: discountCoverage.missingMonths,
      },
      saleWindows: saleWindowsOut,
      priceListAsOf: priceLists.asOf,
    };
  }

  private async aggregateProducts(
    clubId: string,
    from: string,
    to: string,
    payrollSegs: Awaited<ReturnType<typeof loadPayrollSegmentSets>>,
  ) {
    const { start, end } = rangeBounds(from, to);
    const rows = await this.prisma.clubRevenueEntry.findMany({
      where: {
        clubId,
        isActive: true,
        OR: [
          { paidAt: { gte: start, lte: end } },
          {
            paidAt: null,
            occurredAt: { gte: start, lte: end },
            operationType: { in: ['payment', 'sale'] },
          },
        ],
        operationType: { in: ['payment', 'sale'] },
      },
      select: {
        amount: true,
        cash: true,
        card: true,
        cashless: true,
        personalAccount: true,
        paidAmount: true,
        saleType: true,
        productName: true,
        productExternalId: true,
        clientExternalId: true,
        documentId: true,
        externalId: true,
      },
    });

    const byKey = new Map<AggKey, ProductAgg>();
    const bySegment = emptySegRevenue();
    const membershipClients = new Set<string>();
    const otherSegClients = new Set<string>();
    const docSeen = new Set<string>();

    for (const r of rows) {
      const cash = Number(r.cash) || 0;
      const card = Number(r.card) || 0;
      const cashless = Number(r.cashless) || 0;
      const pa = Number(r.personalAccount) || 0;
      const split = cash + card + cashless + pa;
      const major =
        split > 0.009
          ? cash + card + cashless + pa
          : Number(r.paidAmount) || Number(r.amount) || 0;
      if (major <= 0) continue;
      const minor = Math.round(major * 100);
      const bucket = classifySaleType(
        r.saleType ?? undefined,
        r.productName,
        payrollSegs,
        r.productExternalId,
      );
      const segment = saleBucketToPricingSegment(bucket);
      if (segment === 'other') continue;

      const pid = (r.productExternalId ?? '').trim().toLowerCase() || null;
      const name = (r.productName ?? 'Без названия').trim();
      const key = aggKey(segment, pid, name);
      let agg = byKey.get(key);
      if (!agg) {
        agg = {
          productExternalId: pid,
          productName: name,
          segment,
          revenueMinor: 0,
          salesCount: 0,
          clientIds: new Set(),
        };
        byKey.set(key, agg);
      }
      agg.revenueMinor += minor;
      const doc =
        (r.documentId ?? r.externalId ?? `${name}:${minor}`).toLowerCase();
      const docKey = `${key}|${doc}`;
      if (!docSeen.has(docKey)) {
        docSeen.add(docKey);
        agg.salesCount += 1;
      }
      if (r.clientExternalId) {
        agg.clientIds.add(r.clientExternalId);
        if (segment === 'membership') {
          membershipClients.add(r.clientExternalId);
        } else {
          otherSegClients.add(r.clientExternalId);
        }
      }
      bySegment[segment] += minor;
    }

    const crossSellClients = new Set<string>();
    for (const id of membershipClients) {
      if (otherSegClients.has(id)) crossSellClients.add(id);
    }

    return { byKey, bySegment, membershipClients, crossSellClients };
  }

  private async corpoSum(clubId: string, from: string, to: string) {
    const { start, end } = rangeBounds(from, to);
    const [sum, count] = await Promise.all([
      this.prisma.clubRevenueManualEntry.aggregate({
        where: {
          clubId,
          kind: 'corpo',
          entryDate: { gte: start, lte: end },
        },
        _sum: { amountMinor: true },
      }),
      this.prisma.clubRevenueManualEntry.count({
        where: {
          clubId,
          kind: 'corpo',
          entryDate: { gte: start, lte: end },
        },
      }),
    ]);
    return { amountMinor: sum._sum.amountMinor ?? 0, count };
  }

  /**
   * September inflow check: visits in period vs May–Jul same year and YoY Sep.
   */
  private async visitCountsForSaleCheck(
    clubId: string,
    from: string,
    to: string,
  ): Promise<{ saleNoInflow: boolean }> {
    const season = dominantSeason(from, to);
    if (season !== 'high_inflow') return { saleNoInflow: false };
    // Only meaningful for September windows
    const month = Number(from.slice(5, 7));
    if (month !== 9) return { saleNoInflow: false };

    const year = Number(from.slice(0, 4));
    const sepFrom = `${year}-09-01`;
    const sepTo = `${year}-09-30`;
    const summerFrom = `${year}-05-01`;
    const summerTo = `${year}-07-31`;
    const prevSepFrom = `${year - 1}-09-01`;
    const prevSepTo = `${year - 1}-09-30`;

    const [sep, summer, prevSep] = await Promise.all([
      this.prisma.clubHallVisit.count({
        where: {
          clubId,
          isActive: true,
          visitDate: { gte: sepFrom, lte: sepTo },
        },
      }),
      this.prisma.clubHallVisit.count({
        where: {
          clubId,
          isActive: true,
          visitDate: { gte: summerFrom, lte: summerTo },
        },
      }),
      this.prisma.clubHallVisit.count({
        where: {
          clubId,
          isActive: true,
          visitDate: { gte: prevSepFrom, lte: prevSepTo },
        },
      }),
    ]);

    const summerMonthly = summer / 3;
    const notAboveSummer = sep <= summerMonthly;
    const notAbovePrev = prevSep === 0 ? notAboveSummer : sep <= prevSep;
    return { saleNoInflow: notAboveSummer && notAbovePrev };
  }

  // ——— CRUD ———

  async listCompetitors(user: JwtPayload, segmentKey: string) {
    const clubId = requireClubId(user);
    this.assertProductSegment(segmentKey);
    return this.prisma.segmentCompetitor.findMany({
      where: { clubId, segmentKey },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { prices: true },
    });
  }

  async addCompetitor(user: JwtPayload, dto: UpsertSegmentCompetitorDto) {
    const clubId = requireClubId(user);
    this.assertProductSegment(dto.segmentKey);
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Укажите название клуба');
    const url = normalizeOptionalUrl(dto.priceListUrl);
    const row = await this.prisma.segmentCompetitor.create({
      data: {
        clubId,
        segmentKey: dto.segmentKey,
        name,
        priceListUrl: url,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    this.invalidateCache(clubId);
    return row;
  }

  async patchCompetitor(
    user: JwtPayload,
    id: string,
    dto: PatchSegmentCompetitorDto,
  ) {
    const clubId = requireClubId(user);
    const row = await this.prisma.segmentCompetitor.findFirst({
      where: { id, clubId },
    });
    if (!row) throw new NotFoundException('Клуб не найден');
    const data: {
      name?: string;
      priceListUrl?: string | null;
      sortOrder?: number;
    } = {};
    if (dto.name != null) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Укажите название клуба');
      data.name = name;
    }
    if (dto.priceListUrl !== undefined) {
      data.priceListUrl = normalizeOptionalUrl(dto.priceListUrl);
    }
    if (dto.sortOrder != null) data.sortOrder = dto.sortOrder;
    const updated = await this.prisma.segmentCompetitor.update({
      where: { id },
      data,
    });
    this.invalidateCache(clubId);
    return updated;
  }

  async deleteCompetitor(user: JwtPayload, id: string) {
    const clubId = requireClubId(user);
    const row = await this.prisma.segmentCompetitor.findFirst({
      where: { id, clubId },
    });
    if (!row) throw new NotFoundException();
    await this.prisma.segmentCompetitor.delete({ where: { id } });
    this.invalidateCache(clubId);
    return { ok: true };
  }

  async upsertCompetitorPrice(
    user: JwtPayload,
    dto: UpsertCompetitorPriceDto,
  ) {
    const clubId = requireClubId(user);
    const comp = await this.prisma.segmentCompetitor.findFirst({
      where: { id: dto.competitorId, clubId },
    });
    if (!comp) throw new NotFoundException('Клуб не найден');
    const productExternalId = dto.productExternalId.trim().toLowerCase();
    if (!productExternalId) {
      throw new BadRequestException('Нужен productExternalId');
    }
    if (!Number.isFinite(dto.priceMinor) || dto.priceMinor < 0) {
      throw new BadRequestException('Некорректная цена');
    }
    const observedAt = dto.observedAt
      ? new Date(`${dto.observedAt}T12:00:00+03:00`)
      : new Date();
    const row = await this.prisma.segmentCompetitorPrice.upsert({
      where: {
        competitorId_productExternalId: {
          competitorId: dto.competitorId,
          productExternalId,
        },
      },
      create: {
        competitorId: dto.competitorId,
        productExternalId,
        priceMinor: Math.round(dto.priceMinor),
        observedAt,
        theirName: dto.theirName ?? null,
        sourceUrl: dto.sourceUrl ?? null,
      },
      update: {
        priceMinor: Math.round(dto.priceMinor),
        observedAt,
        theirName: dto.theirName ?? null,
        sourceUrl: dto.sourceUrl ?? null,
      },
    });
    this.invalidateCache(clubId);
    return row;
  }

  async batchUpsertCompetitorPrices(
    user: JwtPayload,
    dto: BatchUpsertCompetitorPricesDto,
  ) {
    const clubId = requireClubId(user);
    const comp = await this.prisma.segmentCompetitor.findFirst({
      where: { id: dto.competitorId, clubId },
    });
    if (!comp) throw new NotFoundException('Клуб не найден');
    if (!Array.isArray(dto.prices) || dto.prices.length === 0) {
      throw new BadRequestException('Нужен список цен');
    }
    const observedAt = dto.observedAt
      ? new Date(`${dto.observedAt}T12:00:00+03:00`)
      : new Date();
    let saved = 0;
    for (const item of dto.prices) {
      const productExternalId = (item.productExternalId ?? '')
        .trim()
        .toLowerCase();
      if (!productExternalId) continue;
      if (!Number.isFinite(item.priceMinor) || item.priceMinor < 0) {
        throw new BadRequestException(
          `Некорректная цена для ${productExternalId}`,
        );
      }
      await this.prisma.segmentCompetitorPrice.upsert({
        where: {
          competitorId_productExternalId: {
            competitorId: dto.competitorId,
            productExternalId,
          },
        },
        create: {
          competitorId: dto.competitorId,
          productExternalId,
          priceMinor: Math.round(item.priceMinor),
          observedAt,
          theirName: item.theirName ?? null,
          sourceUrl: null,
        },
        update: {
          priceMinor: Math.round(item.priceMinor),
          observedAt,
          theirName: item.theirName ?? null,
        },
      });
      saved += 1;
    }
    this.invalidateCache(clubId);
    return { ok: true, saved };
  }

  async deleteCompetitorPrice(
    user: JwtPayload,
    body: { competitorId: string; productExternalId: string },
  ) {
    const clubId = requireClubId(user);
    const comp = await this.prisma.segmentCompetitor.findFirst({
      where: { id: body.competitorId, clubId },
    });
    if (!comp) throw new NotFoundException('Клуб не найден');
    const productExternalId = body.productExternalId.trim().toLowerCase();
    await this.prisma.segmentCompetitorPrice.deleteMany({
      where: { competitorId: body.competitorId, productExternalId },
    });
    this.invalidateCache(clubId);
    return { ok: true };
  }

  async addSaleWindow(user: JwtPayload, dto: UpsertSaleWindowDto) {
    const clubId = requireClubId(user);
    if (!dto.name.trim() || !dto.from || !dto.to) {
      throw new BadRequestException('Название и даты обязательны');
    }
    assertPeriod(dto.from, dto.to);
    const row = await this.prisma.membershipSaleWindow.create({
      data: {
        clubId,
        name: dto.name.trim(),
        fromDate: new Date(`${dto.from}T12:00:00+03:00`),
        toDate: new Date(`${dto.to}T12:00:00+03:00`),
        segmentKey: dto.segmentKey ?? 'membership',
      },
    });
    this.invalidateCache(clubId);
    return row;
  }

  async deleteSaleWindow(user: JwtPayload, id: string) {
    const clubId = requireClubId(user);
    if (id === 'builtin-august') {
      throw new BadRequestException('Встроенный август нельзя удалить');
    }
    const row = await this.prisma.membershipSaleWindow.findFirst({
      where: { id, clubId },
    });
    if (!row) throw new NotFoundException();
    await this.prisma.membershipSaleWindow.delete({ where: { id } });
    this.invalidateCache(clubId);
    return { ok: true };
  }

  /**
   * Manual refresh: force re-fetch all months covering [from, to].
   */
  async refreshDiscounts(
    user: JwtPayload,
    params: { from: string; to: string },
  ) {
    const clubId = requireClubId(user);
    assertPeriod(params.from, params.to);
    const months = monthsInRange(params.from, params.to);
    const coverage = await this.ensureDiscountMonths(clubId, months, {
      force: true,
      budgetMs: 60_000,
    });
    const imported = await this.prisma.providedDiscountRow.count({
      where: {
        clubId,
        occurredAt: {
          gte: rangeBounds(params.from, params.to).start,
          lte: rangeBounds(params.from, params.to).end,
        },
      },
    });
    return {
      status: coverage.status,
      imported,
      message: coverage.message ?? `Загружено ${imported} строк скидок`,
      missingMonths: coverage.missingMonths,
      syncedAt: coverage.syncedAt,
    };
  }

  /**
   * Nightly / orchestrator entry: sync given months (force).
   */
  async syncDiscountMonthsForClub(
    clubId: string,
    months: string[],
  ): Promise<{ rows: number; months: string[]; error?: string }> {
    const coverage = await this.ensureDiscountMonths(clubId, months, {
      force: true,
      budgetMs: 90_000,
    });
    let rows = 0;
    for (const m of months) {
      const { from, to } = monthBounds(m);
      rows += await this.prisma.providedDiscountRow.count({
        where: {
          clubId,
          occurredAt: {
            gte: rangeBounds(from, to).start,
            lte: rangeBounds(from, to).end,
          },
        },
      });
    }
    return {
      rows,
      months,
      error:
        coverage.status === 'ok' || coverage.status === 'partial'
          ? undefined
          : coverage.message ?? coverage.status,
    };
  }

  private async ensureDiscountMonths(
    clubId: string,
    months: string[],
    opts: { force: boolean; budgetMs: number },
  ): Promise<{
    status: PricingDiscountsStatus;
    message: string | null;
    syncedAt: string | null;
    missingMonths: string[];
  }> {
    const unique = [...new Set(months.filter((m) => /^\d{4}-\d{2}$/.test(m)))];
    if (!unique.length) {
      return {
        status: 'ok',
        message: null,
        syncedAt: null,
        missingMonths: [],
      };
    }

    const base = this.config.get<string>('FORMA_ANALYTICS_URL')?.trim();
    const apiKey = this.config.get<string>('FORMA_API_KEY')?.trim();
    const basicAuth = this.config.get<string>('FORMA_BASIC_AUTH')?.trim();
    if (!base || !apiKey || !basicAuth) {
      await this.writeDiscountSyncState(clubId, unique, {
        status: 'error',
        error: 'FORMA_ANALYTICS_URL not configured',
      });
      return {
        status: 'not_configured',
        message: 'Analytics URL не настроен (FORMA_ANALYTICS_URL)',
        syncedAt: null,
        missingMonths: unique,
      };
    }

    const existing = await this.prisma.providedDiscountMonth.findMany({
      where: { clubId, month: { in: unique } },
    });
    const byMonth = new Map(existing.map((r) => [r.month, r]));
    const now = Date.now();
    const mk = minskParts();
    const currentMonth = `${mk.year}-${String(mk.month).padStart(2, '0')}`;

    const toFetch = unique.filter((m) => {
      if (opts.force) return true;
      const row = byMonth.get(m);
      if (!row || row.lastError) return true;
      if (
        m === currentMonth &&
        now - row.syncedAt.getTime() > CURRENT_MONTH_STALE_MS
      ) {
        return true;
      }
      return false;
    });

    if (!toFetch.length) {
      const latest = existing
        .map((r) => r.syncedAt.getTime())
        .reduce((a, b) => Math.max(a, b), 0);
      return {
        status: 'ok',
        message: null,
        syncedAt: latest ? new Date(latest).toISOString() : null,
        missingMonths: [],
      };
    }

    const deadline = Date.now() + opts.budgetMs;
    let imported = 0;
    let lastError: string | null = null;
    let endpointMissing = false;
    const syncedOk: string[] = [];
    const failed: string[] = [];

    for (const month of toFetch) {
      if (Date.now() >= deadline) {
        failed.push(...toFetch.filter((m) => !syncedOk.includes(m) && !failed.includes(m)));
        break;
      }
      try {
        const result = await this.fetchAndStoreDiscountMonth(
          clubId,
          month,
          base,
          apiKey,
          basicAuth,
        );
        if (result.endpointMissing) {
          endpointMissing = true;
          lastError = 'endpoint_missing';
          failed.push(month);
          break;
        }
        imported += result.rowCount;
        syncedOk.push(month);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastError = msg.slice(0, 500);
        this.logger.warn(`discount month ${month}: ${msg}`);
        failed.push(month);
        await this.prisma.providedDiscountMonth.upsert({
          where: { clubId_month: { clubId, month } },
          create: {
            clubId,
            month,
            syncedAt: new Date(),
            rowCount: 0,
            lastError: lastError,
          },
          update: {
            syncedAt: new Date(),
            lastError: lastError,
          },
        });
      }
    }

    const allCovered = unique.every((m) => {
      if (syncedOk.includes(m)) return true;
      const row = byMonth.get(m);
      return Boolean(row && !row.lastError && !failed.includes(m));
    });
    const anyCovered =
      syncedOk.length > 0 ||
      unique.some((m) => {
        const row = byMonth.get(m);
        return Boolean(row && !row.lastError);
      });

    let status: PricingDiscountsStatus;
    let message: string | null = null;
    if (endpointMissing) {
      status = 'unavailable';
      message =
        'Метод /discounts ещё не опубликован в FitGOAnalytics.';
    } else if (allCovered && !failed.length) {
      status = 'ok';
      message = null;
    } else if (anyCovered && (failed.length || !allCovered)) {
      status = Date.now() >= deadline && failed.length ? 'loading' : 'partial';
      message =
        status === 'loading'
          ? 'Скидки ещё подтягиваются из 1С — обновите через минуту.'
          : lastError
            ? `Часть месяцев не загрузилась: ${lastError}`
            : 'Часть месяцев скидок ещё не в кэше.';
    } else if (lastError) {
      status = 'error';
      message = lastError;
    } else {
      status = 'loading';
      message = 'Скидки ещё подтягиваются из 1С — обновите через минуту.';
    }

    await this.writeDiscountSyncState(clubId, unique, {
      status:
        status === 'ok' || status === 'partial'
          ? 'ok'
          : status === 'unavailable'
            ? 'unavailable'
            : 'error',
      error: lastError,
    });

    if (syncedOk.length) this.invalidateCache(clubId);

    const after = await this.prisma.providedDiscountMonth.findMany({
      where: { clubId, month: { in: unique } },
    });
    const missingMonths = unique.filter((m) => {
      const row = after.find((r) => r.month === m);
      return !row || Boolean(row.lastError);
    });
    const latest = after
      .filter((r) => !r.lastError)
      .map((r) => r.syncedAt.getTime())
      .reduce((a, b) => Math.max(a, b), 0);

    if (status === 'ok' && imported > 0) {
      message = null;
    }

    return {
      status,
      message,
      syncedAt: latest ? new Date(latest).toISOString() : null,
      missingMonths,
    };
  }

  private async fetchAndStoreDiscountMonth(
    clubId: string,
    month: string,
    base: string,
    apiKey: string,
    basicAuth: string,
  ): Promise<{ rowCount: number; endpointMissing: boolean }> {
    const { from, to } = monthBounds(month);
    const url = `${base.replace(/\/$/, '')}/discounts?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await fetch(url, {
      headers: {
        apikey: apiKey,
        'X-Api-Key': apiKey,
        Authorization: `Basic ${basicAuth}`,
      },
    });
    const text = await res.text();
    if (res.status === 404) {
      return { rowCount: 0, endpointMissing: true };
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    let body: {
      data?: {
        items?: Array<{
          occurredAt?: string;
          productExternalId?: string;
          productName?: string;
          clientExternalId?: string;
          clientName?: string;
          employeeExternalId?: string;
          employeeName?: string;
          discountName?: string;
          discountAmount?: number;
          discountPercent?: number;
          saleDocumentId?: string;
        }>;
      };
    };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new Error(`Invalid JSON: ${text.slice(0, 200)}`);
    }
    const items = body.data?.items ?? [];
    const { start, end } = rangeBounds(from, to);
    await this.prisma.$transaction(async (tx) => {
      await tx.providedDiscountRow.deleteMany({
        where: {
          clubId,
          occurredAt: { gte: start, lte: end },
        },
      });
      if (items.length) {
        await tx.providedDiscountRow.createMany({
          data: items.map((i) => ({
            clubId,
            occurredAt: parseDiscountOccurredAt(i.occurredAt, start),
            productExternalId: i.productExternalId ?? null,
            productName: i.productName ?? null,
            clientExternalId: i.clientExternalId ?? null,
            clientName: i.clientName ?? null,
            employeeExternalId: i.employeeExternalId ?? null,
            employeeName: i.employeeName ?? null,
            discountName: normalizeDiscountName(i.discountName),
            discountAmount: Number(i.discountAmount) || 0,
            discountPercent:
              i.discountPercent != null ? Number(i.discountPercent) : null,
            saleDocumentId: i.saleDocumentId ?? null,
          })),
        });
      }
      await tx.providedDiscountMonth.upsert({
        where: { clubId_month: { clubId, month } },
        create: {
          clubId,
          month,
          syncedAt: new Date(),
          rowCount: items.length,
          lastError: null,
        },
        update: {
          syncedAt: new Date(),
          rowCount: items.length,
          lastError: null,
        },
      });
    });
    return { rowCount: items.length, endpointMissing: false };
  }

  private async writeDiscountSyncState(
    clubId: string,
    months: string[],
    opts: { status: string; error: string | null },
  ) {
    const sorted = [...months].sort();
    await this.prisma.providedDiscountSyncState.upsert({
      where: { clubId },
      create: {
        clubId,
        lastFrom: sorted[0] ? `${sorted[0]}-01` : null,
        lastTo: sorted[sorted.length - 1]
          ? monthBounds(sorted[sorted.length - 1]).to
          : null,
        lastStatus: opts.status,
        lastError: opts.error,
        lastSyncedAt: new Date(),
      },
      update: {
        lastFrom: sorted[0] ? `${sorted[0]}-01` : null,
        lastTo: sorted[sorted.length - 1]
          ? monthBounds(sorted[sorted.length - 1]).to
          : null,
        lastStatus: opts.status,
        lastError: opts.error,
        lastSyncedAt: new Date(),
      },
    });
  }

  private assertProductSegment(segmentKey: string) {
    if (
      !PRODUCT_SEGMENTS.includes(
        segmentKey as Exclude<PricingSegmentKey, 'corporate'>,
      )
    ) {
      throw new BadRequestException(
        'Сегмент должен быть membership|training|shop|spa|solarium',
      );
    }
  }
}

function emptySegRevenue(): Record<
  Exclude<PricingSegmentKey, 'corporate'>,
  number
> {
  return {
    membership: 0,
    training: 0,
    shop: 0,
    spa: 0,
    solarium: 0,
  };
}

function aggKey(
  segment: string,
  productExternalId: string | null,
  productName: string,
): AggKey {
  return `${segment}|${productExternalId ?? ''}|${productName.toLowerCase()}`;
}

function normalizeOptionalUrl(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim();
  return t || null;
}

function normPriceName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/групповоое/g, 'групповое')
    .replace(/\s+/g, ' ')
    .trim();
}

function collectMembershipCatalogIds(
  bySegment: Record<string, PricingPriceMap | undefined>,
): Set<string> {
  const ids = new Set<string>();
  const membership = bySegment.membership;
  if (membership) {
    for (const id of membership.keys()) ids.add(id);
  }
  for (const map of Object.values(bySegment)) {
    if (!map) continue;
    for (const [id, info] of map) {
      if (isMembershipMarketExtraTitle(info.name)) ids.add(id);
    }
  }
  return ids;
}

function indexPricesByName(
  bySegment: Record<string, PricingPriceMap | undefined>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const map of Object.values(bySegment)) {
    if (!map) continue;
    for (const info of map.values()) {
      if (info.priceMinor <= 0) continue;
      const key = normPriceName(info.name);
      if (!key) continue;
      if (!out.has(key)) out.set(key, info.priceMinor);
    }
  }
  return out;
}

function resolveListPrice(
  pid: string,
  productName: string,
  pricesByProduct: Map<string, number>,
  segmentMap: PricingPriceMap | undefined,
  priceByName: Map<string, number>,
): number | null {
  if (pid) {
    const byId =
      pricesByProduct.get(pid) ||
      segmentMap?.get(pid)?.priceMinor ||
      null;
    if (byId && byId > 0) return byId;
  }
  const byName = priceByName.get(normPriceName(productName));
  return byName && byName > 0 ? byName : null;
}

function findAggForProduct(
  byKey: Map<AggKey, ProductAgg>,
  pid: string,
  productName: string,
): ProductAgg | undefined {
  let best: ProductAgg | undefined;
  const nameKey = productName.toLowerCase();
  for (const p of byKey.values()) {
    const matchId = Boolean(pid && p.productExternalId === pid);
    const matchName =
      !pid && p.productName.toLowerCase() === nameKey;
    if (!matchId && !matchName) continue;
    if (p.segment === 'membership') return p;
    if (!best) best = p;
  }
  return best;
}

function buildMembershipCatalogProducts(opts: {
  priceLists: Record<string, PricingPriceMap | undefined>;
  curAgg: Map<AggKey, ProductAgg>;
  catalogIds: Set<string>;
}): ProductAgg[] {
  const byId = new Map<
    string,
    { productExternalId: string; productName: string; listHint: number }
  >();

  const membership = opts.priceLists.membership;
  if (membership) {
    for (const [id, info] of membership) {
      byId.set(id, {
        productExternalId: id,
        productName: info.name,
        listHint: info.priceMinor,
      });
    }
  }
  for (const map of Object.values(opts.priceLists)) {
    if (!map) continue;
    for (const [id, info] of map) {
      if (byId.has(id)) continue;
      if (!isMembershipMarketExtraTitle(info.name)) continue;
      byId.set(id, {
        productExternalId: id,
        productName: info.name,
        listHint: info.priceMinor,
      });
    }
  }

  const usedSales = new Set<AggKey>();
  const rows: ProductAgg[] = [];

  for (const item of byId.values()) {
    const sales = findAggForProduct(
      opts.curAgg,
      item.productExternalId,
      item.productName,
    );
    if (sales) {
      for (const [k, v] of opts.curAgg) {
        if (v === sales) usedSales.add(k);
      }
    }
    rows.push({
      productExternalId: item.productExternalId,
      productName: item.productName,
      segment: 'membership',
      revenueMinor: sales?.revenueMinor ?? 0,
      salesCount: sales?.salesCount ?? 0,
      clientIds: sales?.clientIds ?? new Set(),
    });
  }

  // Period sales not in 1C catalog — keep so revenue does not vanish.
  for (const [key, p] of opts.curAgg) {
    if (usedSales.has(key)) continue;
    if (p.segment === 'membership') {
      rows.push({ ...p, clientIds: new Set(p.clientIds) });
      continue;
    }
    if (
      isMembershipMarketExtraTitle(p.productName) &&
      !(p.productExternalId && opts.catalogIds.has(p.productExternalId))
    ) {
      rows.push({
        ...p,
        segment: 'membership',
        clientIds: new Set(p.clientIds),
      });
    }
  }

  return rows;
}
