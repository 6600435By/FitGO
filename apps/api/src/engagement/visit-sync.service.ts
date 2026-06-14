import { Injectable } from '@nestjs/common';
import {
  GroupClassBookingStatus,
  PersonalBookingStatus,
  VisitSource,
  ClubVisit,
} from '@prisma/client';
import { FitnessService } from '../fitness/fitness.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class VisitSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
  ) {}

  private visitDateKey(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  async upsertVisit(
    userId: string,
    clubId: string,
    visitedAt: Date,
    source: VisitSource,
    externalId?: string,
  ): Promise<{ visit: ClubVisit; isNew: boolean }> {
    const visitDate = this.visitDateKey(visitedAt);
    const existing = await this.prisma.clubVisit.findUnique({
      where: {
        userId_clubId_visitDate: { userId, clubId, visitDate },
      },
    });
    if (existing) {
      const priority: Record<VisitSource, number> = {
        ONEC_SYNC: 6,
        APP_QR: 5,
        APP_GEOFENCE: 4,
        TRAINER_CONFIRM: 3,
        BOOKING_PT: 2,
        BOOKING_GROUP: 1,
      };
      if (priority[source] <= priority[existing.source]) {
        return { visit: existing, isNew: false };
      }
      const updated = await this.prisma.clubVisit.update({
        where: { id: existing.id },
        data: { visitedAt, source, externalId, verified: true },
      });
      return { visit: updated, isNew: false };
    }
    const created = await this.prisma.clubVisit.create({
      data: {
        userId,
        clubId,
        visitedAt,
        visitDate,
        source,
        externalId,
        verified: true,
      },
    });
    return { visit: created, isNew: true };
  }

  async syncUserVisits(userId: string, clubId: string, externalId?: string | null) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { club: true },
    });
    if (!dbUser) return [];

    if (externalId) {
      const externalVisits = await this.fitness.getProvider().getVisits(externalId);
      for (const visit of externalVisits) {
        const visitedAt = new Date(`${visit.date}T12:00:00.000Z`);
        await this.upsertVisit(
          userId,
          clubId,
          visitedAt,
          VisitSource.ONEC_SYNC,
          visit.id,
        );
      }
    }

    const now = new Date();
    await this.prisma.groupClassBooking.updateMany({
      where: {
        clientId: userId,
        status: GroupClassBookingStatus.CONFIRMED,
        endAt: { lt: now },
      },
      data: { status: GroupClassBookingStatus.COMPLETED },
    });

    const [groupBookings, personalBookings] = await Promise.all([
      this.prisma.groupClassBooking.findMany({
        where: {
          clientId: userId,
          status: { not: GroupClassBookingStatus.CANCELLED },
          endAt: { lt: now },
        },
      }),
      this.prisma.personalTrainingBooking.findMany({
        where: {
          clientId: userId,
          status: { not: PersonalBookingStatus.CANCELLED },
          endAt: { lt: now },
        },
      }),
    ]);

    for (const booking of groupBookings) {
      await this.upsertVisit(
        userId,
        clubId,
        booking.startAt,
        VisitSource.BOOKING_GROUP,
        booking.id,
      );
    }
    for (const booking of personalBookings) {
      await this.upsertVisit(
        userId,
        clubId,
        booking.startAt,
        VisitSource.BOOKING_PT,
        booking.id,
      );
    }

    return this.getVisitsForUser(userId, dbUser.gamificationStartedAt);
  }

  async getVisitsForUser(userId: string, since?: Date | null) {
    return this.prisma.clubVisit.findMany({
      where: {
        userId,
        ...(since ? { visitedAt: { gte: since } } : {}),
      },
      orderBy: { visitedAt: 'desc' },
    });
  }

  calcStreak(visitDates: string[]): number {
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
}
