import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ClubRevenueDetailResponse,
  ClubRevenueLineDto,
  ClubRevenueManualEntryDto,
  ClubRevenueManualKind,
  ClubRevenueOperationType,
  ClubRevenuePaymentMethod,
  ClubRevenueReportResponse,
  ClubRevenueSummary,
} from '@fitgo/shared-types';
import { PrismaService } from '../prisma/prisma.service';

function toMinor(major: number): number {
  return Math.round(major * 100);
}

type Row = {
  id: string;
  externalId: string;
  documentId: string | null;
  operationType: string;
  occurredAt: Date;
  paidAt: Date | null;
  saleAmount: number;
  paidAmount: number;
  refundAmount: number;
  amount: number;
  cash: number;
  card: number;
  cashless: number;
  personalAccount: number;
  paymentMethod: string | null;
  saleType: string | null;
  productName: string | null;
  clientName: string | null;
  clientExternalId: string | null;
  employeeName: string | null;
  employeeExternalId: string | null;
  countsTowardIncome: boolean;
  countsTowardMotivation: boolean;
};

const STATUS_LABELS: Record<string, string> = {
  payment: 'Оплата',
  unpaid: 'Не оплачена (долг)',
  refund: 'Возврат',
  sale: 'Продажа',
  personal_deposit: 'Взнос на ЛС (от клиента)',
  personal_credit: 'Взнос на ЛС по абонементу',
  personal_burn: 'Сгорание ЛС',
};

/** Sentinel for system / 1C-automated ops (ЗакрытиеДня burns, etc.). */
export const SYSTEM_EMPLOYEE_ID = '__1c__';
export const SYSTEM_EMPLOYEE_NAME = '1С';

/**
 * Sale document UUID from club-revenue externalId / documentId.
 * cash: `payDoc:cash:Тип:client:saleDoc:ts:op…`
 * debt: `saleDoc:debt:client`
 * sales cache: `saleDoc:nomenclature:ts:…`
 */
function saleDocIdsForRow(row: {
  externalId: string;
  documentId: string | null;
}): string[] {
  const ids = new Set<string>();
  const parts = row.externalId.split(':');
  const cashIdx = parts.indexOf('cash');
  if (cashIdx >= 0 && parts[cashIdx + 3]) {
    ids.add(parts[cashIdx + 3]);
  }
  const debtIdx = parts.indexOf('debt');
  if (debtIdx > 0) {
    ids.add(parts[0]);
  }
  if (row.documentId && !parts.includes('cash')) {
    // unpaid / PA: documentId is usually the sale or day-close doc
    ids.add(row.documentId);
  }
  return [...ids].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
}

/**
 * «Документ.ЗакрытиеДня» пишет сгорание/списание ЛС в 23:59 как оплату с ЛС
 * в старой выгрузке — переводим в personal_burn.
 */
function isDayClosePersonalWriteOff(r: {
  operationType: string;
  occurredAt: Date;
  personalAccount: number;
  cash: number;
  card: number;
  cashless: number;
}): boolean {
  if (r.operationType !== 'payment') return false;
  if (!(r.personalAccount > 0 && r.cash === 0 && r.card === 0 && r.cashless === 0)) {
    return false;
  }
  const at = r.occurredAt;
  return (
    (at.getUTCHours() === 23 && at.getUTCMinutes() === 59) ||
    (at.getHours() === 23 && at.getMinutes() === 59)
  );
}

/**
 * Align cached rows with 1C:
 * - deposit without cash/card/cashless → membership credit;
 * - ЗакрытиеДня (23:59 PA-only) → personal_burn;
 * - debt «безнал» remapped to PA → restore cashless (119 in 1C «Продажи»).
 */
