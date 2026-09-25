import type {
  VisitKind as VisitKindT,
  VisitVerificationStatus as VisitVerificationStatusT,
} from './visit-kind';

export enum UserRole {
  CLIENT = 'CLIENT',
  TRAINER = 'TRAINER',
  SPECIALIST = 'SPECIALIST',
  TECH = 'TECH',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
}

export enum AdminPermission {
  DASHBOARD_VIEW = 'DASHBOARD_VIEW',
  CLIENTS_VIEW = 'CLIENTS_VIEW',
  CLIENTS_MESSAGE = 'CLIENTS_MESSAGE',
  AT_RISK_VIEW = 'AT_RISK_VIEW',
  FUNNEL_VIEW = 'FUNNEL_VIEW',
  REPORTS_VIEW = 'REPORTS_VIEW',
  REPORTS_EDIT = 'REPORTS_EDIT',
  SETTINGS_BRANDING = 'SETTINGS_BRANDING',
  NOTIFICATIONS_SEND = 'NOTIFICATIONS_SEND',
}

export enum AdminTaskStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE',
  CANCELLED = 'CANCELLED',
}

export enum MembershipStatus {
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  FROZEN = 'FROZEN',
  PENDING = 'PENDING',
}

export enum SessionType {
  GROUP = 'GROUP',
  PERSONAL = 'PERSONAL',
  SPA = 'SPA',
}

export interface Club {
  id: string;
  name: string;
  slug: string;
  address?: string;
}

export interface UserProfile {
  id: string;
  externalId?: string;
  clubId: string;
  email: string;
  phone?: string;
  firstName: string;
  lastName: string;
  roles: UserRole[];
}

export interface MembershipServiceQuota {
  name: string;
  remaining?: number;
  total?: number;
  unlimited?: boolean;
}

export interface Membership {
  id: string;
  name: string;
  status: MembershipStatus;
  visitsRemaining?: number;
  visitsTotal?: number;
  validFrom: string;
  validUntil: string;
  /** Included services / package quotas from 1C */
  services?: MembershipServiceQuota[];
  /** Personal account balance (client-level in 1C; carried on membership DTO for card UI) */
  accountBalance?: number;
  debtAmount?: number;
  currency?: string;
  /** Whether this membership tariff supports freeze (hide UI when false) */
  freezeAllowed?: boolean;
  /** Remaining freeze days when freezeAllowed */
  freezeDaysRemaining?: number;
  /** Total freeze days in tariff when known */
  freezeDaysTotal?: number;
  /** End of current freeze window when status is FROZEN */
  frozenUntil?: string;
}

export interface FreezeMembershipRequest {
  days: number;
  /** ISO date YYYY-MM-DD; default today */
  fromDate?: string;
}

export type ClubCrmLinkStatus = 'LINKED' | 'PENDING_CRM';

/** Runtime product modules (nav/API gates). Not agent workstream B0–B10. */
export type ProductModuleKey =
  | 'club_ops'
  | 'group_classes'
  | 'membership_read'
  | 'club_card'
  | 'membership_shop'
  | 'trainer_crm'
  | 'trainer_calendar'
  | 'pt_sheet'
  | 'session_timer'
  | 'spa_booking'
  | 'club_admin'
  | 'messaging'
  | 'engagement'
  | 'wearables';

export interface ProductModuleDefinition {
  key: ProductModuleKey;
  label: string;
  description: string;
  defaultEnabled: boolean;
  /** Client/trainer/admin path prefixes gated by this module */
  surfaces: string[];
}

