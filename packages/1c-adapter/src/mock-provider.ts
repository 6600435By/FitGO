import { UserRole, MembershipStatus, type AuthCredentials, type AuthResult, type Booking, type PaymentResult, type ScheduleSlot } from '@fitgo/shared-types';
import {
  MOCK_CLUB,
  MOCK_PRODUCTS,
  MOCK_USERS,
  buildMockSchedule,
  buildMockVisits,
} from './fixtures';
import type { IFitnessClubProvider, ScheduleFilters, VisitPeriod, BookingContext } from './types';

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function formatDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

export class Mock1CProvider implements IFitnessClubProvider {
  private slots: ScheduleSlot[] = buildMockSchedule();
  private bookings = new Set<string>();

  private ensureFreshSchedule() {
    const now = Date.now();
    const hasUpcoming = this.slots.some((s) => new Date(s.endAt).getTime() > now);
    if (!hasUpcoming) {
      this.slots = buildMockSchedule();
      this.bookings.clear();
    }
  }

  async authenticate(credentials: AuthCredentials): Promise<AuthResult | null> {
    const user = MOCK_USERS[credentials.email];
    if (!user || user.password !== credentials.password) {
      return null;
    }

    return {
      accessToken: `mock-token-${user.profile.externalId}`,
      user: user.profile,
    };
  }

  async getClientProfile(externalId: string) {
    const entry = Object.values(MOCK_USERS).find(
      (u) => u.profile.externalId === externalId,
    );
    return entry?.profile ?? null;
  }

  async findClientByPhone(phone: string) {
    const digits = phone.replace(/\D/g, '');
    const entry = Object.values(MOCK_USERS).find((u) => {
      const p = u.profile.phone?.replace(/\D/g, '') ?? '';
      if (!p || !digits) return false;
      return p === digits || p.slice(-9) === digits.slice(-9);
    });
    if (!entry) return null;
    return {
      externalId: entry.profile.externalId!,
      firstName: entry.profile.firstName,
      lastName: entry.profile.lastName,
      phone: entry.profile.phone,
      email: entry.profile.email,
    };
  }

  async getMembership(externalId: string) {
    const entry = Object.values(MOCK_USERS).find(
      (u) => u.profile.externalId === externalId,
    );
    return entry?.membership ?? null;
  }

  async freezeMembership(externalId: string, days: number, fromDate?: string) {
    const entry = Object.values(MOCK_USERS).find(
      (u) => u.profile.externalId === externalId,
    );
    if (!entry?.membership) {
      throw Object.assign(new Error('Membership not found'), { status: 404 });
    }
    const m = entry.membership;
    if (!m.freezeAllowed) {
      throw Object.assign(new Error('Freeze is not available for this membership'), {
        status: 409,
      });
    }
    if (m.status === MembershipStatus.FROZEN) {
      throw Object.assign(new Error('Membership is already frozen'), { status: 409 });
    }
    const remaining = m.freezeDaysRemaining ?? 0;
    if (!Number.isFinite(days) || days < 1 || days > remaining) {
      throw Object.assign(new Error('days exceed freezeDaysRemaining'), { status: 400 });
    }
    const start = fromDate ?? formatDateKey(new Date());
    m.freezeDaysRemaining = remaining - days;
    m.status = MembershipStatus.FROZEN;
    m.frozenUntil = formatDateKey(addDays(new Date(`${start}T12:00:00`), days));
    m.validUntil = formatDateKey(
      addDays(new Date(`${m.validUntil}T12:00:00`), days),
    );
    return { ...m };
  }

  async getVisits(externalId: string, period?: VisitPeriod) {
    const entry = Object.values(MOCK_USERS).find(
      (u) => u.profile.externalId === externalId,
    );
    if (!entry) return [];

    let visits =
      entry.profile.roles.includes(UserRole.CLIENT)
        ? buildMockVisits(MOCK_CLUB.name)
        : [...entry.visits];

    if (period?.from) {
      visits = visits.filter((v) => v.date >= period.from!);
    }
    if (period?.to) {
      visits = visits.filter((v) => v.date <= period.to!);
    }
    return visits;
  }