function normalizeReceiptRow(r: Row): Row | null {
  if (isDayClosePersonalWriteOff(r)) {
    const amt = r.personalAccount || r.amount || r.paidAmount;
    return {
      ...r,
      operationType: 'personal_burn',
      amount: -Math.abs(amt),
      personalAccount: -Math.abs(amt),
      paidAmount: 0,
      saleAmount: 0,
      countsTowardIncome: false,
      countsTowardMotivation: false,
      paymentMethod: 'personalAccount',
      productName: r.productName?.includes('Сгоран')
        ? r.productName
        : 'Сгорание лицевого счета',
    };
  }
  if (
    r.operationType === 'personal_deposit' &&
    r.cash === 0 &&
    r.card === 0 &&
    r.cashless === 0
  ) {
    return {
      ...r,
      operationType: 'personal_credit',
      personalAccount: r.amount || r.paidAmount || r.saleAmount,
      paidAmount: 0,
      countsTowardIncome: false,
      countsTowardMotivation: false,
      paymentMethod: 'personalAccount',
    };
  }
  // Published/sync remap put долг+безнал into personalAccount — 1C «Продажи» keeps it as Безналичные.
  if (
    r.operationType === 'payment' &&
    r.personalAccount > 0 &&
    r.cash === 0 &&
    r.card === 0 &&
    r.cashless === 0 &&
    r.externalId.includes(':Долг:')
  ) {
    return {
      ...r,
      cashless: r.personalAccount,
      personalAccount: 0,
      paymentMethod: 'cashless',
    };
  }
  return r;
}

/**
 * Club revenue period rules (match 1C «оплата с учётом возврата»):
 * - Приход / ЗП-мотивация: только оплаты (и взносы) с датой оплаты в периоде;
 *   продажа могла быть раньше.
 * - Продано: сумма продаж с датой продажи в периоде.
 * - Долг: неоплаченные продажи с датой продажи ≤ конец периода (долг переносится).
 */
@Injectable()
export class ClubRevenueService {
  constructor(private readonly prisma: PrismaService) {}

