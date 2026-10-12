import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DISCREPANCY_CHEQUE_MATCH_ENABLED,
  DISCREPANCY_SEGMENT_TITLES,
  DISCREPANCY_SALES_MATCH_WINDOW_MIN,
  type DiscrepancyGroupResponse,
  type DiscrepancySalesResponse,
  type DiscrepancySegmentsResponse,
  type DiscrepancySegmentKey,
  type DiscrepancySegmentProduct,
  type DiscrepancySpaPtResponse,
  type DiscrepancySpaPtSessionRow,
  type DiscrepancySummary,
  type DiscrepancyTab,
  type DiscrepancyProductStatus,
  type DiscrepancySaleLine,
} from '@fitgo/shared-types';
import {
  OnexClassKind,
  OnexClassMemberAttendance,
  Role,
} from '@prisma/client';
import {
  classifySaleType,
  clearPayrollSegmentCache,
  isLikelyTrainingProductName,
  loadPayrollSegmentSets,
  matchPayrollSegments,
  type PayrollSegmentSets,
} from '../admin-sales/admin-sales-segments';
import { normalizeSaleType } from '../admin-sales/admin-sales.util';
import {
  enrichGenericPaymentProducts,
  isGenericPaymentProduct,
  loadBasisProductsBySaleDoc,
  pickBasisLinesForRevenueRow,
  saleDocIdsForRevenueRow,
  type BasisProductLine,
} from '../admin-sales/payment-basis-products';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { GroupSessionService } from '../group-session/group-session.service';
import { PrismaService } from '../prisma/prisma.service';
import { SegmentsService } from '../segments/segments.service';
import {
  fingerprint,
  minskDay,
  parsePeriod,
  retentionDays,
} from './discrepancies-period';
import {
  isExpiringPackageWriteOff,
  isLateAddAfterEnd,
  type MembershipSnapLike,
  type SessionLike,
} from './discrepancies-predicates';

type QueryOpts = {
  from?: string;
  to?: string;
  employee?: string;
  showAcked?: boolean;
};

const summaryCache = new Map<string, { at: number; value: DiscrepancySummary }>();
const SUMMARY_CACHE_MS = 5 * 60 * 1000;

/** Per-tab payload cache + in-flight dedupe (summary ∥ tab share one compute). */
const tabResultCache = new Map<string, { at: number; value: unknown }>();
const tabInflight = new Map<string, Promise<unknown>>();

function discrepancyTabCacheKey(
  clubId: string,
  tab: string,
  opts: QueryOpts,
  period: { from: string; to: string },
) {
  return `${clubId}|${tab}|${period.from}|${period.to}|${opts.employee ?? ''}|${opts.showAcked ? 1 : 0}`;
}

async function withDiscrepancyTabCache<T>(
  key: string,
  compute: () => Promise<T>,
): Promise<T> {
  const hit = tabResultCache.get(key);
  if (hit && Date.now() - hit.at < SUMMARY_CACHE_MS) return hit.value as T;
  const pending = tabInflight.get(key);
  if (pending) return pending as Promise<T>;
  const p = compute()
    .then((value) => {
      tabResultCache.set(key, { at: Date.now(), value });
      tabInflight.delete(key);
      return value;
    })
    .catch((err) => {
      tabInflight.delete(key);
      throw err;
    });
  tabInflight.set(key, p);
  return p;
}

