/** Club revenue report (super-admin «Продажи»), separate from desk-sales motivation cache. */

export type ClubRevenueOperationType =
  | 'payment'
  | 'unpaid'
  | 'refund'
  | 'sale'
  | 'personal_deposit'
  | 'personal_credit'
  | 'personal_burn';

export type ClubRevenuePaymentMethod =
  | 'cash'
  | 'card'
  | 'cashless'
  | 'personalAccount'
  | 'mixed'
  | 'unknown';

/** Clickable summary metric → list filter */
export type ClubRevenueSummaryFilter =
  | 'sales'
  | 'sales_paid'
  | 'sales_unpaid'
  | 'sales_refunds'
  | 'sales_cashless'
  | 'revenue'
  | 'revenue_cash'
  | 'revenue_card'
  | 'revenue_corpo'
  | 'revenue_other'
  | 'revenue_refunds_cash'
  | 'revenue_refunds_card'
  | 'pa_deposits'
  | 'pa_credits'
  | 'pa_burns';

export type ClubRevenueManualKind = 'corpo' | 'other';

export interface ClubRevenuePaymentSplit {
  cashMinor: number;
  cardMinor: number;
  cashlessMinor: number;
  personalAccountMinor: number;
}

export interface ClubRevenueLineDto {
  id: string;
  externalId: string;
  documentId: string | null;
  operationType: ClubRevenueOperationType;
  occurredAt: string;
  paidAt: string | null;
  saleAmountMinor: number;
  paidAmountMinor: number;
  refundAmountMinor: number;
  amountMinor: number;
  paymentMethod: ClubRevenuePaymentMethod;
  split: ClubRevenuePaymentSplit;
  saleType: string | null;
  productName: string | null;
  clientName: string | null;
  clientExternalId: string | null;
  employeeName: string | null;
  employeeExternalId: string | null;
  countsTowardIncome: boolean;
  countsTowardMotivation: boolean;
  statusLabel: string;
}

/** Card «Сформированные продажи» */
export interface ClubRevenueSalesBlock {
  /** Продано за период (кэш SaleTransaction / лучшая оценка) */
  formedMinor: number;
  /** Оплачено (нал+карта+безнал+ЛС), как колонка «Оплачено» в 1С */
  paidMinor: number;
  unpaidMinor: number;
  refundsMinor: number;
  cashlessMinor: number;
  /** Оплаты с лицевого счёта (в «Оплачено», не в кассовой выручке) */
  personalAccountPaidMinor: number;
}

/** Card «Выручка» — живые деньги в кассу */
export interface ClubRevenueCashBlock {
  totalMinor: number;
  cashMinor: number;
  cardMinor: number;
  corpoMinor: number;
  otherMinor: number;
  refundsCashMinor: number;
  refundsCardMinor: number;
}

/** Card «Лицевые счета» */
export interface ClubRevenuePersonalBlock {
  depositsMinor: number;
  creditsMinor: number;
  burnsMinor: number;
}

export interface ClubRevenueSummary {
  sales: ClubRevenueSalesBlock;
  revenue: ClubRevenueCashBlock;
  personalAccount: ClubRevenuePersonalBlock;
  /** @deprecated keep for older clients */
  incomeMinor?: number;
  paymentsMinor?: number;
  depositsMinor?: number;
  refundsMinor?: number;
  personalCreditsMinor?: number;
  personalBurnsMinor?: number;
  soldMinor?: number;
  unpaidMinor?: number;
  byPaymentMethod?: ClubRevenuePaymentSplit;
}

export interface ClubRevenueManualEntryDto {
  id: string;
  kind: ClubRevenueManualKind;
  amountMinor: number;
  entryDate: string;
  note: string | null;
  createdAt: string;
}

export interface ClubRevenueEmployeeOption {
  employeeExternalId: string;
  employeeName: string;
}

export interface ClubRevenueReportResponse {
  from: string;
  to: string;
  summary: ClubRevenueSummary;
  lines: ClubRevenueLineDto[];
  employees: ClubRevenueEmployeeOption[];
  manualEntries: ClubRevenueManualEntryDto[];
  currency: string;
  hint?: string;
  lastSyncedAt?: string | null;
}

export interface ClubRevenueDetailResponse {
  line: ClubRevenueLineDto;
  related: ClubRevenueLineDto[];
  currency: string;
}
