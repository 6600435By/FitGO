/** «Тренер клуб» personal ledger (Мои оплаты). */

export type PtBookingFlow = 'CLUB' | 'PERSONAL';

export type TrainerPaymentMethod = 'CASH' | 'TRANSFER' | 'CARD';

export type TrainerPaymentKind =
  | 'PACKAGE_SALE'
  | 'SESSION'
  | 'DEBT_PAYMENT'
  | 'OTHER';

export type TrainerOwnPackageStatus =
  | 'ACTIVE'
  | 'EXHAUSTED'
  | 'EXPIRED'
  | 'CANCELLED';

export interface TrainerOwnPackageTemplate {
  id: string;
  title: string;
  sessionsCount: number;
  priceMinor: number;
  validityDays?: number | null;
  isActive: boolean;
}

export interface TrainerClientPackageView {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  sessionsTotal: number;
  sessionsRemaining: number;
  priceMinor: number;
  paidMinor: number;
  validUntil?: string | null;
  status: TrainerOwnPackageStatus;
  soldAt: string;
}

export interface TrainerClientPaymentView {
  id: string;
  clientId: string;
  clientName: string;
  amountMinor: number;
  method: TrainerPaymentMethod;
  kind: TrainerPaymentKind;
  paidAt: string;
  comment?: string | null;
  packageId?: string | null;
  bookingId?: string | null;
}

export interface TrainerLedgerDebtor {
  clientId: string;
  clientName: string;
  debtMinor: number;
  activePackage?: {
    id: string;
    title: string;
    sessionsRemaining: number;
    validUntil?: string | null;
  } | null;
}

export interface TrainerLedgerClientSnapshot {
  clientId: string;
  clientName: string;
  debtMinor: number;
  /** Client override; null → use trainer default. */
  sessionPriceMinor?: number | null;
  defaultSessionPriceMinor?: number | null;
  /** sessionPriceMinor ?? defaultSessionPriceMinor */
  effectiveSessionPriceMinor?: number | null;
  activePackage?: TrainerClientPackageView | null;
  packages: TrainerClientPackageView[];
  payments: TrainerClientPaymentView[];
}

export interface TrainerLedgerOverview {
  monthEarnedMinor: number;
  allTimeEarnedMinor: number;
  expectedMinor: number;
  debtorsCount: number;
  debtorsTotalMinor: number;
  activePackagesCount: number;
  defaultSessionPriceMinor: number | null;
  /** Trainer's own debt to the club (1C), display-only. */
  clubDebtMinor: number;
  debtors: TrainerLedgerDebtor[];
  recentPayments: TrainerClientPaymentView[];
  templates: TrainerOwnPackageTemplate[];
  canChoosePtFlow: boolean;
}
