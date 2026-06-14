import { Injectable } from '@nestjs/common';
import { BadgeDataScope } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BADGE_DEFINITIONS, TIER_POINTS, XP_BY_ACTION } from './badge-definitions';
import { LeagueService } from './league.service';
import { VisitSyncService } from './visit-sync.service';

@Injectable()
export class BadgeEvaluatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly visitSync: VisitSyncService,
    private readonly league: LeagueService,
  ) {}

  async ensureBadges() {
    for (const def of BADGE_DEFINITIONS) {
      await this.prisma.badge.upsert({
        where: { slug: def.slug },
        update: {
          name: def.name,
          description: def.description,
          threshold: def.threshold,
          category: def.category,
          tier: def.tier,
          dataScope: def.dataScope,
        },
        create: {
          slug: def.slug,
          name: def.name,
          description: def.description,
          threshold: def.threshold,
          category: def.category,
          tier: def.tier,
          dataScope: def.dataScope,
        },
      });
    }
  }

  async evaluate(userId: string): Promise<string[]> {
    await this.ensureBadges();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return [];

    const earned = await this.prisma.userBadge.findMany({
      where: { userId },
      include: { badge: true },
    });
    const earnedSlugs = new Set(earned.map((e) => e.badge.slug));

    const sinceInstallVisits = await this.visitSync.getVisitsForUser(
      userId,
      user.gamificationStartedAt,
    );
    const allVisits = await this.visitSync.getVisitsForUser(userId);
    const outdoorCount = await this.prisma.workoutLog.count({ where: { userId } });

    const sinceInstallCount = sinceInstallVisits.length;
    const historicalCount = allVisits.length;
    const sinceStreak = this.visitSync.calcStreak(
      sinceInstallVisits.map((v) => v.visitDate),
    );
    const historicalStreak = this.visitSync.calcStreak(
      allVisits.map((v) => v.visitDate),
    );

    const loyalty = await this.prisma.loyaltyProfile.findUnique({
      where: { userId },
    });
    const continuityMonths = loyalty?.continuityMonths ?? 0;

    const badges = await this.prisma.badge.findMany();
    const newlyEarned: string[] = [];

    for (const badge of badges) {
      if (earnedSlugs.has(badge.slug) || !badge.threshold) continue;

      let qualifies = false;
      const def = BADGE_DEFINITIONS.find((d) => d.slug === badge.slug);

      if (def?.streak) {
        const streak =
          badge.dataScope === BadgeDataScope.HISTORICAL
            ? historicalStreak
            : sinceStreak;
        qualifies = streak >= badge.threshold;
      } else if (def?.category === 'outdoor') {
        qualifies = outdoorCount >= badge.threshold;
      } else if (def?.category === 'loyalty') {
        qualifies = continuityMonths >= badge.threshold;
      } else if (badge.dataScope === BadgeDataScope.HISTORICAL) {
        qualifies = historicalCount >= badge.threshold;
      } else {
        qualifies = sinceInstallCount >= badge.threshold;
      }

      if (!qualifies) continue;

      await this.prisma.userBadge.create({
        data: { userId, badgeId: badge.id },
      });
      const xp =
        (def?.tier ? TIER_POINTS[def.tier] : 0) + XP_BY_ACTION.BADGE;
      await this.league.awardXp(userId, xp);
      newlyEarned.push(badge.slug);
    }

    return newlyEarned;
  }

  async getNextBadge(userId: string) {
    await this.ensureBadges();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return null;

    const earned = await this.prisma.userBadge.findMany({
      where: { userId },
      include: { badge: true },
    });
    const earnedSlugs = new Set(earned.map((e) => e.badge.slug));

    const sinceInstallVisits = await this.visitSync.getVisitsForUser(
      userId,
      user.gamificationStartedAt,
    );
    const sinceInstallCount = sinceInstallVisits.length;
    const sinceStreak = this.visitSync.calcStreak(
      sinceInstallVisits.map((v) => v.visitDate),
    );

    const visitBadges = BADGE_DEFINITIONS.filter(
      (b) =>
        b.category === 'visits' &&
        b.dataScope === BadgeDataScope.SINCE_INSTALL &&
        !earnedSlugs.has(b.slug),
    ).sort((a, b) => (a.threshold ?? 0) - (b.threshold ?? 0));

    const next = visitBadges[0];
    if (!next?.threshold) return null;

    return {
      slug: next.slug,
      name: next.name,
      description: next.description,
      current: sinceInstallCount,
      target: next.threshold,
      progress: Math.min(100, Math.round((sinceInstallCount / next.threshold) * 100)),
      streak: sinceStreak,
    };
  }
}