@Injectable()
export class DiscrepanciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly segments: SegmentsService,
    private readonly groupSessions: GroupSessionService,
  ) {}

  async summary(user: JwtPayload, opts: QueryOpts): Promise<DiscrepancySummary> {
    const clubId = requireClubId(user);
    const period = parsePeriod(opts.from, opts.to);
    const cacheKey = `${clubId}|${period.from}|${period.to}|${opts.employee ?? ''}`;
    const hit = summaryCache.get(cacheKey);
    if (hit && Date.now() - hit.at < SUMMARY_CACHE_MS) return hit.value;

    const [segments, sales, spa, gp, pt] = await Promise.all([
      this.segmentsTab(user, opts),
      this.salesTab(user, opts),
      this.spaPtTab(user, 'SPA', opts),
      this.groupTab(user, opts),
      this.spaPtTab(user, 'PT', opts),
    ]);

    const value: DiscrepancySummary = {
      from: period.from,
      to: period.to,
      segments:
        segments.problems.unassigned +
        segments.problems.guessed +
        segments.problems.conflict +
        segments.missingEmployees.length,
      sales: DISCREPANCY_CHEQUE_MATCH_ENABLED
        ? sales.problemDays +
          sales.unmatchedKassa.length +
          sales.unmatchedOneC.length
        : sales.problemDays,
      spa: spa.total,
      gp: gp.lateAddTotal + gp.trustExceptions.length,
      pt: pt.total,
    };
    summaryCache.set(cacheKey, { at: Date.now(), value });
    return value;
  }

  async ack(
    user: JwtPayload,
    body: { tab?: string; itemKey?: string; fingerprint?: string; note?: string },
  ) {
    const clubId = requireClubId(user);
    const tab = (body.tab ?? '').trim() as DiscrepancyTab;
    const itemKey = (body.itemKey ?? '').trim();
    const fp = (body.fingerprint ?? '').trim();
    if (!tab || !itemKey || !fp) {
      throw new BadRequestException('tab, itemKey, fingerprint обязательны');
    }
    const expiresAt = new Date();
    expiresAt.setUTCDate(expiresAt.getUTCDate() + retentionDays());
    await this.prisma.discrepancyAck.upsert({
      where: { clubId_tab_itemKey: { clubId, tab, itemKey } },
      create: {
        clubId,
        tab,
        itemKey,
        fingerprint: fp,
        note: body.note?.trim() || null,
        userId: user.sub,
        expiresAt,
      },
      update: {
        fingerprint: fp,
        note: body.note?.trim() || null,
        userId: user.sub,
        expiresAt,
        createdAt: new Date(),
      },
    });
    this.invalidateSummary(clubId);
    return { ok: true };
  }

  async unack(user: JwtPayload, id: string) {
    const clubId = requireClubId(user);
    const row = await this.prisma.discrepancyAck.findFirst({
      where: { id, clubId },
    });
    if (!row) throw new NotFoundException('Не найдено');
    await this.prisma.discrepancyAck.delete({ where: { id } });
    this.invalidateSummary(clubId);
    return { ok: true };
  }

  async recheckSegments(user: JwtPayload) {
    requireClubId(user);
    try {
      await this.segments.syncStaffFrom1C(user);
    } catch {
      // Staff sync may fail if 1C unreachable — still try nomenclature + clear cache
    }
    try {
      await this.segments.syncNomenclature(user, 'all');
    } catch {
      // same
    }
    clearPayrollSegmentCache();
    this.invalidateSummary(requireClubId(user));
    return { ok: true };
  }

  async segmentsTab(
    user: JwtPayload,
    opts: QueryOpts,
  ): Promise<DiscrepancySegmentsResponse> {
    const clubId = requireClubId(user);
    const period = parsePeriod(opts.from, opts.to);
    return withDiscrepancyTabCache(
      discrepancyTabCacheKey(clubId, 'segments', opts, period),
      () => this.computeSegmentsTab(clubId, period, opts),
    );
  }

  private async computeSegmentsTab(
    clubId: string,
    period: ReturnType<typeof parsePeriod>,
    opts: QueryOpts,
  ): Promise<DiscrepancySegmentsResponse> {
    const segments = await loadPayrollSegmentSets(this.config);
    const acks = await this.loadAcks(clubId, 'segments', opts.showAcked);

    const sales = await this.prisma.clubRevenueEntry.findMany({
      where: {
        clubId,
        isActive: true,
        occurredAt: { gte: period.fromD, lte: period.toD },
        operationType: { in: ['payment', 'sale', 'refund'] },
      },
      select: {
        id: true,
        externalId: true,
        documentId: true,
        operationType: true,
        productName: true,
        productExternalId: true,
        productCode: true,
        productGroupName: true,
        saleType: true,
        amount: true,
        saleAmount: true,
        paidAmount: true,
        refundAmount: true,
        employeeExternalId: true,
        employeeName: true,
        occurredAt: true,
      },
    });

    const saleDocIds = sales.flatMap((r) =>
      saleDocIdsForRevenueRow({
        externalId: r.externalId,
        documentId: r.documentId,
      }),
    );
    const basisByDoc = await loadBasisProductsBySaleDoc(
      this.prisma,
      clubId,
      saleDocIds,
    );

    // Cash placeholders / wrong labels → real nomenclature (reuse basis map).
    const payRows = sales.filter(
      (r) => r.operationType === 'payment' || r.operationType === 'refund',
    );
    if (payRows.length) {
      await enrichGenericPaymentProducts(
        this.prisma,
        clubId,
        payRows,
        basisByDoc,
      );
    }

    type Agg = {
      name: string;
      uuid: string | null;
      code: string | null;
      groupName: string | null;
      oneCSaleType: string | null;
      /** Distinct sale documents — one mixed sale counts once per product. */
      docs: Set<string>;
      amount: number;
      sellers: Map<string, { id: string; name: string; docs: Set<string> }>;
      lastSoldAt: Date | null;
    };
    const byProduct = new Map<string, Agg>();

    const rowMoney = (row: (typeof sales)[0], isRefund: boolean) => {
      if (isRefund) {
        return Math.abs(
          Number(row.refundAmount || 0) || Number(row.amount || 0),
        );
      }
      return row.operationType === 'sale'
        ? Number(row.saleAmount || row.amount || 0)
        : Number(row.paidAmount || row.amount || 0);
    };

    const expandProducts = (
      row: (typeof sales)[0],
    ): Array<{
      name: string;
      uuid: string | null;
      code: string | null;
      groupName: string | null;
      saleType: string | null;
      amount: number;
    }> => {
      const isRefund = row.operationType === 'refund';
      const payAmt = rowMoney(row, isRefund);
      const basis: BasisProductLine[] = pickBasisLinesForRevenueRow(
        { externalId: row.externalId, documentId: row.documentId },
        basisByDoc,
      );
      // Payments/refunds: always classify by sale nomenclature (installments,
      // «Оплата от клиента», document titles, ЛС shop charges mislabeled as VIP).
      const shouldExpand =
        (row.operationType === 'payment' || row.operationType === 'refund') &&
        basis.length > 0;
      if (shouldExpand) {
        const total =
          basis.reduce((s, l) => s + Math.abs(l.amount), 0) || basis.length;
        return basis.map((l) => ({
          name: l.productName,
          uuid: l.productExternalId,
          code: l.productCode,
          groupName: l.productGroupName,
          saleType: l.saleType ?? row.saleType,
          amount: isRefund
            ? -(payAmt * (Math.abs(l.amount) / total))
            : payAmt * (Math.abs(l.amount) / total),
        }));
      }
      // After enrich, productName is real — use it; still prefer single basis line uuid.
      if (
        !isGenericPaymentProduct(row.productName) &&
        basis.length === 1 &&
        !row.productExternalId
      ) {
        const L = basis[0]!;
        return [
          {
            name: (row.productName ?? '').trim() || L.productName,
            uuid: L.productExternalId,
            code: L.productCode ?? row.productCode,
            groupName: L.productGroupName ?? row.productGroupName,
            saleType: L.saleType ?? row.saleType,
            amount: isRefund ? -payAmt : payAmt,
          },
        ];
      }
      return [
        {
          name: (row.productName ?? '').trim() || '—',
          uuid: row.productExternalId?.trim() || null,
          code: row.productCode ?? null,
          groupName: row.productGroupName ?? null,
          saleType: row.saleType,
          amount: isRefund ? -payAmt : payAmt,
        },
      ];
    };

    for (const row of sales) {
      if (opts.employee?.trim()) {
        const emp = opts.employee.trim();
        if (
          row.employeeExternalId !== emp &&
          !(row.employeeName ?? '').includes(emp)
        ) {
          continue;
        }
      }
      const isRefund = row.operationType === 'refund';
      const docKey = row.documentId?.trim() || row.externalId;
      for (const part of expandProducts(row)) {
        const name = part.name;
        const uuid = part.uuid;
        const key = (uuid || name).toLowerCase();
        let agg = byProduct.get(key);
        if (!agg) {
          agg = {
            name,
            uuid,
            code: part.code,
            groupName: part.groupName,
            oneCSaleType: part.saleType,
            docs: new Set(),
            amount: 0,
            sellers: new Map(),
            lastSoldAt: null,
          };
          byProduct.set(key, agg);
        }
        if (isRefund) {
          agg.amount += part.amount; // already signed negative
        } else {
          agg.docs.add(docKey);
          agg.amount += part.amount;
        }
        if (part.code && !agg.code) agg.code = part.code;
        if (part.groupName && !agg.groupName) agg.groupName = part.groupName;
        if (part.uuid && !agg.uuid) agg.uuid = part.uuid;
        if (part.saleType && !agg.oneCSaleType) agg.oneCSaleType = part.saleType;
        const sid =
          row.employeeExternalId?.trim() || row.employeeName?.trim() || '';
        if (sid && !isRefund) {
          const prev = agg.sellers.get(sid);
          if (prev) prev.docs.add(docKey);
          else {
            agg.sellers.set(sid, {
              id: sid,
              name: row.employeeName?.trim() || sid,
              docs: new Set([docKey]),
            });
          }
        }
        if (!agg.lastSoldAt || row.occurredAt > agg.lastSoldAt) {
          agg.lastSoldAt = row.occurredAt;
        }
      }
    }

    // Enrich UUID from catalog when Analytics has not published it yet
    const catalog = await this.prisma.catalogProduct.findMany({
      where: { clubId, active: true },
      select: { name: true, externalId: true, code: true },
    });
    const spaServices = await this.prisma.spaService.findMany({
      where: { clubId },
      select: { name: true, externalId: true },
    });
    const nameToUuid = new Map<string, { uuid: string; code?: string | null }>();
    for (const c of catalog) {
      nameToUuid.set(c.name.trim().toLowerCase(), {
        uuid: c.externalId,
        code: c.code,
      });
    }
    for (const s of spaServices) {
      if (s.externalId) {
        nameToUuid.set(s.name.trim().toLowerCase(), { uuid: s.externalId });
      }
    }

    const products: DiscrepancySegmentProduct[] = [];
    const bucketStats = new Map<
      DiscrepancySegmentKey,
      { items: Set<string>; salesCount: number; amount: number }
    >();
    for (const k of Object.keys(DISCREPANCY_SEGMENT_TITLES) as DiscrepancySegmentKey[]) {
      bucketStats.set(k, { items: new Set(), salesCount: 0, amount: 0 });
    }

    let unassigned = 0;
    let guessed = 0;
    let conflict = 0;

    for (const [key, agg] of byProduct) {
      if (!agg.uuid) {
        const hit = nameToUuid.get(agg.name.toLowerCase());
        if (hit) {
          agg.uuid = hit.uuid;
          if (!agg.code && hit.code) agg.code = hit.code;
        }
      }

      const matched = matchPayrollSegments(
        agg.name,
        segments,
        agg.uuid,
      ) as DiscrepancySegmentKey[];
      const classified = classifySaleType(
        agg.oneCSaleType ?? undefined,
        agg.name,
        segments,
        agg.uuid,
      );
      const status = this.productStatus(
        matched,
        agg.oneCSaleType,
        agg.name,
        segments,
      );
      const suggested =
        status === 'UNASSIGNED'
          ? null
          : this.suggestSegment(matched, classified, agg.oneCSaleType, agg.name);
      const salesCount = agg.docs.size;

      const itemKey = `product:${key}`;
      const fp = fingerprint(
        itemKey,
        salesCount,
        Math.round(agg.amount * 100),
        status,
        matched.join(','),
      );
      const ack = acks.get(itemKey);
      const acked = Boolean(ack && ack.fingerprint === fp);
      if (acked && !opts.showAcked) {
        // still count toward segment buckets
      } else if (!acked || opts.showAcked) {
        if (status === 'UNASSIGNED') unassigned += 1;
        else if (status === 'GUESSED') guessed += 1;
        else if (status === 'CONFLICT') conflict += 1;
      }

      const primarySeg =
        matched[0] ??
        (classified === 'massage'
          ? 'spa'
          : (classified as DiscrepancySegmentKey));
      if (primarySeg && bucketStats.has(primarySeg as DiscrepancySegmentKey)) {
        const st = bucketStats.get(primarySeg as DiscrepancySegmentKey)!;
        st.items.add(key);
        st.salesCount += salesCount;
        st.amount += agg.amount;
      }

      if (status === 'OK' && !opts.showAcked) continue;
      if (acked && !opts.showAcked) continue;

      products.push({
        itemKey,
        fingerprint: fp,
        name: agg.name,
        uuid: agg.uuid,
        code: agg.code,
        groupName: agg.groupName,
        oneCSaleType: agg.oneCSaleType,
        status,
        currentBucket: classified,
        matchedSegments: matched,
        suggestedSegment: suggested,
        salesCount,
        amount: Math.round(agg.amount * 100) / 100,
        sellers: [...agg.sellers.values()]
          .map((s) => ({ id: s.id, name: s.name, count: s.docs.size }))
          .sort((a, b) => b.count - a.count),
        lastSoldAt: agg.lastSoldAt?.toISOString() ?? null,
        acked,
        ackNote: ack?.note ?? null,
      });
    }

    products.sort((a, b) => {
      const rank = (s: DiscrepancyProductStatus) =>
        s === 'CONFLICT' ? 0 : s === 'UNASSIGNED' ? 1 : s === 'GUESSED' ? 2 : 3;
      return rank(a.status) - rank(b.status) || b.amount - a.amount;
    });

    const missingEmployees = await this.missingStaff(clubId, period.fromD, period.toD);

    const employeesMap = new Map<string, { id: string; name: string; count: number }>();
    for (const p of products) {
      for (const s of p.sellers) {
        const prev = employeesMap.get(s.id);
        if (prev) prev.count += s.count;
        else employeesMap.set(s.id, { ...s });
      }
    }

    return {
      from: period.from,
      to: period.to,
      segments: (
        Object.keys(DISCREPANCY_SEGMENT_TITLES) as DiscrepancySegmentKey[]
      ).map((key) => {
        const st = bucketStats.get(key)!;
        return {
          key,
          title: DISCREPANCY_SEGMENT_TITLES[key],
          items: st.items.size,
          salesCount: st.salesCount,
          amount: Math.round(st.amount * 100) / 100,
        };
      }),
      problems: { unassigned, guessed, conflict },
      products,
      missingEmployees,
      employees: [...employeesMap.values()].sort((a, b) => b.count - a.count),
    };
  }

  async salesTab(
    user: JwtPayload,
    opts: QueryOpts,
  ): Promise<DiscrepancySalesResponse> {
    const clubId = requireClubId(user);
    const period = parsePeriod(opts.from, opts.to);
    return withDiscrepancyTabCache(
      discrepancyTabCacheKey(clubId, 'sales', opts, period),
      () => this.computeSalesTab(clubId, period, opts),
    );
  }

  private async computeSalesTab(
    clubId: string,
    period: ReturnType<typeof parsePeriod>,
    opts: QueryOpts,
  ): Promise<DiscrepancySalesResponse> {
    const acks = await this.loadAcks(clubId, 'sales', opts.showAcked);
    const empFilter = opts.employee?.trim() || '';
    const empLower = empFilter.toLowerCase();
    const range = { gte: period.fromD, lte: period.toD };

    // Matching always runs on the full day: a mixed sale may have lines from
    // different employees, and the cashier is not the seller. The employee
    // filter only narrows what is shown.
    const [allReceipts, revenue, syncState, segments] = await Promise.all([
      this.prisma.webkassaReceipt.findMany({
        where: { clubId, occurredAt: range },
      }),
      this.prisma.clubRevenueEntry.findMany({
        where: {
          clubId,
          isActive: true,
          operationType: { in: ['payment', 'refund', 'personal_deposit'] },
          OR: [{ paidAt: range }, { paidAt: null, occurredAt: range }],
        },
      }),
      this.prisma.webkassaSyncState.findUnique({ where: { clubId } }),
      DISCREPANCY_CHEQUE_MATCH_ENABLED
        ? loadPayrollSegmentSets(this.config)
        : Promise.resolve(null),
    ]);
    // Only cheques accepted by the operator (Статус КЭД = OK) are real money.
    const receipts = allReceipts.filter(
      (r) => !r.status?.trim() || r.status.trim().toUpperCase() === 'OK',
    );

    const receiptMatchesEmp = (r: { cashier: string | null }) =>
      !empFilter || (r.cashier ?? '').toLowerCase().includes(empLower);
    const employeeMatches = (id: string | null, name: string | null) =>
      !empFilter ||
      id === empFilter ||
      (name ?? '').toLowerCase().includes(empLower);
    const tenderAt = (r: { paidAt: Date | null; occurredAt: Date }) =>
      r.paidAt ?? r.occurredAt;
    const receiptSign = (r: { receiptType: string }) =>
      /возврат/i.test(r.receiptType) ? -1 : 1;
    const receiptTotal = (r: (typeof receipts)[number]) =>
      receiptSign(r) * (Number(r.cash || 0) + Number(r.cashless || 0));

    type DayAgg = {
      kassaCash: number;
      oneCCash: number;
      kassaCard: number;
      oneCCard: number;
    };
    const days = new Map<string, DayAgg>();
    const ensure = (d: string) => {
      let x = days.get(d);
      if (!x) {
        x = { kassaCash: 0, oneCCash: 0, kassaCard: 0, oneCCard: 0 };
        days.set(d, x);
      }
      return x;
    };

    let oneCCashless = 0;
    let oneCPersonalAccount = 0;

    for (const r of receipts) {
      if (!receiptMatchesEmp(r)) continue;
      const day = ensure(minskDay(r.occurredAt));
      const sign = receiptSign(r);
      day.kassaCash += sign * Number(r.cash || 0);
      day.kassaCard += sign * Number(r.cashless || 0);
    }

    for (const r of revenue) {
      if (!employeeMatches(r.employeeExternalId, r.employeeName)) continue;
      const day = ensure(minskDay(tenderAt(r)));
      const sign = r.operationType === 'refund' ? -1 : 1;
      day.oneCCash += sign * Number(r.cash || 0);
      day.oneCCard += sign * Number(r.card || 0);
      oneCCashless += sign * Number(r.cashless || 0);
      oneCPersonalAccount += sign * Number(r.personalAccount || 0);
    }

    const dayRows = [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => {
        const diffCash = round2(v.kassaCash - v.oneCCash);
        const diffCard = round2(v.kassaCard - v.oneCCard);
        const itemKey = `day:${date}`;
        const fp = fingerprint(itemKey, diffCash, diffCard);
        const ack = acks.get(itemKey);
        return {
          itemKey,
          fingerprint: fp,
          acked: Boolean(ack && ack.fingerprint === fp),
          date,
          kassaCash: round2(v.kassaCash),
          oneCCash: round2(v.oneCCash),
          kassaCard: round2(v.kassaCard),
          oneCCard: round2(v.oneCCard),
          diffCash,
          diffCard,
        };
      })
      .filter((d) => opts.showAcked || !d.acked);

    // Cheque↔1C matching is temporarily off — day totals stay; skip the heavy
    // subset search until the report is ready again.
    const unmatchedKassa: DiscrepancySalesResponse['unmatchedKassa'] = [];
    const unmatchedOneC: DiscrepancySalesResponse['unmatchedOneC'] = [];
    let mixedMatched = 0;
    let combinedMatched = 0;
    let matchedCount = 0;

    if (DISCREPANCY_CHEQUE_MATCH_ENABLED) {
      const windowMs = DISCREPANCY_SALES_MATCH_WINDOW_MIN * 60 * 1000;
      // 1C splits one sale document into a row per nomenclature line (payment is
      // prorated by line cost). The cheque covers the whole document, so rows of
      // one document paid at one moment are glued back into a single tender.
      const tenders = new Map<string, Tender>();
      for (const r of revenue) {
        const cash = Number(r.cash || 0);
        const card = Number(r.card || 0);
        if (cash <= 0 && card <= 0) continue;
        const sign = r.operationType === 'refund' ? -1 : 1;
        const at = tenderAt(r);
        const docId = r.documentId?.trim() || null;
        const key = `${docId || r.externalId}|${r.operationType}|${Math.floor(at.getTime() / 60000)}`;
        let t = tenders.get(key);
        if (!t) {
          t = {
            key,
            documentId: docId,
            externalId: r.externalId,
            at,
            cash: 0,
            card: 0,
            clientName: r.clientName?.trim() || null,
            employees: [],
            lines: new Map(),
          };
          tenders.set(key, t);
        }
        t.cash += sign * cash;
        t.card += sign * card;
        t.employees.push({ id: r.employeeExternalId, name: r.employeeName });
        const name = r.productName?.trim() || '—';
        const lineKey = (r.productExternalId?.trim() || name).toLowerCase();
        const line = t.lines.get(lineKey);
        if (line) line.amount += sign * (cash + card);
        else {
          t.lines.set(lineKey, {
            productName: name,
            segment: lineSegment(name, r.productExternalId, segments),
            amount: sign * (cash + card),
          });
        }
      }

      const tenderList = [...tenders.values()].sort(
        (a, b) => a.at.getTime() - b.at.getTime(),
      );
      const sortedReceipts = [...receipts].sort(
        (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
      );
      const usedTender = new Set<string>();
      const usedReceipt = new Set<string>();
      const countMixed = (group: Tender[]) => {
        const keys = new Set(group.flatMap((t) => [...t.lines.keys()]));
        if (keys.size > 1) mixedMatched += 1;
      };
      const dt = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime());

      // 1) One cheque ↔ one 1C payment (whole document, all its lines).
      for (const rec of sortedReceipts) {
        const amount = receiptTotal(rec);
        let best: Tender | null = null;
        let bestDt = Infinity;
        for (const t of tenderList) {
          if (usedTender.has(t.key)) continue;
          if (Math.abs(tenderTotal(t) - amount) > MONEY_EPS) continue;
          const d = dt(t.at, rec.occurredAt);
          if (d <= windowMs && d < bestDt) {
            best = t;
            bestDt = d;
          }
        }
        if (best) {
          usedTender.add(best.key);
          usedReceipt.add(rec.id);
          countMixed([best]);
        }
      }

      // 2) One cheque ↔ several 1C payments (sale split into documents).
      for (const rec of sortedReceipts) {
        if (usedReceipt.has(rec.id)) continue;
        const pool = tenderList.filter(
          (t) => !usedTender.has(t.key) && dt(t.at, rec.occurredAt) <= windowMs,
        );
        const subset = findSubset(pool, tenderTotal, receiptTotal(rec), (t) =>
          dt(t.at, rec.occurredAt),
        );
        if (!subset) continue;
        for (const t of subset) usedTender.add(t.key);
        usedReceipt.add(rec.id);
        combinedMatched += 1;
        countMixed(subset);
      }

      // 3) One 1C payment ↔ several cheques.
      for (const t of tenderList) {
        if (usedTender.has(t.key)) continue;
        const pool = sortedReceipts.filter(
          (r) => !usedReceipt.has(r.id) && dt(r.occurredAt, t.at) <= windowMs,
        );
        const subset = findSubset(pool, receiptTotal, tenderTotal(t), (r) =>
          dt(r.occurredAt, t.at),
        );
        if (!subset) continue;
        for (const r of subset) usedReceipt.add(r.id);
        usedTender.add(t.key);
        combinedMatched += 1;
        countMixed([t]);
      }

      const toLines = (t: Tender) =>
        [...t.lines.values()].map((l) => ({ ...l, amount: round2(l.amount) }));

      for (const rec of sortedReceipts) {
        if (usedReceipt.has(rec.id) || !receiptMatchesEmp(rec)) continue;
        const sign = receiptSign(rec);
        const cash = sign * Number(rec.cash || 0);
        const card = sign * Number(rec.cashless || 0);
        const total = cash + card;
        const itemKey = `kassa:${rec.receiptId}`;
        const fp = fingerprint(itemKey, total, rec.occurredAt.toISOString());
        const ack = acks.get(itemKey);
        const acked = Boolean(ack && ack.fingerprint === fp);
        if (acked && !opts.showAcked) continue;
        let nearest: Tender | null = null;
        let nearestDt = Infinity;
        for (const t of tenderList) {
          if (usedTender.has(t.key)) continue;
          const d = dt(t.at, rec.occurredAt);
          if (d <= windowMs * 3 && d < nearestDt) {
            nearest = t;
            nearestDt = d;
          }
        }
        unmatchedKassa.push({
          itemKey,
          fingerprint: fp,
          receiptId: rec.receiptId,
          occurredAt: rec.occurredAt.toISOString(),
          amount: round2(total),
          cash: round2(cash),
          cashless: round2(card),
          cashier: rec.cashier,
          receiptType: rec.receiptType,
          nearestOneC: nearest
            ? {
                documentId: nearest.documentId,
                occurredAt: nearest.at.toISOString(),
                amount: round2(tenderTotal(nearest)),
                diff: round2(total - tenderTotal(nearest)),
                lines: toLines(nearest),
              }
            : null,
          acked,
        });
      }

      for (const t of tenderList) {
        if (usedTender.has(t.key)) continue;
        if (!t.employees.some((e) => employeeMatches(e.id, e.name))) continue;
        const total = tenderTotal(t);
        const itemKey = `onec:${t.key}`;
        const fp = fingerprint(itemKey, round2(total), t.at.toISOString());
        const ack = acks.get(itemKey);
        const acked = Boolean(ack && ack.fingerprint === fp);
        if (acked && !opts.showAcked) continue;
        const lines = toLines(t);
        const employeeNames = [
          ...new Set(
            t.employees
              .map((e) => e.name?.trim())
              .filter((n): n is string => !!n),
          ),
        ];
        unmatchedOneC.push({
          itemKey,
          fingerprint: fp,
          externalId: t.externalId,
          documentId: t.documentId,
          occurredAt: t.at.toISOString(),
          amount: round2(total),
          cash: round2(t.cash),
          card: round2(t.card),
          productName: lines.map((l) => l.productName).join(' + '),
          lines,
          clientName: t.clientName,
          employeeName: employeeNames.join(', ') || null,
          acked,
        });
      }

      matchedCount = usedReceipt.size;
    }

    const employeesMap = new Map<string, { id: string; name: string; count: number }>();
    for (const r of receipts) {
      const id = r.cashier?.trim();
      if (!id) continue;
      const prev = employeesMap.get(id);
      if (prev) prev.count += 1;
      else employeesMap.set(id, { id, name: id, count: 1 });
    }
    for (const r of revenue) {
      const id = r.employeeExternalId?.trim() || r.employeeName?.trim();
      if (!id) continue;
      const prev = employeesMap.get(id);
      if (prev) prev.count += 1;
      else {
        employeesMap.set(id, {
          id,
          name: r.employeeName?.trim() || id,
          count: 1,
        });
      }
    }

    const problemDays = dayRows.filter(
      (d) => Math.abs(d.diffCash) > 0.02 || Math.abs(d.diffCard) > 0.02,
    ).length;

    return {
      from: period.from,
      to: period.to,
      days: dayRows,
      unmatchedKassa,
      unmatchedOneC,
      oneCCashless: round2(oneCCashless),
      oneCPersonalAccount: round2(oneCPersonalAccount),
      problemDays,
      matchedCount,
      mixedMatched,
      combinedMatched,
      webkassa: {
        lastSuccessAt: syncState?.lastSuccessAt?.toISOString() ?? null,
        lastStatus: syncState?.lastStatus ?? null,
        lastError: syncState?.lastError ?? null,
        lastCount: syncState?.lastCount ?? 0,
      },
      employees: [...employeesMap.values()].sort((a, b) => b.count - a.count),
    };
  }

  async spaPtTab(
    user: JwtPayload,
    kind: 'SPA' | 'PT',
    opts: QueryOpts,
  ): Promise<DiscrepancySpaPtResponse> {
    const clubId = requireClubId(user);
    const period = parsePeriod(opts.from, opts.to);
    return withDiscrepancyTabCache(
      discrepancyTabCacheKey(clubId, kind === 'SPA' ? 'spa' : 'pt', opts, period),
      () => this.computeSpaPtTab(clubId, period, kind, opts),
    );
  }

  private async computeSpaPtTab(
    clubId: string,
    period: ReturnType<typeof parsePeriod>,
    kind: 'SPA' | 'PT',
    opts: QueryOpts,
  ): Promise<DiscrepancySpaPtResponse> {
    const membershipByClient = await this.loadMembershipMap(clubId);
    const sessions = await this.loadSessions(
      clubId,
      period.fromD,
      period.toD,
      kind === 'SPA' ? OnexClassKind.SPA : OnexClassKind.PT,
    );

    const byPerformer = new Map<
      string,
      {
        performerId: string;
        performerName: string;
        count: number;
        redCount: number;
        approximate: boolean;
        sessions: Map<string, DiscrepancySpaPtSessionRow>;
      }
    >();

    const emp = opts.employee?.trim() || '';
    for (const session of sessions) {
      if (emp && performerKey(session) !== emp) continue;
      const sessionKey = `1c:${session.externalId}`;
      let sessionHits = 0;
      let sessionRed = 0;
      let sessionApprox = false;
      const clientNames: string[] = [];
      for (const member of session.members) {
        const check = isExpiringPackageWriteOff(
          session,
          member,
          membershipByClient,
        );
        if (!check.hit) continue;
        sessionHits += 1;
        if (check.redReasons.length) sessionRed += 1;
        if (check.approximate) sessionApprox = true;
        const cn = member.clientName?.trim();
        if (cn && !clientNames.includes(cn)) clientNames.push(cn);
      }
      if (sessionHits === 0) continue;

      const pid = performerKey(session);
      let row = byPerformer.get(pid);
      if (!row) {
        row = {
          performerId: pid,
          performerName: session.employeeName?.trim() || pid,
          count: 0,
          redCount: 0,
          approximate: false,
          sessions: new Map(),
        };
        byPerformer.set(pid, row);
      }
      row.count += sessionHits;
      row.redCount += sessionRed;
      if (sessionApprox) row.approximate = true;
      row.sessions.set(sessionKey, {
        sessionKey,
        startAt: session.startAt.toISOString(),
        title: session.title || (kind === 'SPA' ? 'SPA' : 'ПТ'),
        clientNames,
        writeOffCount: sessionHits,
        redCount: sessionRed,
        approximate: sessionApprox,
      });
    }

    const resolveUser = await this.performerUserResolver(clubId);
    const acks = await this.loadAcks(clubId, kind === 'SPA' ? 'spa' : 'pt');
    const performers = [...byPerformer.values()]
      .map((p) => {
        const itemKey = `perf:${p.performerId}:${period.from}:${period.to}`;
        const fp = fingerprint(itemKey, p.count, p.redCount);
        const ack = acks.get(itemKey);
        const sessionList = [...p.sessions.values()].sort((a, b) =>
          a.startAt.localeCompare(b.startAt),
        );
        return {
          performerId: p.performerId,
          performerName: p.performerName,
          count: p.count,
          redCount: p.redCount,
          approximate: p.approximate,
          sessions: sessionList,
          itemKey,
          fingerprint: fp,
          acked: Boolean(ack && ack.fingerprint === fp),
          performerUserId: resolveUser(p.performerId, p.performerName),
        };
      })
      .filter((p) => opts.showAcked || !p.acked);

    performers.sort((a, b) => b.count - a.count);
    return {
      from: period.from,
      to: period.to,
      performers,
      total: performers.reduce((s, p) => s + p.count, 0),
      redTotal: performers.reduce((s, p) => s + p.redCount, 0),
      employees: performers.map((p) => ({
        id: p.performerId,
        name: p.performerName,
        count: p.count,
      })),
    };
  }

  async groupTab(
    user: JwtPayload,
    opts: QueryOpts,
  ): Promise<DiscrepancyGroupResponse> {
    const clubId = requireClubId(user);
    const period = parsePeriod(opts.from, opts.to);
    return withDiscrepancyTabCache(
      discrepancyTabCacheKey(clubId, 'gp', opts, period),
      () => this.computeGroupTab(clubId, period, opts),
    );
  }

  private async computeGroupTab(
    clubId: string,
    period: ReturnType<typeof parsePeriod>,
    opts: QueryOpts,
  ): Promise<DiscrepancyGroupResponse> {
    const sessions = await this.loadSessions(
      clubId,
      period.fromD,
      period.toD,
      OnexClassKind.GROUP,
    );

    const approvals = await this.prisma.groupClassApproval.findMany({
      where: {
        clubId,
        OR: [
          { adminApprovedAt: { not: null } },
          { overrideApprovedAt: { not: null } },
        ],
      },
      select: { sessionKey: true },
    });
    const approvedKeys = new Set(approvals.map((a) => a.sessionKey));
    const acks = await this.loadAcks(clubId, 'gp');
    const emp = opts.employee?.trim() || '';

    const byPerformer = new Map<
      string,
      DiscrepancyGroupResponse['performers'][number]
    >();

    for (const session of sessions) {
      const sessionKey = `1c:${session.externalId}`;
      if (approvedKeys.has(sessionKey)) continue;
      if (emp && performerKey(session) !== emp) continue;

      let lateAdds = 0;
      let duringAdds = 0;
      let approximate = false;
      let bookedAtStart = 0;
      for (const m of session.members) {
        if (m.cancelled) continue;
        const info = isLateAddAfterEnd(session, m);
        if (info.approximate) approximate = true;
        if (info.late) lateAdds += 1;
        else if (info.during) duringAdds += 1;
        else bookedAtStart += 1;
      }
      if (lateAdds === 0) continue;

      const itemKey = `session:${sessionKey}`;
      const fp = fingerprint(itemKey, lateAdds);
      const ack = acks.get(itemKey);
      const acked = Boolean(ack && ack.fingerprint === fp);
      if (acked && !opts.showAcked) continue;

      const confirmed = session.members.filter(
        (m) =>
          !m.cancelled &&
          (m.attendance === OnexClassMemberAttendance.ATTENDED ||
            m.attendance === 'ATTENDED'),
      ).length;

      const pid = performerKey(session);
      let row = byPerformer.get(pid);
      if (!row) {
        row = {
          performerId: pid,
          performerName: session.employeeName?.trim() || pid,
          lateAddCount: 0,
          sessions: [],
        };
        byPerformer.set(pid, row);
      }
      row.lateAddCount += lateAdds;
      row.sessions.push({
        itemKey,
        fingerprint: fp,
        acked,
        sessionKey,
        startAt: session.startAt.toISOString(),
        title: session.title || 'ГП',
        bookedAtStart,
        confirmed,
        lateAdds,
        duringAdds,
        approximate,
      });
    }

    const resolveUser = await this.performerUserResolver(clubId);
    const performers = [...byPerformer.values()].map((p) => ({
      ...p,
      performerUserId: resolveUser(p.performerId, p.performerName),
    }));
    performers.sort((a, b) => b.lateAddCount - a.lateAddCount);

    let trustExceptions: DiscrepancyGroupResponse['trustExceptions'] = [];
    try {
      const items = await this.groupSessions.listAdminExceptions(clubId);
      trustExceptions = items.map((i) => ({
        id: i.id,
        title: i.title,
        performerName: i.performerName,
        startAt: i.startAt,
        trustBand: i.trustBand,
        baselineCount: i.baselineCount ?? 0,
        attendedCount: i.attendedCount ?? 0,
        trustReasons: i.trustReasons,
      }));
    } catch {
      trustExceptions = [];
    }

    return {
      from: period.from,
      to: period.to,
      performers,
      lateAddTotal: performers.reduce((s, p) => s + p.lateAddCount, 0),
      trustExceptions,
      employees: performers.map((p) => ({
        id: p.performerId,
        name: p.performerName,
        count: p.lateAddCount,
      })),
    };
  }

  /**
   * OK — exactly one segment; CONFLICT — several; GUESSED — no segment, but the
   * 1C sale type or a name rule put it into a bucket; UNASSIGNED — no segment and
   * no signal (lands in the default bucket purely by fallback).
   */
  private productStatus(
    matched: DiscrepancySegmentKey[],
    oneCSaleType: string | null,
    productName: string,
    segments: PayrollSegmentSets | null,
  ): DiscrepancyProductStatus {
    if (matched.length > 1) return 'CONFLICT';
    if (matched.length === 1) return 'OK';
    if (!segments) return 'GUESSED';
    const raw = (oneCSaleType ?? '').toLowerCase().trim();
    const rawSignal = Boolean(raw) && raw !== 'other' && raw !== 'unknown';
    const nameSignal =
      isLikelyTrainingProductName(productName) ||
      normalizeSaleType(undefined, productName) !==
        normalizeSaleType(undefined, '');
    return rawSignal || nameSignal ? 'GUESSED' : 'UNASSIGNED';
  }

  private suggestSegment(
    matched: DiscrepancySegmentKey[],
    classified: string,
    oneCSaleType: string | null,
    productName: string,
  ): DiscrepancySegmentKey | null {
    if (matched.length === 1) return matched[0];
    const map: Record<string, DiscrepancySegmentKey> = {
      membership: 'membership',
      massage: 'spa',
      spa: 'spa',
      shop: 'shop',
      solarium: 'solarium',
      training: 'training',
    };
    if (classified && map[classified]) return map[classified];
    const fallback = normalizeSaleType(oneCSaleType ?? undefined, productName);
    return map[fallback] ?? 'training';
  }

  private async missingStaff(
    clubId: string,
    fromD: Date,
    toD: Date,
  ): Promise<DiscrepancySegmentsResponse['missingEmployees']> {
    const staffUsers = await this.prisma.user.findMany({
      where: {
        clubId,
        roles: {
          some: {
            role: {
              in: [
                Role.ADMIN,
                Role.MANAGER,
                Role.TRAINER,
                Role.SPECIALIST,
                Role.TECH,
              ],
            },
          },
        },
      },
      select: { externalId: true, employeeCode: true },
    });
    const known = new Set<string>();
    for (const u of staffUsers) {
      if (u.externalId) known.add(u.externalId);
      if (u.employeeCode) known.add(u.employeeCode);
    }

    const [saleEmps, sessionEmps] = await Promise.all([
      this.prisma.clubRevenueEntry.groupBy({
        by: ['employeeExternalId', 'employeeName'],
        where: {
          clubId,
          isActive: true,
          occurredAt: { gte: fromD, lte: toD },
          employeeExternalId: { not: null },
        },
        _count: true,
      }),
      this.prisma.onexClassSession.groupBy({
        by: ['employeeExternalId', 'employeeName'],
        where: {
          clubId,
          isActive: true,
          startAt: { gte: fromD, lte: toD },
          employeeExternalId: { not: null },
        },
        _count: true,
      }),
    ]);

    const map = new Map<
      string,
      { externalId: string; name: string; salesCount: number; sessionsCount: number }
    >();
    for (const s of saleEmps) {
      const id = s.employeeExternalId?.trim();
      if (!id || known.has(id)) continue;
      map.set(id, {
        externalId: id,
        name: s.employeeName?.trim() || id,
        salesCount: s._count,
        sessionsCount: 0,
      });
    }
    for (const s of sessionEmps) {
      const id = s.employeeExternalId?.trim();
      if (!id || known.has(id)) continue;
      const prev = map.get(id);
      if (prev) prev.sessionsCount += s._count;
      else {
        map.set(id, {
          externalId: id,
          name: s.employeeName?.trim() || id,
          salesCount: 0,
          sessionsCount: s._count,
        });
      }
    }
    return [...map.values()].sort(
      (a, b) => b.salesCount + b.sessionsCount - (a.salesCount + a.sessionsCount),
    );
  }

  private async loadSessions(
    clubId: string,
    fromD: Date,
    toD: Date,
    kind: OnexClassKind,
  ): Promise<SessionLike[]> {
    const rows = await this.prisma.onexClassSession.findMany({
      where: {
        clubId,
        isActive: true,
        kind,
        startAt: { gte: fromD, lte: toD },
        status: { not: 'CANCELLED' },
      },
      include: { members: true },
    });
    return rows.map((s) => ({
      externalId: s.externalId,
      kind: s.kind,
      status: s.status,
      startAt: s.startAt,
      endAt: s.endAt,
      employeeExternalId: s.employeeExternalId,
      employeeName: s.employeeName,
      title: s.title,
      createdAt: s.createdAt,
      members: s.members.map((m) => ({
        externalId: m.externalId,
        clientName: m.clientName,
        attendance: m.attendance,
        cancelled: m.cancelled,
        paySource: m.paySource,
        paymentBasis: m.paymentBasis,
        bookedAt: m.bookedAt,
        packageDocId: m.packageDocId,
        packageValidUntil: m.packageValidUntil,
        createdAt: m.createdAt,
        quantity: m.quantity,
      })),
    }));
  }

  /** Maps a 1C performer (code or name) to a FitGO user id for review-queue links. */
  private async performerUserResolver(clubId: string) {
    const users = await this.prisma.user.findMany({
      where: { clubId },
      select: {
        id: true,
        externalId: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
      },
    });
    const byCode = new Map<string, string>();
    const byName = new Map<string, string>();
    for (const u of users) {
      for (const raw of [u.externalId, u.employeeCode]) {
        const code = raw?.trim();
        if (!code) continue;
        byCode.set(code, u.id);
        const stripped = code.replace(/^0+/, '');
        if (stripped) byCode.set(stripped, u.id);
      }
      const name = `${u.lastName ?? ''} ${u.firstName ?? ''}`.trim().toLowerCase();
      if (name) byName.set(name, u.id);
    }
    return (code: string, name: string): string | null =>
      byCode.get(code) ??
      byCode.get(code.replace(/^0+/, '')) ??
      byName.get(name.trim().toLowerCase()) ??
      null;
  }

  private async loadMembershipMap(
    clubId: string,
  ): Promise<Map<string, MembershipSnapLike>> {
    const snaps = await this.prisma.clubMembershipSnapshot.findMany({
      where: { clubId },
      select: {
        clientExternalId: true,
        packageName: true,
        endDate: true,
      },
    });
    return new Map(
      snaps.map((s) => [
        s.clientExternalId,
        {
          clientExternalId: s.clientExternalId,
          packageName: s.packageName,
          endDate: s.endDate,
        },
      ]),
    );
  }

  private async loadAcks(
    clubId: string,
    tab: DiscrepancyTab,
    _showAcked?: boolean,
  ) {
    const rows = await this.prisma.discrepancyAck.findMany({
      where: { clubId, tab, expiresAt: { gt: new Date() } },
    });
    return new Map(rows.map((r) => [r.itemKey, r]));
  }

  private invalidateSummary(clubId: string) {
    invalidateDiscrepancySummary(clubId);
  }
}

