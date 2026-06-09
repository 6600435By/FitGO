import {
  MembershipStatus,
  SessionType,
  UserRole,
  type AccessCard,
  type Membership,
  type MembershipProduct,
  type ScheduleSlot,
  type UserProfile,
  type Visit,
} from '@fitgo/shared-types';

export const MOCK_CLUB = {
  id: 'club-demo-001',
  externalId: '1c-club-001',
  name: 'FITGO Demo Club',
  slug: 'demo-club',
  address: 'ул. Спортивная, 10, Минск',
};

export const MOCK_USERS: Record<
  string,
  {
    password: string;
    profile: UserProfile;
    membership: Membership;
    visits: Visit[];
    accessCard: AccessCard;
  }
> = {
  'client@demo.fitgo': {
    password: 'client123',
    profile: {
      id: 'user-client-001',
      externalId: '1c-client-001',
      clubId: MOCK_CLUB.id,
      email: 'client@demo.fitgo',
      phone: '+375291234567',
      firstName: 'Алексей',
      lastName: 'Иванов',
      roles: [UserRole.CLIENT],
    },
    membership: {
      id: 'membership-001',
      name: 'Безлимит 12 месяцев',
      status: MembershipStatus.ACTIVE,
      visitsRemaining: undefined,
      visitsTotal: undefined,
      validFrom: '2025-06-01',
      validUntil: '2026-06-01',
    },
    visits: [
      {
        id: 'visit-001',
        date: '2026-06-08',
        checkIn: '08:15',
        checkOut: '09:45',
        clubName: MOCK_CLUB.name,
      },
      {
        id: 'visit-002',
        date: '2026-06-06',
        checkIn: '18:30',
        checkOut: '20:00',
        clubName: MOCK_CLUB.name,
      },
      {
        id: 'visit-003',
        date: '2026-06-04',
        checkIn: '07:00',
        checkOut: '08:30',
        clubName: MOCK_CLUB.name,
      },
      {
        id: 'visit-004',
        date: '2026-06-02',
        checkIn: '12:00',
        checkOut: '13:15',
        clubName: MOCK_CLUB.name,
      },
      {
        id: 'visit-005',
        date: '2026-05-30',
        checkIn: '19:00',
        checkOut: '20:30',
        clubName: MOCK_CLUB.name,
      },
    ],
    accessCard: {
      id: 'card-001',
      barcode: 'FG2026001234567',
      clientName: 'Алексей Иванов',
      clubName: MOCK_CLUB.name,
    },
  },
  'trainer@demo.fitgo': {
    password: 'trainer123',
    profile: {
      id: 'user-trainer-001',
      externalId: '1c-trainer-001',
      clubId: MOCK_CLUB.id,
      email: 'trainer@demo.fitgo',
      phone: '+375299876543',
      firstName: 'Мария',
      lastName: 'Петрова',
      roles: [UserRole.TRAINER],
    },
    membership: {
      id: 'membership-staff',
      name: 'Сотрудник клуба',
      status: MembershipStatus.ACTIVE,
      validFrom: '2024-01-01',
      validUntil: '2099-12-31',
    },
    visits: [],
    accessCard: {
      id: 'card-trainer-001',
      barcode: 'FG2026009876543',
      clientName: 'Мария Петрова',
      clubName: MOCK_CLUB.name,
    },
  },
  'admin@demo.fitgo': {
    password: 'admin123',
    profile: {
      id: 'user-admin-001',
      externalId: '1c-admin-001',
      clubId: MOCK_CLUB.id,
      email: 'admin@demo.fitgo',
      phone: '+375331112233',
      firstName: 'Дмитрий',
      lastName: 'Сидоров',
      roles: [UserRole.ADMIN],
    },
    membership: {
      id: 'membership-admin',
      name: 'Администратор',
      status: MembershipStatus.ACTIVE,
      validFrom: '2024-01-01',
      validUntil: '2099-12-31',
    },
    visits: [],
    accessCard: {
      id: 'card-admin-001',
      barcode: 'FG2026001111222',
      clientName: 'Дмитрий Сидоров',
      clubName: MOCK_CLUB.name,
    },
  },
};

export const MOCK_CLIENTS = Object.values(MOCK_USERS)
  .filter((u) => u.profile.roles.includes(UserRole.CLIENT))
  .map((u) => u.profile);

export const MOCK_SCHEDULE: ScheduleSlot[] = [
  {
    id: 'slot-001',
    title: 'Йога для начинающих',
    type: SessionType.GROUP,
    trainerId: '1c-trainer-002',
    trainerName: 'Елена Козлова',
    startAt: '2026-06-10T09:00:00',
    endAt: '2026-06-10T10:00:00',
    capacity: 15,
    booked: 8,
    available: true,
  },
  {
    id: 'slot-002',
    title: 'Кроссфит',
    type: SessionType.GROUP,
    trainerId: '1c-trainer-003',
    trainerName: 'Игорь Волков',
    startAt: '2026-06-10T18:00:00',
    endAt: '2026-06-10T19:00:00',
    capacity: 12,
    booked: 12,
    available: false,
  },
  {
    id: 'slot-003',
    title: 'Персональная тренировка',
    type: SessionType.PERSONAL,
    trainerId: '1c-trainer-001',
    trainerName: 'Мария Петрова',
    startAt: '2026-06-10T11:00:00',
    endAt: '2026-06-10T12:00:00',
    capacity: 1,
    booked: 0,
    available: true,
  },
  {
    id: 'slot-004',
    title: 'Пилатес',
    type: SessionType.GROUP,
    trainerId: '1c-trainer-002',
    trainerName: 'Елена Козлова',
    startAt: '2026-06-11T10:00:00',
    endAt: '2026-06-11T11:00:00',
    capacity: 10,
    booked: 5,
    available: true,
  },
  {
    id: 'slot-005',
    title: 'Персональная тренировка',
    type: SessionType.PERSONAL,
    trainerId: '1c-trainer-001',
    trainerName: 'Мария Петрова',
    startAt: '2026-06-11T14:00:00',
    endAt: '2026-06-11T15:00:00',
    capacity: 1,
    booked: 1,
    available: false,
  },
];

export const MOCK_PRODUCTS: MembershipProduct[] = [
  {
    id: 'product-001',
    name: 'Месяц безлимит',
    description: 'Неограниченное посещение в течение 30 дней',
    price: 89,
    currency: 'BYN',
    durationDays: 30,
  },
  {
    id: 'product-002',
    name: '12 тренировок',
    description: 'Абонемент на 12 посещений, срок 3 месяца',
    price: 120,
    currency: 'BYN',
    durationDays: 90,
    visitsIncluded: 12,
  },
  {
    id: 'product-003',
    name: 'Безлимит 12 месяцев',
    description: 'Годовой абонемент с максимальной выгодой',
    price: 890,
    currency: 'BYN',
    durationDays: 365,
  },
];
