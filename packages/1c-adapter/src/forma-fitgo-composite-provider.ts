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
import type { FitgoHttpProvider } from './fitgo-http-provider';
import type { FormaFitnessProvider } from './forma-provider';
import type {
  BookingContext,
  IFitnessClubProvider,
  ScheduleFilters,
  VisitPeriod,
} from './types';

/**
 * Composite: schedule/booking via Forma API v3; client data via custom FitGO HTTP service.
 */
export class FormaFitgoCompositeProvider implements IFitnessClubProvider {
  constructor(
    private readonly forma: FormaFitnessProvider,
    private readonly fitgo: FitgoHttpProvider,
  ) {}

  authenticate(credentials: AuthCredentials): Promise<AuthResult | null> {
    return this.forma.authenticate(credentials);
  }

  async getClientProfile(externalId: string): Promise<UserProfile | null> {
    const client = await this.fitgo.getClientByExternalId(externalId);
    if (!client) return null;
    return {
      id: client.externalId,
      externalId: client.externalId,
      clubId: '',
      email: client.email ?? '',
      phone: client.phone,
      firstName: client.firstName,
      lastName: client.lastName,
      roles: [],
    };
  }

  getMembership(externalId: string): Promise<Membership | null> {
    return this.fitgo.getMembership(externalId);
  }

  getVisits(externalId: string, period?: VisitPeriod): Promise<Visit[]> {
    return this.fitgo.getVisits(externalId, period);
  }

  getAccessCard(externalId: string): Promise<AccessCard | null> {
    return this.fitgo.getAccessCard(externalId);
  }

  getSchedule(clubExternalId: string, filters?: ScheduleFilters): Promise<ScheduleSlot[]> {
    return this.forma.getSchedule(clubExternalId, filters);
  }

  bookSession(externalId: string, sessionId: string, context?: BookingContext) {
    return this.forma.bookSession(externalId, sessionId, context);
  }

  cancelBooking(externalId: string, sessionId: string, context?: BookingContext) {
    return this.forma.cancelBooking(externalId, sessionId, context);
  }

  getBookings(externalId: string, context?: BookingContext): Promise<Booking[]> {
    return this.forma.getBookings(externalId, context);
  }

  getMembershipProducts(clubExternalId: string): Promise<MembershipProduct[]> {
    return this.forma.getMembershipProducts(clubExternalId);
  }

  createPayment(externalId: string, productId: string): Promise<PaymentResult> {
    return this.forma.createPayment(externalId, productId);
  }
}