export function invalidateDiscrepancySummary(clubId: string) {
  for (const key of summaryCache.keys()) {
    if (key.startsWith(`${clubId}|`)) summaryCache.delete(key);
  }
  for (const key of tabResultCache.keys()) {
    if (key.startsWith(`${clubId}|`)) tabResultCache.delete(key);
  }
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Stable performer key shared by the employee filter and the rows. */
function performerKey(session: SessionLike): string {
  return (
    session.employeeExternalId?.trim() ||
    session.employeeName?.trim() ||
    'unknown'
  );
}

const MONEY_EPS = 0.02;
/** Nearest candidates tried in subset matching (2^n combinations). */
const SUBSET_POOL_MAX = 8;

/** One 1C payment: all nomenclature lines of a document paid at one moment. */
type Tender = {
  key: string;
  documentId: string | null;
  externalId: string;
  at: Date;
  cash: number;
  card: number;
  clientName: string | null;
  employees: Array<{ id: string | null; name: string | null }>;
  lines: Map<string, DiscrepancySaleLine>;
};

function tenderTotal(t: Tender) {
  return t.cash + t.card;
}

function lineSegment(
  productName: string,
  productExternalId: string | null,
  segments: PayrollSegmentSets | null,
): DiscrepancySegmentKey | null {
  const matched = matchPayrollSegments(
    productName,
    segments,
    productExternalId,
  ) as DiscrepancySegmentKey[];
  return matched[0] ?? null;
}

/** Smallest group (2+) of same-sign items whose sum equals target, nearest first. */
function findSubset<T>(
  pool: T[],
  value: (x: T) => number,
  target: number,
  distance: (x: T) => number,
): T[] | null {
  if (Math.abs(target) <= MONEY_EPS) return null;
  const items = pool
    .filter((x) => Math.sign(value(x)) === Math.sign(target))
    .sort((a, b) => distance(a) - distance(b))
    .slice(0, SUBSET_POOL_MAX);
  const n = items.length;
  if (n < 2) return null;
  let best: T[] | null = null;
  for (let mask = 3; mask < 1 << n; mask += 1) {
    if ((mask & (mask - 1)) === 0) continue;
    let sum = 0;
    const picked: T[] = [];
    for (let i = 0; i < n; i += 1) {
      if (mask & (1 << i)) {
        sum += value(items[i]);
        picked.push(items[i]);
      }
    }
    if (
      Math.abs(sum - target) <= MONEY_EPS &&
      (!best || picked.length < best.length)
    ) {
      best = picked;
    }
  }
  return best;
}
