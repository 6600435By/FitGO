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
  type TrainerClientSummary,
  type TrainerInviteRequest,
  type Visit,
  type ClientVisitsResponse,
  type PersonalTrainingBookingItem,
  type PersonalTrainingGoalTemplate,
  type PersonalTrainingSessionDetail,
  type TrainerSummary,
  type TrainerWorkSlotInput,
  type PersonalTrainingSlot,
  type TrainerCalendarResponse,
  type TrainerAvailabilityBlock,
  type TrainerCalendarEvent,
  type WearableSyncResult,
  type SpaService,
  type SpaServiceEligibility,
  type SpaSpecialistSummary,
  type SpaBookingSlot,
  type SpaBooking,
  type SpaQuotaRule,
  type SpecialistCalendarResponse,
  type SpecialistWorkSlotInput,
  type ClientProfile,
  type ClientTrainingProfile,
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
  type ProductModulesState,
  type ProductModuleDefinition,
} from '@fitgo/shared-types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface AuthUser {
  id: string;
  externalId?: string;
  clubId?: string;
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

export interface RegisterResponse {
  accessToken: string;
  user: AuthUser;
  pendingTrainers: TrainerInviteRequest[];
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
  cardSource?: '1c' | 'osmi' | 'fitgo';
  crmStatus?: 'LINKED' | 'PENDING_CRM' | null;
  club: {
    id: string;
    name: string;
    slug: string;
    address?: string;
  } | null;
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

export type GroupClassSessionDto = {
  id: string;
  appointmentId: string;
  title: string;
  startAt: string;
  endAt: string;
  status: string;
  baselineQuality: string;
  baselineCount: number;
  submittedCount?: number;
  approvedAttendedCount?: number;
  trustBand: string;
  trustReasons: string[];
  trustReasonLabels: string[];
  trainerId: string;
  trainerName: string;
  members: Array<{
    id: string;
    clientId?: string;
    displayName: string;
    source: string;
    attendance: string;
    visitMatched: boolean;
    trustBand: string;
    trustReasons: string[];
    trustResolution: string;
  }>;
};

export const api = {
  login: (email: string, password: string) =>
    request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  register: (data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone: string;
  }) =>
    request<RegisterResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  me: (token: string) => request<AuthUser>('/auth/me', {}, token),

  clientDashboard: (token: string) =>
    request<ClientDashboard>('/client/dashboard', {}, token),

  clientVisits: (
    token: string,
    params?: { from?: string; to?: string; kind?: string },
  ) => {
    const q = new URLSearchParams();
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    if (params?.kind) q.set('kind', params.kind);
    const qs = q.toString();
    return request<ClientVisitsResponse>(
      `/client/visits${qs ? `?${qs}` : ''}`,
      {},
      token,
    );
  },

  clientSelfConfirmGroupVisit: (token: string, bookingId: string) =>
    request<Visit>(
      `/client/visits/group-bookings/${bookingId}/self-confirm`,
      { method: 'POST' },
      token,
    ),

  features: (token: string) =>
    request<{ modules: ProductModulesState }>('/features', {}, token),

  clientClubs: (token: string) =>
    request<Array<{
      id: string;
      name: string;
      slug: string;
      address?: string;
    }>>('/client/clubs', {}, token),

  clientJoinClub: (token: string, clubSlug: string) =>
    request<{
      club: { id: string; name: string; slug: string; address?: string };
      externalId?: string;
      joinedAt: string;
    }>('/client/club/join', {
      method: 'POST',
      body: JSON.stringify({ clubSlug }),
    }, token),

  clientClubCard: (token: string) =>
    request<{
      enabled: boolean;
      card: ClubCardView | null;
      needsPhone: boolean;
      crmStatus?: 'LINKED' | 'PENDING_CRM' | null;
      anketaUrl?: string;
      syncError?: string;
      membership?: Membership | null;
    }>('/client/card', {}, token),

  clientSyncClubCard: (token: string) =>
    request<{
      enabled: boolean;
      card: ClubCardView | null;
      needsPhone: boolean;
      crmStatus?: 'LINKED' | 'PENDING_CRM' | null;
      anketaUrl?: string;
      syncError?: string;
      membership?: Membership | null;
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
        origin?: string;
      }>
    >('/trainer/personal-bookings', {}, token),

