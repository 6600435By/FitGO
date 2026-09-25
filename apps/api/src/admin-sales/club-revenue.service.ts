import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  ClubRevenueDetailResponse,
  ClubRevenueLineDto,
  ClubRevenueOperationType,
  ClubRevenuePaymentMethod,
  ClubRevenueReportResponse,
  ClubRevenueSummary,
} from '@fitgo/shared-types';
import { PrismaService } from '../prisma/prisma.service';

function toMinor(major: number): number {
  return Math.round(major * 100);
}

const STATUS_LABELS: Record<string, string> = {
  payment: 'Оплата',
  unpaid: 'Не оплачена (долг)',
  refund: 'Возврат',
  sale: 'Продажа',
  personal_deposit: 'Взнос на ЛС',
  personal_credit: 'Прочие поступления',
  personal_burn: 'Сгорание ЛС',
};

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
    if (params.paymentMethod && params.paymentMethod !== 'all') {
      baseWhere.paymentMethod = params.paymentMethod;
    }
    if (params.employeeExternalId) {
      baseWhere.employeeExternalId = params.employeeExternalId;
    }
    if (params.q?.trim()) {
      const q = params.q.trim();
      baseWhere.AND = [
        {
          OR: [
            { clientName: { contains: q, mode: 'insensitive' } },
            { productName: { contains: q, mode: 'insensitive' } },
            { employeeName: { contains: q, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const op = params.operationType && params.operationType !== 'all'
      ? params.operationType
      : null;

    // Receipts in period (приход): payment date in range, or ЛС movements by occurredAt
    const receiptWhere = {
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
        // paid sale rows without explicit payment type
        {
          operationType: 'sale',
          paidAt: { gte: from, lte: to },
          paidAmount: { gt: 0 },
        },
      ],
    };

    // Sales created in period
    const soldInPeriodWhere = {
      ...baseWhere,
      occurredAt: { gte: from, lte: to },
      operationType: { in: ['sale', 'payment', 'unpaid', 'refund'] },
    };

    // Open debt: unpaid, sold on or before period end (carries across months)
    const debtWhere = {
      ...baseWhere,
      operationType: 'unpaid',
      occurredAt: { lte: to },
    };

    const [receipts, soldInPeriod, openDebt, club, syncState, employees] =
      await Promise.all([
        this.prisma.clubRevenueEntry.findMany({
          where: receiptWhere,
          orderBy: [{ paidAt: 'desc' }, { occurredAt: 'desc' }],
          take: 3000,
        }),
        this.prisma.clubRevenueEntry.findMany({
          where: soldInPeriodWhere,
          take: 3000,
        }),
        this.prisma.clubRevenueEntry.findMany({
          where: debtWhere,
          orderBy: [{ occurredAt: 'desc' }],
          take: 3000,
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
        this.prisma.clubRevenueEntry.findMany({
          where: {
            clubId,
            isActive: true,
            OR: [
              { paidAt: { gte: from, lte: to } },
              { occurredAt: { gte: from, lte: to } },
            ],
            employeeExternalId: { not: null },
          },
          select: { employeeExternalId: true, employeeName: true },
          distinct: ['employeeExternalId'],
        }),
      ]);

    const summary = this.buildSummary({
      receipts: receipts as Row[],
      soldInPeriod: soldInPeriod as Row[],
      openDebt: openDebt as Row[],
    });

    // Lines for UI: by filter chip
    let lineRows: Row[];
    if (op === 'unpaid') {
      lineRows = openDebt as Row[];
    } else if (
      op === 'payment' ||
      op === 'refund' ||
      op === 'personal_deposit' ||
      op === 'personal_credit' ||
      op === 'personal_burn'
    ) {
      lineRows = (receipts as Row[]).filter((r) => r.operationType === op);
    } else if (op === 'sale') {
      lineRows = soldInPeriod as Row[];
    } else {
      // all: receipts in period + open debt (dedupe by id)
      const byId = new Map<string, Row>();
      for (const r of [...(receipts as Row[]), ...(openDebt as Row[])]) {
        byId.set(r.id, r);
      }
      lineRows = [...byId.values()].sort((a, b) => {
        const ta = (a.paidAt ?? a.occurredAt).getTime();
        const tb = (b.paidAt ?? b.occurredAt).getTime();
        return tb - ta;
      });
    }

    const lines = lineRows.slice(0, 2000).map((r) => this.toLine(r, from, to));
    const employeeOpts = employees
      .filter((e) => e.employeeExternalId)
      .map((e) => ({
        employeeExternalId: e.employeeExternalId!,
        employeeName: e.employeeName?.trim() || e.employeeExternalId!,
      }))
      .sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'ru'));

    const hint =
      lines.length === 0
        ? 'Нет данных за период. Нажмите «Обновить из 1С».'
        : 'Приход = оплаты от клиентов + взносы на ЛС (нал/карта/безнал), как «Итого приход» в 1С. Возвраты — отдельно. После публикации BSL нажмите «Обновить из 1С».';

    return {
      from: params.from,
      to: params.to,
      summary,
      lines,
      employees: employeeOpts,
      currency: club?.currency ?? 'BYN',
      hint,
      lastSyncedAt: syncState?.lastSuccessAt?.toISOString() ?? null,
    };
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

    const from = new Date(0);
    const to = new Date();
    return {
      line: this.toLine(row as Row, from, to),
      related: related.map((r) => this.toLine(r as Row, from, to)),
      currency: club?.currency ?? 'BYN',
    };
  }

  private buildSummary(input: {
    receipts: Row[];
    soldInPeriod: Row[];
    openDebt: Row[];
  }): ClubRevenueSummary {
    let paymentsMinor = 0;
    let depositsMinor = 0;
    let refundsMinor = 0;
    let personalCreditsMinor = 0;
    let personalBurnsMinor = 0;
    let cashMinor = 0;
    let cardMinor = 0;
    let cashlessMinor = 0;
    let personalAccountMinor = 0;

    for (const r of input.receipts) {
      if (r.operationType === 'personal_deposit') {
        depositsMinor += toMinor(r.paidAmount || r.amount);
        cashMinor += toMinor(r.cash);
        cardMinor += toMinor(r.card);
        cashlessMinor += toMinor(r.cashless);
      } else if (r.operationType === 'personal_credit') {
        personalCreditsMinor += toMinor(Math.abs(r.amount || r.saleAmount));
      } else if (r.operationType === 'personal_burn') {
        personalBurnsMinor += toMinor(Math.abs(r.amount || r.personalAccount));
      } else if (r.operationType === 'refund') {
        // Расход, не входит в «Итого приход» сводного отчёта.
        refundsMinor += toMinor(r.refundAmount || Math.abs(r.amount));
      } else if (
        r.operationType === 'payment' ||
        (r.operationType === 'sale' && r.paidAmount > 0)
      ) {
        // Only the paid slice in this receipt row (1C day allocation)
        paymentsMinor += toMinor(r.paidAmount || r.amount);
        cashMinor += toMinor(r.cash);
        cardMinor += toMinor(r.card);
        cashlessMinor += toMinor(r.cashless);
        personalAccountMinor += toMinor(r.personalAccount);
        refundsMinor += toMinor(r.refundAmount);
      }
    }

    let soldMinor = 0;
    for (const r of input.soldInPeriod) {
      if (
        r.operationType === 'unpaid' ||
        r.operationType === 'payment' ||
        r.operationType === 'sale'
      ) {
        soldMinor += toMinor(r.saleAmount);
      }
    }

    // Full open debt through end of period (including sales from earlier months)
    let unpaidMinor = 0;
    for (const r of input.openDebt) {
      unpaidMinor += toMinor(r.saleAmount || r.amount);
    }

    // Как колонка «Итого приход»: оплаты + взносы, возвраты отдельно.
    const incomeMinor = paymentsMinor + depositsMinor;

    return {
      incomeMinor,
      paymentsMinor,
      depositsMinor,
      refundsMinor,
      personalCreditsMinor,
      personalBurnsMinor,
      soldMinor,
      unpaidMinor,
      byPaymentMethod: {
        cashMinor,
        cardMinor,
        cashlessMinor,
        personalAccountMinor,
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
    const baseLabel = STATUS_LABELS[row.operationType] ?? row.operationType;
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
      employeeName: row.employeeName,
      employeeExternalId: row.employeeExternalId,
      countsTowardIncome: row.countsTowardIncome,
      countsTowardMotivation: row.countsTowardMotivation,
      statusLabel: priorDebt ? `${baseLabel} · прошлый период` : baseLabel,
    };
  }
}
