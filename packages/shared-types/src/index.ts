export enum UserRole {
  CLIENT = 'CLIENT',
  TRAINER = 'TRAINER',
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

export interface Membership {
  id: string;
  name: string;
  status: MembershipStatus;
  visitsRemaining?: number;
  visitsTotal?: number;
  validFrom: string;
  validUntil: string;
}

export interface Visit {
  id: string;
  date: string;
  checkIn?: string;
  checkOut?: string;
  clubName: string;
  title?: string;
  sessionType?: SessionType;
  source?: '1c' | 'fitgo';
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
  /** OSMI barcode symbology (e.g. PDF417 for club turnstiles) */
  barcodeFormat?: 'CODE128' | 'PDF417' | 'QR';
  clientName: string;
  clubName: string;
  membership: Membership | null;
  walletUrl?: string;
  stripImageId?: string;
  syncedAt: string;
  source: 'osmi';
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
}

export interface AdminDashboardStats {
  activeMemberships: number;
  visitsToday: number;
  revenueToday: number;
  expiringSoon: number;
  bookingsToday: number;
}

export interface Booking {
  id: string;
  sessionId: string;
  title: string;
  type: SessionType;
  trainerName?: string;
  startAt: string;
  endAt: string;
  source?: '1c' | 'fitgo';
  lifecycle?: 'UPCOMING' | 'COMPLETED' | 'CANCELLED' | 'AWAITING_CONFIRMATION';
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
  clientCompletedAt?: string;
  trainerCompletedAt?: string;
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
  membershipName?: string;
  membershipStatus?: MembershipStatus;
  lastVisit?: string;
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

export interface StaffMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  dateOfBirth?: string;
  roles: UserRole[];
  isActive: boolean;
  createdAt: string;
}

export interface StaffCreateResult {
  user: StaffMember;
  credentials: { email: string; password: string };
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
