import type { FitgoHttpConfig } from './types';

interface FitgoAnalyticsSalesItem {
  saleDocumentId: string;
  documentId?: string;
  operationType?: string;
  soldAt: string;
  paidAt?: string;
  amount: number;
  saleAmount?: number;
  paidAmount?: number;
  refundAmount?: number;
  cash?: number;
  card?: number;
  cashless?: number;
  personalAccount?: number;
  amountAttributed?: number;
  attributionMode?: string;
  saleType: string;
  productName: string;
  clientExternalId?: string;
  clientName?: string;
  employeeExternalId?: string;
  employeeName?: string;
  paymentMethod?: string;
  countsTowardIncome?: boolean;
  countsTowardMotivation?: boolean;
}

interface FitgoAnalyticsSalesPage {
  items: FitgoAnalyticsSalesItem[];
  page: number;
  pageSize: number;
  total: number;
}

interface FitgoAnalyticsEmployeesStats {
  from: string;
  to: string;
  items: Array<{
    employeeExternalId: string;
    employeeName: string;
    salesCount: number;
    salesAmount: number;
    netAmount: number;
    bySaleType?: Record<string, number>;
  }>;
}

interface FitgoAnalyticsRevenue {
  from: string;
  to: string;
  grossAmount: number;
  refundAmount: number;
  netAmount: number;
  byPaymentMethod?: Record<string, number>;
  bySaleType?: Record<string, number>;
}

export interface FitgoAnalyticsConfig extends FitgoHttpConfig {
  baseUrl: string;
}

export class FitgoAnalyticsHttpProvider {
  constructor(private readonly config: FitgoAnalyticsConfig) {}

  private headers(): Record<string, string> {
    return {
      apikey: this.config.apiKey,
      Authorization: `Basic ${this.config.basicAuth}`,
    };
  }

  private async request<T>(path: string): Promise<T | null> {
    const base = this.config.baseUrl.replace(/\/$/, '');
    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
    const response = await fetch(url, { headers: this.headers() });
    const text = await response.text();

    let body: { data?: T | null; error?: { message?: string } };
    try {
      body = JSON.parse(text) as { data?: T | null; error?: { message?: string } };
    } catch {
      throw new Error(`FitGO Analytics API error ${response.status}: ${text}`);
    }

    if (!response.ok) {
      throw new Error(body.error?.message ?? `FitGO Analytics API error ${response.status}`);
    }

    return body.data ?? null;
  }

  async healthCheck(): Promise<boolean> {
    const data = await this.request<{ status: string }>('/health');
    return data?.status === 'ok';
  }

  async getSales(params: {
    from: string;
    to: string;
    saleType?: string;
    employeeId?: string;
    page?: number;
    pageSize?: number;
    /** cash = сводный отчёт по выручке; debt = открытые остатки долга; changes = журнал */
    scope?: 'cash' | 'debt' | 'changes';
  }): Promise<FitgoAnalyticsSalesPage | null> {
    const q = new URLSearchParams({
      from: params.from,
      to: params.to,
    });
    if (params.saleType) q.set('saleType', params.saleType);
    if (params.employeeId) q.set('employeeId', params.employeeId);
    if (params.scope) q.set('scope', params.scope);
    if (params.page) q.set('page', String(params.page));
    // pageSize=0 means «everything in one response»; must reach 1C, not be dropped as falsy.
    if (params.pageSize != null) q.set('pageSize', String(params.pageSize));
    return this.request<FitgoAnalyticsSalesPage>(`/sales?${q.toString()}`);
  }

  async getEmployeeStats(params: {
    from: string;
    to: string;
    saleType?: string;
  }): Promise<FitgoAnalyticsEmployeesStats | null> {
    const q = new URLSearchParams({ from: params.from, to: params.to });
    if (params.saleType) q.set('saleType', params.saleType);
    return this.request<FitgoAnalyticsEmployeesStats>(`/stats/employees?${q.toString()}`);
  }

  async getRevenue(params: {
    from: string;
    to: string;
    saleType?: string;
    groupBy?: 'paymentMethod' | 'saleType' | 'day';
  }): Promise<FitgoAnalyticsRevenue | null> {
    const q = new URLSearchParams({ from: params.from, to: params.to });
    if (params.saleType) q.set('saleType', params.saleType);
    if (params.groupBy) q.set('groupBy', params.groupBy);
    return this.request<FitgoAnalyticsRevenue>(`/stats/revenue?${q.toString()}`);
  }
}

export type {
  FitgoAnalyticsSalesItem,
  FitgoAnalyticsSalesPage,
  FitgoAnalyticsEmployeesStats,
  FitgoAnalyticsRevenue,
};
