import { Injectable } from '@nestjs/common';
import { LeagueTier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getPublicDisplayName } from './public-display.util';
import {
  demoteTier,
  LEAGUE_TIER_LABELS,
  LEAGUE_TIER_ORDER,
  promoteTier,
  tierOrdinal,
} from './league-tier.util';

const GROUP_SIZE = 25;
const PROMOTE_COUNT = 5;
const RELEGATE_COUNT = 5;

@Injectable()
export class LeagueService {
  constructor(private readonly prisma: PrismaService) {}

  weekBounds(date = new Date()) {
    const d = new Date(date);
    const day = d.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() + diffToMonday);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    return { weekStart, weekEnd };
  }

  async ensureClientRating(userId: string, clubId: string) {
    const existing = await this.prisma.clientRating.findUnique({
      where: { userId },
    });
    if (existing) return existing;
    return this.prisma.clientRating.create({
      data: { userId, clubId, leagueTier: LeagueTier.BRONZE },
    });
  }

  async awardXp(userId: string, amount: number, updateActivity = true) {
    const rating = await this.prisma.clientRating.findUnique({
      where: { userId },
    });
    if (!rating) return null;

    const now = new Date();
    const updated = await this.prisma.clientRating.update({
      where: { userId },
      data: {
        weeklyXp: { increment: amount },
        monthlyXp: { increment: amount },
        lifetimeXp: { increment: amount },
        ...(updateActivity ? { lastAppActivityAt: now } : {}),
      },
    });

    if (rating.leagueGroupId) {
      await this.prisma.leagueGroupMember.upsert({
        where: {
          leagueGroupId_userId: {
            leagueGroupId: rating.leagueGroupId,
            userId,
          },
        },
        update: { weeklyXp: { increment: amount } },
        create: {
          leagueGroupId: rating.leagueGroupId,
          userId,
          weeklyXp: amount,
        },
      });
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { gamificationPoints: { increment: amount } },
    });

    return updated;
  }

  async assignWeeklyGroups(clubId: string) {
    const { weekStart, weekEnd } = this.weekBounds();

    for (const tier of LEAGUE_TIER_ORDER) {
      const ratings = await this.prisma.clientRating.findMany({
        where: { clubId, leagueTier: tier },
        orderBy: { lifetimeXp: 'desc' },
      });
      if (ratings.length === 0) continue;

      for (let i = 0; i < ratings.length; i += GROUP_SIZE) {
        const chunk = ratings.slice(i, i + GROUP_SIZE);
        const group = await this.prisma.leagueGroup.create({
          data: { clubId, leagueTier: tier, weekStart, weekEnd },
        });
        for (const r of chunk) {
          await this.prisma.leagueGroupMember.create({
            data: { leagueGroupId: group.id, userId: r.userId, weeklyXp: 0 },
          });
          await this.prisma.clientRating.update({
            where: { userId: r.userId },
            data: { leagueGroupId: group.id, weeklyXp: 0 },
          });
        }
      }
    }
  }

  async settleWeeklyLeague(clubId: string) {
    const { weekStart } = this.weekBounds();
    const groups = await this.prisma.leagueGroup.findMany({
      where: { clubId, weekStart },
      include: {
        members: {
          orderBy: { weeklyXp: 'desc' },
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
        },
      },
    });

    const results: Array<{ userId: string; promoted: boolean; relegated: boolean }> = [];

    for (const group of groups) {
      const total = group.members.length;
      for (let i = 0; i < total; i++) {
        const member = group.members[i];
        const rank = i + 1;
        let newTier = group.leagueTier;

        if (rank <= PROMOTE_COUNT && tierOrdinal(group.leagueTier) < LEAGUE_TIER_ORDER.length - 1) {
          newTier = promoteTier(group.leagueTier);
          results.push({ userId: member.userId, promoted: true, relegated: false });
        } else if (
          rank > total - RELEGATE_COUNT &&
          tierOrdinal(group.leagueTier) > 0
        ) {
          newTier = demoteTier(group.leagueTier);
          results.push({ userId: member.userId, promoted: false, relegated: true });
        }

        await this.prisma.clientRating.update({
          where: { userId: member.userId },
          data: {
            leagueTier: newTier,
            weeklyXp: 0,
            leagueGroupId: null,
          },
        });
      }
    }

    return results;
  }

  async processMonthlyRatingDecay() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const ratings = await this.prisma.clientRating.findMany({
      where: { lastAppActivityAt: { not: null } },
    });

    for (const rating of ratings) {
      const lastActivity = rating.lastAppActivityAt!;
      const hadActivityLastMonth =
        lastActivity >= startOfPrevMonth && lastActivity < startOfMonth;

      if (hadActivityLastMonth) {
        await this.prisma.clientRating.update({
          where: { userId: rating.userId },
          data: { consecutiveInactiveMonths: 0 },
        });
        continue;
      }

      if (lastActivity >= startOfMonth) continue;

      const inactiveMonths = rating.consecutiveInactiveMonths + 1;
      const newTier = demoteTier(rating.leagueTier);

      await this.prisma.clientRating.update({
        where: { userId: rating.userId },
        data: {
          leagueTier: newTier,
          consecutiveInactiveMonths: inactiveMonths,
        },
      });
    }

    const neverActive = await this.prisma.clientRating.findMany({
      where: { lastAppActivityAt: null },
    });
    for (const rating of neverActive) {
      await this.prisma.clientRating.update({
        where: { userId: rating.userId },
        data: {
          leagueTier: demoteTier(rating.leagueTier),
          consecutiveInactiveMonths: { increment: 1 },
        },
      });
    }
  }

  async getLeagueGroup(userId: string) {
    const rating = await this.prisma.clientRating.findUnique({
      where: { userId },
    });
    if (!rating?.leagueGroupId) {
      return {
        tier: rating?.leagueTier ?? LeagueTier.BRONZE,
        tierLabel: LEAGUE_TIER_LABELS[rating?.leagueTier ?? LeagueTier.BRONZE],
        weekEnd: null,
        members: [],
        myRank: null,
        promotionZone: PROMOTE_COUNT,
        relegationZone: RELEGATE_COUNT,
        weeklyXp: rating?.weeklyXp ?? 0,
      };
    }

    const group = await this.prisma.leagueGroup.findUnique({
      where: { id: rating.leagueGroupId },
      include: {
        members: {
          orderBy: { weeklyXp: 'desc' },
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
        },
      },
    });

    if (!group) {
      return {
        tier: rating.leagueTier,
        tierLabel: LEAGUE_TIER_LABELS[rating.leagueTier],
        weekEnd: null,
        members: [],
        myRank: null,
        promotionZone: PROMOTE_COUNT,
        relegationZone: RELEGATE_COUNT,
        weeklyXp: rating.weeklyXp,
      };
    }

    const members = group.members.map((m, i) => ({
      rank: i + 1,
      userId: m.userId,
      name: getPublicDisplayName(m.user),
      weeklyXp: m.weeklyXp,
      isMe: m.userId === userId,
      zone:
        i + 1 <= PROMOTE_COUNT
          ? 'promotion'
          : i + 1 > group.members.length - RELEGATE_COUNT
            ? 'relegation'
            : 'safe',
    }));

    const myRank = members.find((m) => m.isMe)?.rank ?? null;

    return {
      tier: group.leagueTier,
      tierLabel: LEAGUE_TIER_LABELS[group.leagueTier],
      weekEnd: group.weekEnd.toISOString(),
      members,
      myRank,
      promotionZone: PROMOTE_COUNT,
      relegationZone: RELEGATE_COUNT,
      weeklyXp: rating.weeklyXp,
    };
  }

  getDecayWarning(lastActivity: Date | null | undefined) {
    const now = new Date();
    const dayOfMonth = now.getDate();
    if (lastActivity && lastActivity.getMonth() === now.getMonth() && lastActivity.getFullYear() === now.getFullYear()) {
      return null;
    }
    const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - dayOfMonth;
    let urgency: 'info' | 'warning' | 'critical' = 'info';
    if (dayOfMonth >= 25) urgency = 'critical';
    else if (dayOfMonth >= 21) urgency = 'warning';
    else if (dayOfMonth >= 14) urgency = 'warning';
    return {
      dayOfMonth,
      daysLeftInMonth: daysLeft,
      urgency,
      message:
        dayOfMonth >= 25
          ? 'Сохраните рейтинг — до конца месяца осталось мало времени!'
          : dayOfMonth >= 14
            ? 'В этом месяце ещё не было активности в приложении'
            : 'Откройте приложение и выполните цель, чтобы сохранить лигу',
    };
  }
}
