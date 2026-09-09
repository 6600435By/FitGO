import { Injectable } from '@nestjs/common';
import {
  ClubVisit,
  ClubVisitEvent,
  GroupClassBookingStatus,
  PersonalBookingStatus,
  VisitKind as PrismaVisitKind,
  VisitSource,
  VisitVerification,
} from '@prisma/client';
import {
  SessionType,
  classifyVisitKind,
  type Visit,
  type VisitKind,
  type VisitVerificationStatus,
} from '@fitgo/shared-types';
import { FitnessService } from '../fitness/fitness.service';
import { PrismaService } from '../prisma/prisma.service';

const DAY_FACT_PRIORITY: Record<VisitSource, number> = {
  ONEC_SYNC: 6,
  TRAINER_CONFIRM: 5,
  CLIENT_SELF_CONFIRM: 4,
  APP_QR: 0,
  APP_GEOFENCE: 0,
  BOOKING_PT: 0,
  BOOKING_GROUP: 0,
};

function toPrismaKind(kind: VisitKind): PrismaVisitKind {
  return kind as PrismaVisitKind;
}

function fromPrismaKind(kind: PrismaVisitKind): VisitKind {
  return kind as VisitKind;
}

function fromPrismaVerification(
  v: VisitVerification,
): VisitVerificationStatus {
  return v as VisitVerificationStatus;
}