export const PRODUCT_MODULE_CATALOG: ProductModuleDefinition[] = [
  {
    key: 'club_ops',
    label: 'Клуб и профиль',
    description: 'Выбор клуба, профиль, базовый ЛК',
    defaultEnabled: true,
    surfaces: ['/client', '/client/profile'],
  },
  {
    key: 'group_classes',
    label: 'Групповые занятия',
    description: 'Расписание, запись, мои записи, лист ожидания',
    defaultEnabled: true,
    surfaces: ['/client/schedule', '/client/bookings', '/client/booking-history'],
  },
  {
    key: 'membership_read',
    label: 'Абонемент (чтение)',
    description: 'Статус абонемента, услуги, лицевой счёт из 1С',
    defaultEnabled: true,
    surfaces: [],
  },
  {
    key: 'club_card',
    label: 'Карта доступа',
    description: 'Штрихкод 1С/OSMI и визиты',
    defaultEnabled: true,
    surfaces: ['/client/card', '/client/visits'],
  },
  {
    key: 'membership_shop',
    label: 'Покупка абонемента',
    description: 'Каталог продуктов и онлайн-оплата',
    defaultEnabled: false,
    surfaces: ['/client/products'],
  },
  {
    key: 'trainer_crm',
    label: 'CRM тренера',
    description: 'Roster клиентов тренера',
    defaultEnabled: true,
    surfaces: ['/trainer/clients'],
  },
  {
    key: 'trainer_calendar',
    label: 'Календарь тренера',
    description: 'Слоты и расписание персональных',
    defaultEnabled: true,
    surfaces: ['/trainer/schedule', '/client/schedule/personal'],
  },
  {
    key: 'pt_sheet',
    label: 'Лист ПТ',
    description: 'План/факт персональной тренировки',
    defaultEnabled: true,
    surfaces: ['/trainer/sessions', '/client/personal-bookings'],
  },
  {
    key: 'session_timer',
    label: 'Таймер сессии',
    description: 'Workout timer на тренировке',
    defaultEnabled: true,
    surfaces: [],
  },
  {
    key: 'spa_booking',
    label: 'Спа-запись',
    description: 'Массаж, анализ состава тела, расписание специалистов',
    defaultEnabled: true,
    surfaces: [
      '/specialist/schedule',
      '/client/schedule/spa',
      '/admin/spa',
    ],
  },
  {
    key: 'club_admin',
    label: 'Админка клуба',
    description: 'Дашборд, отчёты, воронка, at-risk',
    defaultEnabled: true,
    surfaces: ['/admin'],
  },
  {
    key: 'messaging',
    label: 'Сообщения',
    description: 'Чат и уведомления',
    defaultEnabled: true,
    surfaces: [
      '/client/notifications',
      '/trainer/messages',
      '/admin/notifications',
    ],
  },
  {
    key: 'engagement',
    label: 'Достижения',
    description: 'Геймификация, лиги, челленджи, рефералы',
    defaultEnabled: true,
    surfaces: ['/client/engagement', '/client/workouts', '/client/referral'],
  },
  {
    key: 'wearables',
    label: 'Носимые устройства',
    description: 'Apple Health / Google Fit (пока stub)',
    defaultEnabled: false,
    surfaces: ['/client/wearables'],
  },
];

export const DEFAULT_PRODUCT_MODULES: Record<ProductModuleKey, boolean> =
  Object.fromEntries(
    PRODUCT_MODULE_CATALOG.map((m) => [m.key, m.defaultEnabled]),
  ) as Record<ProductModuleKey, boolean>;

export type ProductModulesState = Record<ProductModuleKey, boolean>;

export type {
  VisitBasisType,
  VisitKind,
  VisitVerificationStatus,
} from './visit-kind';
export {
  VISIT_KIND_LABELS,
  classifyVisitKind,
  isVerifiedVisitStatus,
  parseVisitKind,
} from './visit-kind';

export interface Visit {
  id: string;
  date: string;
  checkIn?: string;
  checkOut?: string;
  clubName: string;
  title?: string;
  sessionType?: SessionType;
  source?: '1c' | 'fitgo';
  /** Classified visit type (gym / group / PT / spa / …). */
  kind?: VisitKindT;
  /** How the visit was verified for gamification / history trust. */
  verification?: VisitVerificationStatusT;
  /** FitGO booking id when the event comes from an app booking. */
  bookingId?: string;
  /** Client may self-confirm attendance (group only, no 1C check-in). */
  canSelfConfirm?: boolean;
}

