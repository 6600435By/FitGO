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
  name: 'Форма',
  slug: 'demo-club',
  address: 'ул. Спортивная, 10, Минск',
};

/** Шаблоны занятий: dayOffset от сегодня, hour — локальное время */
const SCHEDULE_TEMPLATES: Array<{
  dayOffset: number;
  hour: number;
  durationMin: number;
  title: string;
  type: SessionType;
  trainerId: string;
  trainerName: string;
  capacity: number;
  booked: number;
}> = [
  { dayOffset: 0, hour: 10, durationMin: 60, title: 'Функциональный тренинг', type: SessionType.GROUP, trainerId: '1c-trainer-001', trainerName: 'Мария Петрова', capacity: 12, booked: 6 },
  { dayOffset: 0, hour: 18, durationMin: 60, title: 'Кроссфит', type: SessionType.GROUP, trainerId: '1c-trainer-003', trainerName: 'Игорь Волков', capacity: 12, booked: 10 },
  { dayOffset: 0, hour: 11, durationMin: 60, title: 'Персональная тренировка', type: SessionType.PERSONAL, trainerId: '1c-trainer-001', trainerName: 'Мария Петрова', capacity: 1, booked: 0 },
  { dayOffset: 1, hour: 9, durationMin: 60, title: 'Йога для начинающих', type: SessionType.GROUP, trainerId: '1c-trainer-002', trainerName: 'Елена Козлова', capacity: 15, booked: 8 },
  { dayOffset: 1, hour: 14, durationMin: 60, title: 'Пилатес', type: SessionType.GROUP, trainerId: '1c-trainer-002', trainerName: 'Елена Козлова', capacity: 10, booked: 5 },
  { dayOffset: 1, hour: 16, durationMin: 60, title: 'Персональная тренировка', type: SessionType.PERSONAL, trainerId: '1c-trainer-001', trainerName: 'Мария Петрова', capacity: 1, booked: 0 },
  { dayOffset: 2, hour: 10, durationMin: 60, title: 'Стretching', type: SessionType.GROUP, trainerId: '1c-trainer-001', trainerName: 'Мария Петрова', capacity: 14, booked: 4 },
  { dayOffset: 3, hour: 18, durationMin: 60, title: 'Кроссфит', type: SessionType.GROUP, trainerId: '1c-trainer-003', trainerName: 'Игорь Волков', capacity: 12, booked: 12 },
  { dayOffset: 4, hour: 9, durationMin: 60, title: 'Йога для начинающих', type: SessionType.GROUP, trainerId: '1c-trainer-002', trainerName: 'Елена Козлова', capacity: 15, booked: 3 },
  { dayOffset: 5, hour: 11, durationMin: 60, title: 'Персональная тренировка', type: SessionType.PERSONAL, trainerId: '1c-trainer-001', trainerName: 'Мария Петрова', capacity: 1, booked: 1 },
  { dayOffset: 6, hour: 10, durationMin: 60, title: 'Пилатес', type: SessionType.GROUP, trainerId: '1c-trainer-002', trainerName: 'Елена Козлова', capacity: 10, booked: 2 },
];

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function formatLocalIso(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function formatDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Генерирует расписание на ближайшие дни от «сегодня» */
export function buildMockSchedule(): ScheduleSlot[] {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const slots: ScheduleSlot[] = [];
  let idx = 1;

  for (const tmpl of SCHEDULE_TEMPLATES) {
    const start = addDays(todayStart, tmpl.dayOffset);
    start.setHours(tmpl.hour, 0, 0, 0);
    const end = new Date(start.getTime() + tmpl.durationMin * 60_000);

    if (end.getTime() <= now.getTime()) continue;

    const available = tmpl.booked < tmpl.capacity;
    slots.push({
      id: `slot-${String(idx++).padStart(3, '0')}`,
      title: tmpl.title,
      type: tmpl.type,
      trainerId: tmpl.trainerId,
      trainerName: tmpl.trainerName,
      startAt: formatLocalIso(start),
      endAt: formatLocalIso(end),
      capacity: tmpl.capacity,
      booked: tmpl.booked,
      available,
    });
  }

  return slots.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/** Визиты клиента — последние N дней от сегодня */
export function buildMockVisits(clubName: string): Visit[] {
  const offsets = [2, 4, 6, 8, 12];
  const kinds = ['GYM', 'GROUP', 'PT', 'GYM', 'SPA_MASSAGE'] as const;
  const titles = [
    'Членство VIP',
    'Йога',
    'Персональная тренировка',
    'Тренажёрный зал',
    'Массаж',
  ];
  return offsets.map((daysAgo, i) => {
    const d = addDays(new Date(), -daysAgo);
    return {
      id: `visit-${String(i + 1).padStart(3, '0')}`,
      date: formatDateKey(d),
      checkIn: i % 2 === 0 ? '08:15' : '18:30',
      checkOut: i % 2 === 0 ? '09:45' : '20:00',
      clubName,
      title: titles[i],
      kind: kinds[i],
      verification: 'VERIFIED_1C' as const,
      source: '1c' as const,
    };
  });
}

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
      validUntil: '2026-12-01',
      services: [
        { name: 'Групповые программы', unlimited: true },
        { name: 'Массаж классический', remaining: 2, total: 4 },
      ],
      accountBalance: 45.5,
      debtAmount: 0,
      currency: 'BYN',
      freezeAllowed: true,
      freezeDaysRemaining: 14,
      freezeDaysTotal: 14,
    },
    visits: buildMockVisits(MOCK_CLUB.name),
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

/** @deprecated используйте buildMockSchedule() — оставлено для совместимости импортов */
export const MOCK_SCHEDULE: ScheduleSlot[] = buildMockSchedule();

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
