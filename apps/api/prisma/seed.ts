import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { MOCK_CLUB } from '@fitgo/1c-adapter';

const prisma = new PrismaClient();

const DEMO_USERS = [
  {
    email: 'client@demo.fitgo',
    password: 'client123',
    firstName: 'Алексей',
    lastName: 'Иванов',
    phone: '+375291234567',
    externalId: '1c-client-001',
    roles: [Role.CLIENT],
  },
  {
    email: 'trainer@demo.fitgo',
    password: 'trainer123',
    firstName: 'Мария',
    lastName: 'Петрова',
    phone: '+375299876543',
    externalId: '1c-trainer-001',
    roles: [Role.TRAINER],
  },
  {
    email: 'admin@demo.fitgo',
    password: 'admin123',
    firstName: 'Дмитрий',
    lastName: 'Сидоров',
    phone: '+375331112233',
    externalId: '1c-admin-001',
    roles: [Role.ADMIN],
  },
];

const BADGES = [
  { slug: 'first-visit', name: 'Первый шаг', description: 'Первое посещение клуба', threshold: 1 },
  { slug: 'visits-10', name: 'Постоянный гость', description: '10 посещений', threshold: 10 },
  { slug: 'visits-25', name: 'Фанат фитнеса', description: '25 посещений', threshold: 25 },
  { slug: 'visits-50', name: 'Легенда клуба', description: '50 посещений', threshold: 50 },
  { slug: 'streak-7', name: 'Неделя силы', description: '7 дней подряд в зале', threshold: 7 },
];

async function main() {
  const club = await prisma.club.upsert({
    where: { slug: MOCK_CLUB.slug },
    update: {
      name: MOCK_CLUB.name,
      address: MOCK_CLUB.address,
      externalId: MOCK_CLUB.externalId,
      currency: 'BYN',
    },
    create: {
      name: MOCK_CLUB.name,
      slug: MOCK_CLUB.slug,
      address: MOCK_CLUB.address,
      externalId: MOCK_CLUB.externalId,
      currency: 'BYN',
    },
  });

  await prisma.clubTheme.upsert({
    where: { clubId: club.id },
    update: { primaryColor: '#14b88a' },
    create: { clubId: club.id, primaryColor: '#14b88a' },
  });

  for (const badge of BADGES) {
    await prisma.badge.upsert({
      where: { slug: badge.slug },
      update: badge,
      create: badge,
    });
  }

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  await prisma.challenge.upsert({
    where: { id: 'challenge-monthly-demo' },
    update: {
      title: 'Челлендж месяца',
      description: 'Посетите клуб 8 раз за месяц',
      targetVisits: 8,
      startDate: startOfMonth,
      endDate: endOfMonth,
      active: true,
    },
    create: {
      id: 'challenge-monthly-demo',
      clubId: club.id,
      title: 'Челлендж месяца',
      description: 'Посетите клуб 8 раз за месяц',
      targetVisits: 8,
      startDate: startOfMonth,
      endDate: endOfMonth,
      active: true,
    },
  });

  for (const demoUser of DEMO_USERS) {
    const passwordHash = await bcrypt.hash(demoUser.password, 10);
    const user = await prisma.user.upsert({
      where: {
        clubId_email: {
          clubId: club.id,
          email: demoUser.email,
        },
      },
      update: {
        firstName: demoUser.firstName,
        lastName: demoUser.lastName,
        phone: demoUser.phone,
        externalId: demoUser.externalId,
        password: passwordHash,
      },
      create: {
        clubId: club.id,
        email: demoUser.email,
        password: passwordHash,
        firstName: demoUser.firstName,
        lastName: demoUser.lastName,
        phone: demoUser.phone,
        externalId: demoUser.externalId,
      },
    });

    for (const role of demoUser.roles) {
      await prisma.userRole.upsert({
        where: {
          userId_role: {
            userId: user.id,
            role,
          },
        },
        update: {},
        create: {
          userId: user.id,
          role,
        },
      });
    }

    if (demoUser.roles.some((r) => r === Role.CLIENT)) {
      await prisma.notificationPreference.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id },
      });
    }
  }

  console.log('Seed completed: demo club, users, badges, and challenge created');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