export interface VisitDynamicsWeek {
  weekStart: string;
  count: number;
  byKind: Partial<Record<VisitKindT, number>>;
}

export interface VisitDynamicsHeatmapDay {
  date: string;
  count: number;
}

export interface ClientVisitsResponse {
  visits: Visit[];
  from: string;
  to: string;
  dynamics: {
    byWeek: VisitDynamicsWeek[];
    heatmap: VisitDynamicsHeatmapDay[];
    totalsByKind: Partial<Record<VisitKindT, number>>;
  };
}

export interface AccessCard {
  id: string;
  barcode: string;
  clientName: string;
  clubName: string;
}

export interface ClubCardView {
  id: string;
  barcode: string;
  /** Barcode symbology (e.g. CODE128 for 13-digit club cards, PDF417 for OSMI) */
  barcodeFormat?: 'CODE128' | 'PDF417' | 'QR';
  clientName: string;
  clubName: string;
  membership: Membership | null;
  walletUrl?: string;
  stripImageId?: string;
  syncedAt: string;
  source: '1c' | 'osmi' | 'fitgo';
  anketaUrl?: string;
}

export interface ScheduleSlot {
  id: string;
  title: string;
  type: SessionType;
  serviceId?: string;
  trainerId?: string;
  trainerName?: string;
  startAt: string;
  endAt: string;
  capacity: number;
  booked: number;
  available: boolean;
  /** Forma / 1C room title (e.g. Групповой зал малый). */
  roomTitle?: string;
  /** FitGO: клиент персональной тренировки (для ссылки тренера) */
  clientId?: string;
  waitlist?: {
    open: boolean;
    count: number;
    userPosition?: number;
    userStatus?: 'WAITING' | 'NOTIFIED';
    isFirstInQueue?: boolean;
    canConfirm?: boolean;
  };
}

export interface GroupClassWaitlistEntry {
  id: string;
  sessionId: string;
  title: string;
  trainerName?: string;
  startAt: string;
  endAt: string;
  position: number;
  status: 'WAITING' | 'NOTIFIED' | 'CONFIRMED' | 'CANCELLED';
  isFirstInQueue: boolean;
  notifiedAt?: string;
}

export interface MembershipProduct {
  id: string;
  name: string;
  description?: string;
  price: number;
  currency: string;
  durationDays: number;
  visitsIncluded?: number;
}

export interface PaymentResult {
  id: string;
  status: 'pending' | 'completed' | 'failed';
  amount: number;
  currency: string;
  paymentUrl?: string;
}

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface AuthResult {
  accessToken: string;
  user: UserProfile;
}

export interface ClientDashboard {
  profile: UserProfile;
  membership: Membership | null;
  visits: Visit[];
  accessCard: AccessCard;
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
  rosterStatus?: 'CONFIRMED' | 'PENDING' | 'REJECTED';
  hasApp?: boolean;
  clientAccepted?: boolean;
  inRosterSince?: string;
  source?: 'MANUAL' | 'INVITE';
}

export interface TrainerInviteRequest {
  id: string;
  trainerId: string;
  trainerName: string;
  source: 'link' | 'invite';
  highlight: boolean;
}

export interface UserClubMembershipSummary {
  clubId: string;
  clubName: string;
  clubSlug: string;
  externalId?: string;
  joinedAt: string;
  leftAt?: string;
}

export interface AdminDashboardStats {
  activeMemberships: number;
  visitsToday: number;
  revenueToday: number;
  expiringSoon: number;
  bookingsToday: number;
}

export type PersonalBookingOrigin =
  | 'CLIENT_BOOKED'
  | 'TRAINER_ASSIGNED';

export type GroupBookingOrigin =
  | 'CLIENT_BOOKED'
  | 'STAFF_BOOKED'
  | 'ADMIN_BOOKED';

