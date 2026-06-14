import { Injectable } from '@nestjs/common';
import { LeagueTier, LoyaltyStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { maxTier } from './league-tier.util';
import { VisitSyncService } from './visit-sync.service';

const LOYALTY_TIERS: { months: number; tier: LeagueTier; slug: string }[] = [
  { months: 72, tier: LeagueTier.OBSIDIAN, slug: 'loyalty-6y' },
  { months: 60, tier: LeagueTier.DIAMOND, slug: 'loyalty-5y' },
  { months: 36, tier: LeagueTier.GOLD, slug: 'loyalty-3y' },
  { months: 24, tier: LeagueTier.SILVER, slug: 'loyalty-2y' },
  { months: 12, tier: LeagueTier.BRONZE, slug: 'loyalty-1y' },
];

const FREEZE_MONTHS = 6;

@Injectable()
export class LoyaltyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly visitSync: VisitSyncService,
  ) {}

  private monthsBetween(a: Date, b: Date): number {
    return (
      (a.getFullYear() - b.getFullYear()) * 12 + (a.getMonth() - b.getMonth())
    );
  }

  async computeContinuityMonths(userId: string): Promise<number> {
    const visits = await this.prisma.clubVisit.findMany({
      where: { userId },
      orderBy: { visitedAt: 'asc' },
    });
    if (visits.length === 0) return 0;

    const monthsWithVisits = new Set(
      visits.map((v) => v.visitDate.slice(0, 7)),
    );
    if (monthsWithVisits.size === 0) return 0;

    let continuity = 1;
    const sortedMonths = [...monthsWithVisits].sort();
    for (let i = sortedMonths.length - 1; i > 0; i--) {
      const current = new Date(`${sortedMonths[i]}-01`);
      const prev = new Date(`${sortedMonths[i - 1]}-01`);
      const diff = this.monthsBetween(current, prev);
      if (diff === 1) continuity++;
      else break;
    }
    return continuity;
  }

  tierForMonths(months: number): LeagueTier {
    for (const entry of LOYALTY_TIERS) {
      if (months >= entry.months) return entry.tier;
    }
    return LeagueTier.BRONZE;
  }

  async refreshLoyalty(userId: string) {
    const visits = await this.prisma.clubVisit.findMany({
      where: { userId },
      orderBy: { visitedAt: 'desc' },
      take: 1,
    });
    const lastVisitAt = visits[0]?.visitedAt ?? null;
    const continuityMonths = await this.computeContinuityMonths(userId);
    const peakTier = this.tierForMonths(continuityMonths);

    let profile = await this.prisma.loyaltyProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      profile = await this.prisma.loyaltyProfile.create({
        data: {
          userId,
          peakTier,
          currentTier: peakTier,
          continuityMonths,
          lastVisitAt,
          status: LoyaltyStatus.ACTIVE,
        },
      });
      return profile;
    }

    let status = profile.status;
    let currentTier = profile.currentTier;
    const now = new Date();

    if (lastVisitAt) {
      const monthsSinceVisit = this.monthsBetween(now, lastVisitAt);
      if (monthsSinceVisit >= FREEZE_MONTHS && status !== LoyaltyStatus.FROZEN) {
        status = LoyaltyStatus.FROZEN;
        await this.prisma.loyaltyProfile.update({
          where: { userId },
          data: { status: LoyaltyStatus.FROZEN, frozenAt: now },
        });
      } else if (
        status === LoyaltyStatus.FROZEN &&
        monthsSinceVisit < FREEZE_MONTHS
      ) {
        status = LoyaltyStatus.REACTIVATED;
        const downgradeMap: Partial<Record<LeagueTier, LeagueTier>> = {
          [LeagueTier.OBSIDIAN]: LeagueTier.GOLD,
          [LeagueTier.DIAMOND]: LeagueTier.GOLD,
          [LeagueTier.EMERALD]: LeagueTier.SILVER,
          [LeagueTier.RUBY]: LeagueTier.SILVER,
          [LeagueTier.SAPPHIRE]: LeagueTier.SILVER,
          [LeagueTier.GOLD]: LeagueTier.BRONZE,
        };
        currentTier =
          downgradeMap[profile.peakTier] ?? LeagueTier.BRONZE;
        await this.prisma.loyaltyProfile.update({
          where: { userId },
          data: {
            status: LoyaltyStatus.REACTIVATED,
            reactivatedAt: now,
            currentTier,
            downgradeCount: { increment: 1 },
          },
        });
      }
    }

    return this.prisma.loyaltyProfile.update({
      where: { userId },
      data: {
        peakTier: maxTier(peakTier, profile.peakTier),
        currentTier:
          status === LoyaltyStatus.ACTIVE ? peakTier : currentTier,
        continuityMonths,
        lastVisitAt,
        status,
      },
    });
  }

  async initializeFromHistory(userId: string, clubId: string, externalId?: string | null) {
    await this.visitSync.syncUserVisits(userId, clubId, externalId);
    return this.refreshLoyalty(userId);
  }
}
