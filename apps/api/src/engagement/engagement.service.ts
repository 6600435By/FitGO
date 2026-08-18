import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { VisitSource, WorkoutSource, WorkoutType, NotificationType } from '@prisma/client';
import { FitnessService } from '../fitness/fitness.service';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { BadgeEvaluatorService } from './badge-evaluator.service';
import { XP_BY_ACTION } from './badge-definitions';
import { LeagueService } from './league.service';
import { LEAGUE_TIER_LABELS } from './league-tier.util';
import { LoyaltyService } from './loyalty.service';
import { suggestNickname } from './nickname-pools';
import { getPublicDisplayName } from './public-display.util';
import { VisitSyncService } from './visit-sync.service';
import type { ActivateGamificationDto, CheckInDto, CreateWorkoutDto } from './dto/engagement.dto';

@Injectable()
export class EngagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
    private readonly visitSync: VisitSyncService,
    private readonly loyalty: LoyaltyService,
    private readonly league: LeagueService,
    private readonly badgeEvaluator: BadgeEvaluatorService,
  ) {}

  private requireProfile(user: { profileCompletedAt: Date | null }) {
    if (!user.profileCompletedAt) {
      throw new ForbiddenException({ requiresProfile: true, message: 'Заполните профиль' });
    }
  }

  async suggestNicknameForUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException();
    return { nickname: suggestNickname(user.gender) };
  }

  async checkNickname(clubId: string, name: string) {
    const normalized = name.trim();
    if (normalized.length < 2) {
      return { available: false, reason: 'Слишком короткий ник' };
    }
    const existing = await this.prisma.user.findFirst({
      where: { clubId, gamificationNickname: normalized },
    });
    return { available: !existing };
  }

  async activate(user: JwtPayload, dto: ActivateGamificationDto) {
    const dbUser = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!dbUser) throw new NotFoundException();
    this.requireProfile(dbUser);

    const clubId = requireClubId(user);
    if (dbUser.gamificationStartedAt) {
      throw new BadRequestException('Геймификация уже активирована');
    }

    let nickname = dto.gamificationNickname?.trim();
    if (!dto.useRealNameInPublic) {
      if (!nickname) nickname = suggestNickname(dbUser.gender);
      const check = await this.checkNickname(clubId, nickname);
      if (!check.available) {
        throw new ConflictException('Этот ник уже занят');
      }
    }

    const now = new Date();
    await this.prisma.user.update({
      where: { id: user.sub },
      data: {
        gamificationStartedAt: now,
        useRealNameInPublic: dto.useRealNameInPublic,
        gamificationNickname: dto.useRealNameInPublic ? null : nickname,
      },
    });

    await this.loyalty.initializeFromHistory(user.sub, clubId, dbUser.externalId);
    await this.league.ensureClientRating(user.sub, clubId);
    await this.league.awardXp(user.sub, XP_BY_ACTION.DAILY_GOAL);
    const newBadges = await this.badgeEvaluator.evaluate(user.sub);

    const rating = await this.prisma.clientRating.findUnique({ where: { userId: user.sub } });
    const loyaltyProfile = await this.prisma.loyaltyProfile.findUnique({ where: { userId: user.sub } });

    return {
      gamificationStartedAt: now.toISOString(),
      newBadges,
      loyalty: loyaltyProfile
        ? {
            status: loyaltyProfile.status,
            currentTier: loyaltyProfile.currentTier,
            tierLabel: LEAGUE_TIER_LABELS[loyaltyProfile.currentTier],
            continuityMonths: loyaltyProfile.continuityMonths,
          }
        : null,
      leagueTier: rating?.leagueTier ?? 'BRONZE',
    };
  }

  async checkIn(user: JwtPayload, dto: CheckInDto = {}) {
    const dbUser = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!dbUser) throw new NotFoundException();
    this.requireProfile(dbUser);
    if (!dbUser.gamificationStartedAt) {
      throw new BadRequestException('Сначала активируйте геймификацию');
    }

    const source = dto.qrToken ? VisitSource.APP_QR : VisitSource.APP_GEOFENCE;
    const clubId = requireClubId(user);
    const { visit, isNew } = await this.visitSync.upsertVisit(
      user.sub,
      clubId,
      new Date(),
      source,
    );

    if (isNew) {
      await this.league.awardXp(user.sub, XP_BY_ACTION.CLUB_VISIT);
      await this.updateChallengeProgress(user.sub, clubId);
    }

    await this.loyalty.refreshLoyalty(user.sub);
    const newBadges = await this.badgeEvaluator.evaluate(user.sub);

    return { visitId: visit.id, newBadges, xpAwarded: isNew ? XP_BY_ACTION.CLUB_VISIT : 0 };
  }

  async recordDailyGoal(user: JwtPayload) {
    const dbUser = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!dbUser?.gamificationStartedAt) {
      throw new BadRequestException('Сначала активируйте геймификацию');
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const existing = await this.prisma.notification.findFirst({
      where: {
        userId: user.sub,
        title: 'Ежедневная цель',
        createdAt: { gte: todayStart },
      },
    });
    if (existing) {
      return { awarded: false, message: 'Цель уже выполнена сегодня' };
    }

    await this.league.awardXp(user.sub, XP_BY_ACTION.DAILY_GOAL);
    await this.prisma.notification.create({
      data: {
        userId: user.sub,
        type: NotificationType.GENERAL,
        title: 'Ежедневная цель',
        body: `+${XP_BY_ACTION.DAILY_GOAL} XP за ежедневную активность`,
      },
    });

    return { awarded: true, xp: XP_BY_ACTION.DAILY_GOAL };
  }

  private async updateChallengeProgress(userId: string, clubId: string) {
    const now = new Date();
    const challenges = await this.prisma.challenge.findMany({
      where: {
        clubId,
        active: true,
        startDate: { lte: now },
        endDate: { gte: now },
      },
    });

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const since = user?.gamificationStartedAt ?? new Date(0);

    for (const challenge of challenges) {
      const visits = await this.prisma.clubVisit.count({
        where: {
          userId,
          visitedAt: {
            gte: since > challenge.startDate ? since : challenge.startDate,
            lte: challenge.endDate,
          },
        },
      });

      await this.prisma.challengeEntry.upsert({
        where: { challengeId_userId: { challengeId: challenge.id, userId } },
        update: { visits },
        create: { challengeId: challenge.id, userId, visits },
      });
    }
  }

  async getGamification(user: JwtPayload) {
    const dbUser = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!dbUser) throw new NotFoundException();
    this.requireProfile(dbUser);

    const since = dbUser.gamificationStartedAt;
    const visits = since
      ? await this.visitSync.getVisitsForUser(user.sub, since)
      : [];
    const visitStreak = this.visitSync.calcStreak(visits.map((v) => v.visitDate));
    const totalVisits = visits.length;

    const earned = await this.prisma.userBadge.findMany({
      where: { userId: user.sub },
      include: { badge: true },
      orderBy: { earnedAt: 'desc' },
    });

    const allBadges = await this.prisma.badge.findMany();
    const earnedSlugs = new Set(earned.map((e) => e.badge.slug));
    const lockedBadges = allBadges
      .filter((b) => !earnedSlugs.has(b.slug))
      .map((b) => ({
        id: b.id,
        slug: b.slug,
        name: b.name,
        description: b.description,
        category: b.category,
        tier: b.tier,
      }));

    const rating = await this.prisma.clientRating.findUnique({ where: { userId: user.sub } });
    const loyaltyProfile = await this.prisma.loyaltyProfile.findUnique({ where: { userId: user.sub } });
    const leagueGroup = await this.league.getLeagueGroup(user.sub);
    const nextBadge = since ? await this.badgeEvaluator.getNextBadge(user.sub) : null;
    const decayWarning = this.league.getDecayWarning(rating?.lastAppActivityAt);

    const rankUsers = await this.prisma.clientRating.findMany({
      where: { clubId: requireClubId(user) },
      orderBy: { lifetimeXp: 'desc' },
      take: 50,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            gamificationNickname: true,
            useRealNameInPublic: true,
          },
        },
      },
    });
    const rank = rankUsers.findIndex((r) => r.userId === user.sub) + 1;

    return {
      activated: !!since,
      gamificationStartedAt: since?.toISOString(),
      visitStreak,
      totalVisits,
      points: rating?.lifetimeXp ?? dbUser.gamificationPoints,
      rank: rank > 0 ? rank : undefined,
      badges: earned.map((e) => ({
        id: e.badge.id,
        slug: e.badge.slug,
        name: e.badge.name,
        description: e.badge.description,
        category: e.badge.category,
        tier: e.badge.tier,
        earnedAt: e.earnedAt.toISOString(),
      })),
      lockedBadges,
      nextBadge,
      league: leagueGroup,
      loyalty: loyaltyProfile
        ? {
            status: loyaltyProfile.status,
            currentTier: loyaltyProfile.currentTier,
            peakTier: loyaltyProfile.peakTier,
            tierLabel: LEAGUE_TIER_LABELS[loyaltyProfile.currentTier],
            continuityMonths: loyaltyProfile.continuityMonths,
            lastVisitAt: loyaltyProfile.lastVisitAt?.toISOString(),
          }
        : null,
      decayWarning,
      useRealNameInPublic: dbUser.useRealNameInPublic,
      gamificationNickname: dbUser.gamificationNickname,
    };
  }

  async getLeagueGroup(user: JwtPayload) {
    return this.league.getLeagueGroup(user.sub);
  }

  async createWorkout(user: JwtPayload, dto: CreateWorkoutDto) {
    const dbUser = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!dbUser?.gamificationStartedAt) {
      throw new BadRequestException('Сначала активируйте геймификацию');
    }

    const workout = await this.prisma.workoutLog.create({
      data: {
        userId: user.sub,
        type: dto.type as WorkoutType,
        startedAt: new Date(dto.startedAt),
        durationMin: dto.durationMin,
        distanceKm: dto.distanceKm,
        calories: dto.calories,
        notes: dto.notes,
        source: WorkoutSource.MANUAL,
        verified: false,
      },
    });

    await this.league.awardXp(user.sub, XP_BY_ACTION.WORKOUT_MANUAL);
    const newBadges = await this.badgeEvaluator.evaluate(user.sub);

    return { workout, xpAwarded: XP_BY_ACTION.WORKOUT_MANUAL, newBadges };
  }

  async getWorkouts(user: JwtPayload) {
    return this.prisma.workoutLog.findMany({
      where: { userId: user.sub },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
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

    const club = await this.prisma.club.findUnique({
      where: { id: requireClubId(user) },
    });
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

  async getChallenges(user: JwtPayload) {
    const dbUser = await this.prisma.user.findUnique({ where: { id: user.sub } });
    const challenges = await this.prisma.challenge.findMany({
      where: { clubId: requireClubId(user), active: true },
      orderBy: { startDate: 'desc' },
      include: {
        entries: dbUser?.gamificationStartedAt
          ? { where: { userId: user.sub } }
          : false,
      },
    });

    return challenges.map((c) => {
      const entry = Array.isArray(c.entries) ? c.entries[0] : null;
      return {
        id: c.id,
        title: c.title,
        description: c.description,
        targetVisits: c.targetVisits,
        startDate: c.startDate.toISOString(),
        endDate: c.endDate.toISOString(),
        progress: entry?.visits ?? 0,
        completed: (entry?.visits ?? 0) >= c.targetVisits,
      };
    });
  }

  async getLeaderboard(clubId: string) {
    const ratings = await this.prisma.clientRating.findMany({
      where: { clubId, lifetimeXp: { gt: 0 } },
      orderBy: { lifetimeXp: 'desc' },
      take: 10,
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            gamificationNickname: true,
            useRealNameInPublic: true,
          },
        },
      },
    });

    return ratings.map((r, i) => ({
      rank: i + 1,
      name: getPublicDisplayName(r.user),
      points: r.lifetimeXp,
    }));
  }

  async syncWearable(user: JwtPayload, provider: string) {
    const dbUser = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!dbUser) throw new NotFoundException();

    const visitsImported = dbUser.externalId
      ? (await this.fitness.getProvider().getVisits(dbUser.externalId)).length
      : 0;

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