  async getAccessCard(externalId: string) {
    const entry = Object.values(MOCK_USERS).find(
      (u) => u.profile.externalId === externalId,
    );
    return entry?.accessCard ?? null;
  }

  async getSchedule(clubExternalId: string, filters?: ScheduleFilters) {
    if (clubExternalId !== MOCK_CLUB.externalId) return [];

    this.ensureFreshSchedule();

    let slots = [...this.slots];
    if (filters?.trainerId) {
      slots = slots.filter((s) => s.trainerId === filters.trainerId);
    }
    if (filters?.type) {
      slots = slots.filter((s) => s.type === filters.type);
    }
    if (filters?.from) {
      slots = slots.filter((s) => s.startAt >= filters.from!);
    }
    if (filters?.to) {
      slots = slots.filter((s) => s.startAt <= filters.to!);
    }
    return slots;
  }

  async bookSession(externalId: string, sessionId: string, _context?: BookingContext) {
    this.ensureFreshSchedule();
    const slot = this.slots.find((s) => s.id === sessionId);
    if (!slot) {
      return { success: false, message: 'Занятие не найдено' };
    }
    if (!slot.available || slot.booked >= slot.capacity) {
      return { success: false, message: 'Нет свободных мест' };
    }

    const key = `${externalId}:${sessionId}`;
    if (this.bookings.has(key)) {
      return { success: false, message: 'Вы уже записаны на это занятие' };
    }

    this.bookings.add(key);
    slot.booked += 1;
    if (slot.booked >= slot.capacity) {
      slot.available = false;
    }
    return { success: true };
  }

  async getBookings(externalId: string, _context?: BookingContext): Promise<Booking[]> {
    this.ensureFreshSchedule();
    const bookings: Booking[] = [];
    for (const key of this.bookings) {
      const [bookedExternalId, sessionId] = key.split(':');
      if (bookedExternalId !== externalId) continue;
      const slot = this.slots.find((s) => s.id === sessionId);
      if (!slot) continue;
      bookings.push({
        id: key,
        sessionId: slot.id,
        title: slot.title,
        type: slot.type,
        trainerName: slot.trainerName,
        startAt: slot.startAt,
        endAt: slot.endAt,
      });
    }
    return bookings.sort((a, b) => a.startAt.localeCompare(b.startAt));
  }

  async cancelBooking(externalId: string, sessionId: string, _context?: BookingContext) {
    const key = `${externalId}:${sessionId}`;
    if (!this.bookings.has(key)) {
      return { success: false, message: 'Запись не найдена' };
    }

    const slot = this.slots.find((s) => s.id === sessionId);
    this.bookings.delete(key);
    if (slot) {
      slot.booked = Math.max(0, slot.booked - 1);
      slot.available = true;
    }
    return { success: true };
  }

  async getMembershipProducts() {
    return MOCK_PRODUCTS;
  }

  async getAllClientsMemberships() {
    return Object.values(MOCK_USERS)
      .filter((u) => u.profile.roles.includes(UserRole.CLIENT))
      .map((u) => ({
        externalId: u.profile.externalId!,
        firstName: u.profile.firstName,
        lastName: u.profile.lastName,
        email: u.profile.email,
        membershipName: u.membership.name,
        membershipStatus: u.membership.status,
        validUntil: u.membership.validUntil,
        lastVisit: buildMockVisits(MOCK_CLUB.name)[0]?.date,
      }));
  }

  async createPayment(externalId: string, productId: string): Promise<PaymentResult> {
    const product = MOCK_PRODUCTS.find((p) => p.id === productId);
    if (!product) {
      return {
        id: 'payment-failed',
        status: 'failed',
        amount: 0,
        currency: 'BYN',
      };
    }

    return {
      id: `payment-${Date.now()}`,
      status: 'pending',
      amount: product.price,
      currency: product.currency,
      paymentUrl: `https://pay.fitgo.local/mock/${externalId}/${productId}`,
    };
  }
}
