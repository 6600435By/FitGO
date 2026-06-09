import {
  MembershipStatus,
  UserRole,
  type AccessCard,
  type AtRiskClient,
  type Booking,
  type ClubTheme,
  type GamificationProfile,
  type Membership,
  type MembershipProduct,
  type PaymentResult,
  type ReferralInfo,
  type ScheduleSlot,
  type TrainerClientDetail,
  type Visit,
  type WearableSyncResult,
} from '@fitgo/shared-types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface AuthUser {
  id: string;
  externalId?: string;
  clubId: string;
  email: string;
  phone?: string;
  firstName: string;
  lastName: string;
  roles: UserRole[];
  club?: {
    id: string;
    name: string;
    slug: string;
    address?: string;
  };
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

export interface ClientDashboard {
  profile: AuthUser;
  membership: Membership | null;
  visits: Visit[];
  accessCard: AccessCard;
  club: {
    id: string;
    name: string;
    slug: string;
    address?: string;
  } | null;
}

export interface TrainerClientSummary {
  id: string;
  externalId?: string;
  firstName: string;
  lastName: string;
  phone?: string;
  membershipName?: string;
  membershipStatus?: MembershipStatus;
  lastVisit?: string;
}

export interface TrainerDashboard {
  trainer: {
    id: string;
    externalId: string;
    firstName: string;
    lastName: string;
  };
  schedule: ScheduleSlot[];
  clients: TrainerClientSummary[];
  stats: {
    clientsCount: number;
    sessionsToday: number;
    upcomingSessions: number;
  };
}

export interface DailyReport {
  id: string;
  date: string;
  revenue: number;
  problems?: string | null;
  ideas?: string | null;
}

export interface AdminDashboard {
  club: {
    id: string;
    name: string;
    slug: string;
    address?: string;
    currency?: string;
  } | null;
  stats: {
    activeMemberships: number;
    visitsToday: number;
    revenueToday: number;
    expiringSoon: number;
    bookingsToday: number;
  };
  expiringClients: Array<{
    id: string;
    name: string;
    membership: string;
    validUntil: string;
    daysLeft: number;
  }>;
  funnel: Array<{
    stage: string;
    count: number;
  }>;
  recentReports: DailyReport[];
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}/api${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message ?? `Ошибка ${response.status}`);
  }

  return response.json();
}

export const api = {
  login: (email: string, password: string) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  me: (token: string) => request<AuthUser>('/auth/me', {}, token),

  clientDashboard: (token: string) =>
    request<ClientDashboard>('/client/dashboard', {}, token),

  clientSchedule: (token: string) =>
    request<ScheduleSlot[]>('/client/schedule', {}, token),

  clientBookings: (token: string) =>
    request<Booking[]>('/client/bookings', {}, token),

  clientBook: (token: string, sessionId: string) =>
    request<{ success: boolean; message?: string }>(
      '/client/book',
      { method: 'POST', body: JSON.stringify({ sessionId }) },
      token,
    ),

  clientCancelBooking: (token: string, sessionId: string) =>
    request<{ success: boolean; message?: string }>(
      `/client/bookings/${sessionId}`,
      { method: 'DELETE' },
      token,
    ),

  clientProducts: (token: string) =>
    request<MembershipProduct[]>('/client/products', {}, token),

  clientPayment: (token: string, productId: string) =>
    request<PaymentResult>(
      '/client/payment',
      { method: 'POST', body: JSON.stringify({ productId }) },
      token,
    ),

  trainerDashboard: (token: string) =>
    request<TrainerDashboard>('/trainer/dashboard', {}, token),

  trainerClient: (token: string, clientId: string) =>
    request<TrainerClientDetail>(`/trainer/clients/${clientId}`, {}, token),

  trainerAddNote: (token: string, clientId: string, content: string) =>
    request(`/trainer/clients/${clientId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }, token),

  trainerAddGoal: (
    token: string,
    clientId: string,
    data: { title: string; target?: string; progress?: string },
  ) =>
    request(`/trainer/clients/${clientId}/goals`, {
      method: 'POST',
      body: JSON.stringify(data),
    }, token),

  trainerAddMeasurement: (
    token: string,
    clientId: string,
    data: { weight?: number; notes?: string },
  ) =>
    request(`/trainer/clients/${clientId}/measurements`, {
      method: 'POST',
      body: JSON.stringify(data),
    }, token),

  trainerSendMessage: (token: string, clientId: string, message: string) =>
    request(`/trainer/clients/${clientId}/message`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }, token),

  adminDashboard: (token: string) =>
    request<AdminDashboard>('/admin/dashboard', {}, token),

  adminAtRisk: (token: string) =>
    request<AtRiskClient[]>('/admin/at-risk', {}, token),

  adminClubs: (token: string) =>
    request<Array<{
      id: string;
      name: string;
      slug: string;
      address?: string;
      currency: string;
      primaryColor: string;
    }>>('/admin/clubs', {}, token),

  adminSendReminder: (token: string, clientUserId: string, message?: string) =>
    request(`/admin/remind/${clientUserId}`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }, token),

  createDailyReport: (
    token: string,
    data: { date: string; revenue: number; problems?: string; ideas?: string },
  ) =>
    request<DailyReport>('/admin/daily-report', {
      method: 'POST',
      body: JSON.stringify(data),
    }, token),

  notifications: (token: string) =>
    request<NotificationItem[]>('/notifications', {}, token),

  markNotificationRead: (token: string, id: string) =>
    request(`/notifications/${id}/read`, { method: 'PATCH' }, token),

  subscribePush: (
    token: string,
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  ) =>
    request('/notifications/subscribe', {
      method: 'POST',
      body: JSON.stringify(subscription),
    }, token),

  gamification: (token: string) =>
    request<GamificationProfile>('/engagement/gamification', {}, token),

  referral: (token: string) =>
    request<ReferralInfo>('/engagement/referral', {}, token),

  clubTheme: (token: string) =>
    request<ClubTheme>('/engagement/theme', {}, token),

  updateClubTheme: (
    token: string,
    data: { logoUrl?: string; primaryColor?: string },
  ) =>
    request('/engagement/theme', {
      method: 'POST',
      body: JSON.stringify(data),
    }, token),

  leaderboard: (token: string) =>
    request<Array<{ rank: number; name: string; points: number }>>(
      '/engagement/leaderboard',
      {},
      token,
    ),

  syncWearable: (token: string, provider: string) =>
    request<WearableSyncResult>(
      `/engagement/wearables/${provider}/sync`,
      { method: 'POST' },
      token,
    ),
};
