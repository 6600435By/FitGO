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
  serviceId?: string;
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

export interface FitgoClientLookup {
  externalId: string;
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
}

export interface IFitnessClubProvider {
  authenticate(credentials: AuthCredentials): Promise<AuthResult | null>;
  getClientProfile(externalId: string): Promise<UserProfile | null>;
  /** Resolve 1C client by phone (FitGO HTTP / composite). Returns null if unsupported or not found. */
  findClientByPhone?(phone: string): Promise<FitgoClientLookup | null>;
  getMembership(externalId: string): Promise<Membership | null>;
  /** Freeze membership in 1C (FitGO HTTP). Optional — unsupported providers throw. */
  freezeMembership?(
    externalId: string,
    days: number,
    fromDate?: string,
  ): Promise<Membership>;
  /** Consume a membership package service (spa massage etc.). Optional. */
  consumeMembershipService?(
    externalId: string,
    input: {
      serviceName?: string;
      serviceId?: string;
      bookingRef: string;
      occurredAt: string;
      durationMin?: number;
      /** ФИО сотрудника 1С (из слота FitGO) */
      employeeName?: string;
      /** Код справочника Сотрудники в 1С, если известен */
      employeeCode?: string;
    },
  ): Promise<Membership>;
  /** Cancel FitGO SPA visit in 1C (unpost / status Отменено) by bookingRef. Optional. */
  restoreSpaVisit?(
    externalId: string,
    input: { bookingRef: string },
  ): Promise<Membership>;
  /** Status of FitGO SPA visit in 1C by bookingRef (sync cancellations). Optional. */
  getSpaVisitStatus?(
    externalId: string,
    input: { bookingRef: string },
  ): Promise<{
    found: boolean;
    cancelled: boolean;
    posted?: boolean;
    deletionMark?: boolean;
    status?: string;
    num?: string;
  }>;
  /** Record a paid spa service sale in 1C. Optional. */
  sellSpaService?(
    externalId: string,
    input: {
      serviceName: string;
      serviceId?: string;
      bookingRef: string;
      occurredAt: string;
      priceMinor: number;
      currency?: string;
      durationMin?: number;
      employeeName?: string;
      employeeCode?: string;
    },
  ): Promise<Membership>;
  /**
   * Unpaid specialist-rendered services for a period (not aggregate client debt).
   * Optional — returns [] when unsupported.
   */
  getSpecialistServiceDebts?(input: {
    from: string;
    to: string;
    /** Required — full-club scan overloads 1C. */
    employeeCode: string;
  }): Promise<
    import('@fitgo/shared-types').SpecialistServiceDebt[]
  >;
  /**
   * Check PT session payment fact in 1C by client phone/externalId + datetime.
   * Optional — returns null when unsupported.
   */
  getPtSessionPayment?(input: {
    clientExternalId?: string;
    clientPhone?: string;
    trainerExternalId?: string;
    occurredAt: string;
  }): Promise<{
    paymentStatus: 'PAID' | 'DEBT' | 'PENDING_PAYMENT' | 'N_A';
    payKind?: 'GIFT' | 'BLOCK' | 'PAID' | 'UNKNOWN';
    priceMinor?: number;
    docRef?: string;
  } | null>;
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
  /** Custom FitGO HTTP service (1C extension), e.g. .../fitgo/hs/fitgo/v1 */
  fitgoUrl?: string;
  /** FitGOAnalytics HTTP service, e.g. .../fitgo/hs/analytics/v1 */
  analyticsUrl?: string;
}

export interface FitgoHttpConfig {
  baseUrl: string;
  apiKey: string;
  basicAuth: string;
}

export interface FormaWordPressConfig {
  ajaxUrl: string;
}