  trainerCalendar: (token: string, from: string, to: string) =>
    request<TrainerCalendarResponse>(
      `/trainer/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      {},
      token,
    ),

  trainerAvailabilityBlocks: (token: string, from: string, to: string) =>
    request<TrainerAvailabilityBlock[]>(
      `/trainer/availability-blocks?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      {},
      token,
    ),

  trainerSetAvailabilityBlocks: (
    token: string,
    data: {
      periodStart: string;
      periodEnd: string;
      blocks: Array<{ startAt: string; endAt: string }>;
    },
  ) =>
    request<TrainerAvailabilityBlock[]>(
      '/trainer/availability-blocks',
      { method: 'PUT', body: JSON.stringify(data) },
      token,
    ),

  trainerFillFromTemplate: (
    token: string,
    periodStart: string,
    periodEnd: string,
  ) =>
    request<TrainerAvailabilityBlock[]>(
      '/trainer/schedule/fill-from-template',
      {
        method: 'POST',
        body: JSON.stringify({ periodStart, periodEnd }),
      },
      token,
    ),

  trainerPublishSchedule: (
    token: string,
    periodStart: string,
    periodEnd: string,
  ) =>
    request<{ publishedBlocks: number; periodStart: string; periodEnd: string }>(
      '/trainer/schedule/publish',
      {
        method: 'POST',
        body: JSON.stringify({ periodStart, periodEnd }),
      },
      token,
    ),

  trainerAssignPersonalBooking: (
    token: string,
    clientId: string,
    startAt: string,
  ) =>
    request<{
      id: string;
      clientId: string;
      clientName: string;
      startAt: string;
      endAt: string;
    }>(
      '/trainer/personal-bookings',
      {
        method: 'POST',
        body: JSON.stringify({ clientId, startAt }),
      },
      token,
    ),

  trainerUpdatePersonalBooking: (
    token: string,
    bookingId: string,
    data: { startAt?: string; action?: 'cancel' },
  ) =>
    request(`/trainer/personal-bookings/${bookingId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }, token),

  clientProducts: (token: string) =>
    request<MembershipProduct[]>('/client/products', {}, token),

  clientPayment: (token: string, productId: string) =>
    request<PaymentResult>(
      '/client/payment',
      { method: 'POST', body: JSON.stringify({ productId }) },
      token,
    ),

  clientFreezeMembership: (
    token: string,
    data: { days: number; fromDate?: string },
  ) =>
    request<{ membership: Membership }>(
      '/client/membership/freeze',
      { method: 'POST', body: JSON.stringify(data) },
      token,
    ),

  // ─── Spa booking ───────────────────────────────────────────────────────────

  clientSpaServices: (
    token: string,
    params?: { membershipServiceName?: string; quotaOnly?: boolean },
  ) => {
    const q = new URLSearchParams();
    if (params?.membershipServiceName) {
      q.set('membershipServiceName', params.membershipServiceName);
    }
    if (params?.quotaOnly) q.set('quotaOnly', '1');
    const qs = q.toString();
    return request<SpaServiceEligibility[]>(
      `/client/spa/services${qs ? `?${qs}` : ''}`,
      {},
      token,
    );
  },

  clientSpaSpecialists: (
    token: string,
    serviceId: string,
    params?: {
      membershipServiceName?: string;
      paymentType?: 'QUOTA' | 'PAID';
    },
  ) => {
    const q = new URLSearchParams({ serviceId });
    if (params?.membershipServiceName) {
      q.set('membershipServiceName', params.membershipServiceName);
    }
    if (params?.paymentType) q.set('paymentType', params.paymentType);
    return request<SpaSpecialistSummary[]>(
      `/client/spa/specialists?${q.toString()}`,
      {},
      token,
    );
  },

  clientSpaSlots: (token: string, specialistId: string, serviceId: string) =>
    request<SpaBookingSlot[]>(
      `/client/spa/specialists/${specialistId}/slots?serviceId=${encodeURIComponent(serviceId)}`,
      {},
      token,
    ),

  clientBookSpa: (
    token: string,
    data: {
      serviceId: string;
      specialistId: string;
      startAt: string;
      paymentType: 'QUOTA' | 'PAID';
      membershipServiceName?: string;
    },
  ) =>
    request<{ booking: SpaBooking; membership: Membership | null }>(
      '/client/spa-bookings',
      { method: 'POST', body: JSON.stringify(data) },
      token,
    ),

  clientSpaBookings: (token: string) =>
    request<SpaBooking[]>('/client/spa-bookings', {}, token),

  clientCancelSpaBooking: (token: string, bookingId: string) =>
    request<{ success: boolean }>(
      `/client/spa-bookings/${bookingId}`,
      { method: 'DELETE' },
      token,
    ),

  specialistOwnServices: (token: string) =>
    request<SpaService[]>('/specialist/spa/services', {}, token),

  specialistWorkSchedule: (token: string) =>
    request<SpecialistWorkSlotInput[]>('/specialist/work-schedule', {}, token),

  specialistSetWorkSchedule: (
    token: string,
    slots: SpecialistWorkSlotInput[],
  ) =>
    request<SpecialistWorkSlotInput[]>(
      '/specialist/work-schedule',
      { method: 'PUT', body: JSON.stringify({ slots }) },
      token,
    ),

  specialistCalendar: (token: string, from: string, to: string) =>
    request<SpecialistCalendarResponse>(
      `/specialist/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      {},
      token,
    ),