  async report(
    clubId: string,
    params: {
      from: string;
      to: string;
      operationType?: string;
      paymentMethod?: string;
      employeeExternalId?: string;
      q?: string;
    },
  ): Promise<ClubRevenueReportResponse> {
    const from = new Date(`${params.from}T00:00:00.000Z`);
    const to = new Date(`${params.to}T23:59:59.999Z`);

    const baseWhere: Record<string, unknown> = {
      clubId,
      isActive: true,
    };

    const searchFilter =
      params.q?.trim()
        ? {
            OR: [
              { clientName: { contains: params.q.trim(), mode: 'insensitive' } },
              { productName: { contains: params.q.trim(), mode: 'insensitive' } },
              {
                employeeName: {
                  contains: params.q.trim(),
                  mode: 'insensitive',
                },
              },
            ],
          }
        : null;

    // Summary always covers the full period (cards stay fixed when drilling into a metric).
    // operationType / paymentMethod / employee / q filter only the table lines.
    const summaryReceiptWhere = {
      ...baseWhere,
      OR: [
        {
          operationType: { in: ['payment', 'refund'] },
          paidAt: { gte: from, lte: to },
        },
        {
          operationType: {
            in: ['personal_deposit', 'personal_credit', 'personal_burn'],
          },
          occurredAt: { gte: from, lte: to },
        },
        {
          operationType: 'sale',
          paidAt: { gte: from, lte: to },
          paidAmount: { gt: 0 },
        },
      ],
    };

    const summaryDebtWhere: Record<string, unknown> = {
      ...baseWhere,
      operationType: 'unpaid',
      occurredAt: { lte: to },
    };

    // Line filters (chips / clickable card metrics). Employee is applied
    // after SaleTransaction enrichment — cash scope from 1C has empty staff.
    const lineFilters: Record<string, unknown> = { ...baseWhere };
    if (params.paymentMethod && params.paymentMethod !== 'all') {
      lineFilters.paymentMethod = params.paymentMethod;
    }
    if (searchFilter) {
      lineFilters.AND = [searchFilter];
    }

    const op = params.operationType && params.operationType !== 'all'
      ? params.operationType
      : null;

    const lineReceiptWhere = {
      ...lineFilters,
      OR: [
        {
          operationType: { in: ['payment', 'refund'] },
          paidAt: { gte: from, lte: to },
        },
        {
          operationType: {
            in: ['personal_deposit', 'personal_credit', 'personal_burn'],
          },
          occurredAt: { gte: from, lte: to },
        },
        {
          operationType: 'sale',
          paidAt: { gte: from, lte: to },
          paidAmount: { gt: 0 },
        },
      ],
    };

    const lineDebtWhere: Record<string, unknown> = {
      ...baseWhere,
      operationType: 'unpaid',
      occurredAt: { lte: to },
    };

    const [
      summaryReceipts,
      lineReceipts,
      openDebt,
      lineOpenDebt,
      club,
      syncState,
      saleStaff,
      manuals,
      formedSales,
    ] = await Promise.all([
      this.prisma.clubRevenueEntry.findMany({
        where: summaryReceiptWhere,
        orderBy: [{ paidAt: 'desc' }, { occurredAt: 'desc' }],
      }),
      this.prisma.clubRevenueEntry.findMany({
        where: lineReceiptWhere,
        orderBy: [{ paidAt: 'desc' }, { occurredAt: 'desc' }],
      }),
      this.prisma.clubRevenueEntry.findMany({
        where: summaryDebtWhere,
        orderBy: [{ occurredAt: 'desc' }],
      }),
      this.prisma.clubRevenueEntry.findMany({
        where: lineDebtWhere,
        orderBy: [{ occurredAt: 'desc' }],
      }),
      this.prisma.club.findUnique({
        where: { id: clubId },
        select: { currency: true },
      }),
      this.prisma.salesSyncState.findUnique({
        where: {
          clubId_resourceKey: { clubId, resourceKey: 'club_revenue' },
        },
      }),
      this.prisma.saleTransaction.findMany({
        where: {
          clubId,
          isActive: true,
          // Payments in period may settle older sales — look back ~4 months.
          soldAt: {
            gte: new Date(from.getTime() - 120 * 24 * 60 * 60 * 1000),
            lte: to,
          },
          employeeExternalId: { not: null },
          NOT: { employeeExternalId: '' },
        },
        select: {
          externalSaleId: true,
          employeeExternalId: true,
          employeeName: true,
          soldAt: true,
        },
      }),
      this.prisma.clubRevenueManualEntry.findMany({
        where: { clubId, entryDate: { gte: from, lte: to } },
        orderBy: { entryDate: 'desc' },
      }),
      this.prisma.saleTransaction.aggregate({
        where: {
          clubId,
          isActive: true,
          soldAt: { gte: from, lte: to },
        },
        _sum: { amount: true },
      }),
    ]);

    const staffBySaleDoc = buildStaffBySaleDoc(saleStaff);

    const normalizedSummary = (summaryReceipts as Row[])
      .map(normalizeReceiptRow)
      .filter((r): r is Row => r != null)
      .map((r) => attachEmployee(r, staffBySaleDoc));

    const normalizedLines = (lineReceipts as Row[])
      .map(normalizeReceiptRow)
      .filter((r): r is Row => r != null)
      .map((r) => attachEmployee(r, staffBySaleDoc));

    const enrichedOpenDebt = (openDebt as Row[]).map((r) =>
      attachEmployee(r, staffBySaleDoc),
    );
    const enrichedLineDebt = (lineOpenDebt as Row[]).map((r) =>
      attachEmployee(r, staffBySaleDoc),
    );

    const manualDtos: ClubRevenueManualEntryDto[] = manuals.map((m) => ({
      id: m.id,
      kind: m.kind as ClubRevenueManualKind,
      amountMinor: m.amountMinor,
      entryDate: m.entryDate.toISOString().slice(0, 10),
      note: m.note,
      createdAt: m.createdAt.toISOString(),
    }));

    const summary = this.buildSummary({
      receipts: normalizedSummary,
      soldInPeriod: [],
      openDebt: enrichedOpenDebt,
      formedSalesMinor: toMinor(formedSales._sum.amount ?? 0),
      manuals: manualDtos,
    });

    // Lines for UI: by filter chip / clickable card metric
    let lineRows: Row[];
    if (op === 'unpaid') {
      lineRows = enrichedLineDebt;
    } else if (
      op === 'payment' ||
      op === 'refund' ||
      op === 'personal_deposit' ||
      op === 'personal_credit' ||
      op === 'personal_burn'
    ) {
      lineRows = normalizedLines.filter((r) => {
        if (r.operationType !== op) return false;
        if (op === 'refund' && params.paymentMethod === 'cash') {
          return r.cash > 0;
        }
        if (op === 'refund' && params.paymentMethod === 'card') {
          return r.card > 0;
        }
        return true;
      });
    } else {
      const byId = new Map<string, Row>();
      for (const r of [...normalizedLines, ...enrichedLineDebt]) {
        byId.set(r.id, r);
      }
      lineRows = [...byId.values()].sort((a, b) => {
        const ta = (a.paidAt ?? a.occurredAt).getTime();
        const tb = (b.paidAt ?? b.occurredAt).getTime();
        return tb - ta;
      });
    }

    const empFilter = params.employeeExternalId?.trim() || '';
    if (empFilter === SYSTEM_EMPLOYEE_ID) {
      lineRows = lineRows.filter((r) => !r.employeeExternalId);
    } else if (empFilter) {
      lineRows = lineRows.filter((r) => r.employeeExternalId === empFilter);
    }

    const lines = lineRows.slice(0, 2000).map((r) => this.toLine(r, from, to));

    const employeeMap = new Map<string, string>();
    for (const r of [...normalizedLines, ...enrichedLineDebt]) {
      const id = r.employeeExternalId?.trim();
      if (!id) continue;
      const name = r.employeeName?.trim() || id;
      if (!employeeMap.has(id)) employeeMap.set(id, name);
    }
    for (const s of saleStaff) {
      const id = s.employeeExternalId?.trim();
      if (!id || s.soldAt < from || s.soldAt > to) continue;
      const name = s.employeeName?.trim() || id;
      if (!employeeMap.has(id)) employeeMap.set(id, name);
    }
    const hasSystemOps = [...normalizedLines, ...enrichedLineDebt].some(
      (r) => !r.employeeExternalId,
    );
    const employeeOpts = [...employeeMap.entries()]
      .map(([employeeExternalId, employeeName]) => ({
        employeeExternalId,
        employeeName,
      }))
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'ru'));
    if (hasSystemOps) {
      employeeOpts.unshift({
        employeeExternalId: SYSTEM_EMPLOYEE_ID,
        employeeName: SYSTEM_EMPLOYEE_NAME,
      });
    }

    const hint =
      lines.length === 0
        ? 'Нет данных за период. Нажмите «Обновить из 1С».'
        : 'Итоги в карточках — за весь выбранный период. Клик по цифре фильтрует только таблицу.';

    return {
      from: params.from,
      to: params.to,
      summary,
      lines,
      employees: employeeOpts,
      manualEntries: manualDtos,
      currency: club?.currency ?? 'BYN',
      hint,
      lastSyncedAt: syncState?.lastSuccessAt?.toISOString() ?? null,
    };
  }

  async addManual(
    clubId: string,
    createdById: string,
    input: {
      kind: ClubRevenueManualKind;
      amountMajor: number;
      entryDate: string;
      note?: string;
    },
  ): Promise<ClubRevenueManualEntryDto> {
    if (input.kind !== 'corpo' && input.kind !== 'other') {
      throw new BadRequestException('kind must be corpo|other');
    }
    const amountMinor = Math.round(Number(input.amountMajor) * 100);
    if (!Number.isFinite(amountMinor) || amountMinor === 0) {
      throw new BadRequestException('amount required');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.entryDate)) {
      throw new BadRequestException('entryDate YYYY-MM-DD required');
    }
    const row = await this.prisma.clubRevenueManualEntry.create({
      data: {
        clubId,
        kind: input.kind,
        amountMinor,
        entryDate: new Date(`${input.entryDate}T00:00:00.000Z`),
        note: input.note?.trim() || null,
        createdById,
      },
    });
    return {
      id: row.id,
      kind: row.kind as ClubRevenueManualKind,
      amountMinor: row.amountMinor,
      entryDate: row.entryDate.toISOString().slice(0, 10),
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async deleteManual(clubId: string, id: string): Promise<void> {
    const row = await this.prisma.clubRevenueManualEntry.findFirst({
      where: { id, clubId },
    });
    if (!row) throw new NotFoundException('Manual entry not found');
    await this.prisma.clubRevenueManualEntry.delete({ where: { id } });
  }

  async detail(
    clubId: string,
    id: string,
  ): Promise<ClubRevenueDetailResponse> {
    const row = await this.prisma.clubRevenueEntry.findFirst({
      where: { id, clubId, isActive: true },
    });
    if (!row) throw new NotFoundException('Sale not found');

    const related = row.documentId
      ? await this.prisma.clubRevenueEntry.findMany({
          where: {
            clubId,
            isActive: true,
            documentId: row.documentId,
            id: { not: row.id },
          },
          orderBy: { occurredAt: 'asc' },
          take: 50,
        })
      : [];

    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { currency: true },
    });

    const saleDocs = [
      ...saleDocIdsForRow(row as Row),
      ...related.flatMap((r) => saleDocIdsForRow(r as Row)),
    ];
    const uniqueDocs = [...new Set(saleDocs)];
    const sales =
      uniqueDocs.length > 0
        ? await this.prisma.saleTransaction.findMany({
            where: {
              clubId,
              isActive: true,
              OR: uniqueDocs.map((doc) => ({
                externalSaleId: { startsWith: `${doc}:` },
              })),
            },
            select: {
              externalSaleId: true,
              employeeExternalId: true,
              employeeName: true,
            },
          })
        : [];
    const staffBySaleDoc = buildStaffBySaleDoc(sales);

    const from = new Date(0);
    const to = new Date();
    const main = attachEmployee(
      (normalizeReceiptRow(row as Row) ?? (row as Row)),
      staffBySaleDoc,
    );
    return {
      line: this.toLine(main, from, to),
      related: related
        .map((r) => normalizeReceiptRow(r as Row) ?? (r as Row))
        .map((r) => attachEmployee(r, staffBySaleDoc))
        .map((r) => this.toLine(r, from, to)),
      currency: club?.currency ?? 'BYN',
    };
  }

  private buildSummary(input: {
    receipts: Row[];
    soldInPeriod: Row[];
    openDebt: Row[];
    formedSalesMinor: number;
    manuals: ClubRevenueManualEntryDto[];
  }): ClubRevenueSummary {
    let payCash = 0;
    let payCard = 0;
    let payCashless = 0;
    let payPa = 0;
    let depCash = 0;
    let depCard = 0;
    let depositsMinor = 0;
    let creditsMinor = 0;
    let burnsMinor = 0;
    let refundsCash = 0;
    let refundsCard = 0;
    let refundsOther = 0;

    for (const r of input.receipts) {
      if (r.operationType === 'personal_deposit') {
        depositsMinor += toMinor(r.paidAmount || r.amount);
        depCash += toMinor(r.cash);
        depCard += toMinor(r.card);
      } else if (r.operationType === 'personal_credit') {
        creditsMinor += toMinor(Math.abs(r.amount || r.saleAmount));
      } else if (r.operationType === 'personal_burn') {
        burnsMinor += toMinor(Math.abs(r.amount || r.personalAccount));
      } else if (r.operationType === 'refund') {
        const amt = toMinor(r.refundAmount || Math.abs(r.amount));
        if (r.cash > 0) refundsCash += amt;
        else if (r.card > 0) refundsCard += amt;
        else refundsOther += amt; // ignore in UI totals (e.g. −12 without type)
      } else if (
        r.operationType === 'payment' ||
        (r.operationType === 'sale' && r.paidAmount > 0)
      ) {
        payCash += toMinor(r.cash);
        payCard += toMinor(r.card);
        payCashless += toMinor(r.cashless);
        payPa += toMinor(r.personalAccount);
      }
    }

    let unpaidMinor = 0;
    for (const r of input.openDebt) {
      unpaidMinor += toMinor(r.saleAmount || r.amount);
    }

    const paidMinor = payCash + payCard + payCashless + payPa;
    const refundsMinor = refundsCash + refundsCard;

    let corpoMinor = 0;
    let otherMinor = 0;
    for (const m of input.manuals) {
      if (m.kind === 'corpo') corpoMinor += m.amountMinor;
      else if (m.kind === 'other') otherMinor += m.amountMinor;
    }

    // Выручка: живые деньги (оплаты продаж нал/карта + взносы на ЛС нал/карта + корпо/прочие) − возвраты
    const revenueCash = payCash + depCash;
    const revenueCard = payCard + depCard;
    const revenueTotal =
      revenueCash + revenueCard + corpoMinor + otherMinor - refundsCash - refundsCard;

    const formedMinor =
      input.formedSalesMinor > 0 ? input.formedSalesMinor : paidMinor;

    return {
      sales: {
        formedMinor,
        paidMinor,
        unpaidMinor,
        refundsMinor,
        cashlessMinor: payCashless,
        personalAccountPaidMinor: payPa,
      },
      revenue: {
        totalMinor: revenueTotal,
        cashMinor: revenueCash,
        cardMinor: revenueCard,
        corpoMinor,
        otherMinor,
        refundsCashMinor: refundsCash,
        refundsCardMinor: refundsCard,
      },
      personalAccount: {
        depositsMinor,
        creditsMinor,
        burnsMinor,
      },
      // legacy aliases for older UI
      incomeMinor: revenueTotal,
      paymentsMinor: paidMinor,
      depositsMinor,
      refundsMinor,
      personalCreditsMinor: creditsMinor,
      personalBurnsMinor: burnsMinor,
      soldMinor: formedMinor,
      unpaidMinor,
      byPaymentMethod: {
        cashMinor: revenueCash,
        cardMinor: revenueCard,
        cashlessMinor: payCashless,
        personalAccountMinor: payPa,
      },
    };
  }

  private toLine(
    row: Row,
    periodFrom: Date,
    _periodTo: Date,
  ): ClubRevenueLineDto {
    const priorDebt =
      row.operationType === 'unpaid' && row.occurredAt < periodFrom;
    let baseLabel = STATUS_LABELS[row.operationType] ?? row.operationType;
    if (row.operationType === 'refund') {
      if (row.cash > 0) baseLabel = 'Возврат (наличные)';
      else if (row.card > 0) baseLabel = 'Возврат (карта)';
    }
    return {
      id: row.id,
      externalId: row.externalId,
      documentId: row.documentId,
      operationType: row.operationType as ClubRevenueOperationType,
      occurredAt: row.occurredAt.toISOString(),
      paidAt: row.paidAt?.toISOString() ?? null,
      saleAmountMinor: toMinor(row.saleAmount),
      paidAmountMinor: toMinor(row.paidAmount),
      refundAmountMinor: toMinor(row.refundAmount),
      amountMinor: toMinor(row.amount),
      paymentMethod: (row.paymentMethod ??
        'unknown') as ClubRevenuePaymentMethod,
      split: {
        cashMinor: toMinor(row.cash),
        cardMinor: toMinor(row.card),
        cashlessMinor: toMinor(row.cashless),
        personalAccountMinor: toMinor(row.personalAccount),
      },
      saleType: row.saleType,
      productName: row.productName,
      clientName: row.clientName,
      clientExternalId: row.clientExternalId,
      employeeName: row.employeeName ?? SYSTEM_EMPLOYEE_NAME,
      employeeExternalId: row.employeeExternalId ?? SYSTEM_EMPLOYEE_ID,
      countsTowardIncome: row.countsTowardIncome,
      countsTowardMotivation: row.countsTowardMotivation,
      statusLabel: priorDebt ? `${baseLabel} · прошлый период` : baseLabel,
    };
  }
}

function buildStaffBySaleDoc(
  sales: {
    externalSaleId: string;
    employeeExternalId: string | null;
    employeeName: string | null;
    soldAt?: Date;
  }[],
): Map<string, { employeeExternalId: string; employeeName: string }> {
  const map = new Map<
    string,
    { employeeExternalId: string; employeeName: string }
  >();
  for (const s of sales) {
    const empId = s.employeeExternalId?.trim();
    if (!empId) continue;
    const saleDoc = s.externalSaleId.split(':')[0];
    if (!saleDoc || map.has(saleDoc)) continue;
    map.set(saleDoc, {
      employeeExternalId: empId,
      employeeName: s.employeeName?.trim() || empId,
    });
  }
  return map;
}

function attachEmployee(
  row: Row,
  staffBySaleDoc: Map<
    string,
    { employeeExternalId: string; employeeName: string }
  >,
): Row {
  if (row.employeeExternalId?.trim()) return row;
  for (const saleDoc of saleDocIdsForRow(row)) {
    const hit = staffBySaleDoc.get(saleDoc);
    if (hit) {
      return {
        ...row,
        employeeExternalId: hit.employeeExternalId,
        employeeName: hit.employeeName,
      };
    }
  }
  return row;
}
