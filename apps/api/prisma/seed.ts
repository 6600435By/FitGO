import { BadgeDataScope, Gender, LeagueTier, PrismaClient, Role, AdminPermission, VisitSource } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { MOCK_CLUB } from '@fitgo/1c-adapter';

const prisma = new PrismaClient();

const BADGES = [
  { slug: 'visit-1', name: 'Первый шаг', description: '1 визит', threshold: 1, category: 'visits', tier: 'bronze', dataScope: BadgeDataScope.SINCE_INSTALL },
  { slug: 'visit-10', name: 'Постоянный гость', description: '10 визитов', threshold: 10, category: 'visits', tier: 'bronze', dataScope: BadgeDataScope.SINCE_INSTALL },
  { slug: 'visit-25', name: 'Фанат фитнеса', description: '25 визитов', threshold: 25, category: 'visits', tier: 'silver', dataScope: BadgeDataScope.SINCE_INSTALL },
  { slug: 'visit-50', name: 'Полтинник', description: '50 визитов', threshold: 50, category: 'visits', tier: 'silver', dataScope: BadgeDataScope.SINCE_INSTALL },
  { slug: 'visit-100', name: 'Сотня', description: '100 визитов', threshold: 100, category: 'visits', tier: 'gold', dataScope: BadgeDataScope.SINCE_INSTALL },
  { slug: 'streak-3', name: 'Разгон', description: '3 дня подряд', threshold: 3, category: 'streak', tier: 'bronze', dataScope: BadgeDataScope.SINCE_INSTALL },
  { slug: 'streak-7', name: 'Неделя силы', description: '7 дней подряд', threshold: 7, category: 'streak', tier: 'silver', dataScope: BadgeDataScope.SINCE_INSTALL },
  { slug: 'streak-14', name: 'Две недели', description: '14 дней подряд', threshold: 14, category: 'streak', tier: 'gold', dataScope: BadgeDataScope.SINCE_INSTALL },
  { slug: 'outdoor-first', name: 'Первый выход', description: '1 тренировка вне клуба', threshold: 1, category: 'outdoor', tier: 'bronze', dataScope: BadgeDataScope.SINCE_INSTALL },
  { slug: 'outdoor-10', name: 'Домашний атлет', description: '10 тренировок вне клуба', threshold: 10, category: 'outdoor', tier: 'silver', dataScope: BadgeDataScope.SINCE_INSTALL },
  { slug: 'loyalty-1y', name: 'Верный друг', description: '1 год непрерывности', threshold: 12, category: 'loyalty', tier: 'bronze', dataScope: BadgeDataScope.HISTORICAL },
  { slug: 'loyalty-2y', name: 'Клубный житель', description: '2 года непрерывности', threshold: 24, category: 'loyalty', tier: 'silver', dataScope: BadgeDataScope.HISTORICAL },
  { slug: 'loyalty-3y', name: 'Старожил', description: '3 года непрерывности', threshold: 36, category: 'loyalty', tier: 'gold', dataScope: BadgeDataScope.HISTORICAL },
  { slug: 'loyalty-5y', name: 'Столп клуба', description: '5 лет непрерывности', threshold: 60, category: 'loyalty', tier: 'platinum', dataScope: BadgeDataScope.HISTORICAL },
  { slug: 'loyalty-6y', name: 'Клубная легенда', description: '6+ лет непрерывности', threshold: 72, category: 'loyalty', tier: 'diamond', dataScope: BadgeDataScope.HISTORICAL },
];

