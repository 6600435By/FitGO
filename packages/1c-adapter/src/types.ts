import type {
  AccessCard,
  AuthCredentials,
  AuthResult,
  Booking,
  Membership,
  MembershipProduct,
  PaymentResult,
  ScheduleSlot,
  UserProfile,
  Visit,
} from '@fitgo/shared-types';

export interface ScheduleFilters {
  from?: string;
  to?: string;
  trainerId?: string;
  type?: 'GROUP' | 'PERSONAL';
}

export interface VisitPeriod {
  from?: string;
  to?: string;
}

export interface BookingContext {
  phone?: string;
  name?: string;
}

export interface IFitnessClubProvider {
  authenticate(credentials: AuthCredentials): Promise<AuthResult | null>;
  getClientProfile(externalId: string): Promise<UserProfile | null>;
  getMembership(externalId: string): Promise<Membership | null>;
  getVisits(externalId: string, period?: VisitPeriod): Promise<Visit[]>;
  getAccessCard(externalId: string): Promise<AccessCard | null>;
  getSchedule(clubExternalId: string, filters?: ScheduleFilters): Promise<ScheduleSlot[]>;
  bookSession(
    externalId: string,
    sessionId: string,
    context?: BookingContext,
  ): Promise<{ success: boolean; message?: string }>;
  cancelBooking(
    externalId: string,
    sessionId: string,
    context?: BookingContext,
  ): Promise<{ success: boolean; message?: string }>;
  getBookings(externalId: string, context?: BookingContext): Promise<Booking[]>;
  getMembershipProducts(clubExternalId: string): Promise<MembershipProduct[]>;
  createPayment(externalId: string, productId: string): Promise<PaymentResult>;
  getAllClientsMemberships?(clubExternalId: string): Promise<Array<{
    externalId: string;
    firstName: string;
    lastName: string;
    email?: string;
    membershipName?: string;
    membershipStatus?: string;
    validUntil?: string;
    lastVisit?: string;
  }>>;
}

export interface OneCConfig {
  baseUrl: string;
  apiKey: string;
}

export interface FormaConfig {
  baseUrl: string;
  apiKey: string;
  basicAuth: string;
  defaultPassword?: string;
}

export interface FormaWordPressConfig {
  ajaxUrl: string;
}