export type {
  ServiceControlLevel,
  ServicePresenceStatus,
  ServicePerformanceStatus,
  ServiceUsageStatus,
  ServicePaymentStatus,
  ServiceUsageControl,
} from './service-usage';

export {
  isElevatedOrigin,
  controlLevelFromOrigin,
  initialControlFields,
  toUsageControl,
  computeUsageAfterGates,
  originBadgeLabel,
} from './service-usage';

export type {
  TrustBand,
  TrustReasonCode,
  TrustResolution,
} from './trust';

export {
  PRESENCE_VISIT_WINDOW_HOURS,
  GROUP_BASELINE_SOFT_CAP,
  TRUST_REASON_LABELS,
  visitInBookingWindow,
  worstTrustBand,
  isPayrollTrusted,
  computeBookingTrust,
  computeGroupMemberTrust,
  computeGroupSessionTrust,
} from './trust';

export * from './payroll';
export * from './staff-pay';
export * from './admin-sales';
export * from './club-revenue';
export * from './club-revenue';
export * from './pt-timesheet';
export * from './staff-roster';

import type {
  ServiceControlLevel,
  ServicePresenceStatus,
  ServicePerformanceStatus,
  ServiceUsageStatus,
  ServicePaymentStatus,
  ServiceUsageControl,
} from './service-usage';

/** Unified booking origin for client UI badges. */
export type BookingOrigin =
  | PersonalBookingOrigin
  | 'SPECIALIST_ASSIGNED'
  | 'ADMIN_ASSIGNED'
  | GroupBookingOrigin;

export interface Booking {
  id: string;
  sessionId: string;
  title: string;
  type: SessionType;
  trainerName?: string;
  startAt: string;
  endAt: string;
  source?: '1c' | 'fitgo';
  origin?: BookingOrigin;
  lifecycle?: 'UPCOMING' | 'COMPLETED' | 'CANCELLED' | 'AWAITING_CONFIRMATION';
  /** Кто отменил (для SPA / истории) */
  cancelledBy?: SpaCancelledBy;
  cancelledByLabel?: string;
  usage?: ServiceUsageControl;
}

export interface TrainerSummary {
  id: string;
  firstName: string;
  lastName: string;
  hasSchedule: boolean;
}

export interface PersonalTrainingSlot {
  startAt: string;
  endAt: string;
}

export interface PersonalTrainingBookingItem {
  id: string;
  trainerId: string;
  trainerName: string;
  clientId?: string;
  clientName?: string;
  startAt: string;
  endAt: string;
  status: 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';
  origin?: PersonalBookingOrigin;
  clientCompletedAt?: string;
  trainerCompletedAt?: string;
  isComplimentary?: boolean;
  usage?: ServiceUsageControl;
}

export type PersonalSessionStatus =
  | 'SCHEDULED'
  | 'AWAITING_CONFIRMATION'
  | 'COMPLETED'
  | 'CANCELLED';

export interface PersonalTrainingSessionTask {
  id: string;
  title: string;
  sortOrder: number;
  clientConfirmed: boolean;
  trainerConfirmed: boolean;
}

export interface PersonalTrainingSessionGoal {
  id: string;
  title: string;
  notes?: string;
  sortOrder: number;
  clientConfirmed: boolean;
  trainerConfirmed: boolean;
  tasks: PersonalTrainingSessionTask[];
}

export interface PersonalTrainingSessionDetail {
  id: string;
  trainerId: string;
  trainerName: string;
  clientId: string;
  clientName: string;
  startAt: string;
  endAt: string;
  status: PersonalSessionStatus;
  clientCompletedAt?: string;
  trainerCompletedAt?: string;
  canEdit: boolean;
  canComplete: boolean;
  goals: PersonalTrainingSessionGoal[];
  workoutSheet: import('./workout-sheet').WorkoutSheet;
  clientDateOfBirth?: string;
  /** Из анкеты клиента (будет заполняться позже) */
  clientRestingHr?: number;
}

