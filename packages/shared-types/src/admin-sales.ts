/** Desk sales cache for admin motivation / «Мои продажи». */

export type AdminSaleType = 'membership' | 'massage' | 'solarium' | 'shop';

export type AdminSalePaymentFilter = 'all' | 'paid' | 'unpaid';

export type MembershipSalesAttribution = 'individual' | 'shiftShare';

export interface AdminSaleLineDto {
  id: string;
  externalSaleId: string;
  soldAt: string;
  paidAt: string | null;
  amountMinor: number;
  /** Amount after shift split (membership only); equals amountMinor when individual. */
  attributedMinor: number;
  saleType: AdminSaleType;
  productName: string | null;
  clientName: string | null;
  employeeExternalId: string | null;
  employeeName: string | null;
  paid: boolean;
}

export interface AdminSalesTotals {
  membershipPaidMinor: number;
  massagePaidMinor: number;
  solariumPaidMinor: number;
  shopPaidMinor: number;
  unpaidMinor: number;
  /** Accrual = paid × % (with attribution already applied). */
  accrualMembershipMinor: number;
  accrualExtraMinor: number;
  accrualShopMinor: number;
  accrualTotalMinor: number;
}

export interface AdminMySalesResponse {
  from: string;
  to: string;
  attribution: MembershipSalesAttribution;
  attributionLabel: string;
  totals: AdminSalesTotals;
  lines: AdminSaleLineDto[];
  currency: string;
  hint?: string;
}

export interface AdminSalesStaffRow {
  userId: string;
  name: string;
  employeeCode: string | null;
  attribution: MembershipSalesAttribution;
  attributionLabel: string;
  membershipPaidMinor: number;
  massagePaidMinor: number;
  solariumPaidMinor: number;
  shopPaidMinor: number;
  unpaidMinor: number;
  accrualTotalMinor: number;
}

export interface AdminSalesOverviewResponse {
  from: string;
  to: string;
  rows: AdminSalesStaffRow[];
  currency: string;
  hint?: string;
}

export interface AdminSalesStaffDetailResponse {
  userId: string;
  name: string;
  from: string;
  to: string;
  attribution: MembershipSalesAttribution;
  attributionLabel: string;
  totals: AdminSalesTotals;
  lines: AdminSaleLineDto[];
  currency: string;
}