@Injectable()
export class VisitSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
  ) {}

  visitDateKey(date: Date | string): string {
    if (typeof date === 'string') return date.slice(0, 10);
    return date.toISOString().slice(0, 10);
  }

  /**
   * Day-fact for streak/loyalty. Only verified sources create/update facts.
   * Honor app check-in (APP_QR / APP_GEOFENCE) does not create a verified day.
   */
  async upsertDayFact(
    userId: string,
    clubId: string,
    visitedAt: Date,
    source: VisitSource,
    externalId?: string,
  ): Promise<{ visit: ClubVisit | null; isNew: boolean }> {
    if (DAY_FACT_PRIORITY[source] <= 0) {
      return { visit: null, isNew: false };
    }

    const visitDate = this.visitDateKey(visitedAt);
    const existing = await this.prisma.clubVisit.findUnique({
      where: {
        userId_clubId_visitDate: { userId, clubId, visitDate },
      },
    });

    if (existing) {
      if (!existing.verified || DAY_FACT_PRIORITY[source] > DAY_FACT_PRIORITY[existing.source]) {
        const updated = await this.prisma.clubVisit.update({
          where: { id: existing.id },
          data: {
            visitedAt,
            source,
            externalId,
            verified: true,
          },
        });
        return { visit: updated, isNew: false };
      }
      return { visit: existing, isNew: false };
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

  /** @deprecated Prefer upsertDayFact — kept for callers that still use upsertVisit name. */
  async upsertVisit(
    userId: string,
    clubId: string,
    visitedAt: Date,
    source: VisitSource,
    externalId?: string,
  ): Promise<{ visit: ClubVisit; isNew: boolean }> {
    const result = await this.upsertDayFact(
      userId,
      clubId,
      visitedAt,
      source,
      externalId,
    );
    if (!result.visit) {
      // Return a non-persisted stub shape for honor check-in callers
      const visitDate = this.visitDateKey(visitedAt);
      return {
        visit: {
          id: `unverified-${visitDate}`,
          userId,
          clubId,
          visitedAt,
          visitDate,
          source,
          externalId: externalId ?? null,
          verified: false,
        } as ClubVisit,
        isNew: false,
      };
    }
    return { visit: result.visit, isNew: result.isNew };
  }

  async upsertEvent(input: {
    userId: string;
    clubId: string;
    externalKey: string;
    kind: VisitKind;
    verification: VisitVerification;
    source: VisitSource;
    occurredAt: Date;
    title?: string | null;
    externalId?: string | null;
    bookingId?: string | null;
    checkIn?: string | null;
    checkOut?: string | null;
  }): Promise<ClubVisitEvent> {
    const visitDate = this.visitDateKey(input.occurredAt);
    const data = {
      kind: toPrismaKind(input.kind),
      verification: input.verification,
      source: input.source,
      title: input.title ?? null,
      externalId: input.externalId ?? null,
      bookingId: input.bookingId ?? null,
      occurredAt: input.occurredAt,
      visitDate,
      checkIn: input.checkIn ?? null,
      checkOut: input.checkOut ?? null,
    };

    const event = await this.prisma.clubVisitEvent.upsert({
      where: {
        userId_clubId_externalKey: {
          userId: input.userId,
          clubId: input.clubId,
          externalKey: input.externalKey,
        },
      },
      create: {
        userId: input.userId,
        clubId: input.clubId,
        externalKey: input.externalKey,
        ...data,
      },
      update: data,
    });

    if (
      input.verification === VisitVerification.VERIFIED_1C ||
      input.verification === VisitVerification.VERIFIED_TRAINER ||
      input.verification === VisitVerification.VERIFIED_CLIENT_SELF
    ) {
      await this.upsertDayFact(
        input.userId,
        input.clubId,
        input.occurredAt,
        input.source,
        input.externalId ?? input.bookingId ?? undefined,
      );
    }

    return event;
  }

  async recordTrainerConfirm(input: {
    userId: string;
    clubId: string;
    bookingId: string;
    kind: 'PT' | 'GROUP';
    occurredAt: Date;
    title?: string;
    checkIn?: string;
    checkOut?: string;
  }) {
    return this.upsertEvent({
      userId: input.userId,
      clubId: input.clubId,
      externalKey: `booking:${input.bookingId}`,
      kind: input.kind,
      verification: VisitVerification.VERIFIED_TRAINER,
      source: VisitSource.TRAINER_CONFIRM,
      occurredAt: input.occurredAt,
      title: input.title,
      bookingId: input.bookingId,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
    });
  }

  async recordClientSelfConfirm(input: {
    userId: string;
    clubId: string;
    bookingId: string;
    occurredAt: Date;
    title?: string;
    checkIn?: string;
    checkOut?: string;
  }) {
    return this.upsertEvent({
      userId: input.userId,
      clubId: input.clubId,
      externalKey: `booking:${input.bookingId}`,
      kind: 'GROUP',
      verification: VisitVerification.VERIFIED_CLIENT_SELF,
      source: VisitSource.CLIENT_SELF_CONFIRM,
      occurredAt: input.occurredAt,
      title: input.title,
      bookingId: input.bookingId,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
    });
  }

  async syncUserVisits(
    userId: string,
    clubId: string,
    externalId?: string | null,
    period?: { from?: string; to?: string },
  ) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { club: true },
    });
    if (!dbUser) return [];

    const from =
      period?.from ??
      this.visitDateKey(new Date(Date.now() - 365 * 86400000));
    const to = period?.to ?? this.visitDateKey(new Date());

    if (externalId) {
      const externalVisits = await this.fitness
        .getProvider()
        .getVisits(externalId, { from, to })
        .catch(() => [] as Visit[]);

      for (const visit of externalVisits) {
        const kind = classifyVisitKind({
          kind: visit.kind,
          title: visit.title,
          sessionType: visit.sessionType,
        });
        const occurredAt = visit.checkIn
          ? new Date(
              visit.checkIn.includes('T')
                ? visit.checkIn
                : `${visit.date}T${visit.checkIn.length === 5 ? visit.checkIn + ':00' : visit.checkIn}`,
            )
          : new Date(`${visit.date}T12:00:00.000Z`);

        await this.upsertEvent({
          userId,
          clubId,
          externalKey: `1c:${visit.id}`,
          kind,
          verification: VisitVerification.VERIFIED_1C,
          source: VisitSource.ONEC_SYNC,
          occurredAt: Number.isNaN(occurredAt.getTime())
            ? new Date(`${visit.date}T12:00:00.000Z`)
            : occurredAt,
          title: visit.title,
          externalId: visit.id,
          checkIn: visit.checkIn,
          checkOut: visit.checkOut,
        });
      }
    }

    const now = new Date();
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
        include: { trainer: true },
      }),
    ]);

    for (const booking of groupBookings) {
      const existingVerified = await this.prisma.clubVisitEvent.findFirst({
        where: {
          userId,
          clubId,
          OR: [
            { bookingId: booking.id, verification: { not: VisitVerification.PENDING } },
            {
              visitDate: this.visitDateKey(booking.startAt),
              source: VisitSource.ONEC_SYNC,
              kind: { in: [PrismaVisitKind.GROUP, PrismaVisitKind.GYM] },
            },
          ],
        },
      });

      if (existingVerified) continue;

      await this.upsertEvent({
        userId,
        clubId,
        externalKey: `booking:${booking.id}`,
        kind: 'GROUP',
        verification: VisitVerification.PENDING,
        source: VisitSource.BOOKING_GROUP,
        occurredAt: booking.startAt,
        title: booking.title,
        bookingId: booking.id,
        checkIn: booking.startAt.toISOString().slice(11, 16),
        checkOut: booking.endAt.toISOString().slice(11, 16),
      });
    }

    for (const booking of personalBookings) {
      const trainerConfirmed = !!booking.trainerCompletedAt;
      const title =
        `Персональная · ${booking.trainer.firstName} ${booking.trainer.lastName}`.trim();

      if (trainerConfirmed) {
        await this.recordTrainerConfirm({
          userId,
          clubId,
          bookingId: booking.id,
          kind: 'PT',
          occurredAt: booking.startAt,
          title,
          checkIn: booking.startAt.toISOString().slice(11, 16),
          checkOut: booking.endAt.toISOString().slice(11, 16),
        });
      } else {
        const has1c = await this.prisma.clubVisitEvent.findFirst({
          where: {
            userId,
            clubId,
            visitDate: this.visitDateKey(booking.startAt),
            source: VisitSource.ONEC_SYNC,
            kind: PrismaVisitKind.PT,
          },
        });
        if (has1c) continue;

        await this.upsertEvent({
          userId,
          clubId,
          externalKey: `booking:${booking.id}`,
          kind: 'PT',
          verification: VisitVerification.PENDING,
          source: VisitSource.BOOKING_PT,
          occurredAt: booking.startAt,
          title,
          bookingId: booking.id,
          checkIn: booking.startAt.toISOString().slice(11, 16),
          checkOut: booking.endAt.toISOString().slice(11, 16),
        });
      }
    }

    return this.getVerifiedDayFacts(userId, dbUser.gamificationStartedAt);
  }

  async getVerifiedDayFacts(userId: string, since?: Date | null) {
    return this.prisma.clubVisit.findMany({
      where: {
        userId,
        verified: true,
        ...(since ? { visitedAt: { gte: since } } : {}),
      },
      orderBy: { visitedAt: 'desc' },
    });
  }

  async getVisitsForUser(userId: string, since?: Date | null) {
    return this.getVerifiedDayFacts(userId, since);
  }

  async getEventsForUser(
    userId: string,
    clubId: string,
    options?: {
      from?: string;
      to?: string;
      kind?: VisitKind;
    },
  ) {
    return this.prisma.clubVisitEvent.findMany({
      where: {
        userId,
        clubId,
        ...(options?.from || options?.to
          ? {
              visitDate: {
                ...(options.from ? { gte: options.from } : {}),
                ...(options.to ? { lte: options.to } : {}),
              },
            }
          : {}),
        ...(options?.kind ? { kind: toPrismaKind(options.kind) } : {}),
      },
      orderBy: [{ visitDate: 'desc' }, { occurredAt: 'desc' }],
    });
  }

  eventToVisit(
    event: ClubVisitEvent,
    clubName: string,
    extras?: { canSelfConfirm?: boolean },
  ): Visit {
    const kind = fromPrismaKind(event.kind);
    return {
      id: event.id,
      date: event.visitDate,
      checkIn: event.checkIn ?? undefined,
      checkOut: event.checkOut ?? undefined,
      clubName,
      title: event.title ?? undefined,
      sessionType:
        kind === 'PT'
          ? SessionType.PERSONAL
          : kind === 'GROUP'
            ? SessionType.GROUP
            : undefined,
      source: event.source === VisitSource.ONEC_SYNC ? '1c' : 'fitgo',
      kind,
      verification: fromPrismaVerification(event.verification),
      bookingId: event.bookingId ?? undefined,
      canSelfConfirm: extras?.canSelfConfirm,
    };
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

  buildDynamics(visits: Visit[]) {
    const totalsByKind: Partial<Record<VisitKind, number>> = {};
    const heatmapMap = new Map<string, number>();
    const weekMap = new Map<
      string,
      { count: number; byKind: Partial<Record<VisitKind, number>> }
    >();

    for (const visit of visits) {
      if (
        visit.verification !== 'VERIFIED_1C' &&
        visit.verification !== 'VERIFIED_TRAINER' &&
        visit.verification !== 'VERIFIED_CLIENT_SELF'
      ) {
        // Include pending in list but not in verified dynamics counts — still show on heatmap lightly
      }

      const kind = visit.kind ?? 'UNKNOWN';
      const verified =
        visit.verification === 'VERIFIED_1C' ||
        visit.verification === 'VERIFIED_TRAINER' ||
        visit.verification === 'VERIFIED_CLIENT_SELF';

      if (verified) {
        totalsByKind[kind] = (totalsByKind[kind] ?? 0) + 1;
      }

      heatmapMap.set(visit.date, (heatmapMap.get(visit.date) ?? 0) + 1);

      const d = new Date(`${visit.date}T12:00:00.000Z`);
      const day = d.getUTCDay();
      const mondayOffset = day === 0 ? -6 : 1 - day;
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() + mondayOffset);
      const weekStart = monday.toISOString().slice(0, 10);
      const bucket = weekMap.get(weekStart) ?? { count: 0, byKind: {} };
      if (verified) {
        bucket.count += 1;
        bucket.byKind[kind] = (bucket.byKind[kind] ?? 0) + 1;
      }
      weekMap.set(weekStart, bucket);
    }

    const byWeek = [...weekMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, v]) => ({ weekStart, count: v.count, byKind: v.byKind }));

    const heatmap = [...heatmapMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    return { byWeek, heatmap, totalsByKind };
  }
}
