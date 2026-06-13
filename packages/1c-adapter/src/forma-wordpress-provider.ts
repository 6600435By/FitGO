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
  FormaWordPressConfig,
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

/**
 * Proxies Forma API calls through WordPress planvueplugin AJAX handlers.
 * Use when 1C is only reachable from the club's WordPress server.
 */
export class FormaWordPressProxyProvider implements IFitnessClubProvider {
  private readonly tokenCache = new Map<string, string>();

  constructor(private readonly config: FormaWordPressConfig) {}

  private async wpRequest<T = unknown>(
    params: Record<string, string>,
  ): Promise<T> {
    const response = await fetch(this.config.ajaxUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });

    const text = await response.text();
    let body: { data?: T; message?: string; error?: string } & Partial<T>;
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new Error(
        `WordPress proxy error ${response.status}: ${text.slice(0, 200)}`,
      );
    }

    if (!response.ok) {
      throw new Error(
        body.message ?? body.error ?? `WordPress proxy error ${response.status}`,
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

    const auth = await this.wpRequest<FormaAuthData>({
      action: 'authClient',
      phone,
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
    _clubExternalId: string,
    filters?: ScheduleFilters,
  ): Promise<ScheduleSlot[]> {
    const { startDate, endDate } = buildScheduleRange(filters);
    const params: Record<string, string> = {
      action: 'getGroups',
      start_date: startDate,
      end_date: endDate,
    };

    if (filters?.trainerId) {
      params.employee_id = filters.trainerId;
    }

    if (filters?.serviceId) {
      params.service_id = filters.serviceId;
    }

    const items = await this.wpRequest<FormaClassItem[]>(params);
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
      await this.wpRequest({
        action: 'clientToClass',
        appointment_id: sessionId,
        user_token: userToken,
      });
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
      await this.wpRequest({
        action: 'clientFromClass',
        appointment_id: sessionId,
        user_token: userToken,
      });
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
