import { MembershipStatus, type AccessCard, type Membership, type Visit } from '@fitgo/shared-types';
import { unwrapFormaData } from './forma-shared';
import type { FitgoHttpConfig, VisitPeriod } from './types';

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

interface FitgoMembershipData {
  id: string;
  name: string;
  status: string;
  visitsRemaining?: number;
  visitsTotal?: number;
  validFrom: string;
  validUntil: string;
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
    const response = await fetch(url, { headers: this.headers() });
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

  async getClientByPhone(phone: string): Promise<FitgoClientData | null> {
    return this.request<FitgoClientData>(
      `/client?phone=${encodeURIComponent(phone)}`,
    );
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

function mapMembership(data: FitgoMembershipData): Membership {
  return {
    id: data.id,
    name: data.name,
    status: mapMembershipStatus(data.status),
    visitsRemaining: data.visitsRemaining,
    visitsTotal: data.visitsTotal,
    validFrom: data.validFrom,
    validUntil: data.validUntil,
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