  specialistFillFromTemplate: (
    token: string,
    periodStart: string,
    periodEnd: string,
  ) =>
    request<{ createdBlocks: number }>(
      '/specialist/schedule/fill-from-template',
      {
        method: 'POST',
        body: JSON.stringify({ periodStart, periodEnd }),
      },
      token,
    ),

  specialistPublishSchedule: (
    token: string,
    periodStart: string,
    periodEnd: string,
  ) =>
    request<{ publishedBlocks: number }>(
      '/specialist/schedule/publish',
      {
        method: 'POST',
        body: JSON.stringify({ periodStart, periodEnd }),
      },
      token,
    ),

  specialistSpaBookings: (token: string) =>
    request<SpaBooking[]>('/specialist/spa-bookings', {}, token),

  specialistAssignSpaBooking: (
    token: string,
    data: {
      clientId: string;
      serviceId: string;
      startAt: string;
      paymentType: 'QUOTA' | 'PAID';
      membershipServiceName?: string;
    },
  ) =>
    request<{ booking: SpaBooking; membership: Membership | null }>(
      '/specialist/spa-bookings',
      { method: 'POST', body: JSON.stringify(data) },
      token,
    ),

  specialistCancelSpaBooking: (token: string, bookingId: string) =>
    request<{ ok: boolean }>(
      `/specialist/spa-bookings/${bookingId}`,
      { method: 'PATCH' },
      token,
    ),

  specialistCompleteSpaBooking: (token: string, bookingId: string) =>
    request<SpaBooking>(
      `/specialist/spa-bookings/${bookingId}/complete`,
      { method: 'POST', body: '{}' },
      token,
    ),

  adminSpaServices: (token: string) =>
    request<SpaService[]>('/admin/spa/services', {}, token),

  adminUpsertSpaService: (
    token: string,
    data: {
      id?: string;
      name: string;
      kind: 'MASSAGE' | 'BODY_COMPOSITION' | 'WRAP';
      durationMin: number;
      bufferMin?: number;
      priceMinor: number;
      currency?: string;
      active?: boolean;
    },
  ) =>
    request<SpaService>('/admin/spa/services', {
      method: 'POST',
      body: JSON.stringify(data),
    }, token),

  adminSpaQuotaRules: (token: string) =>
    request<SpaQuotaRule[]>('/admin/spa/quota-rules', {}, token),

  adminSetSpaQuotaRules: (
    token: string,
    rules: Array<{
      membershipServiceName: string;
      allowedServiceIds: string[];
      allowedSpecialistIds: string[];
    }>,
  ) =>
    request<SpaQuotaRule[]>('/admin/spa/quota-rules', {
      method: 'PUT',
      body: JSON.stringify({ rules }),
    }, token),

  adminSpaSpecialists: (token: string) =>
    request<SpaSpecialistSummary[]>('/admin/spa/specialists', {}, token),

