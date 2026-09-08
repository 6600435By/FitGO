import {
  MembershipStatus,
  type AccessCard,
  type Membership,
  type MembershipServiceQuota,
  type Visit,
} from '@fitgo/shared-types';
import { unwrapFormaData } from './forma-shared';
import type { FitgoClientLookup, FitgoHttpConfig, VisitPeriod } from './types';

interface FitgoApiError {
  error?: { code?: number; message?: string };
  message?: string;
}

interface FitgoClientData {
  externalId: string;
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
}

interface FitgoServiceQuotaData {
  name?: string;
  serviceName?: string;
  remaining?: number;
  total?: number;
  unlimited?: boolean;
}

interface FitgoMembershipData {
  id: string;
  name: string;
  status: string;
  visitsRemaining?: number;
  visitsTotal?: number;
  validFrom: string;
  validUntil: string;
  services?: FitgoServiceQuotaData[];
  serviceQuotas?: FitgoServiceQuotaData[];
  accountBalance?: number;
  debtAmount?: number;
  currency?: string;
}

interface FitgoVisitData {
  id: string;
  date: string;
  checkIn?: string;
  checkOut?: string;
  clubName: string;
  title?: string;
}

interface FitgoCardData {
  id: string;
  barcode: string;
  clientName: string;
  clubName: string;
}

export class FitgoHttpProvider {
  constructor(private readonly config: FitgoHttpConfig) {}

  private headers(): Record<string, string> {
    return {
      apikey: this.config.apiKey,
      Authorization: `Basic ${this.config.basicAuth}`,
    };
  }

  private async request<T>(path: string): Promise<T | null> {
    const base = this.config.baseUrl.replace(/\/$/, '');
    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
    const response = await fetch(url, {
      headers: this.headers(),
      signal: AbortSignal.timeout(12_000),
    });
    const text = await response.text();

    let body: FitgoApiError & { data?: T | null };
    try {
      body = JSON.parse(text) as FitgoApiError & { data?: T | null };
    } catch {
      throw new Error(`FitGO 1C API error ${response.status}: ${text}`);
    }

    if (!response.ok) {
      throw new Error(
        body.error?.message ?? body.message ?? `FitGO 1C API error ${response.status}`,
      );
    }

    return unwrapFormaData<T | null>(body);
  }

  private clientQuery(externalId: string): string {
    return `/client?externalId=${encodeURIComponent(externalId)}`;
  }

  async getClientByExternalId(externalId: string): Promise<FitgoClientData | null> {
    return this.request<FitgoClientData>(this.clientQuery(externalId));
  }

  async getClientByPhone(phone: string): Promise<FitgoClientLookup | null> {
    const data = await this.request<FitgoClientData>(
      `/client?phone=${encodeURIComponent(phone)}`,
    );
    if (!data?.externalId) return null;
    return {
      externalId: data.externalId,
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
      email: data.email,
    };
  }

  async getMembership(externalId: string): Promise<Membership | null> {
    const data = await this.request<FitgoMembershipData | null>(
      `/membership?externalId=${encodeURIComponent(externalId)}`,
    );
    if (!data) return null;
    return mapMembership(data);
  }

  async getVisits(externalId: string, period?: VisitPeriod): Promise<Visit[]> {
    const params = new URLSearchParams({ externalId });
    if (period?.from) params.set('from', period.from);
    if (period?.to) params.set('to', period.to);
    const items = await this.request<FitgoVisitData[]>(`/visits?${params.toString()}`);
    return (items ?? []).map(mapVisit);
  }

  async getAccessCard(externalId: string): Promise<AccessCard | null> {
    const data = await this.request<FitgoCardData | null>(
      `/card?externalId=${encodeURIComponent(externalId)}`,
    );
    if (!data) return null;
    return {
      id: data.id,
      barcode: data.barcode,
      clientName: data.clientName,
      clubName: data.clubName,
    };
  }

  async healthCheck(): Promise<boolean> {
    const data = await this.request<{ status: string }>('/health');
    return data?.status === 'ok';
  }
}

function mapMembershipStatus(status: string): MembershipStatus {
  const upper = status.toUpperCase();
  if (upper === 'ACTIVE' || upper === 'АКТИВНЫЙ' || upper === 'АКТИВЕН') {
    return MembershipStatus.ACTIVE;
  }
  if (upper === 'FROZEN' || upper === 'ЗАМОРОЖЕН') {
    return MembershipStatus.FROZEN;
  }
  if (upper === 'EXPIRED' || upper === 'ИСТЁК' || upper === 'ИСТЕК') {
    return MembershipStatus.EXPIRED;
  }
  if (upper === 'PENDING' || upper === 'ОЖИДАНИЕ') {
    return MembershipStatus.PENDING;
  }
  return MembershipStatus.ACTIVE;
}

function mapServiceQuota(raw: FitgoServiceQuotaData): MembershipServiceQuota | null {
  const name = raw.name ?? raw.serviceName;
  if (!name) return null;
  return {
    name,
    remaining: raw.remaining,
    total: raw.total,
    unlimited: raw.unlimited,
  };
}

function coerceOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function mapMembership(data: FitgoMembershipData): Membership {
  const rawServices = data.services ?? data.serviceQuotas ?? [];
  const services = rawServices
    .map(mapServiceQuota)
    .filter((s): s is MembershipServiceQuota => s !== null);

  return {
    id: data.id,
    name: data.name,
    status: mapMembershipStatus(data.status),
    visitsRemaining: data.visitsRemaining,
    visitsTotal: data.visitsTotal,
    validFrom: data.validFrom,
    validUntil: data.validUntil,
    services: services.length > 0 ? services : undefined,
    accountBalance: coerceOptionalNumber(data.accountBalance),
    debtAmount: coerceOptionalNumber(data.debtAmount),
    currency: data.currency,
  };
}

function mapVisit(data: FitgoVisitData): Visit {
  return {
    id: data.id,
    date: data.date,
    checkIn: data.checkIn,
    checkOut: data.checkOut,
    clubName: data.clubName,
    title: data.title,
    source: '1c',
  };
}