export interface TrainerClientSession {
  id: string;
  startAt: string;
  endAt: string;
  status: PersonalSessionStatus;
  awaitingConfirmation: boolean;
  goalsCount: number;
  hasWorkoutSheet: boolean;
}

export interface TrainerWorkSlotInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export type TrainerCalendarEventKind =
  | 'GROUP'
  | 'PERSONAL'
  | 'DUTY'
  | 'OPEN_SLOT'
  | 'DRAFT_SLOT';

export interface TrainerCalendarEvent {
  id: string;
  kind: TrainerCalendarEventKind;
  title: string;
  startAt: string;
  endAt: string;
  clientId?: string;
  clientName?: string;
  bookingId?: string;
  origin?: PersonalBookingOrigin;
  available?: boolean;
  capacity?: number;
  booked?: number;
}

export interface TrainerAvailabilityBlock {
  id: string;
  startAt: string;
  endAt: string;
  status: 'DRAFT' | 'PUBLISHED';
}

export interface TrainerSchedulePublicationInfo {
  periodStart: string;
  periodEnd: string;
  publishedAt: string;
}

export interface TrainerCalendarResponse {
  events: TrainerCalendarEvent[];
  availabilityBlocks: TrainerAvailabilityBlock[];
  draftBlockCount: number;
  lastPublication?: TrainerSchedulePublicationInfo;
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

export interface ConversationSummary {
  id: string;
  kind: 'ADMIN' | 'TRAINER' | 'TRAINER_ADMIN';
  title: string;
  subtitle?: string;
  clientId: string;
  trainerId?: string;
  lastMessage?: string;
  lastMessageAt: string;
  unreadCount: number;
}

export interface ChatMessageItem {
  id: string;
  body: string;
  senderId: string;
  senderName: string;
  isMine: boolean;
  readAt?: string;
  createdAt: string;
}

export interface GamificationProfile {
  activated: boolean;
  gamificationStartedAt?: string;
  visitStreak: number;
  totalVisits: number;
  badges: Array<{
    id: string;
    slug?: string;
    name: string;
    description: string;
    category?: string;
    tier?: string;
    earnedAt: string;
  }>;
  lockedBadges?: Array<{
    id: string;
    slug: string;
    name: string;
    description: string;
    category?: string;
    tier?: string;
  }>;
  nextBadge?: {
    slug: string;
    name: string;
    description: string;
    current: number;
    target: number;
    progress: number;
    streak: number;
  } | null;
  league?: LeagueGroupView;
  loyalty?: LoyaltyInfo | null;
  decayWarning?: DecayWarning | null;
  rank?: number;
  points: number;
  useRealNameInPublic?: boolean;
  gamificationNickname?: string | null;
}

export interface LeagueGroupView {
  tier: string;
  tierLabel: string;
  weekEnd: string | null;
  members: Array<{
    rank: number;
    userId: string;
    name: string;
    weeklyXp: number;
    isMe: boolean;
    zone: 'promotion' | 'safe' | 'relegation';
  }>;
  myRank: number | null;
  promotionZone: number;
  relegationZone: number;
  weeklyXp: number;
}

export interface LoyaltyInfo {
  status: string;
  currentTier: string;
  peakTier?: string;
  tierLabel: string;
  continuityMonths: number;
  lastVisitAt?: string;
}

export interface DecayWarning {
  dayOfMonth: number;
  daysLeftInMonth: number;
  urgency: 'info' | 'warning' | 'critical';
  message: string;
}

export interface ClientProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  profileCompletedAt?: string | null;
  gamificationNickname?: string | null;
  useRealNameInPublic?: boolean;
  gamificationStartedAt?: string | null;
  training?: import('./client-training-profile').ClientTrainingProfile | null;
}

