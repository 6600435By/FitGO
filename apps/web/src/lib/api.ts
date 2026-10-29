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
  type SpaBoardResponse,
  type SpaBookingSlot,
  type SpaBooking,
  type SpaBulkBookingResult,
  type SpaQuotaRule,
  type SpaWaitlistEntry,
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
  type AdminRenewalTaskDetail,
  type AdminRenewalActionBody,
  type AdminRenewalCounters,
  type SuperAdminAnalytics,
  type StaffAuditLogItem,
  type AppUsageReport,
  type ClubAnalyticsReport,
  type ManagerEfficiencyBlock,
  type StaffAnalyticsReport,
  type PricingAnalyticsReport,
  type MembershipEfficiencyReport,
  type MembershipTrainersReport,
  type MembershipClientsReport,
  type MembershipEconomicsSettings,
  type MembershipEfficiencyBasis,
  type MembershipEfficiencyView,
  type MembershipUtilizationSegment,
  type PricingSegmentKey,
  type UpsertCompetitorPriceDto,
  type UpsertSaleWindowDto,
  type UpsertSegmentCompetitorDto,
  type AdminTaskWorkReport,
  type AnalyticsCompareMode,
  type AnalyticsDepartment,
  type FloorStaffHome,
  AdminPermission,
  AdminTaskStatus,
  type ProductModulesState,
  type ProductModuleDefinition,
  type AdminHomeLayoutValue,
  type AdminHomePinId,
  type AdminHomeWidgetId,
} from '@fitgo/shared-types';

/** Empty / unset = same-origin /api (Next rewrite → Nest). Absolute URL for separate hosts. */
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');

function xlsxErrorMessage(text: string, status: number): string {
  const trimmed = text.trim();
  if (
    !trimmed ||
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html')
  ) {
    return `Ошибка Excel (HTTP ${status})`;
  }
  try {
    const parsed = JSON.parse(trimmed) as { message?: unknown };
    if (typeof parsed.message === 'string') return parsed.message;
    if (Array.isArray(parsed.message)) return parsed.message.join('; ');
  } catch {
    /* plain text body */
  }
  return trimmed.length > 200 ? `Ошибка Excel (HTTP ${status})` : trimmed;
}

export interface AuthUser {
  id: string;
  externalId?: string;
  clubId?: string;
  email: string;
  phone?: string;
  firstName: string;
  lastName: string;
  groupPrograms?: boolean;
  trainerStaff?: boolean;
  trainerClub?: boolean;
  trainerReformers?: boolean;
  roles: UserRole[];
  club?: {
    id: string;
    name: string;
    slug: string;
    address?: string;
  };
}

export type StaffProfileDto = {
  userId: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  roles: string[];
  groupPrograms: boolean;
  trainerStaff: boolean;
  trainerClub: boolean;
  trainerReformers: boolean;
  bio: string;
  photoUrl: string | null;
  photoThumbUrl: string | null;
  bioMax: number;
  hiddenByAdmin: boolean;
};

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
    needsReviewCount: number;
    sessionsToday: {
      total: number;
      group: number;
      spa: number;
      pt: number;
    };
    revenueToday: {
      total: number;
      cash: number;
      card: number;
      other: number;
      currency: string;
      syncedAt?: string;
    };
    tasks: {
      total: number;
      bookingControl: number;
      membership: number;
      group: number;
      spa: number;
      pt: number;
      manager: number;
      birthday?: number;
      clientDebt?: number;
      staffDebt?: number;
      installment?: number;
      confirmation?: number;
      clients?: number;
      control?: number;
      overdue?: number;
      mine?: number;
      rework?: number;
      pool?: number;
      waiting?: number;
    };
    /** Next focus rows for home «Мой фокус» (optional). */
    focusPreview?: Array<{
      id: string;
      title: string;
      subtitle?: string;
      phone?: string;
      primaryAction: string;
      kind: string;
      bucket: string;
      virtual?: boolean;
      sessionKey?: string;
    }>;
    expiringSoon: number;
    pendingCrmCount?: number;
  };
  callToday: Array<{
    taskId: string;
    clientName: string;
    phone?: string;
    membership: string;
    validUntil: string;
    daysLeft: number;
    stage: string;
  }>;
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

/** After deploy / JWT rotate, stale tokens return 401 — force re-login once. */
let handlingUnauthorized = false;

function handleUnauthorized(hadToken: boolean, path: string) {
  if (!hadToken || path === '/auth/login' || path === '/auth/register') return;
  if (typeof window === 'undefined') return;
  if (handlingUnauthorized) return;
  handlingUnauthorized = true;
  // Lazy import: auth.ts type-imports from this module.
  void import('./auth').then(({ clearAuth }) => {
    clearAuth();
    try {
      sessionStorage.setItem('fitgo_session_expired', '1');
    } catch {
      /* private mode */
    }
    const loc = window.location.pathname;
    if (!loc.startsWith('/login') && !loc.startsWith('/register')) {
      window.location.replace('/login');
    }
  });
}

function errorMessageFromBody(
  body: unknown,
  status: number,
): string {
  if (typeof body === 'string' && body.trim()) return body.trim();
  if (body && typeof body === 'object') {
    const o = body as { message?: unknown; error?: unknown };
    const raw = o.message;
    if (Array.isArray(raw)) {
      const joined = raw.map(String).filter((s) => s.trim()).join('; ');
      if (joined) return joined;
    }
    if (typeof raw === 'string' && raw.trim()) return raw;
    if (typeof o.error === 'string' && o.error.trim()) {
      // Nest often sends error: "Bad Request" — keep only if no message.
      if (o.error !== 'Bad Request' && o.error !== 'Error') return o.error;
    }
  }
  return `Ошибка ${status}`;
}

