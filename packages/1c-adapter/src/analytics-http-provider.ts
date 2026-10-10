import { RequestGate } from './request-gate';
import type { FitgoHttpConfig } from './types';

/** Analytics reports are heavy — keep at most 2 concurrent to 1C. */
const analyticsGate = new RequestGate(2);

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

/** Default timeout for heavy /sales reports (1C can take tens of seconds). */
const DEFAULT_TIMEOUT_MS = 90_000;
const HEALTH_TIMEOUT_MS = 12_000;

export class FitgoAnalyticsHttpProvider {
  constructor(private readonly config: FitgoAnalyticsConfig) {}

  private headers(): Record<string, string> {
    return {
      apikey: this.config.apiKey,
      Authorization: `Basic ${this.config.basicAuth}`,
    };
  }

  private async request<T>(
    path: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<T | null> {
    const flightKey = `${this.config.baseUrl}|GET|${path}`;
    return analyticsGate.run(flightKey, () =>
      this.requestRaw<T>(path, timeoutMs),
    );
  }

  private async requestRaw<T>(
    path: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<T | null> {
    const base = this.config.baseUrl.replace(/\/$/, '');
    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
    let response: Response;
    try {
      response = await fetch(url, {
        headers: this.headers(),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new Error(
          `FitGO Analytics API timeout after ${timeoutMs}ms: ${path}`,
        );
      }
      throw err;
    }
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
    const data = await this.request<{ status: string }>(
      '/health',
      HEALTH_TIMEOUT_MS,
    );
    return data?.status === 'ok';
  }

  async getSales(params: {
    from: string;
    to: string;
    saleType?: string;
    employeeId?: string;
    page?: number;
    pageSize?: number;
    /** cash | debt | changes | installments | members */
    scope?: 'cash' | 'debt' | 'changes' | 'installments' | 'members';
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

  /** Club hall visits: Документ.Посещение. Needs published template /v1/stats/visits. */
  async getVisitCount(params: {
    from: string;
    to: string;
  }): Promise<number | null> {
    const q = new URLSearchParams({ from: params.from, to: params.to });
    const data = await this.request<{ count?: number }>(
      `/stats/visits?${q.toString()}`,
    );
    if (!data || typeof data.count !== 'number') return null;
    return data.count;
  }

  /**
   * Open installment schedules (sale + plan/fact payments).
   * Requires published Analytics `scope=installments`.
   */
  /**
   * Open installment schedules. Returns null when Analytics is down or
   * `ПолучитьРассрочки` is not published yet (never throws).
   * Short timeout so club analytics is not blocked by a hanging 1C call.
   */
  async getInstallments(): Promise<FitgoInstallmentSale[] | null> {
    const today = new Date().toISOString().slice(0, 10);
    const q = new URLSearchParams({
      from: '2020-01-01',
      to: today,
      scope: 'installments',
    });
    try {
      const data = await this.request<{
        items?: FitgoInstallmentSale[];
        error?: string | { message?: string };
      }>(`/sales?${q.toString()}`, 12_000);
      if (!data) return null;
      if (data.error && !data.items?.length) return null;
      return data.items ?? [];
    } catch {
      return null;
    }
  }

  /**
   * Club membership counters (active/frozen/expiring/ended).
   * Requires published Analytics `scope=members`.
   */
  async getMembersSummary(params: {
    from: string;
    to: string;
  }): Promise<FitgoMembersSummary | null> {
    const q = new URLSearchParams({
      from: params.from,
      to: params.to,
      scope: 'members',
    });
    try {
      const data = await this.request<FitgoMembersSummary & {
        error?: string | { message?: string };
      }>(`/sales?${q.toString()}`, 20_000);
      if (!data) return null;
      if (data.error && data.active == null) return null;
      return {
        active: Number(data.active) || 0,
        frozen: Number(data.frozen) || 0,
        expiring7: Number(data.expiring7) || 0,
        expiring30: Number(data.expiring30) || 0,
        endedInPeriod: Number(data.endedInPeriod) || 0,
        endedClientIds: Array.isArray(data.endedClientIds)
          ? data.endedClientIds.map(String)
          : [],
        asOf: data.asOf ?? params.to,
        from: data.from ?? params.from,
      };
    } catch {
      return null;
    }
  }
}

export interface FitgoMembersSummary {
  active: number;
  frozen: number;
  expiring7: number;
  expiring30: number;
  endedInPeriod: number;
  endedClientIds: string[];
  asOf?: string;
  from?: string;
}

export interface FitgoInstallmentPayment {
  n: number;
  planDate: string;
  planAmount: number;
  factDate?: string | null;
  factAmount?: number | null;
}

export interface FitgoInstallmentSale {
  saleDocumentId: string;
  number?: string;
  soldAt?: string;
  clientExternalId?: string;
  clientName?: string;
  phone?: string;
  templateName?: string;
  total?: number;
  payments: FitgoInstallmentPayment[];
}

export type {
  FitgoAnalyticsSalesItem,
  FitgoAnalyticsSalesPage,
  FitgoAnalyticsEmployeesStats,
  FitgoAnalyticsRevenue,
};
