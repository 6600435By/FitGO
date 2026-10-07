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

/** Parse Forma/client filter or slot time to epoch ms (local if no zone). */
function scheduleFilterMs(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return Date.parse(`${trimmed}T00:00:00`);
  }
  const normalized = trimmed.includes('T')
    ? trimmed
    : trimmed.replace(' ', 'T');
  return Date.parse(normalized);
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

  async getClientPackages(externalId: string) {
    const membership = await this.getMembership(externalId);
    if (!membership) return [];
    return [
      {
        id: membership.id,
        name: membership.name,
        status: membership.status,
        validFrom: membership.validFrom,
        validUntil: membership.validUntil,
        serviceQuotas: membership.services ?? [],
      },
    ];
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

  async consumeMembershipService(
    externalId: string,
    input: {
      serviceName?: string;
      serviceId?: string;
      bookingRef: string;
      occurredAt: string;
      durationMin?: number;
    },
  ) {
    const entry = Object.values(MOCK_USERS).find(
      (u) => u.profile.externalId === externalId,
    );
    if (!entry?.membership) {
      throw Object.assign(new Error('Membership not found'), { status: 404 });
    }
    const m = entry.membership;
    const services = m.services ?? [];
    const needle = (input.serviceName ?? '').toLowerCase().trim();
    const idx = services.findIndex((s) => {
      const n = s.name.toLowerCase();
      return needle && (n === needle || n.includes(needle) || needle.includes(n));
    });
    if (idx < 0) {
      throw Object.assign(new Error('Service quota not found'), { status: 404 });
    }
    const svc = services[idx];
    if (svc.unlimited) {
      return {
        ...m,
        services: [...services],
        docId: `mock-spa-${input.bookingRef}`,
        docNumber: 'MOCK-SPA',
      };
    }
    const remaining = svc.remaining ?? 0;
    if (remaining <= 0) {
      throw Object.assign(new Error('No remaining service quota'), { status: 409 });
    }
    services[idx] = { ...svc, remaining: remaining - 1 };
    m.services = [...services];
    void input.occurredAt;
    void input.durationMin;
    void input.serviceId;
    return {
      ...m,
      services: [...services],
      docId: `mock-spa-${input.bookingRef}`,
      docNumber: 'MOCK-SPA',
    };
  }

  async restoreSpaVisit(
    externalId: string,
    input: { bookingRef: string },
  ) {
    const entry = Object.values(MOCK_USERS).find(
      (u) => u.profile.externalId === externalId,
    );
    if (!entry?.membership) {
      throw Object.assign(new Error('Membership not found'), { status: 404 });
    }
    void input.bookingRef;
    return { ...entry.membership };
  }

  async getSpaVisitStatus(
    _externalId: string,
    input: { bookingRef: string },
  ) {
    void input.bookingRef;
    return { found: true, cancelled: false, posted: true };
  }

  async sellSpaService(
    externalId: string,
    input: {
      serviceName: string;
      serviceId?: string;
      bookingRef: string;
      occurredAt: string;
      priceMinor: number;
      currency?: string;
      durationMin?: number;
    },
  ) {
    const entry = Object.values(MOCK_USERS).find(
      (u) => u.profile.externalId === externalId,
    );
    if (!entry?.membership) {
      throw Object.assign(new Error('Membership not found'), { status: 404 });
    }
    const m = entry.membership;
    const price = (input.priceMinor ?? 0) / 100;
    m.debtAmount = (m.debtAmount ?? 0) + price;
    if (input.currency) m.currency = input.currency;
    void input.serviceName;
    void input.occurredAt;
    void input.serviceId;
    void input.durationMin;
    return {
      ...m,
      docId: `mock-spa-${input.bookingRef}`,
      docNumber: 'MOCK-SPA-SALE',
    };
  }

  async getSpecialistServiceDebts(_input: {
    from: string;
    to: string;
    employeeCode: string;
  }): Promise<import('@fitgo/shared-types').SpecialistServiceDebt[]> {
    const code = _input.employeeCode?.trim() ?? '';
    if (!code) return [];
    return [
      {
        externalId: 'mock-client-1',
        clientName: 'Куделко Д.',
        serviceName: 'Массаж спортивный 40 мин',
        occurredAt: `${_input.from}T12:00:00`,
        amount: 95,
        currency: 'BYN',
        employeeCode: '000000099',
        employeeName: 'Хилькович Е.',
        docRef: '000028749#1',
        paymentStatus: 'DEBT' as const,
      },
      {
        externalId: 'mock-client-2',
        clientName: 'Иванов И.',
        serviceName: 'Массаж классический общий',
        occurredAt: `${_input.to}T15:00:00`,
        amount: 90,
        currency: 'BYN',
        employeeCode: '000000081',
        employeeName: 'Петрова',
        docRef: '000028700#1',
        paymentStatus: 'PAID' as const,
      },
    ].filter((r) => r.employeeCode === code);
  }

  async getPtSessionPayment(input: {
    clientExternalId?: string;
    clientPhone?: string;
    trainerExternalId?: string;
    occurredAt: string;
  }): Promise<{
    paymentStatus: 'PAID' | 'DEBT' | 'PENDING_PAYMENT' | 'N_A';
    payKind?: 'GIFT' | 'BLOCK' | 'PAID' | 'UNKNOWN';
    priceMinor?: number;
    docRef?: string;
  } | null> {
    void input.trainerExternalId;
    if (!input.clientExternalId && !input.clientPhone) return null;
    const last = (input.clientPhone ?? input.clientExternalId ?? '').replace(
      /\D/g,
      '',
    );
    const even = last.length > 0 && Number(last[last.length - 1]) % 2 === 0;
    return {
      paymentStatus: even ? 'PAID' : 'DEBT',
      payKind: even ? 'PAID' : 'UNKNOWN',
      priceMinor: 5000,
      docRef: even ? `MOCK-PT-${input.occurredAt.slice(0, 10)}` : undefined,
    };
  }

  async getGroupSessionRoster(appointmentId: string) {
    if (!appointmentId.trim()) return null;
    return {
      data: [
        {
          externalId: 'mock-client-1',
          clientName: 'Иванов И.',
          phone: '375291111111',
        },
        {
          externalId: 'mock-client-2',
          clientName: 'Петрова А.',
          phone: '375292222222',
        },
      ],
    };
  }

  async getSegmentsConfig() {
    return {
      segments: [
        {
          key: 'staff.admins',
          type: 'employee' as const,
          uuid: '8deca45d-36c3-2cf1-11f1-bb0f60dafc75',
          name: 'Администраторы',
          found: true,
          count: 2,
        },
        {
          key: 'staff.managers',
          type: 'employee' as const,
          uuid: '8deca45d-36c3-2cf1-11f1-bb368b133b96',
          name: 'Управляющий',
          found: true,
          count: 1,
        },
        {
          key: 'staff.spa',
          type: 'employee' as const,
          uuid: '81167085-c20c-362e-11eb-0a233ed68521',
          name: 'Спа специалисты',
          found: true,
          count: 1,
        },
        {
          key: 'staff.trainers',
          type: 'employee' as const,
          uuid: '8db17085-c20c-362e-11eb-a6793776913c',
          name: 'Тренера все',
          found: true,
          count: 1,
        },
        {
          key: 'staff.groupTrainers',
          type: 'employee' as const,
          uuid: '8deca45d-36c3-2cf1-11f1-bb326a47ed50',
          name: 'Тренера ГП приложение',
          found: true,
          count: 1,
        },
        {
          key: 'nom.spaCabinet',
          type: 'nomenclature' as const,
          uuid: '8deca45d-36c3-2cf1-11f1-b9bd204f566c',
          name: 'Спа кабинет приложение',
          found: true,
          count: 2,
        },
      ],
    };
  }

  async getSegmentMembers(input: { key?: string; uuid?: string }) {
    const key = input.key ?? '';
    if (key.startsWith('nom.')) {
      return {
        key,
        uuid: input.uuid ?? '',
        type: 'nomenclature',
        name: 'Mock nom',
        found: true,
        data: [
          {
            externalId: 'nom-1',
            name: 'Массаж классический',
            code: '00001',
            priceMinor: 4500,
          },
          {
            externalId: 'nom-2',
            name: 'Солярий 10 мин',
            code: '00002',
            priceMinor: 800,
          },
        ],
      };
    }
    return {
      key,
      uuid: input.uuid ?? '',
      type: 'employee',
      name: 'Mock staff',
      found: true,
      data: [
        {
          externalId: 'staff-1',
          name: 'Админ Тест',
          code: '000000001',
          phone: '375291000001',
        },
        {
          externalId: 'staff-2',
          name: 'Специалист Тест',
          code: '000000002',
          phone: '375291000002',
        },
      ],
    };
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
    // Accept any club id in mock — seed may use live FORMA_CLUB_ID UUID.
    if (!clubExternalId) return [];

    this.ensureFreshSchedule();

    let slots = [...this.slots];
    if (filters?.trainerId) {
      slots = slots.filter((s) => s.trainerId === filters.trainerId);
    }
    if (filters?.type) {
      slots = slots.filter((s) => s.type === filters.type);
    }
    // Compare as instants — string compare breaks on "YYYY-MM-DD HH:mm" vs "...T..."
    if (filters?.from) {
      const fromMs = scheduleFilterMs(filters.from);
      slots = slots.filter((s) => scheduleFilterMs(s.startAt) >= fromMs);
    }
    if (filters?.to) {
      const toMs = scheduleFilterMs(filters.to);
      slots = slots.filter((s) => scheduleFilterMs(s.startAt) <= toMs);
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

  async getExpiringMemberships(days = 14) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Object.values(MOCK_USERS)
      .filter((u) => u.profile.roles.includes(UserRole.CLIENT) && u.membership)
      .map((u) => {
        const from = new Date(u.membership.validFrom);
        const until = new Date(u.membership.validUntil);
        const termDays = Math.max(
          0,
          Math.round((until.getTime() - from.getTime()) / 86400000),
        );
        const daysLeft =
          (until.getTime() - today.getTime()) / 86400000;
        const oneOff = termDays <= 1;
        return { u, daysLeft, termDays, oneOff };
      })
      .filter(
        ({ daysLeft, oneOff }) =>
          !oneOff && daysLeft >= 0 && daysLeft <= days,
      )
      .map(({ u, termDays }) => ({
        externalId: u.profile.externalId!,
        firstName: u.profile.firstName,
        lastName: u.profile.lastName,
        phone: u.profile.phone,
        docId: u.membership.id,
        name: u.membership.name,
        status: u.membership.status,
        validFrom: u.membership.validFrom,
        validUntil: u.membership.validUntil,
        visitsRemaining: u.membership.visitsRemaining,
        kind: 'membership' as const,
        termDays,
        totalUnits: null as null,
        oneOff: false,
        nextMembership: null as null,
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