async function assertBlobOk(
  res: Response,
  token: string,
  path: string,
): Promise<void> {
  if (res.ok) return;
  if (res.status === 401) handleUnauthorized(true, path);
  const text = await res.text();
  throw new Error(xlsxErrorMessage(text, res.status));
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
    if (response.status === 401) {
      handleUnauthorized(Boolean(token), path);
    }
    const error = await response.json().catch(() => ({}));
    throw new Error(errorMessageFromBody(error, response.status));
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

  authPresence: (token: string) =>
    request<{ ok: true }>('/auth/presence', { method: 'POST' }, token),

  getStaffSyncStatus: (token: string) =>
    request<{
      dataAsOf: string | null;
      dataAsOfIso: string | null;
      freshness: 'green' | 'yellow' | 'red';
      sourceLabel: string | null;
      running: {
        runId: string;
        startedAt: string;
        triggeredByName: string | null;
        trigger: string;
        profile: string;
      } | null;
      cooldownUntil: string | null;
      nextNightlyAt: string;
      inNightWindow: boolean;
      lastError: string | null;
      lastRun: {
        id: string;
        status: string;
        trigger: string;
        finishedAt: string | null;
        startedAt: string;
      } | null;
    }>('/staff/sync/status', {}, token),

  postStaffSyncRefresh: (token: string) =>
    request<{
      status: 'started' | 'running' | 'cooldown' | 'already_nightly';
      reason?: 'manual_cooldown' | 'night_window';
      runId?: string;
      dataAsOf: string | null;
      dataAsOfIso: string | null;
      freshness: 'green' | 'yellow' | 'red';
      sourceLabel: string | null;
      running: {
        runId: string;
        startedAt: string;
        triggeredByName: string | null;
        trigger: string;
        profile: string;
      } | null;
      cooldownUntil: string | null;
      inNightWindow: boolean;
      lastError: string | null;
    }>('/staff/sync/refresh', { method: 'POST', body: '{}' }, token),

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

  clientSpaWaitlist: (token: string, from: string, to: string) => {
    const q = new URLSearchParams({ from, to });
    return request<SpaWaitlistEntry[]>(
      `/client/spa-waitlist?${q}`,
      {},
      token,
    );
  },

  clientJoinSpaWaitlist: (
    token: string,
    data: {
      specialistId: string;
      serviceId: string;
      desiredStartAt: string;
    },
  ) =>
    request<SpaWaitlistEntry>(
      '/client/spa-waitlist',
      { method: 'POST', body: JSON.stringify(data) },
      token,
    ),

  clientCancelSpaWaitlist: (token: string, id: string) =>
    request<{ ok: boolean }>(
      `/client/spa-waitlist/${id}`,
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

  /** Set or clear published working hours for one calendar day. */
  specialistSetDayHours: (
    token: string,
    body: { day: string; startTime?: string | null; endTime?: string | null },
  ) =>
    request<{
      day: string;
      startTime: string | null;
      endTime: string | null;
      blocks: Array<{
        id: string;
        startAt: string;
        endAt: string;
        status: 'DRAFT' | 'PUBLISHED';
      }>;
    }>(
      '/specialist/availability/day',
      { method: 'PUT', body: JSON.stringify(body) },
      token,
    ),

  specialistCalendar: (token: string, from: string, to: string) =>
    request<SpecialistCalendarResponse>(
      `/specialist/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      {},
      token,
    ),

  specialistSpaBoard: (token: string, from: string, to: string) =>
    request<SpaBoardResponse>(
      `/specialist/spa-board?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
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

  lookupSpaClientByPhone: (token: string, phone: string) =>
    request<{
      found: boolean;
      pending: boolean;
      source: 'local' | '1c' | 'none';
      phone: string;
      clientId?: string;
      externalId?: string;
      firstName?: string;
      lastName?: string;
    }>(
      `/specialist/clients/by-phone?phone=${encodeURIComponent(phone)}`,
      {},
      token,
    ),

  getSpaClientNote: (
    token: string,
    query: { clientId?: string; clientExternalId?: string; phone?: string },
  ) => {
    const q = new URLSearchParams();
    if (query.clientId) q.set('clientId', query.clientId);
    if (query.clientExternalId) {
      q.set('clientExternalId', query.clientExternalId);
    }
    if (query.phone) q.set('phone', query.phone);
    return request<{ text: string; identityKey: string | null }>(
      `/specialist/spa/client-note?${q}`,
      {},
      token,
    );
  },

  putSpaClientNote: (
    token: string,
    data: {
      clientId?: string;
      clientExternalId?: string;
      phone?: string;
      text: string;
    },
  ) =>
    request<{ text: string; identityKey: string | null }>(
      '/specialist/spa/client-note',
      { method: 'PUT', body: JSON.stringify(data) },
      token,
    ),

  specialistAssignSpaBooking: (
    token: string,
    data: {
      clientId?: string;
      guestName?: string;
      guestPhone?: string;
      serviceId: string;
      startAt: string;
      paymentType: 'QUOTA' | 'PAID';
      membershipServiceName?: string;
      visitNote?: string;
      overlapConfirmed?: boolean;
    },
  ) =>
    request<{ booking: SpaBooking; membership: Membership | null }>(
      '/specialist/spa-bookings',
      { method: 'POST', body: JSON.stringify(data) },
      token,
    ),

  specialistBulkAssignSpaBooking: (
    token: string,
    data: {
      clientId?: string;
      guestName?: string;
      guestPhone?: string;
      serviceId: string;
      startAt: string;
      paymentType: 'QUOTA' | 'PAID';
      membershipServiceName?: string;
      visitNote?: string;
      dates: string[];
      overlapConfirmed?: boolean;
    },
  ) =>
    request<SpaBulkBookingResult>(
      '/specialist/spa-bookings/bulk',
      { method: 'POST', body: JSON.stringify(data) },
      token,
    ),

  specialistSpaWaitlist: (token: string, from: string, to: string) => {
    const q = new URLSearchParams({ from, to });
    return request<SpaWaitlistEntry[]>(
      `/specialist/spa-waitlist?${q}`,
      {},
      token,
    );
  },

  specialistCreateSpaWaitlist: (
    token: string,
    data: {
      serviceId: string;
      desiredStartAt?: string;
      preference?: 'EXACT' | 'WINDOW';
      windowStart?: string;
      windowEnd?: string;
      timeFromMin?: number;
      timeToMin?: number;
      weekdays?: number;
      note?: string;
      clientId?: string;
      guestName?: string;
      guestPhone?: string;
    },
  ) =>
    request<SpaWaitlistEntry>(
      '/specialist/spa-waitlist',
      { method: 'POST', body: JSON.stringify(data) },
      token,
    ),

  specialistUpdateSpaWaitlist: (
    token: string,
    id: string,
    data: {
      windowStart?: string;
      windowEnd?: string;
      timeFromMin?: number | null;
      timeToMin?: number | null;
      weekdays?: number;
      note?: string | null;
      desiredStartAt?: string;
    },
  ) =>
    request<SpaWaitlistEntry>(
      `/specialist/spa-waitlist/${id}`,
      { method: 'PATCH', body: JSON.stringify(data) },
      token,
    ),

  specialistCancelSpaWaitlist: (token: string, id: string) =>
    request<{ ok: boolean }>(
      `/specialist/spa-waitlist/${id}`,
      { method: 'DELETE' },
      token,
    ),

  specialistBookFromSpaWaitlist: (
    token: string,
    id: string,
    data?: {
      startAt?: string;
      paymentType?: 'QUOTA' | 'PAID';
      membershipServiceName?: string;
    },
  ) =>
    request<{ booking: SpaBooking; membership: Membership | null }>(
      `/specialist/spa-waitlist/${id}/book`,
      { method: 'POST', body: JSON.stringify(data ?? {}) },
      token,
    ),

  specialistCancelSpaBooking: (token: string, bookingId: string) =>
    request<{ ok: boolean }>(
      `/specialist/spa-bookings/${bookingId}`,
      { method: 'PATCH' },
      token,
    ),

  specialistUpdateSpaBooking: (
    token: string,
    bookingId: string,
    data: {
      specialistId?: string;
      serviceId?: string;
      startAt?: string;
      clientId?: string;
      guestName?: string;
      guestPhone?: string;
      paymentType?: 'QUOTA' | 'PAID';
      membershipServiceName?: string;
      visitNote?: string;
      overlapConfirmed?: boolean;
    },
  ) =>
    request<{ booking: SpaBooking }>(
      `/specialist/spa-bookings/${bookingId}`,
      { method: 'PUT', body: JSON.stringify(data) },
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
      priceOverrideMinor?: number | null;
      bookable?: boolean;
      currency?: string;
      active?: boolean;
    },
  ) =>
    request<SpaService>('/admin/spa/services', {
      method: 'POST',
      body: JSON.stringify(data),
    }, token),

  adminDeleteSpaService: (token: string, serviceId: string) =>
    request<{ deleted: boolean; hidden: boolean; service?: SpaService }>(
      `/admin/spa/services/${serviceId}`,
      { method: 'DELETE' },
      token,
    ),

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

  adminSpaBoard: (
    token: string,
    from: string,
    to: string,
    filters?: {
      specialistIds?: string[];
      serviceIds?: string[];
      status?: string;
      approval?: string;
    },
  ) => {
    const q = new URLSearchParams({ from, to });
    if (filters?.specialistIds?.length) {
      q.set('specialistIds', filters.specialistIds.join(','));
    }
    if (filters?.serviceIds?.length) {
      q.set('serviceIds', filters.serviceIds.join(','));
    }
    if (filters?.status) q.set('status', filters.status);
    if (filters?.approval) q.set('approval', filters.approval);
    return request<SpaBoardResponse>(`/admin/spa-board?${q}`, {}, token);
  },

  adminSpaClients: (token: string) =>
    request<Array<{ id: string; firstName: string; lastName: string; phone?: string }>>(
      '/admin/spa/clients',
      {},
      token,
    ),

  adminAssignSpaBooking: (
    token: string,
    data: {
      clientId?: string;
      guestName?: string;
      guestPhone?: string;
      specialistId: string;
      serviceId: string;
      startAt: string;
      paymentType: 'QUOTA' | 'PAID';
      membershipServiceName?: string;
      visitNote?: string;
      overlapConfirmed?: boolean;
    },
  ) =>
    request<{ booking: SpaBooking; membership: Membership | null }>(
      '/admin/spa-bookings',
      { method: 'POST', body: JSON.stringify(data) },
      token,
    ),

  adminBulkAssignSpaBooking: (
    token: string,
    data: {
      clientId?: string;
      guestName?: string;
      guestPhone?: string;
      specialistId: string;
      serviceId: string;
      startAt: string;
      paymentType: 'QUOTA' | 'PAID';
      membershipServiceName?: string;
      visitNote?: string;
      dates: string[];
      overlapConfirmed?: boolean;
    },
  ) =>
    request<SpaBulkBookingResult>(
      '/admin/spa-bookings/bulk',
      { method: 'POST', body: JSON.stringify(data) },
      token,
    ),

  adminSpaWaitlist: (
    token: string,
    from: string,
    to: string,
    specialistId?: string,
  ) => {
    const q = new URLSearchParams({ from, to });
    if (specialistId) q.set('specialistId', specialistId);
    return request<SpaWaitlistEntry[]>(`/admin/spa-waitlist?${q}`, {}, token);
  },

  adminCreateSpaWaitlist: (
    token: string,
    data: {
      specialistId: string;
      serviceId: string;
      desiredStartAt?: string;
      preference?: 'EXACT' | 'WINDOW';
      windowStart?: string;
      windowEnd?: string;
      timeFromMin?: number;
      timeToMin?: number;
      weekdays?: number;
      note?: string;
      clientId?: string;
      guestName?: string;
      guestPhone?: string;
    },
  ) =>
    request<SpaWaitlistEntry>(
      '/admin/spa-waitlist',
      { method: 'POST', body: JSON.stringify(data) },
      token,
    ),

  adminUpdateSpaWaitlist: (
    token: string,
    id: string,
    data: {
      windowStart?: string;
      windowEnd?: string;
      timeFromMin?: number | null;
      timeToMin?: number | null;
      weekdays?: number;
      note?: string | null;
      desiredStartAt?: string;
    },
  ) =>
    request<SpaWaitlistEntry>(
      `/admin/spa-waitlist/${id}`,
      { method: 'PATCH', body: JSON.stringify(data) },
      token,
    ),

  adminCancelSpaWaitlist: (token: string, id: string) =>
    request<{ ok: boolean }>(
      `/admin/spa-waitlist/${id}`,
      { method: 'DELETE' },
      token,
    ),

  adminBookFromSpaWaitlist: (
    token: string,
    id: string,
    data?: {
      startAt?: string;
      paymentType?: 'QUOTA' | 'PAID';
      membershipServiceName?: string;
    },
  ) =>
    request<{ booking: SpaBooking; membership: Membership | null }>(
      `/admin/spa-waitlist/${id}/book`,
      { method: 'POST', body: JSON.stringify(data ?? {}) },
      token,
    ),

  adminCancelSpaBooking: (token: string, bookingId: string) =>
    request<{ ok: boolean }>(
      `/admin/spa-bookings/${bookingId}`,
      { method: 'PATCH' },
      token,
    ),

  adminUpdateSpaBooking: (
    token: string,
    bookingId: string,
    data: {
      specialistId?: string;
      serviceId?: string;
      startAt?: string;
      clientId?: string;
      guestName?: string;
      guestPhone?: string;
      paymentType?: 'QUOTA' | 'PAID';
      membershipServiceName?: string;
      visitNote?: string;
      overlapConfirmed?: boolean;
    },
  ) =>
    request<{ booking: SpaBooking }>(
      `/admin/spa-bookings/${bookingId}`,
      { method: 'PUT', body: JSON.stringify(data) },
      token,
    ),

  adminConfirmSpaManualPayment: (token: string, bookingId: string) =>
    request<{ booking: SpaBooking }>(
      `/admin/spa-bookings/${bookingId}/confirm-manual-payment`,
      { method: 'POST', body: '{}' },
      token,
    ),

  adminGetSpecialistWorkSchedule: (token: string, specialistId: string) =>
    request<SpecialistWorkSlotInput[]>(
      `/admin/spa/specialists/${specialistId}/work-schedule`,
      {},
      token,
    ),

  adminSetSpecialistWorkSchedule: (
    token: string,
    specialistId: string,
    slots: SpecialistWorkSlotInput[],
  ) =>
    request<SpecialistWorkSlotInput[]>(
      `/admin/spa/specialists/${specialistId}/work-schedule`,
      { method: 'PUT', body: JSON.stringify({ slots }) },
      token,
    ),

  adminSetSpecialistDayHours: (
    token: string,
    specialistId: string,
    body: { day: string; startTime?: string | null; endTime?: string | null },
  ) =>
    request<{
      day: string;
      startTime: string | null;
      endTime: string | null;
    }>(
      `/admin/spa/specialists/${specialistId}/availability/day`,
      { method: 'PUT', body: JSON.stringify(body) },
      token,
    ),

  adminFillSpecialistFromTemplate: (
    token: string,
    specialistId: string,
    periodStart: string,
    periodEnd: string,
  ) =>
    request<{ createdBlocks: number }>(
      `/admin/spa/specialists/${specialistId}/schedule/fill-from-template`,
      {
        method: 'POST',
        body: JSON.stringify({ periodStart, periodEnd }),
      },
      token,
    ),

  adminPublishSpecialistSchedule: (
    token: string,
    specialistId: string,
    periodStart: string,
    periodEnd: string,
  ) =>
    request<{ publishedBlocks: number }>(
      `/admin/spa/specialists/${specialistId}/schedule/publish`,
      {
        method: 'POST',
        body: JSON.stringify({ periodStart, periodEnd }),
      },
      token,
    ),

  trainerDashboard: (token: string) =>
    request<TrainerDashboard>('/trainer/dashboard', {}, token),

  trainerGpHome: (token: string) =>
    request<FloorStaffHome>('/trainer/gp-home', {}, token),

  specialistHome: (token: string) =>
    request<FloorStaffHome>('/specialist/home', {}, token),

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

  adminHomeLayout: (token: string) =>
    request<AdminHomeLayoutValue>('/admin/home-layout', {}, token),

  adminPutHomeLayout: (
    token: string,
    body: { widgets: AdminHomeWidgetId[]; pins: AdminHomePinId[] },
  ) =>
    request<AdminHomeLayoutValue>(
      '/admin/home-layout',
      { method: 'PUT', body: JSON.stringify(body) },
      token,
    ),

  adminResetHomeLayout: (token: string) =>
    request<AdminHomeLayoutValue>(
      '/admin/home-layout',
      { method: 'DELETE' },
      token,
    ),

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

  chatConversations: (
    token: string,
    scope?: 'clients' | 'admin' | 'trainers' | 'staff',
  ) => {
    const query = scope ? `?scope=${scope}` : '';
    return request<ConversationSummary[]>(
      `/chat/conversations${query}`,
      {},
      token,
    );
  },

  chatUnreadCount: (token: string) =>
    request<{ chat: number }>('/chat/unread-count', {}, token),

  chatStaffRecipients: (token: string) =>
    request<
      Array<{
        id: string;
        firstName: string;
        lastName: string;
        roleLabel: string;
      }>
    >('/chat/staff-recipients', {}, token),

  chatOpenTrainerAdmin: (token: string) =>
    request<ConversationSummary>(
      '/chat/conversations/trainer-admin',
      { method: 'POST' },
      token,
    ),

  chatOpenStaff: (token: string, peerId: string) =>
    request<ConversationSummary>('/chat/conversations/staff', {
      method: 'POST',
      body: JSON.stringify({ peerId }),
    }, token),

  chatCreateGroup: (
    token: string,
    data: { title: string; memberIds: string[] },
  ) =>
    request<ConversationSummary>('/chat/conversations/group', {
      method: 'POST',
      body: JSON.stringify(data),
    }, token),

  chatUpdateGroup: (
    token: string,
    conversationId: string,
    data: {
      title?: string;
      addMemberIds?: string[];
      removeMemberIds?: string[];
    },
  ) =>
    request<ConversationSummary>(
      `/chat/conversations/${conversationId}/group`,
      {
        method: 'PATCH',
        body: JSON.stringify(data),
      },
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

  adminTasksInbox: (token: string) =>
    request<import('@fitgo/shared-types').AdminTasksInboxResponse>(
      '/admin/tasks/inbox',
      {},
      token,
    ),

  adminTaskOutcome: (
    token: string,
    taskId: string,
    body: {
      outcomeId: string;
      comment?: string;
      date?: string;
      snoozeDays?: number;
    },
  ) =>
    request<AdminTaskItem>(`/admin/tasks/${taskId}/outcome`, {
      method: 'POST',
      body: JSON.stringify(body),
    }, token),

  adminUpdateTask: (
    token: string,
    taskId: string,
    status: AdminTaskStatus,
    comment?: string,
  ) =>
    request(`/admin/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, comment }),
    }, token),

  adminRenewalCounters: (token: string) =>
    request<AdminRenewalCounters>('/admin/tasks/renewals/counters', {}, token),

  adminBirthdaySkipped: (token: string) =>
    request<{ skipped: number; dayKey: string; scanError?: string }>(
      '/admin/tasks/birthdays/skipped',
      {},
      token,
    ),

  adminRefreshRenewals: (token: string) =>
    request<{ created: number; closedRenewed: number; closedLost: number }>(
      '/admin/tasks/renewals/refresh',
      { method: 'POST' },
      token,
    ),

  adminTaskDetail: (token: string, taskId: string) =>
    request<AdminRenewalTaskDetail>(`/admin/tasks/${taskId}`, {}, token),

  adminClaimTask: (token: string, taskId: string) =>
    request<AdminTaskItem>(`/admin/tasks/${taskId}/claim`, {
      method: 'POST',
    }, token),

  adminTaskAction: (
    token: string,
    taskId: string,
    body: AdminRenewalActionBody,
  ) =>
    request<AdminTaskItem>(`/admin/tasks/${taskId}/action`, {
      method: 'POST',
      body: JSON.stringify(body),
    }, token),

  adminConfirmBookingClient: (
    token: string,
    taskId: string,
    body: { clientExternalId: string; confirmed?: boolean },
  ) =>
    request<AdminTaskItem>(`/admin/tasks/${taskId}/confirm-client`, {
      method: 'POST',
      body: JSON.stringify(body),
    }, token),

  adminExcludeBookingClient: (
    token: string,
    taskId: string,
    body: { clientExternalId: string },
  ) =>
    request<AdminTaskItem>(`/admin/tasks/${taskId}/exclude-client`, {
      method: 'POST',
      body: JSON.stringify(body),
    }, token),

  superAdminStaff: (token: string, opts?: { archived?: boolean }) =>
    request<StaffMember[]>(
      `/super-admin/staff${opts?.archived ? '?archived=1' : ''}`,
      {},
      token,
    ),

  superAdminArchiveStaff: (token: string, id: string) =>
    request<StaffMember>(
      `/super-admin/staff/${id}/archive`,
      { method: 'POST' },
      token,
    ),

  superAdminRestoreStaff: (token: string, id: string) =>
    request<StaffMember>(
      `/super-admin/staff/${id}/restore`,
      { method: 'POST' },
      token,
    ),

  superAdminSyncStaffFrom1C: (token: string, _replace = false) =>
    request<{
      results: Array<{
        key: string;
        added: number;
        updated: number;
        unchanged: number;
        skipped?: number;
        fetched?: number;
        pruned?: number;
        error?: string;
        notes?: string;
      }>;
      credentials: Array<{ email: string; password: string; name: string }>;
      removed?: number;
    }>(`/super-admin/segments/sync-staff`, { method: 'POST' }, token),

  superAdminSyncNomenclatureFrom1C: (
    token: string,
    kind?: 'spa' | 'membership' | 'shop' | 'all',
  ) => {
    const q = kind && kind !== 'all' ? `?kind=${kind}` : '';
    return request<{
      results: Array<{
        key: string;
        added: number;
        updated: number;
        unchanged: number;
        deactivated: number;
        error?: string;
      }>;
    }>(`/super-admin/segments/sync-nomenclature${q}`, { method: 'POST' }, token);
  },

  superAdminCreateStaff: (
    token: string,
    data: {
      firstName: string;
      lastName: string;
      dateOfBirth?: string;
      phone?: string;
      email?: string;
      password?: string;
      role?: 'ADMIN' | 'MANAGER' | 'TRAINER' | 'SPECIALIST' | 'TECH';
      roles?: Array<'ADMIN' | 'MANAGER' | 'TRAINER' | 'SPECIALIST' | 'TECH'>;
      groupPrograms?: boolean;
      trainerStaff?: boolean;
      trainerClub?: boolean;
      trainerReformers?: boolean;
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
      email: string;
      isActive: boolean;
      loginEnabled: boolean;
      password: string;
      roles: Array<'ADMIN' | 'MANAGER' | 'TRAINER' | 'SPECIALIST' | 'TECH'>;
      groupPrograms: boolean;
      trainerStaff: boolean;
      trainerClub: boolean;
      trainerReformers: boolean;
    }>,
  ) =>
    request<StaffMember & { credentials?: { email: string; password: string } }>(
      `/super-admin/staff/${id}`,
      { method: 'PATCH', body: JSON.stringify(data) },
      token,
    ),

  superAdminStaffExportUrl: () => `${API_URL}/api/super-admin/staff/export.csv`,

  superAdminSuggestedPassword: (token: string) =>
    request<{ password: string }>(
      '/super-admin/staff/suggested-password',
      {},
      token,
    ),

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

  superAdminTasks: (
    token: string,
    opts?: {
      status?: AdminTaskStatus;
      assigneeId?: string;
      onShift?: boolean;
    },
  ) => {
    const q = new URLSearchParams();
    if (opts?.status) q.set('status', opts.status);
    if (opts?.assigneeId) q.set('assigneeId', opts.assigneeId);
    if (opts?.onShift) q.set('onShift', '1');
    const qs = q.toString();
    return request<AdminTaskItem[]>(
      `/super-admin/tasks${qs ? `?${qs}` : ''}`,
      {},
      token,
    );
  },

  superAdminCreateTask: (
    token: string,
    data: {
      assigneeId?: string;
      assigneeIds?: string[];
      title: string;
      description?: string;
      dueAt?: string;
      completionMode?: 'SHARED' | 'INDIVIDUAL';
      priority?: string;
      checklist?: string[];
      pool?: boolean;
      onShift?: boolean;
    },
  ) =>
    request<AdminTaskItem | AdminTaskItem[]>('/super-admin/tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    }, token),

  superAdminBulkUpdateTasks: (
    token: string,
    data: {
      ids: string[];
      assigneeId?: string | null;
      dueAt?: string;
      priority?: string;
      status?: AdminTaskStatus;
      comment?: string;
    },
  ) =>
    request<AdminTaskItem[]>('/super-admin/tasks/bulk', {
      method: 'POST',
      body: JSON.stringify(data),
    }, token),

  superAdminUpdateTask: (
    token: string,
    id: string,
    data: Partial<{
      status: AdminTaskStatus;
      title: string;
      description: string;
      dueAt: string;
      assigneeId: string | null;
      priority: string;
      comment: string;
    }>,
  ) =>
    request<AdminTaskItem>(`/super-admin/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }, token),

  superAdminTaskEvents: (token: string, id: string) =>
    request<
      Array<{
        id: string;
        kind?: string;
        stage?: string;
        comment?: string;
        actorName?: string;
        createdAt: string;
      }>
    >(`/super-admin/tasks/${id}/events`, {}, token),

  superAdminReworkTask: (
    token: string,
    id: string,
    data: {
      comment: string;
      assigneeId?: string;
      pool?: boolean;
      dueAt?: string;
    },
  ) =>
    request<AdminTaskItem>(`/super-admin/tasks/${id}/rework`, {
      method: 'POST',
      body: JSON.stringify(data),
    }, token),

  superAdminTaskTemplates: (token: string) =>
    request<import('@fitgo/shared-types').AdminTaskTemplateItem[]>(
      '/super-admin/task-templates',
      {},
      token,
    ),

  superAdminCreateTaskTemplate: (
    token: string,
    data: import('@fitgo/shared-types').CreateAdminTaskTemplateBody,
  ) =>
    request<import('@fitgo/shared-types').AdminTaskTemplateItem>(
      '/super-admin/task-templates',
      { method: 'POST', body: JSON.stringify(data) },
      token,
    ),

  superAdminDeleteTaskTemplate: (token: string, id: string) =>
    request<{ ok: boolean }>(`/super-admin/task-templates/${id}`, {
      method: 'DELETE',
    }, token),

  superAdminTaskRules: (token: string) =>
    request<
      Array<{
        source: string;
        label: string;
        enabled: boolean;
        assignMode: 'POOL' | 'USERS' | 'ON_SHIFT';
        assigneeIds: string[];
        duePolicy: 'END_OF_DAY' | 'HOURS_BEFORE_EVENT' | 'HOURS_AFTER_CREATE';
        dueHours?: number | null;
        params: Record<string, unknown>;
      }>
    >('/super-admin/task-rules', {}, token),

  superAdminPutTaskRules: (
    token: string,
    rules: Array<{
      source: string;
      enabled: boolean;
      assignMode: 'POOL' | 'USERS' | 'ON_SHIFT';
      assigneeIds?: string[];
      duePolicy: 'END_OF_DAY' | 'HOURS_BEFORE_EVENT' | 'HOURS_AFTER_CREATE';
      dueHours?: number | null;
      params?: Record<string, unknown>;
    }>,
  ) =>
    request('/super-admin/task-rules', {
      method: 'PUT',
      body: JSON.stringify({ rules }),
    }, token),

  superAdminOverview: (token: string) =>
    request<{
      asOf: string;
      currency: string;
      onShift: Array<{
        userId: string;
        name: string;
        role: string;
        startAt: string;
        endAt: string;
      }>;
      openTasks: number;
      /** Open BIRTHDAY tasks for today (DB only). */
      birthdayToday: number;
      revenue: {
        currentMinor: number;
        prevMonthMinor: number;
        prevYearMinor: number;
        from: string;
        to: string;
        prevMonthTo: string;
        prevYearTo: string;
      };
      visits: {
        available: boolean;
        current: number | null;
        prevMonth: number | null;
        prevYear: number | null;
        hint: string | null;
      };
      salesMix: Array<{
        key: string;
        label: string;
        amountMinor: number;
        share: number;
      }>;
    }>('/super-admin/overview', {}, token),

  superAdminAnalytics: (token: string, period?: '7d' | '30d' | '90d') => {
    const q = period ? `?period=${period}` : '';
    return request<SuperAdminAnalytics>(`/super-admin/analytics${q}`, {}, token);
  },

  analyticsClub: (
    token: string,
    params: {
      from: string;
      to: string;
      compare?: AnalyticsCompareMode;
      cmpFrom?: string;
      cmpTo?: string;
      includePay?: boolean;
    },
  ) => {
    const q = new URLSearchParams({
      from: params.from,
      to: params.to,
    });
    if (params.compare) q.set('compare', params.compare);
    if (params.cmpFrom) q.set('cmpFrom', params.cmpFrom);
    if (params.cmpTo) q.set('cmpTo', params.cmpTo);
    if (params.includePay) q.set('includePay', '1');
    return request<ClubAnalyticsReport>(
      `/super-admin/analytics/club?${q}`,
      {},
      token,
    );
  },

  analyticsStaff: (
    token: string,
    params: {
      from: string;
      to: string;
      department?: AnalyticsDepartment;
      userId?: string;
      includePay?: boolean;
    },
  ) => {
    const q = new URLSearchParams({
      from: params.from,
      to: params.to,
    });
    if (params.department) q.set('department', params.department);
    if (params.userId) q.set('userId', params.userId);
    if (params.includePay) q.set('includePay', '1');
    return request<StaffAnalyticsReport>(
      `/super-admin/analytics/staff?${q}`,
      {},
      token,
    );
  },

  analyticsStaffManagerEfficiency: (
    token: string,
    params: { from: string; to: string },
  ) => {
    const q = new URLSearchParams({
      from: params.from,
      to: params.to,
    });
    return request<ManagerEfficiencyBlock>(
      `/super-admin/analytics/staff/manager-efficiency?${q}`,
      {},
      token,
    );
  },

  analyticsStaffXlsx: async (
    token: string,
    params: {
      from: string;
      to: string;
      department?: AnalyticsDepartment;
      userId?: string;
      includePay?: boolean;
    },
  ) => {
    const q = new URLSearchParams({
      from: params.from,
      to: params.to,
    });
    if (params.department) q.set('department', params.department);
    if (params.userId) q.set('userId', params.userId);
    if (params.includePay) q.set('includePay', '1');
    const res = await fetch(
      `${API_URL}/api/super-admin/analytics/staff.xlsx?${q}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    await assertBlobOk(res, token, '/super-admin/analytics/staff.xlsx');
    return res.blob();
  },

  analyticsMarket: (
    token: string,
    params: {
      from: string;
      to: string;
      compare?: AnalyticsCompareMode;
    },
  ) => {
    const q = new URLSearchParams({
      from: params.from,
      to: params.to,
    });
    if (params.compare) q.set('compare', params.compare);
    return request<PricingAnalyticsReport>(
      `/super-admin/analytics/market?${q}`,
      {},
      token,
    );
  },

  analyticsMemberships: (
    token: string,
    params: {
      from: string;
      to: string;
      basis?: MembershipEfficiencyBasis;
      view?: MembershipEfficiencyView;
      family?: string;
    },
  ) => {
    const q = new URLSearchParams({
      from: params.from,
      to: params.to,
    });
    if (params.basis) q.set('basis', params.basis);
    if (params.view) q.set('view', params.view);
    if (params.family) q.set('family', params.family);
    return request<MembershipEfficiencyReport>(
      `/super-admin/analytics/memberships?${q}`,
      {},
      token,
    );
  },

  analyticsMembershipsTrainers: (
    token: string,
    params: {
      from: string;
      to: string;
      basis?: MembershipEfficiencyBasis;
      family?: string;
    },
  ) => {
    const q = new URLSearchParams({
      from: params.from,
      to: params.to,
    });
    if (params.basis) q.set('basis', params.basis);
    if (params.family) q.set('family', params.family);
    return request<MembershipTrainersReport>(
      `/super-admin/analytics/memberships/trainers?${q}`,
      {},
      token,
    );
  },

  analyticsMembershipsClients: (
    token: string,
    params: {
      from: string;
      to: string;
      basis?: MembershipEfficiencyBasis;
      family?: string;
      segment?: MembershipUtilizationSegment;
      page?: number;
      pageSize?: number;
      sort?: string;
    },
  ) => {
    const q = new URLSearchParams({
      from: params.from,
      to: params.to,
    });
    if (params.basis) q.set('basis', params.basis);
    if (params.family) q.set('family', params.family);
    if (params.segment) q.set('segment', params.segment);
    if (params.page) q.set('page', String(params.page));
    if (params.pageSize) q.set('pageSize', String(params.pageSize));
    if (params.sort) q.set('sort', params.sort);
    return request<MembershipClientsReport>(
      `/super-admin/analytics/memberships/clients?${q}`,
      {},
      token,
    );
  },

  analyticsMembershipsXlsx: async (
    token: string,
    params: {
      from: string;
      to: string;
      basis?: MembershipEfficiencyBasis;
      view?: MembershipEfficiencyView;
      family?: string;
    },
  ) => {
    const q = new URLSearchParams({
      from: params.from,
      to: params.to,
    });
    if (params.basis) q.set('basis', params.basis);
    if (params.view) q.set('view', params.view);
    if (params.family) q.set('family', params.family);
    const res = await fetch(
      `${API_URL}/api/super-admin/analytics/memberships.xlsx?${q}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    await assertBlobOk(res, token, '/super-admin/analytics/memberships.xlsx');
    return res.blob();
  },

  analyticsMembershipsSettingsGet: (token: string) =>
    request<MembershipEconomicsSettings>(
      `/super-admin/analytics/memberships/settings`,
      {},
      token,
    ),

  analyticsMembershipsSettingsPut: (
    token: string,
    body: Partial<MembershipEconomicsSettings>,
  ) =>
    request<MembershipEconomicsSettings>(
      `/super-admin/analytics/memberships/settings`,
      { method: 'PUT', body: JSON.stringify(body) },
      token,
    ),

  analyticsMarketAddCompetitor: (
    token: string,
    body: UpsertSegmentCompetitorDto,
  ) =>
    request(`/super-admin/analytics/market/competitors`, {
      method: 'POST',
      body: JSON.stringify(body),
    }, token),

  analyticsMarketPatchCompetitor: (
    token: string,
    id: string,
    body: {
      name?: string;
      priceListUrl?: string | null;
      sortOrder?: number;
    },
  ) =>
    request(`/super-admin/analytics/market/competitors/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }, token),

  analyticsMarketDeleteCompetitor: (token: string, id: string) =>
    request(`/super-admin/analytics/market/competitors/${id}`, {
      method: 'DELETE',
    }, token),

  analyticsMarketUpsertPrice: (
    token: string,
    body: UpsertCompetitorPriceDto,
  ) =>
    request(`/super-admin/analytics/market/competitor-prices`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }, token),

  analyticsMarketBatchUpsertPrices: (
    token: string,
    body: {
      competitorId: string;
      prices: Array<{
        productExternalId: string;
        priceMinor: number;
        theirName?: string | null;
      }>;
      observedAt?: string;
    },
  ) =>
    request<{ ok: boolean; saved: number }>(
      `/super-admin/analytics/market/competitor-prices/batch`,
      {
        method: 'PUT',
        body: JSON.stringify(body),
      },
      token,
    ),

  analyticsMarketAddSaleWindow: (
    token: string,
    body: UpsertSaleWindowDto,
  ) =>
    request(`/super-admin/analytics/market/sale-windows`, {
      method: 'POST',
      body: JSON.stringify(body),
    }, token),

  analyticsMarketDeleteSaleWindow: (token: string, id: string) =>
    request(`/super-admin/analytics/market/sale-windows/${id}`, {
      method: 'DELETE',
    }, token),

  analyticsMarketRefreshDiscounts: (
    token: string,
    body: { from: string; to: string },
  ) =>
    request<{
      status: string;
      message?: string;
      imported?: number;
      missingMonths?: string[];
      syncedAt?: string | null;
    }>(
      `/super-admin/analytics/market/discounts/refresh`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
      token,
    ),

  analyticsMarketDeletePrice: (
    token: string,
    body: { competitorId: string; productExternalId: string },
  ) =>
    request(`/super-admin/analytics/market/competitor-prices`, {
      method: 'DELETE',
      body: JSON.stringify(body),
    }, token),

  analyticsMarketHideProduct: (
    token: string,
    body: {
      segmentKey: Exclude<PricingSegmentKey, 'corporate'>;
      productExternalId: string;
    },
  ) =>
    request<{ ok: boolean }>(`/super-admin/analytics/market/products`, {
      method: 'DELETE',
      body: JSON.stringify(body),
    }, token),

  analyticsTasks: (
    token: string,
    params: { from: string; to: string },
  ) => {
    const q = new URLSearchParams({
      from: params.from,
      to: params.to,
    });
    return request<AdminTaskWorkReport>(
      `/super-admin/analytics/tasks?${q}`,
      {},
      token,
    );
  },

  analyticsTasksXlsx: async (
    token: string,
    params: { from: string; to: string },
  ) => {
    const q = new URLSearchParams({
      from: params.from,
      to: params.to,
    });
    const res = await fetch(
      `${API_URL}/api/super-admin/analytics/tasks.xlsx?${q}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    await assertBlobOk(res, token, '/super-admin/analytics/tasks.xlsx');
    return res.blob();
  },

  superAdminAuditLog: (token: string) =>
    request<StaffAuditLogItem[]>('/super-admin/audit-log', {}, token),

  superAdminAppUsage: (token: string, days: 7 | 30 = 7) =>
    request<AppUsageReport>(
      `/super-admin/app-usage?days=${days}`,
      {},
      token,
    ),

  superAdminBackupStatus: (token: string) =>
    request<{
      warn: boolean;
      reason?: 'failed' | 'stale' | 'missing';
      message?: string;
      finishedAt?: string | null;
      ok?: boolean;
      bundleId?: string | null;
    }>('/super-admin/backup-status', {}, token),

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

  bookingControlList: (
    token: string,
    base: 'super-admin' | 'admin' | 'trainer' | 'specialist',
    params: {
      from: string;
      to: string;
      kind?: string;
      status?: string;
      needsReview?: boolean;
      payment?: string;
      performerId?: string;
      payTag?: string;
      flag?: string;
      hall?: string;
      reformer?: string;
      client?: string;
      clientId?: string;
      notIn1c?: boolean;
      missingJournal?: boolean;
    },
  ) => {
    const q = new URLSearchParams({ from: params.from, to: params.to });
    if (params.kind && params.kind !== 'ALL') q.set('kind', params.kind);
    if (params.status && params.status !== 'ALL') q.set('status', params.status);
    if (params.payment && params.payment !== 'ALL')
      q.set('payment', params.payment);
    if (params.needsReview) q.set('needsReview', '1');
    if (params.performerId) q.set('performerId', params.performerId);
    if (params.payTag) q.set('payTag', params.payTag);
    if (params.flag) q.set('flag', params.flag);
    if (params.hall) q.set('hall', params.hall);
    if (params.reformer) q.set('reformer', params.reformer);
    if (params.client?.trim()) q.set('client', params.client.trim());
    if (params.clientId?.trim()) q.set('clientId', params.clientId.trim());
    if (params.notIn1c) q.set('notIn1c', '1');
    if (params.missingJournal) q.set('missingJournal', '1');
    return request<import('@fitgo/shared-types').BookingControlListItem[]>(
      `/${base}/booking-control?${q}`,
      {},
      token,
    );
  },

  bookingControlDetail: (
    token: string,
    base: 'super-admin' | 'admin' | 'trainer' | 'specialist',
    sessionKey: string,
  ) =>
    request<import('@fitgo/shared-types').BookingControlDetail>(
      `/${base}/booking-control?sessionKey=${encodeURIComponent(sessionKey)}`,
      {},
      token,
    ),

  bookingControlRemark: (
    token: string,
    base: 'super-admin' | 'admin' | 'trainer' | 'specialist',
    sessionKey: string,
    comment: string,
    assigneeId?: string,
  ) =>
    request<import('@fitgo/shared-types').BookingControlRemark>(
      `/${base}/booking-control/remark`,
      {
        method: 'POST',
        body: JSON.stringify({
          sessionKey,
          comment,
          ...(assigneeId ? { assigneeId } : {}),
        }),
      },
      token,
    ),

  bookingControlRemarkAssignees: (
    token: string,
    base: 'super-admin' | 'admin',
  ) =>
    request<Array<{ id: string; name: string }>>(
      `/${base}/booking-control/remark-assignees`,
      {},
      token,
    ),

  bookingControlAssignRemark: (
    token: string,
    base: 'super-admin' | 'admin',
    sessionKey: string,
    assigneeId: string | null,
  ) =>
    request<import('@fitgo/shared-types').BookingControlRemark>(
      `/${base}/booking-control/assign-remark`,
      {
        method: 'POST',
        body: JSON.stringify({ sessionKey, assigneeId }),
      },
      token,
    ),

  bookingControlResolve: (
    token: string,
    base: 'super-admin' | 'admin',
    sessionKey: string,
    adminComment?: string,
  ) =>
    request<import('@fitgo/shared-types').BookingControlRemark>(
      `/${base}/booking-control/resolve`,
      {
        method: 'POST',
        body: JSON.stringify({
          sessionKey,
          ...(adminComment?.trim() ? { adminComment: adminComment.trim() } : {}),
        }),
      },
      token,
    ),

  bookingControlRefreshFrom1c: (
    token: string,
    base: 'super-admin' | 'admin',
    body: { from: string; to: string },
  ) =>
    request<{
      from: string;
      to: string;
      sessionsUpserted: number;
      membersUpserted: number;
      journalsTouched: number;
      endpointMissing: boolean;
      ptSalesUpserted?: number;
      message: string;
    }>(
      `/${base}/booking-control/refresh-from-1c`,
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  bookingControlSetAttendance: (
    token: string,
    base: 'super-admin' | 'admin',
    body: {
      sessionKey: string;
      clientExternalId: string;
      attendance: 'ATTENDED' | 'NO_SHOW';
    },
  ) =>
    request<import('@fitgo/shared-types').BookingControlDetail>(
      `/${base}/booking-control/attendance`,
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  bookingControlTrainerSeen: (
    token: string,
    sessionKey: string,
    seenClientIds: string[],
    comment?: string,
  ) =>
    request<import('@fitgo/shared-types').BookingControlDetail>(
      '/trainer/booking-control/trainer-seen',
      {
        method: 'POST',
        body: JSON.stringify({
          sessionKey,
          seenClientIds,
          ...(comment !== undefined ? { comment } : {}),
        }),
      },
      token,
    ),

  bookingControlBulkApprove: (
    token: string,
    body: {
      from: string;
      to: string;
      role: 'trainer' | 'admin';
      sessionKeys: string[];
    },
  ) =>
    request<{ confirmed: number; skipped: number }>(
      '/super-admin/booking-control/bulk-approve',
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  bookingControlApprove: (
    token: string,
    base: 'super-admin' | 'admin' | 'trainer' | 'specialist',
    sessionKey: string,
    comment?: string,
  ) =>
    request<import('@fitgo/shared-types').BookingControlDetail>(
      `/${base}/booking-control/approve`,
      {
        method: 'POST',
        body: JSON.stringify({ sessionKey, comment: comment ?? '' }),
      },
      token,
    ),

  bookingControlRevise: (
    token: string,
    base: 'trainer' | 'specialist',
    sessionKey: string,
    mode: 'update' | 'rereview',
    comment?: string,
  ) =>
    request<import('@fitgo/shared-types').BookingControlDetail>(
      `/${base}/booking-control/revise`,
      {
        method: 'POST',
        body: JSON.stringify({
          sessionKey,
          mode,
          comment: comment ?? '',
        }),
      },
      token,
    ),

  bookingControlReturnApproval: (
    token: string,
    base: 'super-admin' | 'admin',
    sessionKey: string,
    comment?: string,
  ) =>
    request<import('@fitgo/shared-types').BookingControlDetail>(
      `/${base}/booking-control/return-approval`,
      {
        method: 'POST',
        body: JSON.stringify({ sessionKey, comment: comment ?? '' }),
      },
      token,
    ),

  bookingControlManagerRework: (
    token: string,
    body: {
      sessionKey: string;
      target: 'trainer' | 'admin' | 'staff';
      assigneeId?: string;
      comment: string;
      dueAt?: string;
    },
  ) =>
    request<{
      mode: 'approval' | 'task';
      detail?: import('@fitgo/shared-types').BookingControlDetail;
      task?: { id: string; title: string };
      warning?: string;
    }>(
      '/super-admin/booking-control/rework',
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  bookingControlReworkAssignees: (token: string) =>
    request<
      Array<{
        id: string;
        name: string;
        roles: string[];
        externalId: string | null;
      }>
    >('/super-admin/booking-control/rework-assignees', {}, token),

  bookingControlReworkTasks: (token: string, sessionKey: string) =>
    request<
      Array<{
        id: string;
        title: string;
        assigneeId: string | null;
        dueAt?: string;
      }>
    >(
      `/super-admin/booking-control/rework-tasks?sessionKey=${encodeURIComponent(sessionKey)}`,
      {},
      token,
    ),

  trainerManagerTasks: (token: string) =>
    request<
      Array<{
        id: string;
        title: string;
        description?: string;
        dueAt?: string;
        sessionKey?: string;
        clientName?: string;
        createdBy?: { firstName: string; lastName: string };
      }>
    >('/trainer/manager-tasks', {}, token),

  trainerManagerTaskDone: (
    token: string,
    id: string,
    comment?: string,
  ) =>
    request(`/trainer/manager-tasks/${id}/done`, {
      method: 'POST',
      body: JSON.stringify({ comment: comment ?? '' }),
    }, token),

  specialistManagerTasks: (token: string) =>
    request<
      Array<{
        id: string;
        title: string;
        description?: string;
        dueAt?: string;
        sessionKey?: string;
        clientName?: string;
        createdBy?: { firstName: string; lastName: string };
      }>
    >('/specialist/manager-tasks', {}, token),

  specialistManagerTaskDone: (
    token: string,
    id: string,
    comment?: string,
  ) =>
    request(`/specialist/manager-tasks/${id}/done`, {
      method: 'POST',
      body: JSON.stringify({ comment: comment ?? '' }),
    }, token),

  superAdminClubSaleRework: (
    token: string,
    entryId: string,
    body: {
      target: 'performer' | 'admin' | 'staff';
      assigneeId?: string;
      comment: string;
      dueAt?: string;
    },
  ) =>
    request<{
      mode: 'task';
      task: { id: string; title: string };
    }>(
      `/super-admin/sales/club/${entryId}/rework`,
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  superAdminClubSaleReworkTasks: (token: string, entryId: string) =>
    request<
      Array<{
        id: string;
        title: string;
        dueAt?: string;
        assignee?: { id: string; firstName: string; lastName: string };
      }>
    >(`/super-admin/sales/club/${entryId}/rework-tasks`, {}, token),

  superAdminSalesReworkAssignees: (token: string) =>
    request<
      Array<{
        id: string;
        name: string;
        roles: string[];
        externalId: string | null;
      }>
    >('/super-admin/sales/rework-assignees', {}, token),

  bookingControlSpaLinkSale: (
    token: string,
    base: 'super-admin' | 'admin',
    body: {
      bookingId: string;
      saleExternalId: string;
      applyServiceId?: string;
    },
  ) =>
    request<import('@fitgo/shared-types').BookingControlDetail>(
      `/${base}/booking-control/spa-link-sale`,
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  bookingControlSpaLinkVisit: (
    token: string,
    base: 'super-admin' | 'admin',
    body: { bookingId: string; onexExternalId: string },
  ) =>
    request<import('@fitgo/shared-types').BookingControlDetail>(
      `/${base}/booking-control/spa-link-visit`,
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  bookingControlSpaUnlink: (
    token: string,
    base: 'super-admin' | 'admin',
    bookingId: string,
  ) =>
    request<import('@fitgo/shared-types').BookingControlDetail>(
      `/${base}/booking-control/spa-unlink`,
      { method: 'POST', body: JSON.stringify({ bookingId }) },
      token,
    ),

  bookingControlSpaAdoptJournal: (
    token: string,
    base: 'super-admin' | 'admin' | 'specialist',
    body: { sessionKey: string; serviceId?: string },
  ) =>
    request<import('@fitgo/shared-types').BookingControlDetail>(
      `/${base}/booking-control/spa-adopt-journal`,
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  bookingControlSpaAdoptJournalBulk: (
    token: string,
    base: 'super-admin' | 'admin' | 'specialist',
    sessionKeys: string[],
  ) =>
    request<{
      added: number;
      skipped: Array<{ sessionKey: string; reason: string }>;
    }>(
      `/${base}/booking-control/spa-adopt-journal-bulk`,
      { method: 'POST', body: JSON.stringify({ sessionKeys }) },
      token,
    ),

  bookingControlPendingApprovals: (
    token: string,
    base: 'super-admin' | 'admin',
    params?: { from?: string; to?: string; kind?: 'GROUP' | 'SPA' | 'PT' },
  ) => {
    const q = new URLSearchParams();
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    if (params?.kind) q.set('kind', params.kind);
    const qs = q.toString();
    return request<import('@fitgo/shared-types').GroupApprovalPendingTask[]>(
      `/${base}/booking-control/pending-approvals${qs ? `?${qs}` : ''}`,
      {},
      token,
    );
  },

  adminDebtLines: (token: string, taskId: string) =>
    request<import('@fitgo/shared-types').AdminDebtLine[]>(
      `/admin/tasks/${taskId}/debt-lines`,
      {},
      token,
    ),

  adminSnoozeTask: (token: string, taskId: string, days: number) =>
    request<AdminTaskItem>(`/admin/tasks/${taskId}/snooze`, {
      method: 'POST',
      body: JSON.stringify({ days }),
    }, token),

  adminTaskComment: (token: string, taskId: string, comment: string) =>
    request(`/admin/tasks/${taskId}/comment`, {
      method: 'POST',
      body: JSON.stringify({ comment }),
    }, token),

  bookingControlHallSnapshots: (
    token: string,
    base: 'super-admin' | 'admin' | 'trainer',
    sessionKey: string,
  ) =>
    request<import('@fitgo/shared-types').HallClassSnapshotItem[]>(
      `/${base}/booking-control/hall-snapshots?sessionKey=${encodeURIComponent(sessionKey)}`,
      {},
      token,
    ),

  bookingControlHallSnapshotImageUrl: async (
    token: string,
    base: 'super-admin' | 'admin' | 'trainer',
    snapshotId: string,
  ): Promise<string> => {
    const response = await fetch(
      `${API_URL}/api/${base}/booking-control/hall-snapshots/${encodeURIComponent(snapshotId)}/image`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) {
      if (response.status === 401) {
        handleUnauthorized(
          Boolean(token),
          `/${base}/booking-control/hall-snapshots/image`,
        );
      }
      const error = await response.json().catch(() => ({}));
      throw new Error(errorMessageFromBody(error, response.status));
    }
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  },

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

  discrepanciesSummary: (
    token: string,
    params: { from: string; to: string; employee?: string },
  ) => {
    const q = new URLSearchParams({ from: params.from, to: params.to });
    if (params.employee) q.set('employee', params.employee);
    return request<import('@fitgo/shared-types').DiscrepancySummary>(
      `/super-admin/discrepancies/summary?${q}`,
      {},
      token,
    );
  },

  discrepanciesSegments: (
    token: string,
    params: {
      from: string;
      to: string;
      employee?: string;
      showAcked?: boolean;
    },
  ) => {
    const q = new URLSearchParams({ from: params.from, to: params.to });
    if (params.employee) q.set('employee', params.employee);
    if (params.showAcked) q.set('showAcked', '1');
    return request<import('@fitgo/shared-types').DiscrepancySegmentsResponse>(
      `/super-admin/discrepancies/segments?${q}`,
      {},
      token,
    );
  },

  discrepanciesRecheckSegments: (token: string) =>
    request<{ ok: boolean }>(
      '/super-admin/discrepancies/segments/recheck',
      { method: 'POST', body: '{}' },
      token,
    ),

  discrepanciesSales: (
    token: string,
    params: {
      from: string;
      to: string;
      employee?: string;
      showAcked?: boolean;
    },
  ) => {
    const q = new URLSearchParams({ from: params.from, to: params.to });
    if (params.employee) q.set('employee', params.employee);
    if (params.showAcked) q.set('showAcked', '1');
    return request<import('@fitgo/shared-types').DiscrepancySalesResponse>(
      `/super-admin/discrepancies/sales?${q}`,
      {},
      token,
    );
  },

  discrepanciesSpa: (
    token: string,
    params: { from: string; to: string; employee?: string; showAcked?: boolean },
  ) => {
    const q = new URLSearchParams({ from: params.from, to: params.to });
    if (params.employee) q.set('employee', params.employee);
    if (params.showAcked) q.set('showAcked', '1');
    return request<import('@fitgo/shared-types').DiscrepancySpaPtResponse>(
      `/super-admin/discrepancies/spa?${q}`,
      {},
      token,
    );
  },

  discrepanciesPt: (
    token: string,
    params: { from: string; to: string; employee?: string; showAcked?: boolean },
  ) => {
    const q = new URLSearchParams({ from: params.from, to: params.to });
    if (params.employee) q.set('employee', params.employee);
    if (params.showAcked) q.set('showAcked', '1');
    return request<import('@fitgo/shared-types').DiscrepancySpaPtResponse>(
      `/super-admin/discrepancies/pt?${q}`,
      {},
      token,
    );
  },

  discrepanciesGroup: (
    token: string,
    params: { from: string; to: string; employee?: string; showAcked?: boolean },
  ) => {
    const q = new URLSearchParams({ from: params.from, to: params.to });
    if (params.employee) q.set('employee', params.employee);
    if (params.showAcked) q.set('showAcked', '1');
    return request<import('@fitgo/shared-types').DiscrepancyGroupResponse>(
      `/super-admin/discrepancies/group?${q}`,
      {},
      token,
    );
  },

  discrepanciesAck: (
    token: string,
    body: {
      tab: string;
      itemKey: string;
      fingerprint: string;
      note?: string;
    },
  ) =>
    request<{ ok: boolean }>(
      '/super-admin/discrepancies/ack',
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  discrepancyTaskOptions: (
    token: string,
    params: {
      date?: string;
      at?: string;
      tab?: string;
      performerUserId?: string;
    },
  ) => {
    const q = new URLSearchParams();
    if (params.date) q.set('date', params.date);
    if (params.at) q.set('at', params.at);
    if (params.tab) q.set('tab', params.tab);
    if (params.performerUserId) q.set('performerUserId', params.performerUserId);
    return request<import('@fitgo/shared-types').DiscrepancyTaskOptions>(
      `/super-admin/discrepancies/tasks/options?${q}`,
      {},
      token,
    );
  },

  discrepancyTaskLinks: (token: string, tab: string) =>
    request<import('@fitgo/shared-types').DiscrepancyTaskLink[]>(
      `/super-admin/discrepancies/tasks/links?tab=${encodeURIComponent(tab)}`,
      {},
      token,
    ),

  discrepancyTaskCreate: (
    token: string,
    body: import('@fitgo/shared-types').DiscrepancyTaskCreateBody,
  ) =>
    request<{ created: number }>(
      '/super-admin/discrepancies/tasks',
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  discrepancyTaskRules: (token: string) =>
    request<import('@fitgo/shared-types').DiscrepancyTaskRuleDto[]>(
      '/super-admin/discrepancies/tasks/rules',
      {},
      token,
    ),

  discrepancyTaskRulesSave: (
    token: string,
    rules: import('@fitgo/shared-types').DiscrepancyTaskRuleDto[],
  ) =>
    request<import('@fitgo/shared-types').DiscrepancyTaskRuleDto[]>(
      '/super-admin/discrepancies/tasks/rules',
      { method: 'PUT', body: JSON.stringify({ rules }) },
      token,
    ),

  discrepancyTaskAutoRun: (token: string) =>
    request<import('@fitgo/shared-types').DiscrepancyAutoRunResult>(
      '/super-admin/discrepancies/tasks/auto/run',
      { method: 'POST', body: '{}' },
      token,
    ),

  staffTasksMine: (token: string) =>
    request<
      Array<{
        id: string;
        title: string;
        description?: string;
        status: string;
        dueAt?: string;
        createdAt: string;
        createdBy?: string;
        auto: boolean;
      }>
    >('/staff-tasks/mine', {}, token),

  staffTaskDone: (token: string, id: string, comment?: string) =>
    request<{ ok: boolean }>(
      `/staff-tasks/${id}/done`,
      { method: 'POST', body: JSON.stringify({ comment }) },
      token,
    ),

  webkassaSync: (token: string, from: string, to: string) => {
    const q = new URLSearchParams({ from, to });
    return request<{ ok: boolean; count: number }>(
      `/super-admin/webkassa/sync?${q}`,
      { method: 'POST', body: '{}' },
      token,
    );
  },

  webkassaUpload: async (token: string, file: File) => {
    // JSON base64 — Next rewrite /api → Nest truncates multipart («Unexpected end of form»).
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return request<{ ok: boolean; count: number }>(
      '/super-admin/webkassa/upload-json',
      {
        method: 'POST',
        body: JSON.stringify({
          fileBase64: btoa(binary),
          filename: file.name,
        }),
      },
      token,
    );
  },

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
      roomTitle?: string;
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

  payrollCopyStaffProfile: (
    token: string,
    userId: string,
    body: {
      departments: Array<'ADMIN' | 'MANAGER' | 'TRAINER' | 'SPECIALIST' | 'TECH'>;
      tracks?: Array<
        | 'ADMIN'
        | 'MANAGER'
        | 'GROUP_TRAINER'
        | 'SPA'
        | 'TECH'
        | 'PT'
        | 'CLUB'
        | 'REFORMER'
      >;
      trainerGroups?: Array<'GP' | 'STAFF' | 'CLUB' | 'REFORMER'>;
      effectiveFrom?: string;
    },
  ) =>
    request<{ copied: number; skipped: number }>(
      `/super-admin/payroll/staff/${userId}/profile/copy`,
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  payrollPayTemplates: (token: string) =>
    request<import('@fitgo/shared-types').StaffPayTemplateDto[]>(
      '/super-admin/payroll/pay-templates',
      {},
      token,
    ),

  payrollSavePayTemplate: (
    token: string,
    body: {
      track: import('@fitgo/shared-types').StaffPayTrack;
      baseSalaryMinor?: number;
      payProfile: import('@fitgo/shared-types').StaffPayProfile;
      label?: string;
    },
  ) =>
    request<import('@fitgo/shared-types').StaffPayTemplateDto>(
      '/super-admin/payroll/pay-templates',
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  payrollApplyPayTemplate: (
    token: string,
    userId: string,
    body?: {
      tracks?: import('@fitgo/shared-types').StaffPayTrack[];
      effectiveFrom?: string;
    },
  ) =>
    request<import('@fitgo/shared-types').StaffCompensationDto>(
      `/super-admin/payroll/staff/${userId}/profile/apply-template`,
      { method: 'POST', body: JSON.stringify(body ?? {}) },
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

  /** Re-read Документ.Занятие for period from 1C, then caller reloads summary. */
  classSyncRefreshForPayroll: (
    token: string,
    body: { from: string; to: string; userId?: string },
    mode: 'super' | 'admin' = 'super',
  ) =>
    request<{
      from: string;
      to: string;
      sessionsUpserted: number;
      membersUpserted: number;
      journalsTouched: number;
      endpointMissing: boolean;
      periodLocked?: boolean;
      message: string;
    }>(
      mode === 'super'
        ? '/super-admin/class-sync/refresh-for-payroll'
        : '/admin/class-sync/refresh-for-payroll',
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  classSyncSessions: (
    token: string,
    body?: { from?: string; to?: string; yearToDate?: boolean },
  ) =>
    request<{
      from: string;
      to: string;
      sessionsUpserted: number;
      endpointMissing: boolean;
    }>(
      '/super-admin/class-sync/sessions',
      { method: 'POST', body: JSON.stringify(body ?? {}) },
      token,
    ),

  classSyncVisits: (
    token: string,
    body?: { from?: string; to?: string; yearToDate?: boolean },
  ) =>
    request<{
      from: string;
      to: string;
      upserted: number;
      endpointMissing: boolean;
    }>(
      '/super-admin/class-sync/visits',
      { method: 'POST', body: JSON.stringify(body ?? {}) },
      token,
    ),

  payrollClubSummary: (
    token: string,
    params: {
      from: string;
      to: string;
      department?: string;
    },
  ) => {
    const q = new URLSearchParams({
      from: params.from,
      to: params.to,
    });
    if (params.department) q.set('department', params.department);
    return request<import('@fitgo/shared-types').ClubPayrollReport>(
      `/super-admin/payroll/club-summary?${q}`,
      {},
      token,
    );
  },

  payrollClubSummaryXlsx: async (
    token: string,
    params: {
      from: string;
      to: string;
      department?: string;
      picture?: boolean;
    },
  ) => {
    const q = new URLSearchParams({
      from: params.from,
      to: params.to,
    });
    if (params.department) q.set('department', params.department);
    if (params.picture) q.set('picture', '1');
    const res = await fetch(
      `${API_URL}/api/super-admin/payroll/club-summary.xlsx?${q}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    await assertBlobOk(res, token, '/super-admin/payroll/club-summary.xlsx');
    return res.blob();
  },

  payrollCorporateSales: (
    token: string,
    params: { from: string; to: string },
  ) => {
    const q = new URLSearchParams(params);
    return request<import('@fitgo/shared-types').PayrollCorporateSaleDto[]>(
      `/super-admin/payroll/corporate-sales?${q}`,
      {},
      token,
    );
  },

  payrollUpsertCorporateSale: (
    token: string,
    body: {
      userId: string;
      periodFrom: string;
      periodTo: string;
      amountMinor: number;
      note?: string;
    },
  ) =>
    request<import('@fitgo/shared-types').PayrollCorporateSaleDto>(
      '/super-admin/payroll/corporate-sales',
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  payrollSetEmployment: (
    token: string,
    userId: string,
    employmentKind: import('@fitgo/shared-types').StaffEmploymentKind,
  ) =>
    request<{ userId: string; employmentKind: string }>(
      `/super-admin/payroll/staff/${userId}/employment`,
      {
        method: 'PATCH',
        body: JSON.stringify({ employmentKind }),
      },
      token,
    ),

  payrollSetMotivationExclusion: (
    token: string,
    userId: string,
    excludeFromPayrollMotivation: boolean,
  ) =>
    request<{ userId: string; excludeFromPayrollMotivation: boolean }>(
      `/super-admin/payroll/staff/${userId}/motivation-exclusion`,
      {
        method: 'PATCH',
        body: JSON.stringify({ excludeFromPayrollMotivation }),
      },
      token,
    ),

  payrollSetSpaPartner: (
    token: string,
    bookingId: string,
    partnerSource: string | null,
  ) =>
    request<{ id: string; partnerSource: string | null }>(
      `/super-admin/payroll/spa-bookings/${bookingId}/partner`,
      {
        method: 'PATCH',
        body: JSON.stringify({ partnerSource }),
      },
      token,
    ),

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

  payrollUpdateAdjustment: (
    token: string,
    id: string,
    body: { amountMinor?: number; reason?: string },
  ) =>
    request<import('@fitgo/shared-types').PayrollAdjustmentDto>(
      `/super-admin/payroll/adjustments/${id}`,
      { method: 'PATCH', body: JSON.stringify(body) },
      token,
    ),

  payrollDeleteAdjustment: (token: string, id: string) =>
    request<{ success: boolean }>(
      `/super-admin/payroll/adjustments/${id}`,
      { method: 'DELETE' },
      token,
    ),

  payrollPayouts: (token: string, userId: string) => {
    const q = new URLSearchParams({ userId });
    return request<import('@fitgo/shared-types').PayrollPayoutDto[]>(
      `/super-admin/payroll/payouts?${q}`,
      {},
      token,
    );
  },

  payrollPayoutPreview: (
    token: string,
    params: {
      userId: string;
      kind: import('@fitgo/shared-types').PayrollPayoutKind;
      year: number;
      month: number;
      periodFrom?: string;
      periodTo?: string;
    },
  ) => {
    const q = new URLSearchParams({
      userId: params.userId,
      kind: params.kind,
      year: String(params.year),
      month: String(params.month),
    });
    if (params.periodFrom) q.set('periodFrom', params.periodFrom);
    if (params.periodTo) q.set('periodTo', params.periodTo);
    return request<import('@fitgo/shared-types').PayrollPayoutPreview>(
      `/super-admin/payroll/payouts/preview?${q}`,
      {},
      token,
    );
  },

  payrollPayoutBatchPreview: (
    token: string,
    params: {
      kind: import('@fitgo/shared-types').PayrollPayoutKind;
      year: number;
      month: number;
      periodFrom?: string;
      periodTo?: string;
      department?: string;
      userIds?: string[];
    },
  ) => {
    const q = new URLSearchParams({
      kind: params.kind,
      year: String(params.year),
      month: String(params.month),
    });
    if (params.periodFrom) q.set('periodFrom', params.periodFrom);
    if (params.periodTo) q.set('periodTo', params.periodTo);
    if (params.department) q.set('department', params.department);
    if (params.userIds?.length) q.set('userIds', params.userIds.join(','));
    return request<import('@fitgo/shared-types').PayrollPayoutPreview[]>(
      `/super-admin/payroll/payouts/batch-preview?${q}`,
      {},
      token,
    );
  },

  payrollPayoutSaveDraft: (
    token: string,
    body: {
      userId: string;
      kind: import('@fitgo/shared-types').PayrollPayoutKind;
      year: number;
      month: number;
      periodFrom?: string;
      periodTo?: string;
      cardTransferMinor?: number;
      actualCashMinor?: number;
    },
  ) =>
    request<import('@fitgo/shared-types').PayrollPayoutDto>(
      '/super-admin/payroll/payouts/draft',
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  payrollPayoutConfirm: (
    token: string,
    body: {
      userId: string;
      kind: import('@fitgo/shared-types').PayrollPayoutKind;
      year: number;
      month: number;
      periodFrom?: string;
      periodTo?: string;
      cardTransferMinor?: number;
      actualCashMinor?: number;
      note?: string;
    },
  ) =>
    request<import('@fitgo/shared-types').PayrollPayoutDto>(
      '/super-admin/payroll/payouts/confirm',
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  payrollPayoutConfirmBatch: (
    token: string,
    body: {
      kind: import('@fitgo/shared-types').PayrollPayoutKind;
      year: number;
      month: number;
      periodFrom?: string;
      periodTo?: string;
      items: Array<{
        userId: string;
        cardTransferMinor?: number;
        actualCashMinor?: number;
        note?: string;
      }>;
    },
  ) =>
    request<import('@fitgo/shared-types').PayrollPayoutDto[]>(
      '/super-admin/payroll/payouts/confirm-batch',
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

  payrollHoldPreview: (
    token: string,
    base: 'super-admin' | 'admin',
    sessionKey: string,
  ) => {
    const q = new URLSearchParams({ sessionKey });
    return request<{
      line: string;
      held: boolean;
      earnMinor?: number;
      ratePercent?: number;
      priceMinor?: number;
    } | null>(`/${base}/payroll/hold-preview?${q}`, {}, token);
  },

  selfPayrollOverview: (
    token: string,
    params: { from: string; to: string },
  ) => {
    const q = new URLSearchParams(params);
    return request<import('@fitgo/shared-types').PayrollSelfOverview>(
      `/me/payroll/overview?${q}`,
      {},
      token,
    );
  },

  /** Sale card linked to a work unit on self payroll (admin/trainer/specialist). */
  selfPayrollSaleDetail: (
    token: string,
    externalId: string,
    params: { from: string; to: string },
  ) => {
    const q = new URLSearchParams(params);
    return request<import('@fitgo/shared-types').ClubRevenueDetailResponse>(
      `/me/payroll/sale/${encodeURIComponent(externalId)}?${q}`,
      {},
      token,
    );
  },

  specialistPayrollSaleDetail: (
    token: string,
    externalId: string,
    params: { from: string; to: string },
  ) => {
    const q = new URLSearchParams(params);
    return request<import('@fitgo/shared-types').ClubRevenueDetailResponse>(
      `/specialist/payroll/sale/${encodeURIComponent(externalId)}?${q}`,
      {},
      token,
    );
  },

  adminMySales: (
    token: string,
    params: {
      from: string;
      to: string;
      saleType?: string;
      payment?: string;
      includeLines?: boolean;
    },
  ) => {
    const q = new URLSearchParams({ from: params.from, to: params.to });
    if (params.saleType && params.saleType !== 'all')
      q.set('saleType', params.saleType);
    if (params.payment && params.payment !== 'all')
      q.set('payment', params.payment);
    if (params.includeLines) q.set('includeLines', '1');
    return request<import('@fitgo/shared-types').AdminMySalesResponse>(
      `/admin/sales/mine?${q}`,
      {},
      token,
    );
  },

  superAdminSales: (
    token: string,
    params: {
      from: string;
      to: string;
      saleType?: string;
      payment?: string;
      q?: string;
    },
  ) => {
    const q = new URLSearchParams({ from: params.from, to: params.to });
    if (params.saleType && params.saleType !== 'all')
      q.set('saleType', params.saleType);
    if (params.payment && params.payment !== 'all')
      q.set('payment', params.payment);
    if (params.q) q.set('q', params.q);
    return request<import('@fitgo/shared-types').AdminSalesOverviewResponse>(
      `/super-admin/sales?${q}`,
      {},
      token,
    );
  },

  superAdminSalesStaff: (
    token: string,
    userId: string,
    params: {
      from: string;
      to: string;
      saleType?: string;
      payment?: string;
    },
  ) => {
    const q = new URLSearchParams({ from: params.from, to: params.to });
    if (params.saleType && params.saleType !== 'all')
      q.set('saleType', params.saleType);
    if (params.payment && params.payment !== 'all')
      q.set('payment', params.payment);
    return request<import('@fitgo/shared-types').AdminSalesStaffDetailResponse>(
      `/super-admin/sales/staff/${userId}?${q}`,
      {},
      token,
    );
  },

  superAdminSalesSync: (token: string) =>
    request<{
      status: 'started' | 'running';
      running?: boolean;
      error?: string | null;
      lastSyncedAt?: string | null;
      adminStatus?: string | null;
      revenueStatus?: string | null;
    }>('/super-admin/sales/sync', { method: 'POST' }, token),

  superAdminSalesSyncStatus: (token: string) =>
    request<{
      running: boolean;
      error: string | null;
      lastSyncedAt: string | null;
      adminStatus: string | null;
      revenueStatus: string | null;
    }>('/super-admin/sales/sync-status', {}, token),

  superAdminClubSales: (
    token: string,
    params: {
      from: string;
      to: string;
      operationType?: string;
      paymentMethod?: string;
      employeeExternalId?: string;
      q?: string;
      productId?: string;
      productExact?: boolean;
      segment?: string;
      debtor?: string;
    },
  ) => {
    const q = new URLSearchParams({ from: params.from, to: params.to });
    if (params.operationType && params.operationType !== 'all')
      q.set('operationType', params.operationType);
    if (params.paymentMethod && params.paymentMethod !== 'all')
      q.set('paymentMethod', params.paymentMethod);
    if (params.employeeExternalId)
      q.set('employeeExternalId', params.employeeExternalId);
    if (params.q) q.set('q', params.q);
    if (params.productId) q.set('productId', params.productId);
    if (params.productExact) q.set('productExact', '1');
    if (params.segment && params.segment !== 'all')
      q.set('segment', params.segment);
    if (params.debtor) q.set('debtor', params.debtor);
    return request<import('@fitgo/shared-types').ClubRevenueReportResponse>(
      `/super-admin/sales/club?${q}`,
      {},
      token,
    );
  },

  superAdminClubSaleDetail: (token: string, id: string) =>
    request<import('@fitgo/shared-types').ClubRevenueDetailResponse>(
      `/super-admin/sales/club/${id}`,
      {},
      token,
    ),

  superAdminClubSalesXlsx: async (
    token: string,
    params: {
      from: string;
      to: string;
      operationType?: string;
      paymentMethod?: string;
      employeeExternalId?: string;
      q?: string;
      productId?: string;
      productExact?: boolean;
      segment?: string;
      debtor?: string;
    },
  ) => {
    const q = new URLSearchParams({ from: params.from, to: params.to });
    if (params.operationType && params.operationType !== 'all')
      q.set('operationType', params.operationType);
    if (params.paymentMethod && params.paymentMethod !== 'all')
      q.set('paymentMethod', params.paymentMethod);
    if (params.employeeExternalId)
      q.set('employeeExternalId', params.employeeExternalId);
    if (params.q) q.set('q', params.q);
    if (params.productId) q.set('productId', params.productId);
    if (params.productExact) q.set('productExact', '1');
    if (params.segment && params.segment !== 'all')
      q.set('segment', params.segment);
    if (params.debtor) q.set('debtor', params.debtor);
    const res = await fetch(
      `${API_URL}/api/super-admin/sales/club.xlsx?${q}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    await assertBlobOk(res, token, '/super-admin/sales/club.xlsx');
    return res.blob();
  },

  superAdminClubSalesManualAdd: (
    token: string,
    body: {
      kind: import('@fitgo/shared-types').ClubRevenueManualKind;
      amount: number;
      entryDate: string;
      note?: string;
    },
  ) =>
    request<import('@fitgo/shared-types').ClubRevenueManualEntryDto>(
      '/super-admin/sales/club/manual',
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  superAdminClubSalesManualDelete: (token: string, id: string) =>
    request<{ ok?: boolean }>(
      `/super-admin/sales/club/manual/${id}`,
      { method: 'DELETE' },
      token,
    ),

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

  trainerPtStats: (token: string, from: string, to: string) =>
    request<import('@fitgo/shared-types').PtStatsReport>(
      `/trainer/pt-timesheet/stats?from=${from}&to=${to}`,
      {},
      token,
    ),

  adminPtStatsTrainers: (token: string, from: string, to: string) => {
    const q = new URLSearchParams({ from, to });
    return request<Array<{ id: string; name: string }>>(
      `/admin/pt-timesheet/stats/trainers?${q}`,
      {},
      token,
    );
  },

  adminPtStats: (
    token: string,
    from: string,
    to: string,
    trainerId?: string,
  ) => {
    const q = new URLSearchParams({ from, to });
    if (trainerId) q.set('trainerId', trainerId);
    return request<import('@fitgo/shared-types').PtStatsReport>(
      `/admin/pt-timesheet/stats?${q}`,
      {},
      token,
    );
  },

  adminPtStatsXlsx: async (
    token: string,
    from: string,
    to: string,
    trainerId?: string,
  ) => {
    const q = new URLSearchParams({ from, to });
    if (trainerId) q.set('trainerId', trainerId);
    const res = await fetch(
      `${API_URL}/api/admin/pt-timesheet/stats.xlsx?${q}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    await assertBlobOk(res, token, '/admin/pt-timesheet/stats.xlsx');
    return res.blob();
  },

  saPtStatsTrainers: (token: string, from: string, to: string) => {
    const q = new URLSearchParams({ from, to });
    return request<Array<{ id: string; name: string }>>(
      `/super-admin/pt-timesheet/stats/trainers?${q}`,
      {},
      token,
    );
  },

  saPtStats: (
    token: string,
    from: string,
    to: string,
    trainerId?: string,
  ) => {
    const q = new URLSearchParams({ from, to });
    if (trainerId) q.set('trainerId', trainerId);
    return request<import('@fitgo/shared-types').PtStatsReport>(
      `/super-admin/pt-timesheet/stats?${q}`,
      {},
      token,
    );
  },

  saPtStatsXlsx: async (
    token: string,
    from: string,
    to: string,
    trainerId?: string,
  ) => {
    const q = new URLSearchParams({ from, to });
    if (trainerId) q.set('trainerId', trainerId);
    const res = await fetch(
      `${API_URL}/api/super-admin/pt-timesheet/stats.xlsx?${q}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    await assertBlobOk(res, token, '/super-admin/pt-timesheet/stats.xlsx');
    return res.blob();
  },

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

  adminPtConfirmManualPayment: (token: string, bookingId: string) =>
    request<import('@fitgo/shared-types').TrainerDaySheetDto>(
      `/admin/pt-timesheet/bookings/${bookingId}/confirm-manual-payment`,
      { method: 'POST', body: '{}' },
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

  adminRosterPatchDay: (
    token: string,
    body: {
      date: string;
      holiday?: boolean;
      hours?: { open: string; close: string; closed?: boolean } | null;
    },
  ) =>
    request<import('@fitgo/shared-types').ClubWorkingHours>(
      '/admin/staff-roster/day',
      { method: 'PUT', body: JSON.stringify(body) },
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
      userId?: string;
      userIds?: string[];
      track: import('@fitgo/shared-types').StaffShiftTrack;
      date: string;
      startAt: string;
      endAt: string;
      note?: string;
      overtimeMinutes?: number;
    },
  ) =>
    request<import('@fitgo/shared-types').StaffShiftDto[]>(
      '/admin/staff-roster/shifts',
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  adminRosterFillShifts: (
    token: string,
    body: {
      userId: string;
      track: import('@fitgo/shared-types').StaffShiftTrack;
      startTime: string;
      endTime: string;
      dates: string[];
      overtimeMinutes?: number;
      skipIfExists?: boolean;
    },
  ) =>
    request<{
      created: number;
      skipped: Array<{ date: string; reason: string }>;
    }>(
      '/admin/staff-roster/shifts/fill',
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

  saRosterPatchDay: (
    token: string,
    body: {
      date: string;
      holiday?: boolean;
      hours?: { open: string; close: string; closed?: boolean } | null;
    },
  ) =>
    request<import('@fitgo/shared-types').ClubWorkingHours>(
      '/super-admin/staff-roster/day',
      { method: 'PUT', body: JSON.stringify(body) },
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
      userId?: string;
      userIds?: string[];
      track: import('@fitgo/shared-types').StaffShiftTrack;
      date: string;
      startAt: string;
      endAt: string;
      note?: string;
      overtimeMinutes?: number;
    },
  ) =>
    request<import('@fitgo/shared-types').StaffShiftDto[]>(
      '/super-admin/staff-roster/shifts',
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),

  saRosterFillShifts: (
    token: string,
    body: {
      userId: string;
      track: import('@fitgo/shared-types').StaffShiftTrack;
      startTime: string;
      endTime: string;
      dates: string[];
      overtimeMinutes?: number;
      skipIfExists?: boolean;
    },
  ) =>
    request<{
      created: number;
      skipped: Array<{ date: string; reason: string }>;
    }>(
      '/super-admin/staff-roster/shifts/fill',
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

  staffProfileMine: (token: string) =>
    request<StaffProfileDto>('/me/staff-profile', {}, token),

  staffProfileUpdateBio: (token: string, bio: string) =>
    request<StaffProfileDto>(
      '/me/staff-profile',
      { method: 'PATCH', body: JSON.stringify({ bio }) },
      token,
    ),

  staffProfileUploadPhoto: async (token: string, file: File) => {
    // JSON base64 — Next rewrite /api → Nest truncates multipart («Unexpected end of form»).
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return request<StaffProfileDto>(
      '/me/staff-profile/photo-json',
      {
        method: 'POST',
        body: JSON.stringify({
          fileBase64: btoa(binary),
          mimeType: file.type || undefined,
        }),
      },
      token,
    );
  },

  clientStaffCard: (token: string, id: string) =>
    request<StaffProfileDto>(`/client/staff/${id}`, {}, token),

  trainerGpSchedule: (token: string, from: string, to: string) =>
    request<import('@fitgo/shared-types').GpScheduleEvent[]>(
      `/trainer/gp-schedule?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      {},
      token,
    ),

  adminClubSchedule: (
    token: string,
    base: 'admin' | 'super-admin' | 'trainer',
    params: {
      from: string;
      to: string;
      types?: string;
      staffIds?: string;
      status?: string;
      approval?: string;
      clubId?: string;
    },
  ) => {
    const q = new URLSearchParams({ from: params.from, to: params.to });
    if (params.types) q.set('types', params.types);
    if (params.staffIds) q.set('staffIds', params.staffIds);
    if (params.status) q.set('status', params.status);
    if (params.approval) q.set('approval', params.approval);
    if (params.clubId) q.set('clubId', params.clubId);
    return request<import('@fitgo/shared-types').ClubScheduleEvent[]>(
      `/${base}/club-schedule?${q}`,
      {},
      token,
    );
  },

  specialistAvailabilityCheck: (
    token: string,
    body: { startAt: string; endAt: string },
  ) =>
    request<{
      overlaps: Array<{
        specialistId: string;
        specialistName: string;
        reason: string;
        defaultSpaRoomId?: string | null;
      }>;
    }>(
      '/specialist/availability/check',
      { method: 'POST', body: JSON.stringify(body) },
      token,
    ),
};