  adminSetSpecialistServices: (
    token: string,
    specialistId: string,
    serviceIds: string[],
  ) =>
    request<SpaSpecialistSummary[]>(
      `/admin/spa/specialists/${specialistId}/services`,
      { method: 'PUT', body: JSON.stringify({ serviceIds }) },
      token,
    ),

  adminSpaCalendar: (token: string, from: string, to: string) =>
    request<SpaBooking[]>(
      `/admin/spa/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      {},
      token,
    ),

  adminSpaClients: (token: string) =>
    request<Array<{ id: string; firstName: string; lastName: string; phone?: string }>>(
      '/admin/spa/clients',
      {},
      token,
    ),

  adminAssignSpaBooking: (
    token: string,
    data: {
      clientId: string;
      specialistId: string;
      serviceId: string;
      startAt: string;
      paymentType: 'QUOTA' | 'PAID';
      membershipServiceName?: string;
    },
  ) =>
    request<{ booking: SpaBooking; membership: Membership | null }>(
      '/admin/spa-bookings',
      { method: 'POST', body: JSON.stringify(data) },
      token,
    ),

  trainerDashboard: (token: string) =>
    request<TrainerDashboard>('/trainer/dashboard', {}, token),

  trainerClients: (token: string) =>
    request<TrainerClientSummary[]>('/trainer/clients', {}, token),

  trainerAddOfflineClient: (
    token: string,
    data: { firstName: string; lastName: string; phone: string; notes?: string },
  ) =>
    request<TrainerClientSummary | { message: string }>(
      '/trainer/clients',
      { method: 'POST', body: JSON.stringify(data) },
      token,
    ),

  trainerInviteClient: (token: string, phone: string) =>
    request<{ message: string }>(
      '/trainer/clients/invite',
      { method: 'POST', body: JSON.stringify({ phone }) },
      token,
    ),

  clientTrainerInvites: (token: string) =>
    request<TrainerInviteRequest[]>('/client/trainer-invites', {}, token),

  clientAcceptTrainerInvite: (token: string, trainerId: string) =>
    request<{ success: boolean }>(
      `/client/trainer-invites/${trainerId}/accept`,
      { method: 'POST' },
      token,
    ),

  clientRejectTrainerInvite: (token: string, trainerId: string) =>
    request<{ success: boolean }>(
      `/client/trainer-invites/${trainerId}/reject`,
      { method: 'POST' },
      token,
    ),

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

  updateTrainingProfile: (
    token: string,
    data: Partial<{
      [K in keyof ClientTrainingProfile]: ClientTrainingProfile[K];
    }>,
  ) =>
    request<ClientTrainingProfile>('/client/profile/training', {
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

  updateBodyLog: (
    token: string,
    id: string,
    data: {
      weightKg?: number | null;
      chestCm?: number | null;
      waistCm?: number | null;
      hipsCm?: number | null;
      bicepsCm?: number | null;
      thighCm?: number | null;
      bodyFatPct?: number | null;
      notes?: string | null;
    },
  ) =>
    request(`/client/body/log/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }, token),

  deleteBodyLog: (token: string, id: string) =>
    request<{ ok: boolean }>(`/client/body/log/${id}`, {
      method: 'DELETE',
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

  adminPendingCrm: (token: string) =>
    request<
      Array<{
        membershipId: string;
        userId: string;
        firstName: string;
        lastName: string;
        phone?: string;
        email: string;
        joinedAt: string;
        lastCrmSyncAt?: string;
        crmStatus: string | null;
      }>
    >('/admin/pending-crm', {}, token),

  adminClubProfile: (token: string) =>
    request<{
      id: string;
      name: string;
      slug: string;
      address?: string;
      phone?: string;
      website?: string;
      currency: string;
      externalId?: string;
      theme: ClubTheme;
    }>('/admin/club-profile', {}, token),

  adminUpdateClubProfile: (
    token: string,
    data: {
      name?: string;
      address?: string;
      phone?: string;
      website?: string;
      logoUrl?: string;
      primaryColor?: string;
    },
  ) =>
    request('/admin/club-profile', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }, token),

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
      role: 'ADMIN' | 'TRAINER' | 'SPECIALIST';
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

  superAdminModules: (token: string) =>
    request<{
      modules: ProductModulesState;
      catalog: Array<ProductModuleDefinition & { enabled: boolean }>;
      updatedAt?: string;
    }>('/super-admin/modules', {}, token),

  superAdminSetModules: (
    token: string,
    modules: Partial<ProductModulesState>,
  ) =>
    request<{ modules: ProductModulesState }>('/super-admin/modules', {
      method: 'PUT',
      body: JSON.stringify({ modules }),
    }, token),

  superAdminReviewQueue: (token: string) =>
    request<import('@fitgo/shared-types').ServiceUsageReviewItem[]>(
      '/super-admin/service-usage/review-queue',
      {},
      token,
    ),

  superAdminAckReview: (
    token: string,
    kind: string,
    bookingId: string,
  ) =>
    request<{ success: boolean }>(
      `/super-admin/service-usage/review-queue/${kind}/${bookingId}/ack`,
      { method: 'POST', body: '{}' },
      token,
    ),

  superAdminPresenceOverride: (
    token: string,
    kind: string,
    bookingId: string,
    note: string,
  ) =>
    request<{ success: boolean }>(
      `/super-admin/service-usage/${kind}/${bookingId}/presence-override`,
      { method: 'POST', body: JSON.stringify({ note }) },
      token,
    ),

  superAdminSpecialistDebtPerformers: (token: string) =>
    request<Array<{ employeeCode: string; name: string; roles: string[] }>>(
      '/super-admin/specialist-service-debts/performers',
      {},
      token,
    ),

  superAdminSpecialistDebts: (
    token: string,
    params: { from: string; to: string; employeeCode: string },
  ) => {
    const q = new URLSearchParams({
      from: params.from,
      to: params.to,
      employeeCode: params.employeeCode,
    });
    return request<import('@fitgo/shared-types').SpecialistServiceDebt[]>(
      `/super-admin/specialist-service-debts?${q}`,
      {},
      token,
    );
  },

  superAdminTrustExceptions: (token: string) =>
    request<import('@fitgo/shared-types').TrustExceptionItem[]>(
      '/super-admin/trust-exceptions',
      {},
      token,
    ),

  superAdminResolveTrust: (
    token: string,
    kind: 'SPA' | 'PT',
    bookingId: string,
    note: string,
  ) =>
    request<{ success: boolean }>(
      `/super-admin/trust-exceptions/${kind}/${bookingId}/resolve`,
      { method: 'POST', body: JSON.stringify({ note }) },
      token,
    ),

  adminGroupSessionExceptions: (token: string) =>
    request<import('@fitgo/shared-types').TrustExceptionItem[]>(
      '/admin/group-sessions/exceptions',
      {},
      token,
    ),

  adminResolveGroupSession: (token: string, id: string, note: string) =>
    request<unknown>(`/admin/group-sessions/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }, token),

  adminReturnGroupSession: (token: string, id: string) =>
    request<unknown>(`/admin/group-sessions/${id}/return`, {
      method: 'POST',
      body: '{}',
    }, token),

  trainerOpenGroupSession: (
    token: string,
    body: {
      appointmentId: string;
      title: string;
      startAt: string;
      endAt: string;
    },
  ) =>
    request<GroupClassSessionDto>('/trainer/group-sessions/open', {
      method: 'POST',
      body: JSON.stringify(body),
    }, token),

  trainerGroupSessions: (token: string, from: string, to: string) =>
    request<GroupClassSessionDto[]>(
      `/trainer/group-sessions?from=${from}&to=${to}`,
      {},
      token,
    ),

  trainerGetGroupSession: (token: string, id: string) =>
    request<GroupClassSessionDto>(`/trainer/group-sessions/${id}`, {}, token),

  trainerSetGroupMemberAttendance: (
    token: string,
    sessionId: string,
    memberId: string,
    attendance: string,
  ) =>
    request<GroupClassSessionDto>(
      `/trainer/group-sessions/${sessionId}/members/${memberId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ attendance }),
      },
      token,
    ),

  trainerAddGroupMember: (
    token: string,
    sessionId: string,
    body: { displayName: string; clientId?: string },
  ) =>
    request<GroupClassSessionDto>(
      `/trainer/group-sessions/${sessionId}/members`,
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  trainerSubmitGroupSession: (token: string, id: string) =>
    request<GroupClassSessionDto>(`/trainer/group-sessions/${id}/submit`, {
      method: 'POST',
      body: '{}',
    }, token),

  payrollStaff: (token: string) =>
    request<import('@fitgo/shared-types').StaffPaySummary[]>(
      '/super-admin/payroll/staff',
      {},
      token,
    ),

  payrollStaffProfile: (token: string, userId: string) =>
    request<import('@fitgo/shared-types').StaffCompensationDto | null>(
      `/super-admin/payroll/staff/${userId}/profile`,
      {},
      token,
    ),

  payrollSaveStaffProfile: (
    token: string,
    userId: string,
    body: {
      baseSalaryMinor?: number;
      payProfile: import('@fitgo/shared-types').StaffPayProfile;
      effectiveFrom?: string;
    },
  ) =>
    request<import('@fitgo/shared-types').StaffCompensationDto>(
      `/super-admin/payroll/staff/${userId}/profile`,
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  payrollSummary: (
    token: string,
    params: { userId: string; from: string; to: string },
  ) => {
    const q = new URLSearchParams(params);
    return request<import('@fitgo/shared-types').PayrollPeriodSummary>(
      `/super-admin/payroll/summary?${q}`,
      {},
      token,
    );
  },

  payrollLock: (
    token: string,
    body: { userId: string; from: string; to: string },
  ) =>
    request<import('@fitgo/shared-types').PayrollPeriodSummary>(
      '/super-admin/payroll/lock',
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  payrollAdjustment: (
    token: string,
    body: {
      userId: string;
      amountMinor: number;
      reason: string;
      periodFrom: string;
      periodTo: string;
    },
  ) =>
    request<import('@fitgo/shared-types').PayrollAdjustmentDto>(
      '/super-admin/payroll/adjustments',
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  adminPayrollStaff: (token: string) =>
    request<import('@fitgo/shared-types').StaffPaySummary[]>(
      '/admin/payroll/staff',
      {},
      token,
    ),

  adminPayrollSummary: (
    token: string,
    params: { userId: string; from: string; to: string },
  ) => {
    const q = new URLSearchParams(params);
    return request<import('@fitgo/shared-types').PayrollPeriodSummary>(
      `/admin/payroll/summary?${q}`,
      {},
      token,
    );
  },

  trainerPtShifts: (token: string, from: string, to: string) =>
    request<import('@fitgo/shared-types').TrainerShiftDto[]>(
      `/trainer/pt-timesheet/shifts?from=${from}&to=${to}`,
      {},
      token,
    ),

  trainerPtUpsertShift: (
    token: string,
    body: { id?: string; date: string; startAt: string; endAt: string },
  ) =>
    request<import('@fitgo/shared-types').TrainerShiftDto>(
      '/trainer/pt-timesheet/shifts',
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  trainerPtDeleteShift: (token: string, id: string) =>
    request<{ success: boolean }>(
      `/trainer/pt-timesheet/shifts/${id}`,
      { method: 'DELETE' },
      token,
    ),

  trainerPtDaySheet: (token: string, date: string) =>
    request<import('@fitgo/shared-types').TrainerDaySheetDto>(
      `/trainer/pt-timesheet/day?date=${date}`,
      {},
      token,
    ),

  trainerPtSubmitDay: (token: string, date: string) =>
    request<import('@fitgo/shared-types').TrainerDaySheetDto>(
      '/trainer/pt-timesheet/day/submit',
      { method: 'POST', body: JSON.stringify({ date }) },
      token,
    ),

  trainerPtLateAdd: (
    token: string,
    body: {
      date: string;
      phone: string;
      firstName: string;
      lastName: string;
      startAt: string;
      isComplimentary?: boolean;
    },
  ) =>
    request<import('@fitgo/shared-types').TrainerDaySheetDto>(
      '/trainer/pt-timesheet/day/late-add',
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  trainerPtCorrectPhone: (token: string, bookingId: string, phone: string) =>
    request<import('@fitgo/shared-types').TrainerDaySheetDto>(
      `/trainer/pt-timesheet/bookings/${bookingId}/correct-phone`,
      { method: 'POST', body: JSON.stringify({ phone }) },
      token,
    ),

  trainerPtEscalate: (token: string, bookingId: string) =>
    request<import('@fitgo/shared-types').TrainerDaySheetDto>(
      `/trainer/pt-timesheet/bookings/${bookingId}/escalate`,
      { method: 'POST', body: '{}' },
      token,
    ),

  trainerPtNotThisClient: (token: string, bookingId: string) =>
    request<import('@fitgo/shared-types').TrainerDaySheetDto>(
      `/trainer/pt-timesheet/bookings/${bookingId}/not-this-client`,
      { method: 'POST', body: '{}' },
      token,
    ),

  adminPtClientIssues: (token: string) =>
    request<import('@fitgo/shared-types').PtClientIssueQueueItem[]>(
      '/admin/pt-timesheet/client-issues',
      {},
      token,
    ),

  adminPtSheets: (token: string, status?: string) => {
    const q = status ? `?status=${status}` : '';
    return request<import('@fitgo/shared-types').TrainerDaySheetDto[]>(
      `/admin/pt-timesheet/sheets${q}`,
      {},
      token,
    );
  },

  adminPtSheet: (token: string, id: string) =>
    request<import('@fitgo/shared-types').TrainerDaySheetDto>(
      `/admin/pt-timesheet/sheets/${id}`,
      {},
      token,
    ),

  adminPtRebindPhone: (token: string, bookingId: string, phone: string) =>
    request<import('@fitgo/shared-types').TrainerDaySheetDto>(
      `/admin/pt-timesheet/bookings/${bookingId}/rebind-phone`,
      { method: 'POST', body: JSON.stringify({ phone }) },
      token,
    ),

  adminPtResolveClient: (token: string, bookingId: string) =>
    request<import('@fitgo/shared-types').TrainerDaySheetDto>(
      `/admin/pt-timesheet/bookings/${bookingId}/resolve-client`,
      { method: 'POST', body: '{}' },
      token,
    ),

  adminPtSetPayment: (
    token: string,
    bookingId: string,
    body: {
      paymentStatus: 'PAID' | 'DEBT' | 'PENDING_PAYMENT' | 'N_A';
      payKind?: string;
      priceMinor?: number;
      verified1c?: boolean;
    },
  ) =>
    request<import('@fitgo/shared-types').TrainerDaySheetDto>(
      `/admin/pt-timesheet/bookings/${bookingId}/payment`,
      { method: 'PATCH', body: JSON.stringify(body) },
      token,
    ),

  adminPtVerify1c: (token: string, bookingId: string) =>
    request<import('@fitgo/shared-types').TrainerDaySheetDto>(
      `/admin/pt-timesheet/bookings/${bookingId}/verify-1c`,
      { method: 'POST', body: '{}' },
      token,
    ),

  adminPtApproveSheet: (token: string, id: string) =>
    request<import('@fitgo/shared-types').TrainerDaySheetDto>(
      `/admin/pt-timesheet/sheets/${id}/approve`,
      { method: 'POST', body: '{}' },
      token,
    ),

  saPtSheets: (token: string, status?: string) => {
    const q = status ? `?status=${status}` : '';
    return request<import('@fitgo/shared-types').TrainerDaySheetDto[]>(
      `/super-admin/pt-timesheet/sheets${q}`,
      {},
      token,
    );
  },

  saPtApproveSheet: (
    token: string,
    id: string,
    forceBookingIds?: string[],
  ) =>
    request<import('@fitgo/shared-types').TrainerDaySheetDto>(
      `/super-admin/pt-timesheet/sheets/${id}/approve`,
      {
        method: 'POST',
        body: JSON.stringify({ forceBookingIds }),
      },
      token,
    ),

  saPtLockSheet: (token: string, id: string) =>
    request<import('@fitgo/shared-types').TrainerDaySheetDto>(
      `/super-admin/pt-timesheet/sheets/${id}/lock`,
      { method: 'POST', body: '{}' },
      token,
    ),

  superAdminClubProfile: (token: string) =>
    request<{
      id: string;
      name: string;
      slug: string;
      address?: string;
      phone?: string;
      website?: string;
      currency: string;
      externalId?: string;
      workingHours?: import('@fitgo/shared-types').ClubWorkingHours;
      theme: ClubTheme;
    }>('/super-admin/club-profile', {}, token),

  superAdminUpdateClubProfile: (
    token: string,
    data: {
      name?: string;
      address?: string;
      phone?: string;
      website?: string;
      logoUrl?: string;
      primaryColor?: string;
      workingHours?: import('@fitgo/shared-types').ClubWorkingHours;
    },
  ) =>
    request('/super-admin/club-profile', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }, token),

  adminRosterWorkingHours: (token: string) =>
    request<import('@fitgo/shared-types').ClubWorkingHours>(
      '/admin/staff-roster/working-hours',
      {},
      token,
    ),

  adminRosterStaff: (token: string, track: import('@fitgo/shared-types').StaffShiftTrack) =>
    request<Array<{ id: string; name: string; roles: string[] }>>(
      `/admin/staff-roster/staff?track=${track}`,
      {},
      token,
    ),

  adminRosterMonth: (
    token: string,
    year: number,
    month: number,
    track?: import('@fitgo/shared-types').StaffShiftTrack,
  ) => {
    const q = new URLSearchParams({
      year: String(year),
      month: String(month),
      ...(track ? { track } : {}),
    });
    return request<import('@fitgo/shared-types').StaffShiftMonthCell[]>(
      `/admin/staff-roster/month?${q}`,
      {},
      token,
    );
  },

  adminRosterUpsertShift: (
    token: string,
    body: {
      id?: string;
      userId: string;
      track: import('@fitgo/shared-types').StaffShiftTrack;
      date: string;
      startAt: string;
      endAt: string;
      note?: string;
    },
  ) =>
    request<import('@fitgo/shared-types').StaffShiftDto>(
      '/admin/staff-roster/shifts',
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  adminRosterDeleteShift: (token: string, id: string) =>
    request<{ success: boolean }>(
      `/admin/staff-roster/shifts/${id}`,
      { method: 'DELETE' },
      token,
    ),

  adminRosterMyHours: (token: string, from: string, to: string) =>
    request<import('@fitgo/shared-types').StaffHourlySummary>(
      `/admin/staff-roster/my-hours?from=${from}&to=${to}`,
      {},
      token,
    ),

  saRosterWorkingHours: (token: string) =>
    request<import('@fitgo/shared-types').ClubWorkingHours>(
      '/super-admin/staff-roster/working-hours',
      {},
      token,
    ),

  saRosterStaff: (token: string, track: import('@fitgo/shared-types').StaffShiftTrack) =>
    request<Array<{ id: string; name: string; roles: string[] }>>(
      `/super-admin/staff-roster/staff?track=${track}`,
      {},
      token,
    ),

  saRosterMonth: (
    token: string,
    year: number,
    month: number,
    track?: import('@fitgo/shared-types').StaffShiftTrack,
  ) => {
    const q = new URLSearchParams({
      year: String(year),
      month: String(month),
      ...(track ? { track } : {}),
    });
    return request<import('@fitgo/shared-types').StaffShiftMonthCell[]>(
      `/super-admin/staff-roster/month?${q}`,
      {},
      token,
    );
  },

  saRosterUpsertShift: (
    token: string,
    body: {
      id?: string;
      userId: string;
      track: import('@fitgo/shared-types').StaffShiftTrack;
      date: string;
      startAt: string;
      endAt: string;
      note?: string;
    },
  ) =>
    request<import('@fitgo/shared-types').StaffShiftDto>(
      '/super-admin/staff-roster/shifts',
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  saRosterDeleteShift: (token: string, id: string) =>
    request<{ success: boolean }>(
      `/super-admin/staff-roster/shifts/${id}`,
      { method: 'DELETE' },
      token,
    ),

  saRosterSummaries: (
    token: string,
    from: string,
    to: string,
    track?: import('@fitgo/shared-types').StaffShiftTrack,
  ) => {
    const q = new URLSearchParams({ from, to, ...(track ? { track } : {}) });
    return request<import('@fitgo/shared-types').StaffHourlySummary[]>(
      `/super-admin/staff-roster/summaries?${q}`,
      {},
      token,
    );
  },

  trainerRosterMyMonth: (token: string, year: number, month: number) =>
    request<import('@fitgo/shared-types').StaffShiftMonthCell[]>(
      `/trainer/staff-roster/my-month?year=${year}&month=${month}`,
      {},
      token,
    ),
};
