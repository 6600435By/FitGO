import { Injectable, NotFoundException } from '@nestjs/common';
import { FitnessService } from '../fitness/fitness.service';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/jwt.strategy';

const BADGE_DEFS = [
  { slug: 'first-visit', name: 'Первый шаг', description: 'Первое посещение клуба', threshold: 1 },
  { slug: 'visits-10', name: 'Постоянный гость', description: '10 посещений', threshold: 10 },
  { slug: 'visits-25', name: 'Фанат фитнеса', description: '25 посещений', threshold: 25 },
  { slug: 'visits-50', name: 'Легенда клуба', description: '50 посещений', threshold: 50 },
  { slug: 'streak-7', name: 'Неделя силы', description: '7 дней подряд в зале', threshold: 7 },
];

@Injectable()
export class EngagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
  ) {}

  async ensureBadges() {
    for (const badge of BADGE_DEFS) {
      await this.prisma.badge.upsert({
        where: { slug: badge.slug },
        update: { name: badge.name, description: badge.description, threshold: badge.threshold },
        create: badge,
      });
    }
  }

  private calcStreak(visitDates: string[]): number {
    if (visitDates.length === 0) return 0;
    const uniqueDays = [...new Set(visitDates.map((d) => d.slice(0, 10)))].sort().reverse();
    let streak = 1;
    for (let i = 0; i < uniqueDays.length - 1; i++) {
      const current = new Date(uniqueDays[i]);
      const next = new Date(uniqueDays[i + 1]);
      const diff = (current.getTime() - next.getTime()) / 86400000;
      if (diff === 1) streak++;
      else break;
    }
    return streak;
  }

  async getGamification(user: JwtPayload) {
    await this.ensureBadges();
    const dbUser = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!dbUser?.externalId) throw new NotFoundException('Клиент не привязан к 1С');

    const visits = await this.fitness.getProvider().getVisits(dbUser.externalId);
    const visitStreak = this.calcStreak(visits.map((v) => v.date));
    const totalVisits = visits.length;

    const badges = await this.prisma.badge.findMany();
    const earned = await this.prisma.userBadge.findMany({
      where: { userId: user.sub },
      include: { badge: true },
    });

    for (const badge of badges) {
      if (!badge.threshold) continue;
      const earnedSlugs = new Set(earned.map((e) => e.badge.slug));
      if (earnedSlugs.has(badge.slug)) continue;

      const qualifies =
        badge.slug === 'streak-7'
          ? visitStreak >= badge.threshold
          : totalVisits >= badge.threshold;

      if (qualifies) {
        await this.prisma.userBadge.create({
          data: { userId: user.sub, badgeId: badge.id },
        });
        await this.prisma.user.update({
          where: { id: user.sub },
          data: { gamificationPoints: { increment: badge.threshold * 10 } },
        });
      }
    }

    const updatedEarned = await this.prisma.userBadge.findMany({
      where: { userId: user.sub },
      include: { badge: true },
      orderBy: { earnedAt: 'desc' },
    });

    const dbUserUpdated = await this.prisma.user.findUnique({
      where: { id: user.sub },
    });

    const clubUsers = await this.prisma.user.findMany({
      where: { clubId: user.clubId },
      orderBy: { gamificationPoints: 'desc' },
      take: 20,
    });
    const rank = clubUsers.findIndex((u) => u.id === user.sub) + 1;

    return {
      visitStreak,
      totalVisits,
      points: dbUserUpdated?.gamificationPoints ?? 0,
      rank: rank > 0 ? rank : undefined,
      badges: updatedEarned.map((e) => ({
        id: e.badge.id,
        name: e.badge.name,
        description: e.badge.description,
        earnedAt: e.earnedAt.toISOString(),
      })),
    };
  }

  async getReferral(user: JwtPayload) {
    let dbUser = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!dbUser) throw new NotFoundException();

    if (!dbUser.referralCode) {
      const code = `FG${dbUser.id.slice(-6).toUpperCase()}`;
      dbUser = await this.prisma.user.update({
        where: { id: user.sub },
        data: { referralCode: code },
      });
    }

    const club = await this.prisma.club.findUnique({ where: { id: user.clubId } });
    const referralsCount = await this.prisma.referral.count({
      where: { referrerId: user.sub },
    });

    const baseUrl = process.env.WEB_URL ?? 'http://localhost:3000';
    return {
      code: dbUser.referralCode!,
      link: `${baseUrl}/login?ref=${dbUser.referralCode}`,
      referralsCount,
      rewardDescription: club?.referralRewardDesc ?? 'Скидка 10% на следующий абонемент',
    };
  }

  async getClubTheme(clubId: string) {
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      include: { theme: true },
    });
    if (!club) throw new NotFoundException('Клуб не найден');

    return {
      clubName: club.name,
      logoUrl: club.theme?.logoUrl ?? undefined,
      primaryColor: club.theme?.primaryColor ?? '#14b88a',
    };
  }

  async updateClubTheme(
    clubId: string,
    data: { logoUrl?: string; primaryColor?: string; customDomain?: string },
  ) {
    return this.prisma.clubTheme.upsert({
      where: { clubId },
      update: data,
      create: { clubId, ...data },
    });
  }

  async getChallenges(clubId: string) {
    return this.prisma.challenge.findMany({
      where: { clubId, active: true },
      orderBy: { startDate: 'desc' },
    });
  }

  async getLeaderboard(clubId: string) {
    const users = await this.prisma.user.findMany({
      where: { clubId, gamificationPoints: { gt: 0 } },
      orderBy: { gamificationPoints: 'desc' },
      take: 10,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        gamificationPoints: true,
      },
    });
    return users.map((u, i) => ({
      rank: i + 1,
      name: `${u.firstName} ${u.lastName.charAt(0)}.`,
      points: u.gamificationPoints,
    }));
  }

  async syncWearable(user: JwtPayload, provider: string) {
    const dbUser = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!dbUser?.externalId) throw new NotFoundException();

    const visits = await this.fitness.getProvider().getVisits(dbUser.externalId);
    const visitsImported = visits.length;

    const sync = await this.prisma.wearableSync.upsert({
      where: { userId_provider: { userId: user.sub, provider } },
      update: { visitsImported, lastSyncAt: new Date() },
      create: { userId: user.sub, provider, visitsImported },
    });

    return {
      synced: true,
      visitsImported,
      lastSyncAt: sync.lastSyncAt.toISOString(),
    };
  }
}
