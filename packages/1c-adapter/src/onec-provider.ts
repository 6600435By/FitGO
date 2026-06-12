import type {
  AccessCard,
  AuthCredentials,
  AuthResult,
  Booking,
  Membership,
  MembershipProduct,
  PaymentResult,
  ScheduleSlot,
  UserProfile,
  Visit,
} from '@fitgo/shared-types';
import type { IFitnessClubProvider, OneCConfig, ScheduleFilters, VisitPeriod, BookingContext } from './types';

/**
 * Real 1C:Fitness API provider.
 * Requires published HTTP service and API key from the club's 1C instance.
 * Documentation: https://fitness1cv3.docs.apiary.io
 */
export class OneCFitnessProvider implements IFitnessClubProvider {
  constructor(private readonly config: OneCConfig) {}

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`1C API error ${response.status}: ${body}`);
    }

    return response.json() as Promise<T>;
  }

  async authenticate(credentials: AuthCredentials): Promise<AuthResult | null> {
    try {
      return await this.request<AuthResult>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials),
      });
    } catch {
      return null;
    }
  }

  async getClientProfile(externalId: string): Promise<UserProfile | null> {
    return this.request<UserProfile | null>(`/clients/${externalId}`);
  }

  async getMembership(externalId: string): Promise<Membership | null> {
    return this.request<Membership | null>(`/clients/${externalId}/membership`);
  }

  async getVisits(externalId: string, period?: VisitPeriod): Promise<Visit[]> {
    const params = new URLSearchParams();
    if (period?.from) params.set('from', period.from);
    if (period?.to) params.set('to', period.to);
    const query = params.toString() ? `?${params}` : '';
    return this.request<Visit[]>(`/clients/${externalId}/visits${query}`);
  }

  async getAccessCard(externalId: string): Promise<AccessCard | null> {
    return this.request<AccessCard | null>(`/clients/${externalId}/access-card`);
  }

  async getSchedule(
    clubExternalId: string,
    filters?: ScheduleFilters,
  ): Promise<ScheduleSlot[]> {
    const params = new URLSearchParams();
    if (filters?.from) params.set('from', filters.from);
    if (filters?.to) params.set('to', filters.to);
    if (filters?.trainerId) params.set('trainerId', filters.trainerId);
    if (filters?.type) params.set('type', filters.type);
    const query = params.toString() ? `?${params}` : '';
    return this.request<ScheduleSlot[]>(`/clubs/${clubExternalId}/schedule${query}`);
  }

  async bookSession(externalId: string, sessionId: string, _context?: BookingContext) {
    return this.request<{ success: boolean; message?: string }>(
      `/clients/${externalId}/bookings`,
      {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      },
    );
  }

  async cancelBooking(externalId: string, sessionId: string, _context?: BookingContext) {
    return this.request<{ success: boolean; message?: string }>(
      `/clients/${externalId}/bookings/${sessionId}`,
      { method: 'DELETE' },
    );
  }

  async getBookings(externalId: string, _context?: BookingContext): Promise<Booking[]> {
    return this.request<Booking[]>(`/clients/${externalId}/bookings`);
  }

  async getMembershipProducts(clubExternalId: string): Promise<MembershipProduct[]> {
    return this.request<MembershipProduct[]>(`/clubs/${clubExternalId}/products`);
  }

  async createPayment(externalId: string, productId: string): Promise<PaymentResult> {
    return this.request<PaymentResult>(`/clients/${externalId}/payments`, {
      method: 'POST',
      body: JSON.stringify({ productId }),
    });
  }

  async getAllClientsMemberships(clubExternalId: string) {
    return this.request<Array<{
      externalId: string;
      firstName: string;
      lastName: string;
      email?: string;
      membershipName?: string;
      membershipStatus?: string;
      validUntil?: string;
      lastVisit?: string;
    }>>(`/clubs/${clubExternalId}/clients`);
  }
}