export interface BodyProfileResponse {
  profile: { heightCm?: number | null; targetWeightKg?: number | null };
  logs: Array<{
    id: string;
    recordedAt: string;
    source: string;
    weightKg?: number | null;
    chestCm?: number | null;
    waistCm?: number | null;
    hipsCm?: number | null;
    bicepsCm?: number | null;
    thighCm?: number | null;
    bodyFatPct?: number | null;
    notes?: string | null;
  }>;
}

export type {
  BodyLimitationZone,
  ClientPrimaryGoal,
  ClientTrainingProfile,
  ExperienceLevel,
  HomeEquipmentItem,
  PreferredIntensity,
  PreferredModality,
  PreferredTimeOfDay,
} from './client-training-profile';
export {
  BODY_LIMITATION_LABELS,
  CLIENT_PRIMARY_GOAL_LABELS,
  EXPERIENCE_LEVEL_LABELS,
  GOAL_HORIZON_OPTIONS,
  HOME_EQUIPMENT_LABELS,
  PREFERRED_INTENSITY_LABELS,
  PREFERRED_MODALITY_LABELS,
  PREFERRED_TIME_LABELS,
  emptyTrainingProfile,
  trainingProfileCompleteness,
} from './client-training-profile';

export interface ChallengeView {
  id: string;
  title: string;
  description?: string | null;
  targetVisits: number;
  startDate: string;
  endDate: string;
  progress: number;
  completed: boolean;
}

export interface ReferralInfo {
  code: string;
  link: string;
  referralsCount: number;
  rewardDescription: string;
}

export interface ClubTheme {
  logoUrl?: string;
  primaryColor: string;
  clubName: string;
  address?: string;
  phone?: string;
  website?: string;
  workingHours?: import('./staff-roster').ClubWorkingHours;
}

export interface AtRiskClient {
  id: string;
  userId: string;
  name: string;
  email: string;
  reason: string;
  daysInactive?: number;
  daysUntilExpiry?: number;
  membership?: string;
}

export interface TrainerClientDetail {
  id: string;
  externalId?: string;
  firstName: string;
  lastName: string;
  phone?: string;
  gender?: string | null;
  dateOfBirth?: string | null;
  crmStatus?: ClubCrmLinkStatus | null;
  membershipName?: string;
  membershipStatus?: MembershipStatus;
  lastVisit?: string;
  /** Client self-filled questionnaire (no gamification). */
  questionnaire?: {
    training: import('./client-training-profile').ClientTrainingProfile | null;
    body: {
      heightCm?: number | null;
      targetWeightKg?: number | null;
      latestWeightKg?: number | null;
      latestLoggedAt?: string | null;
    };
  };
  sessions: TrainerClientSession[];
  goals: Array<{ id: string; title: string; target?: string; progress?: string }>;
  notes: Array<{ id: string; content: string; createdAt: string }>;
  measurements: Array<{ id: string; weight?: number; notes?: string; recordedAt: string }>;
}

export interface WearableSyncResult {
  synced: boolean;
  visitsImported: number;
  lastSyncAt: string;
}

export {
  PERSONAL_TRAINING_GOAL_TEMPLATES,
  type PersonalTrainingGoalTemplate,
} from './personal-training-goals';
export * from './workout-sheet';
export * from './block-session';

export interface StaffMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  dateOfBirth?: string;
  /** Код сотрудника в 1С. */
  employeeCode?: string;
  /** false — пароль входа ещё не выдан. */
  loginEnabled?: boolean;
  roles: UserRole[];
  isActive: boolean;
  /** STAFF (default) or EXTERNAL (сторонние в отчёте ЗП). */
  employmentKind?: 'STAFF' | 'EXTERNAL';
  createdAt: string;
}

export interface StaffCreateResult {
  user: StaffMember;
  /** Present only when the staff member can log into the app. */
  credentials?: { email: string; password: string };
}

export interface AdminTaskItem {
  id: string;
  title: string;
  description?: string;
  status: AdminTaskStatus;
  dueAt?: string;
  completedAt?: string;
  assignee: { id: string; firstName: string; lastName: string };
  createdAt: string;
}

