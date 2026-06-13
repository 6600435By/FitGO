export enum UserRole {
  CLIENT = 'CLIENT',
  TRAINER = 'TRAINER',
  ADMIN = 'ADMIN',
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
  lifecycle?: 'UPCOMING' | 'COMPLETED' | 'CANCELLED';
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
  status: 'CONFIRMED' | 'CANCELLED';
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
  kind: 'ADMIN' | 'TRAINER';
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
  visitStreak: number;
  totalVisits: number;
  badges: Array<{ id: string; name: string; description: string; earnedAt: string }>;
  rank?: number;
  points: number;
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
  phone?: string;
  membershipName?: string;
  membershipStatus?: MembershipStatus;
  lastVisit?: string;
  goals: Array<{ id: string; title: string; target?: string; progress?: string }>;
  notes: Array<{ id: string; content: string; createdAt: string }>;
  measurements: Array<{ id: string; weight?: number; notes?: string; recordedAt: string }>;
}

export interface WearableSyncResult {
  synced: boolean;
  visitsImported: number;
  lastSyncAt: string;
}