const DEMO_USERS = [
  {
    email: 'client@demo.fitgo',
    password: 'client123',
    firstName: 'Алексей',
    lastName: 'Иванов',
    phone: '+375296600435',
    externalId: '1c-client-001',
    gender: Gender.MALE,
    dateOfBirth: new Date('1990-05-15'),
    roles: [Role.CLIENT],
    withGamification: true,
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
    withAllAdminPermissions: true,
  },
  {
    email: 'superadmin@demo.fitgo',
    password: 'super123',
    firstName: 'Ольга',
    lastName: 'Козлова',
    phone: '+375441234567',
    roles: [Role.SUPER_ADMIN],
  },
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
    const gamificationStartedAt =
      'withGamification' in demoUser && demoUser.withGamification ? new Date() : undefined;

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
        ...('gender' in demoUser && demoUser.gender
          ? { gender: demoUser.gender, dateOfBirth: demoUser.dateOfBirth, profileCompletedAt: new Date() }
          : {}),
        ...(gamificationStartedAt
          ? {
              gamificationStartedAt,
              useRealNameInPublic: true,
              gamificationNickname: 'Железный Кабан',
            }
          : {}),
      },
      create: {
        clubId: club.id,
        email: demoUser.email,
        password: passwordHash,
        firstName: demoUser.firstName,
        lastName: demoUser.lastName,
        phone: demoUser.phone,
        externalId: demoUser.externalId,
        ...('gender' in demoUser && demoUser.gender
          ? { gender: demoUser.gender, dateOfBirth: demoUser.dateOfBirth, profileCompletedAt: new Date() }
          : {}),
        ...(gamificationStartedAt
          ? {
              gamificationStartedAt,
              useRealNameInPublic: true,
            }
          : {}),
      },
    });

    for (const role of demoUser.roles) {
      await prisma.userRole.upsert({
        where: { userId_role: { userId: user.id, role } },
        update: {},
        create: { userId: user.id, role },
      });
    }

    if (demoUser.roles.some((r) => r === Role.CLIENT)) {
      await prisma.notificationPreference.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id },
      });

      if ('withGamification' in demoUser && demoUser.withGamification) {
        await prisma.clientRating.upsert({
          where: { userId: user.id },
          update: {},
          create: {
            userId: user.id,
            clubId: club.id,
            leagueTier: LeagueTier.BRONZE,
            weeklyXp: 120,
            monthlyXp: 120,
            lifetimeXp: 120,
            lastAppActivityAt: new Date(),
          },
        });

        await prisma.loyaltyProfile.upsert({
          where: { userId: user.id },
          update: {},
          create: {
            userId: user.id,
            peakTier: LeagueTier.BRONZE,
            currentTier: LeagueTier.BRONZE,
            continuityMonths: 3,
            lastVisitAt: new Date(),
          },
        });

        for (let i = 0; i < 5; i++) {
          const d = new Date();
          d.setDate(d.getDate() - i * 2);
          const visitDate = d.toISOString().slice(0, 10);
          await prisma.clubVisit.upsert({
            where: {
              userId_clubId_visitDate: {
                userId: user.id,
                clubId: club.id,
                visitDate,
              },
            },
            update: {},
            create: {
              userId: user.id,
              clubId: club.id,
              visitedAt: d,
              visitDate,
              source: VisitSource.ONEC_SYNC,
            },
          });
        }
      }
    }

    if (demoUser.roles.some((r) => r === Role.TRAINER)) {
      await prisma.trainerWorkSlot.deleteMany({ where: { trainerId: user.id } });
      await prisma.trainerWorkSlot.createMany({
        data: [
          { trainerId: user.id, dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
          { trainerId: user.id, dayOfWeek: 3, startTime: '10:00', endTime: '20:00' },
          { trainerId: user.id, dayOfWeek: 5, startTime: '09:00', endTime: '15:00' },
        ],
      });

      const periodStart = new Date();
      periodStart.setHours(0, 0, 0, 0);
      const periodEnd = new Date(periodStart);
      periodEnd.setDate(periodEnd.getDate() + 28);
      periodEnd.setHours(23, 59, 59, 999);

      await prisma.trainerAvailabilityBlock.deleteMany({
        where: { trainerId: user.id },
      });

      const template = await prisma.trainerWorkSlot.findMany({
        where: { trainerId: user.id },
      });
      const blocks: Array<{ trainerId: string; startAt: Date; endAt: Date; status: 'PUBLISHED' }> = [];
      const cursor = new Date(periodStart);
      while (cursor <= periodEnd) {
        for (const slot of template) {
          if (slot.dayOfWeek !== cursor.getDay()) continue;
          const [sh, sm] = slot.startTime.split(':').map(Number);
          const [eh, em] = slot.endTime.split(':').map(Number);
          const startAt = new Date(cursor);
          startAt.setHours(sh, sm, 0, 0);
          const endAt = new Date(cursor);
          endAt.setHours(eh, em, 0, 0);
          blocks.push({
            trainerId: user.id,
            startAt,
            endAt,
            status: 'PUBLISHED',
          });
        }
        cursor.setDate(cursor.getDate() + 1);
      }

      if (blocks.length > 0) {
        await prisma.trainerAvailabilityBlock.createMany({ data: blocks });
        await prisma.trainerSchedulePublication.create({
          data: {
            trainerId: user.id,
            periodStart,
            periodEnd,
          },
        });
      }
    }

    if (
      'withAllAdminPermissions' in demoUser &&
      demoUser.withAllAdminPermissions
    ) {
      for (const permission of Object.values(AdminPermission)) {
        await prisma.adminPermissionGrant.upsert({
          where: {
            userId_permission: { userId: user.id, permission },
          },
          update: {},
          create: { userId: user.id, permission },
        });
      }
    }
  }

  console.log('Seed completed: demo club, users, badges, gamification data');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