export interface GrowthInsight {
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  action?: string;
}

export interface SuperAdminAnalytics {
  periodDays: number;
  kpis: {
    visits: number;
    visitsPrev: number;
    activeMemberships: number;
    expiringSoon: number;
    revenue: number;
    revenuePrev: number;
    personalSessionsCompleted: number;
    adminTasksDoneRate: number;
  };
  trainerRankings: Array<{
    trainerId: string;
    name: string;
    score: number;
    completedPt: number;
    activeClients: number;
  }>;
  groupDirectionLoad: Array<{
    title: string;
    bookings: number;
    loadPercent: number;
  }>;
  insights: GrowthInsight[];
  integrationHealth?: {
    provider: string;
    clubExternalId: string | null;
    ok: boolean;
  };
}

export interface StaffAuditLogItem {
  id: string;
  action: string;
  targetId?: string;
  actorName: string;
  meta?: Record<string, unknown>;
  createdAt: string;
}

export const ADMIN_PERMISSION_LABELS: Record<AdminPermission, string> = {
  [AdminPermission.DASHBOARD_VIEW]: 'Дашборд',
  [AdminPermission.CLIENTS_VIEW]: 'Клиенты',
  [AdminPermission.CLIENTS_MESSAGE]: 'Сообщения клиентам',
  [AdminPermission.AT_RISK_VIEW]: 'Клиенты в зоне риска',
  [AdminPermission.FUNNEL_VIEW]: 'Воронка',
  [AdminPermission.REPORTS_VIEW]: 'Просмотр отчётов',
  [AdminPermission.REPORTS_EDIT]: 'Ввод отчётов',
  [AdminPermission.SETTINGS_BRANDING]: 'Брендинг клуба',
  [AdminPermission.NOTIFICATIONS_SEND]: 'Рассылки',
};

export const ADMIN_PERMISSION_PRESETS: Record<
  string,
  { label: string; permissions: AdminPermission[] }
> = {
  reception: {
    label: 'Рецепция',
    permissions: [
      AdminPermission.DASHBOARD_VIEW,
      AdminPermission.CLIENTS_VIEW,
      AdminPermission.CLIENTS_MESSAGE,
      AdminPermission.NOTIFICATIONS_SEND,
    ],
  },
  marketing: {
    label: 'Маркетинг',
    permissions: [
      AdminPermission.DASHBOARD_VIEW,
      AdminPermission.FUNNEL_VIEW,
      AdminPermission.AT_RISK_VIEW,
      AdminPermission.NOTIFICATIONS_SEND,
    ],
  },
  floor: {
    label: 'Директор зала',
    permissions: [
      AdminPermission.DASHBOARD_VIEW,
      AdminPermission.CLIENTS_VIEW,
      AdminPermission.AT_RISK_VIEW,
      AdminPermission.REPORTS_VIEW,
      AdminPermission.REPORTS_EDIT,
    ],
  },
};

// ─── Spa booking ─────────────────────────────────────────────────────────────

export type SpaServiceKind = 'MASSAGE' | 'BODY_COMPOSITION' | 'WRAP';

export type SpaPaymentType = 'QUOTA' | 'PAID';

export type SpaBookingOrigin =
  | 'CLIENT_BOOKED'
  | 'SPECIALIST_ASSIGNED'
  | 'ADMIN_ASSIGNED';

export type SpaBookingStatus = 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';

export type SpaCancelledBy = 'CLIENT' | 'SPECIALIST' | 'ADMIN' | 'CRM_ADMIN';

export interface SpaService {
  id: string;
  clubId: string;
  name: string;
  kind: SpaServiceKind;
  durationMin: number;
  bufferMin: number;
  priceMinor: number;
  currency: string;
  active: boolean;
}

export interface SpaServiceEligibility {
  service: SpaService;
  /** Can book via membership quota */
  quotaAvailable: boolean;
  /** Remaining quota for matched membership service name (if any) */
  quotaRemaining?: number;
  membershipServiceName?: string;
  /** Can book as paid */
  paidAvailable: boolean;
}

