import { UserRole } from '@fitgo/shared-types';
import type {
  PayrollPeriodSummary,
  SpaBooking,
  SpaService,
  SpecialistCalendarResponse,
  SpecialistWorkSlotInput,
} from '@fitgo/shared-types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: UserRole[];
  clubId?: string;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_URL}/api${path}`, { ...options, headers });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      if (Array.isArray(body.message)) message = body.message.join(', ');
      else if (body.message) message = body.message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  login: (email: string, password: string) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  me: (token: string) => request<AuthUser>('/auth/me', {}, token),

  getStaffSyncStatus: (token: string) =>
    request<{
      dataAsOf: string | null;
      freshness: 'green' | 'yellow' | 'red';
      sourceLabel: string | null;
      running: {
        startedAt: string;
        triggeredByName: string | null;
        trigger: string;
      } | null;
    }>('/staff/sync/status', {}, token),

  specialistCalendar: (token: string, from: string, to: string) =>
    request<SpecialistCalendarResponse>(
      `/specialist/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      {},
      token,
    ),

  specialistWorkSchedule: (token: string) =>
    request<SpecialistWorkSlotInput[]>('/specialist/work-schedule', {}, token),

  specialistSetWorkSchedule: (
    token: string,
    slots: SpecialistWorkSlotInput[],
  ) =>
    request<SpecialistWorkSlotInput[]>('/specialist/work-schedule', {
      method: 'PUT',
      body: JSON.stringify({ slots }),
    }, token),

  specialistFillFromTemplate: (
    token: string,
    periodStart: string,
    periodEnd: string,
  ) =>
    request('/specialist/schedule/fill-from-template', {
      method: 'POST',
      body: JSON.stringify({ periodStart, periodEnd }),
    }, token),

  specialistPublishSchedule: (
    token: string,
    periodStart: string,
    periodEnd: string,
  ) =>
    request<{ publishedBlocks: number }>('/specialist/schedule/publish', {
      method: 'POST',
      body: JSON.stringify({ periodStart, periodEnd }),
    }, token),

  specialistSpaBookings: (token: string) =>
    request<SpaBooking[]>('/specialist/spa-bookings', {}, token),

  specialistOwnServices: (token: string) =>
    request<SpaService[]>('/specialist/spa/services', {}, token),

  spaClients: (token: string) =>
    request<Array<{ id: string; firstName: string; lastName: string }>>(
      '/admin/spa/clients',
      {},
      token,
    ),

  specialistAssignSpaBooking: (
    token: string,
    body: {
      clientId: string;
      serviceId: string;
      startAt: string;
      paymentType: 'QUOTA' | 'PAID';
    },
  ) =>
    request<SpaBooking>('/specialist/spa-bookings', {
      method: 'POST',
      body: JSON.stringify(body),
    }, token),

  specialistCompleteSpaBooking: (token: string, bookingId: string) =>
    request(`/specialist/spa-bookings/${bookingId}/complete`, {
      method: 'POST',
    }, token),

  specialistPayrollSummary: (token: string, from: string, to: string) =>
    request<PayrollPeriodSummary>(
      `/specialist/payroll/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      {},
      token,
    ),

  bookingControlList: (
    token: string,
    params: { from: string; to: string; needsReview?: boolean },
  ) => {
    const q = new URLSearchParams({
      from: params.from,
      to: params.to,
      kind: 'SPA',
    });
    if (params.needsReview) q.set('needsReview', '1');
    return request<
      import('@fitgo/shared-types').BookingControlListItem[]
    >(`/specialist/booking-control?${q}`, {}, token);
  },

  bookingControlDetail: (token: string, sessionKey: string) =>
    request<import('@fitgo/shared-types').BookingControlDetail>(
      `/specialist/booking-control?sessionKey=${encodeURIComponent(sessionKey)}`,
      {},
      token,
    ),

  bookingControlRemark: (
    token: string,
    sessionKey: string,
    comment: string,
  ) =>
    request(`/specialist/booking-control/remark`, {
      method: 'POST',
      body: JSON.stringify({ sessionKey, comment }),
    }, token),
};
