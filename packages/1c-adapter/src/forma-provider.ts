import {
  SessionType,
  type AccessCard,
  type AuthCredentials,
  type AuthResult,
  type Booking,
  type Membership,
  type MembershipProduct,
  type PaymentResult,
  type ScheduleSlot,
  type UserProfile,
  type Visit,
} from '@fitgo/shared-types';
import type {
  BookingContext,
  FormaConfig,
  IFitnessClubProvider,
  ScheduleFilters,
  VisitPeriod,
} from './types';
import {
  buildScheduleRange,
  mapFormaClass,
  normalizePhone,
  unwrapFormaData,
  type FormaAuthData,
  type FormaClassItem,
} from './forma-shared';

interface FormaResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export class FormaFitnessProvider implements IFitnessClubProvider {
  private readonly tokenCache = new Map<string, string>();

  constructor(private readonly config: FormaConfig) {}

  private headers(userToken?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Basic ${this.config.basicAuth}`,
      apikey: this.config.apiKey,
    };
    if (userToken) {
      headers.usertoken = userToken;
    }
    return headers;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
    userToken?: string,
  ): Promise<T> {
    const base = this.config.baseUrl.replace(/\/$/, '');
    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.headers(userToken),
        ...(options.headers as Record<string, string>),
      },
    });

    const text = await response.text();
    let body: FormaResponse<T> & T;
    try {
      body = JSON.parse(text) as FormaResponse<T> & T;
    } catch {
      throw new Error(`Forma API error ${response.status}: ${text}`);
    }

    if (!response.ok) {
      throw new Error(
        body.message ?? body.error ?? `Forma API error ${response.status}`,
      );
    }

    return unwrapFormaData<T>(body);
  }

  private async resolveUserToken(context?: BookingContext): Promise<string> {
    if (!context?.phone) {
      throw new Error('Для записи через 1С необходим номер телефона в профиле');
    }

    const phone = normalizePhone(context.phone);
    const cached = this.tokenCache.get(phone);
    if (cached) return cached;

    const password = this.config.defaultPassword;
    if (!password) {
      throw new Error('Не настроен пароль для авторизации клиентов в 1С');
    }

    const auth = await this.request<FormaAuthData>('/auth_client/', {
      method: 'POST',
      body: JSON.stringify({ phone, password }),
    });

    if (!auth.user_token) {
      throw new Error('Не удалось авторизовать клиента в 1С. Проверьте номер телефона.');
    }

    this.tokenCache.set(phone, auth.user_token);
    return auth.user_token;
  }

  async authenticate(_credentials: AuthCredentials): Promise<AuthResult | null> {
    return null;
  }

  async getClientProfile(_externalId: string): Promise<UserProfile | null> {
    return null;
  }

  async getMembership(_externalId: string): Promise<Membership | null> {
    return null;
  }

  async getVisits(_externalId: string, _period?: VisitPeriod): Promise<Visit[]> {
    return [];
  }

  async getAccessCard(_externalId: string): Promise<AccessCard | null> {
    return null;
  }

  async getSchedule(
    clubExternalId: string,
    filters?: ScheduleFilters,
  ): Promise<ScheduleSlot[]> {
    const { startDate, endDate } = buildScheduleRange(filters);
    const params = new URLSearchParams({
      club_id: clubExternalId,
      start_date: startDate,
      end_date: endDate,
    });

    if (filters?.trainerId) {
      params.set('employee_id', filters.trainerId);
    }

    const items = await this.request<FormaClassItem[]>(
      `/classes/?${params.toString()}`,
      { method: 'GET' },
    );

    let slots = (Array.isArray(items) ? items : []).map(mapFormaClass);

    if (filters?.type === SessionType.PERSONAL) {
      slots = [];
    }

    return slots.sort((a, b) => a.startAt.localeCompare(b.startAt));
  }

  async bookSession(
    _externalId: string,
    sessionId: string,
    context?: BookingContext,
  ) {
    try {
      const userToken = await this.resolveUserToken(context);
      await this.request(
        '/client_to_class/',
        {
          method: 'POST',
          body: JSON.stringify({ appointment_id: sessionId }),
        },
        userToken,
      );
      return { success: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Не удалось записаться';
      return { success: false, message };
    }
  }

  async cancelBooking(
    _externalId: string,
    sessionId: string,
    context?: BookingContext,
  ) {
    try {
      const userToken = await this.resolveUserToken(context);
      const params = new URLSearchParams({ appointment_id: sessionId });
      await this.request(
        `/client_from_class/?${params.toString()}`,
        { method: 'DELETE' },
        userToken,
      );
      return { success: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Не удалось отменить запись';
      return { success: false, message };
    }
  }

  async getBookings(_externalId: string, _context?: BookingContext): Promise<Booking[]> {
    return [];
  }

  async getMembershipProducts(_clubExternalId: string): Promise<MembershipProduct[]> {
    return [];
  }

  async createPayment(_externalId: string, _productId: string): Promise<PaymentResult> {
    return {
      id: 'forma-unavailable',
      status: 'failed',
      amount: 0,
      currency: 'BYN',
    };
  }
}
