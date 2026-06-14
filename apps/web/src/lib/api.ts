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
  type PersonalTrainingBookingItem,
  type TrainerSummary,
  type TrainerWorkSlotInput,
  type PersonalTrainingSlot,
  type WearableSyncResult,
  type ConversationSummary,
  type ChatMessageItem,
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
  accessCard: AccessCard | null;
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
  status: 'PENDING' | 'COMPLETED';
  senderName?: string;
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

  clientSchedule: (
    token: string,
    params?: {
      from?: string;
      to?: string;
      serviceId?: string;
      trainerId?: string;
    },
  ) => {
    const search = new URLSearchParams();
    if (params?.from) search.set('from', params.from);
    if (params?.to) search.set('to', params.to);
    if (params?.serviceId) search.set('serviceId', params.serviceId);
    if (params?.trainerId) search.set('trainerId', params.trainerId);
    const query = search.toString() ? `?${search}` : '';
    return request<ScheduleSlot[]>(`/client/schedule${query}`, {}, token);
  },

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

  clientTrainers: (token: string) =>
    request<TrainerSummary[]>('/client/trainers', {}, token),

  clientTrainerSlots: (
    token: string,
    trainerId: string,
    from?: string,
    to?: string,
  ) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const query = params.toString() ? `?${params}` : '';
    return request<PersonalTrainingSlot[]>(
      `/client/trainers/${trainerId}/slots${query}`,
      {},
      token,
    );
  },

  clientBookPersonal: (token: string, trainerId: string, startAt: string) =>
    request<PersonalTrainingBookingItem>(
      '/client/personal-bookings',
      { method: 'POST', body: JSON.stringify({ trainerId, startAt }) },
      token,
    ),

  clientPersonalBookings: (token: string) =>
    request<PersonalTrainingBookingItem[]>(
      '/client/personal-bookings',
      {},
      token,
    ),

  clientCancelPersonalBooking: (token: string, bookingId: string) =>
    request<{ success: boolean }>(
      `/client/personal-bookings/${bookingId}`,
      { method: 'DELETE' },
      token,
    ),

  trainerWorkSchedule: (token: string) =>
    request<TrainerWorkSlotInput[]>('/trainer/work-schedule', {}, token),

  trainerSetWorkSchedule: (token: string, slots: TrainerWorkSlotInput[]) =>
    request<TrainerWorkSlotInput[]>(
      '/trainer/work-schedule',
      { method: 'PUT', body: JSON.stringify({ slots }) },
      token,
    ),

  trainerPersonalBookings: (token: string) =>
    request<
      Array<{
        id: string;
        clientId: string;
        clientName: string;
        startAt: string;
        endAt: string;
        status: string;
      }>
    >('/trainer/personal-bookings', {}, token),

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

  trainerMessageRecipients: (token: string) =>
    request<Array<{ id: string; firstName: string; lastName: string }>>(
      '/trainer/message-recipients',
      {},
      token,
    ),

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

  notifications: (
    token: string,
    filter?: 'all' | 'pending' | 'completed' | 'unread',
  ) => {
    const query =
      filter && filter !== 'all' ? `?filter=${filter}` : '';
    return request<NotificationItem[]>(`/notifications${query}`, {}, token);
  },

  markNotificationRead: (token: string, id: string) =>
    request(`/notifications/${id}/read`, { method: 'PATCH' }, token),

  markNotificationComplete: (token: string, id: string) =>
    request(`/notifications/${id}/complete`, { method: 'PATCH' }, token),

  sendAdminMessage: (token: string, message: string) =>
    request<{ success: boolean; recipients: number }>(
      '/notifications/admin-message',
      { method: 'POST', body: JSON.stringify({ message }) },
      token,
    ),

  sendStaffMessage: (
    token: string,
    data: {
      message: string;
      recipientType: 'admin' | 'trainer';
      trainerId?: string;
    },
  ) =>
    request<{ success: boolean; recipients: number }>(
      '/notifications/staff-message',
      { method: 'POST', body: JSON.stringify(data) },
      token,
    ),

  clientBookingHistory: (
    token: string,
    filter?: 'all' | 'upcoming' | 'completed' | 'cancelled',
  ) => {
    const query = filter && filter !== 'all' ? `?filter=${filter}` : '';
    return request<import('@fitgo/shared-types').Booking[]>(
      `/client/booking-history${query}`,
      {},
      token,
    );
  },

  clientClubTrainers: (token: string) =>
    request<Array<{ id: string; firstName: string; lastName: string }>>(
      '/client/club-trainers',
      {},
      token,
    ),

  chatConversations: (token: string, scope?: 'clients' | 'admin' | 'trainers') => {
    const query = scope ? `?scope=${scope}` : '';
    return request<ConversationSummary[]>(
      `/chat/conversations${query}`,
      {},
      token,
    );
  },

  chatUnreadCount: (token: string) =>
    request<{ chat: number }>('/chat/unread-count', {}, token),

  chatOpenTrainerAdmin: (token: string) =>
    request<ConversationSummary>(
      '/chat/conversations/trainer-admin',
      { method: 'POST' },
      token,
    ),

  chatCreateConversation: (
    token: string,
    data: { kind: 'admin' | 'trainer'; trainerId?: string },
  ) =>
    request<ConversationSummary>(
      '/chat/conversations',
      { method: 'POST', body: JSON.stringify(data) },
      token,
    ),

  chatOpenTrainerClient: (token: string, clientId: string) =>
    request<ConversationSummary>(
      `/chat/conversations/trainer/${clientId}`,
      { method: 'POST' },
      token,
    ),

  chatMessages: (token: string, conversationId: string) =>
    request<{
      conversation: ConversationSummary;
      messages: ChatMessageItem[];
    }>(`/chat/conversations/${conversationId}/messages`, {}, token),

  chatSendMessage: (token: string, conversationId: string, body: string) =>
    request<ChatMessageItem>(
      `/chat/conversations/${conversationId}/messages`,
      { method: 'POST', body: JSON.stringify({ body }) },
      token,
    ),

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
