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
  type PersonalTrainingGoalTemplate,
  type PersonalTrainingSessionDetail,
  type TrainerSummary,
  type TrainerWorkSlotInput,
  type PersonalTrainingSlot,
  type WearableSyncResult,
  type ClientProfile,
  type BodyProfileResponse,
  type ChallengeView,
  type LeagueGroupView,
  type ClubCardView,
  type ConversationSummary,
  type ChatMessageItem,
  type StaffMember,
  type StaffCreateResult,
  type AdminTaskItem,
  type SuperAdminAnalytics,
  type StaffAuditLogItem,
  AdminPermission,
  AdminTaskStatus,
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

  clientClubCard: (token: string) =>
    request<{
      enabled: boolean;
      card: ClubCardView | null;
      needsPhone: boolean;
      anketaUrl?: string;
      syncError?: string;
    }>('/client/card', {}, token),

  clientSyncClubCard: (token: string) =>
    request<{
      enabled: boolean;
      card: ClubCardView | null;
      needsPhone: boolean;
      anketaUrl?: string;
      syncError?: string;
    }>('/client/card/sync', { method: 'POST' }, token),

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

  clientJoinWaitlist: (token: string, sessionId: string) =>
    request<import('@fitgo/shared-types').GroupClassWaitlistEntry>(
      `/client/waitlist/${sessionId}`,
      { method: 'POST' },
      token,
    ),

  clientLeaveWaitlist: (token: string, sessionId: string) =>
    request<{ success: boolean }>(`/client/waitlist/${sessionId}`, {
      method: 'DELETE',
    }, token),

  clientConfirmWaitlist: (token: string, sessionId: string) =>
    request<{ success: boolean; message?: string }>(
      `/client/waitlist/${sessionId}/confirm`,
      { method: 'POST' },
      token,
    ),

  clientWaitlist: (token: string) =>
    request<import('@fitgo/shared-types').GroupClassWaitlistEntry[]>(
      '/client/waitlist',
      {},
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

  personalGoalTemplates: (token: string) =>
    request<PersonalTrainingGoalTemplate[]>(
      '/personal-bookings/goal-templates',
      {},
      token,
    ),

  personalSessionDetail: (token: string, bookingId: string) =>
    request<PersonalTrainingSessionDetail>(
      `/personal-bookings/${bookingId}`,
      {},
      token,
    ),

  personalSessionPreviousSheet: (token: string, bookingId: string) =>
    request<{ sheet: import('@fitgo/shared-types').WorkoutSheet | null; date?: string }>(
      `/personal-bookings/${bookingId}/previous-sheet`,
      {},
      token,
    ),

  personalSessionCircuitHistory: (token: string, bookingId: string) =>
    request<import('@fitgo/shared-types').CircuitHistoryPoint[]>(
      `/personal-bookings/${bookingId}/circuit-history`,
      {},
      token,
    ),

  personalSessionUpdatePlan: (
    token: string,
    bookingId: string,
    payload: {
      goals: Array<{
        id?: string;
        title: string;
        notes?: string;
        tasks?: Array<{ id?: string; title: string }>;
      }>;
      workoutSheet?: import('@fitgo/shared-types').WorkoutSheet;
    },
  ) =>
    request<PersonalTrainingSessionDetail>(
      `/personal-bookings/${bookingId}/plan`,
      { method: 'PUT', body: JSON.stringify(payload) },
      token,
    ),

  personalSessionConfirmGoal: (
    token: string,
    bookingId: string,
    goalId: string,
  ) =>
    request<PersonalTrainingSessionDetail>(
      `/personal-bookings/${bookingId}/goals/${goalId}/confirm`,
      { method: 'POST' },
      token,
    ),

  personalSessionConfirmTask: (
    token: string,
    bookingId: string,
    taskId: string,
  ) =>
    request<PersonalTrainingSessionDetail>(
      `/personal-bookings/${bookingId}/tasks/${taskId}/confirm`,
      { method: 'POST' },
      token,
    ),

  personalSessionComplete: (token: string, bookingId: string) =>
    request<PersonalTrainingSessionDetail>(
      `/personal-bookings/${bookingId}/complete`,
      { method: 'POST' },
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

  adminFunnel: (token: string) =>
    request<{ funnel: Array<{ stage: string; count: number }> }>('/admin/funnel', {}, token),

  adminReports: (token: string) =>
    request<{ recentReports: Array<{
      id: string;
      date: string;
      revenue: number;
      problems?: string | null;
      ideas?: string | null;
    }> }>('/admin/reports', {}, token),

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

  activateGamification: (
    token: string,
    data: { useRealNameInPublic: boolean; gamificationNickname?: string },
  ) =>
    request('/engagement/activate', {
      method: 'POST',
      body: JSON.stringify(data),
    }, token),

  suggestNickname: (token: string) =>
    request<{ nickname: string }>('/engagement/nickname/suggest', {}, token),

  checkNickname: (token: string, name: string) =>
    request<{ available: boolean; reason?: string }>(
      `/engagement/nickname/check?name=${encodeURIComponent(name)}`,
      {},
      token,
    ),

  checkIn: (token: string, qrToken?: string) =>
    request('/engagement/check-in', {
      method: 'POST',
      body: JSON.stringify({ qrToken }),
    }, token),

  dailyGoal: (token: string) =>
    request('/engagement/daily-goal', { method: 'POST' }, token),

  leagueGroup: (token: string) =>
    request<LeagueGroupView>('/engagement/league/group', {}, token),

  challenges: (token: string) =>
    request<ChallengeView[]>('/engagement/challenges', {}, token),

  clientProfile: (token: string) =>
    request<ClientProfile>('/client/profile', {}, token),

  updateClientProfile: (
    token: string,
    data: {
      firstName: string;
      lastName: string;
      phone: string;
      gender: string;
      dateOfBirth: string;
    },
  ) =>
    request<ClientProfile>('/client/profile', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }, token),

  updateGamificationSettings: (
    token: string,
    data: { useRealNameInPublic?: boolean; gamificationNickname?: string },
  ) =>
    request('/client/profile/gamification', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }, token),

  bodyProfile: (token: string) =>
    request<BodyProfileResponse>('/client/body', {}, token),

  updateBodyProfile: (
    token: string,
    data: { heightCm?: number; targetWeightKg?: number },
  ) =>
    request('/client/body/profile', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }, token),

  addBodyLog: (
    token: string,
    data: {
      weightKg?: number;
      chestCm?: number;
      waistCm?: number;
      hipsCm?: number;
      bicepsCm?: number;
      thighCm?: number;
      bodyFatPct?: number;
      notes?: string;
    },
  ) =>
    request('/client/body/log', {
      method: 'POST',
      body: JSON.stringify(data),
    }, token),

  createWorkout: (
    token: string,
    data: {
      type: string;
      startedAt: string;
      durationMin: number;
      distanceKm?: number;
      calories?: number;
      notes?: string;
    },
  ) =>
    request('/engagement/workouts', {
      method: 'POST',
      body: JSON.stringify(data),
    }, token),

  getWorkouts: (token: string) =>
    request<Array<{
      id: string;
      type: string;
      startedAt: string;
      durationMin: number;
      distanceKm?: number;
      calories?: number;
      notes?: string;
    }>>('/engagement/workouts', {}, token),

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

  adminPermissions: (token: string) =>
    request<{ permissions: AdminPermission[] }>('/admin/permissions', {}, token),

  adminMyTasks: (token: string) =>
    request<AdminTaskItem[]>('/admin/tasks', {}, token),

  adminUpdateTask: (token: string, taskId: string, status: AdminTaskStatus) =>
    request(`/admin/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }, token),

  superAdminStaff: (token: string) =>
    request<StaffMember[]>('/super-admin/staff', {}, token),

  superAdminCreateStaff: (
    token: string,
    data: {
      firstName: string;
      lastName: string;
      dateOfBirth?: string;
      phone?: string;
      email: string;
      password: string;
      role: 'ADMIN' | 'TRAINER';
    },
  ) =>
    request<StaffCreateResult>('/super-admin/staff', {
      method: 'POST',
      body: JSON.stringify(data),
    }, token),

  superAdminUpdateStaff: (
    token: string,
    id: string,
    data: Partial<{
      firstName: string;
      lastName: string;
      dateOfBirth: string;
      phone: string;
      isActive: boolean;
      password: string;
    }>,
  ) =>
    request<StaffMember & { credentials?: { email: string; password: string } }>(
      `/super-admin/staff/${id}`,
      { method: 'PATCH', body: JSON.stringify(data) },
      token,
    ),

  superAdminStaffExportUrl: () => `${API_URL}/api/super-admin/staff/export.csv`,

  superAdminPermissions: (token: string, adminId: string) =>
    request<{ permissions: AdminPermission[] }>(
      `/super-admin/admins/${adminId}/permissions`,
      {},
      token,
    ),

  superAdminSetPermissions: (
    token: string,
    adminId: string,
    permissions: AdminPermission[],
  ) =>
    request(`/super-admin/admins/${adminId}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissions }),
    }, token),

  superAdminApplyPreset: (
    token: string,
    adminId: string,
    preset: 'reception' | 'marketing' | 'floor',
  ) =>
    request<{ permissions: AdminPermission[] }>(
      `/super-admin/admins/${adminId}/permissions/preset`,
      { method: 'POST', body: JSON.stringify({ preset }) },
      token,
    ),

  superAdminTasks: (token: string, status?: AdminTaskStatus) => {
    const q = status ? `?status=${status}` : '';
    return request<AdminTaskItem[]>(`/super-admin/tasks${q}`, {}, token);
  },

  superAdminCreateTask: (
    token: string,
    data: { assigneeId: string; title: string; description?: string; dueAt?: string },
  ) =>
    request<AdminTaskItem>('/super-admin/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    }, token),

  superAdminUpdateTask: (
    token: string,
    id: string,
    data: Partial<{ status: AdminTaskStatus; title: string; description: string; dueAt: string }>,
  ) =>
    request<AdminTaskItem>(`/super-admin/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }, token),

  superAdminAnalytics: (token: string, period?: '7d' | '30d' | '90d') => {
    const q = period ? `?period=${period}` : '';
    return request<SuperAdminAnalytics>(`/super-admin/analytics${q}`, {}, token);
  },

  superAdminAuditLog: (token: string) =>
    request<StaffAuditLogItem[]>('/super-admin/audit-log', {}, token),
};