export interface SpaQuotaRule {
  id: string;
  clubId: string;
  /** Exact name of membership.services[] entry from 1C */
  membershipServiceName: string;
  allowedServiceIds: string[];
  allowedSpecialistIds: string[];
}

export interface SpaSpecialistSummary {
  id: string;
  firstName: string;
  lastName: string;
  hasSchedule: boolean;
  serviceIds: string[];
}

export interface SpaBookingSlot {
  startAt: string;
  endAt: string;
}

export interface SpaBooking {
  id: string;
  clubId: string;
  specialistId: string;
  specialistName: string;
  clientId: string;
  clientName: string;
  serviceId: string;
  serviceName: string;
  startAt: string;
  endAt: string;
  status: SpaBookingStatus;
  origin: SpaBookingOrigin;
  paymentType: SpaPaymentType;
  priceMinor?: number;
  membershipServiceName?: string;
  consumedInCrmAt?: string;
  cancelledBy?: SpaCancelledBy;
  cancelledAt?: string;
  usage?: ServiceUsageControl;
  specialistCompletedAt?: string;
  paidAt?: string;
}

/** Specialist-rendered service from 1C (period report: sales + sessions). */
export interface SpecialistServiceDebt {
  externalId: string;
  clientName: string;
  serviceName: string;
  occurredAt: string;
  amount: number;
  currency: string;
  employeeCode: string;
  employeeName: string;
  docRef: string;
  /** DEBT = unpaid at reception; PAID = settled in 1C. */
  paymentStatus: 'DEBT' | 'PAID';
  bookingRef?: string;
}

/** Elevated / review-queue row for super-admin. */
export interface ServiceUsageReviewItem {
  id: string;
  kind: 'SPA' | 'PT' | 'GROUP';
  title: string;
  clientId: string;
  clientName: string;
  performerName: string;
  bookedByName?: string;
  startAt: string;
  endAt: string;
  origin: string;
  controlLevel: ServiceControlLevel;
  presenceStatus: ServicePresenceStatus;
  performanceStatus: ServicePerformanceStatus;
  usageStatus: ServiceUsageStatus;
  paymentStatus: ServicePaymentStatus;
  reviewFlag: boolean;
  eligibleForMotivation: boolean;
  isComplimentary?: boolean;
}

export interface ConsumeMembershipServiceRequest {
  serviceName?: string;
  serviceId?: string;
  bookingRef: string;
  occurredAt: string;
  durationMin?: number;
}

export interface SellSpaServiceRequest {
  serviceName: string;
  serviceId?: string;
  bookingRef: string;
  occurredAt: string;
  priceMinor: number;
  currency?: string;
  durationMin?: number;
}

export type SpecialistCalendarEventKind =
  | 'SPA'
  | 'OPEN_SLOT'
  | 'DRAFT_SLOT';

export interface SpecialistCalendarEvent {
  id: string;
  kind: SpecialistCalendarEventKind;
  title: string;
  startAt: string;
  endAt: string;
  clientId?: string;
  clientName?: string;
  bookingId?: string;
  serviceId?: string;
  serviceName?: string;
  origin?: SpaBookingOrigin;
  paymentType?: SpaPaymentType;
  available?: boolean;
}

export interface SpecialistWorkSlotInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

export interface SpecialistAvailabilityBlock {
  id: string;
  startAt: string;
  endAt: string;
  status: 'DRAFT' | 'PUBLISHED';
}

export interface SpecialistSchedulePublicationInfo {
  periodStart: string;
  periodEnd: string;
  publishedAt: string;
}

export interface SpecialistCalendarResponse {
  events: SpecialistCalendarEvent[];
  availabilityBlocks: SpecialistAvailabilityBlock[];
  draftBlockCount: number;
  lastPublication?: SpecialistSchedulePublicationInfo;
}
