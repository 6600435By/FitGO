import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MembershipStatus, SessionType, normalizeWorkoutSheet, workoutSheetHasData, type ScheduleSlot, type Visit } from '@fitgo/shared-types';
import {
  AccountStatus,
  BodyLogSource,
  GroupClassBookingStatus,
  PersonalBookingStatus,
  Role,
} from '@prisma/client';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { ClientProfileService } from '../client/client-profile.service';
import { ClubMembershipService } from '../common/club-membership.service';
import { FormaScheduleCacheService } from '../club-schedule/forma-schedule-cache.service';
import { staffOwnsScheduleSlot } from '../club-schedule/trainer-schedule.helpers';
import { addMoscowDays, moscowDayKey } from '../club-sync/moscow-time';
import { VisitSyncService } from '../engagement/visit-sync.service';
import { FitnessService } from '../fitness/fitness.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ServiceUsageService } from '../service-usage/service-usage.service';
import { TrainerLedgerService } from './trainer-ledger.service';
import { TrainerRosterService } from './trainer-roster.service';

@Injectable()
export class TrainerService {
  constructor(
    private readonly fitness: FitnessService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly visitSync: VisitSyncService,
    private readonly roster: TrainerRosterService,
    private readonly clubMembership: ClubMembershipService,
    private readonly clientProfile: ClientProfileService,
    private readonly serviceUsage: ServiceUsageService,
    private readonly formaCache: FormaScheduleCacheService,
    private readonly ledger: TrainerLedgerService,
  ) {}

  /** Group classes from ClubScheduleSlot (filled by club-sync) — no live Forma. */
  private async fetchTrainerGroupSchedule(
    clubId: string,
    trainerExternalId: string,
    trainerUserId: string,
  ): Promise<ScheduleSlot[]> {
    try {
      const from = moscowDayKey();
      const to = addMoscowDays(from, 14);
      const allSlots = await this.formaCache.getClubSchedule(clubId, from, to);
      const dbTrainer = await this.prisma.user.findUnique({
        where: { id: trainerUserId },
      });
      if (!dbTrainer) return allSlots;

      return allSlots.filter((slot) =>
        staffOwnsScheduleSlot(slot, {
          externalId: dbTrainer.externalId ?? trainerExternalId,
          employeeCode: dbTrainer.employeeCode,
          firstName: dbTrainer.firstName,
          lastName: dbTrainer.lastName,
        }),
      );
    } catch {
      return [];
    }
  }

  private async fetchTrainerPersonalSchedule(
    trainerUserId: string,
  ): Promise<ScheduleSlot[]> {
    const now = new Date();
    const bookings = await this.prisma.personalTrainingBooking.findMany({
      where: {
        trainerId: trainerUserId,
        status: PersonalBookingStatus.CONFIRMED,
        endAt: { gt: now },
      },
      include: { client: true },
      orderBy: { startAt: 'asc' },
    });

    return bookings.map((booking) => ({
      id: booking.id,
      clientId: booking.clientId,
      title: `Персональная · ${booking.client.firstName} ${booking.client.lastName}`.trim(),
      type: SessionType.PERSONAL,
      trainerId: booking.trainerId,
      trainerName: '',
      startAt: booking.startAt.toISOString(),
      endAt: booking.endAt.toISOString(),
      capacity: 1,
      booked: 1,
      available: false,
    }));
  }

  private localDateKey(d = new Date()): string {
    return d.toLocaleDateString('fr-CA');
  }

  private filterUpcomingSchedule<T extends { endAt: string; startAt: string }>(
    slots: T[],
  ): T[] {
    const now = Date.now();
    return slots
      .filter((s) => new Date(s.endAt).getTime() > now)
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
  }

  private formatVisitTime(date: Date): string {
    return date.toISOString().slice(11, 16);
  }

  private async getAppSessionVisits(
    clientId: string,
    clubName: string,
  ): Promise<Visit[]> {
    const now = new Date();

    const [groupBookings, personalBookings] = await Promise.all([
      this.prisma.groupClassBooking.findMany({
        where: {
          clientId,
          status: { not: GroupClassBookingStatus.CANCELLED },
          endAt: { lt: now },
        },
        orderBy: { startAt: 'desc' },
      }),
      this.prisma.personalTrainingBooking.findMany({
        where: {
          clientId,
          status: { not: PersonalBookingStatus.CANCELLED },
          endAt: { lt: now },
        },
        include: { trainer: true },
        orderBy: { startAt: 'desc' },
      }),
    ]);

    const groupVisits: Visit[] = groupBookings.map((booking) => ({
      id: `group-${booking.id}`,
      date: booking.startAt.toISOString().slice(0, 10),
      checkIn: this.formatVisitTime(booking.startAt),
      checkOut: this.formatVisitTime(booking.endAt),
      clubName,
      title: booking.title,
      sessionType: SessionType.GROUP,
      source: 'fitgo',
    }));

    const personalVisits: Visit[] = personalBookings.map((booking) => ({
      id: `personal-${booking.id}`,
      date: booking.startAt.toISOString().slice(0, 10),
      checkIn: this.formatVisitTime(booking.startAt),
      checkOut: this.formatVisitTime(booking.endAt),
      clubName,
      title: `Персональная · ${booking.trainer.firstName} ${booking.trainer.lastName}`.trim(),
      sessionType: SessionType.PERSONAL,
      source: 'fitgo',
    }));

    return [...groupVisits, ...personalVisits];
  }

  private mergeVisits(externalVisits: Visit[], appVisits: Visit[]): Visit[] {
    return [...externalVisits, ...appVisits].sort((a, b) => {
      const dateCompare = b.date.localeCompare(a.date);
      if (dateCompare !== 0) return dateCompare;
      return (b.checkIn ?? '').localeCompare(a.checkIn ?? '');
    });
  }

  private async getClientVisitHistory(
    clientId: string,
    externalId: string | null | undefined,
    clubId: string,
    clubName: string,
  ): Promise<Visit[]> {
    // One sync into FitGO cache (14d + cooldown); do NOT call getVisits again.
    if (externalId) {
      await this.visitSync.syncUserVisits(clientId, clubId, externalId);
    }

    const clubVisits = await this.visitSync.getVisitsForUser(clientId);
    const syncedVisits: Visit[] = clubVisits.map((v) => ({
      id: v.id,
      date: v.visitDate.slice(0, 10),
      checkIn: this.formatVisitTime(v.visitedAt),
      clubName,
      title: v.source === 'ONEC_SYNC' ? 'Визит в клуб' : 'Check-in / запись',
      source: v.source === 'ONEC_SYNC' ? '1c' : 'fitgo',
    }));

    const appVisits = await this.getAppSessionVisits(clientId, clubName);
    const combined = [...syncedVisits, ...appVisits];

    const byDateTitle = new Set<string>();
    const merged: Visit[] = [];

    for (const v of this.mergeVisits(combined, [])) {
      const key = `${v.date}|${v.title ?? ''}|${v.checkIn ?? ''}`;
      if (byDateTitle.has(key)) continue;
      byDateTitle.add(key);
      merged.push(v);
    }

    return merged;
  }

  private async getTrainerClientSessions(trainerId: string, clientId: string) {
    const bookings = await this.prisma.personalTrainingBooking.findMany({
      where: { trainerId, clientId },
      include: {
        sessionGoals: true,
      },
      orderBy: { startAt: 'desc' },
    });

    const now = Date.now();
    return bookings.map((booking) => {
      let status: 'SCHEDULED' | 'AWAITING_CONFIRMATION' | 'COMPLETED' | 'CANCELLED';
      if (booking.status === PersonalBookingStatus.CANCELLED) {
        status = 'CANCELLED';
      } else if (booking.status === PersonalBookingStatus.COMPLETED) {
        status = 'COMPLETED';
      } else if (
        booking.status === PersonalBookingStatus.CONFIRMED &&
        booking.endAt.getTime() <= now
      ) {
        status = 'AWAITING_CONFIRMATION';
      } else {
        status = 'SCHEDULED';
      }

      return {
        id: booking.id,
        startAt: booking.startAt.toISOString(),
        endAt: booking.endAt.toISOString(),
        status,
        awaitingConfirmation: status === 'AWAITING_CONFIRMATION',
        goalsCount: booking.sessionGoals.length,
        hasWorkoutSheet: workoutSheetHasData(
          normalizeWorkoutSheet(booking.workoutSheet),
        ),
        cancelReason:
          status === 'CANCELLED' && booking.cancelReason?.trim()
            ? booking.cancelReason.trim()
            : undefined,
      };
    });
  }

  async getDashboard(user: JwtPayload) {
    const externalId = user.externalId ?? '1c-trainer-001';
    const activeMembership = await this.clubMembership.getActiveMembership(user.sub);
    const club = activeMembership?.club ?? (user.clubId
      ? await this.prisma.club.findUnique({ where: { id: user.clubId } })
      : null);

    const [groupSchedule, personalSchedule] = club?.id
      ? await Promise.all([
          this.fetchTrainerGroupSchedule(club.id, externalId, user.sub),
          this.fetchTrainerPersonalSchedule(user.sub),
        ])
      : [[], await this.fetchTrainerPersonalSchedule(user.sub)];

    const schedule = this.filterUpcomingSchedule([
      ...groupSchedule,
      ...personalSchedule,
    ]);
    const todayKey = this.localDateKey();

    const clients = await this.roster.listClients(user.sub, club?.id ?? user.clubId);

    return {
      trainer: {
        id: user.sub,
        externalId,
        firstName:
          (await this.prisma.user.findUnique({ where: { id: user.sub } }))
            ?.firstName ?? 'Тренер',
        lastName:
          (await this.prisma.user.findUnique({ where: { id: user.sub } }))
            ?.lastName ?? '',
      },
      schedule,
      clients,
      stats: {
        clientsCount: clients.length,
        sessionsToday: schedule.filter((s) =>
          s.startAt.slice(0, 10) === todayKey,
        ).length,
        upcomingSessions: schedule.length,
      },
    };
  }

  async getMessageRecipients(user: JwtPayload) {
    const eligibleIds = await this.roster.getMessagableClientIds(user.sub);
    if (eligibleIds.length === 0) return [];

    const clients = await this.prisma.user.findMany({
      where: {
        id: { in: eligibleIds },
        roles: { some: { role: Role.CLIENT } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    return clients.map((client) => ({
      id: client.id,
      firstName: client.firstName,
      lastName: client.lastName,
    }));
  }

  async getClientDetail(user: JwtPayload, clientId: string) {
    await this.roster.ensureRosterAccess(user.sub, clientId);

    const client = await this.prisma.user.findFirst({
      where: {
        id: clientId,
        roles: { some: { role: Role.CLIENT } },
      },
    });
    if (!client) throw new NotFoundException('Клиент не найден');

    const provider = this.fitness.getProvider();
    let membershipName: string | undefined;
    let membershipStatus: MembershipStatus | undefined;

    const sessions = await this.getTrainerClientSessions(user.sub, clientId);
    const lastCompleted = sessions.find((s) => s.status === 'COMPLETED');
    const lastVisit = lastCompleted?.startAt.slice(0, 10);

    const membershipRow = await this.prisma.userClubMembership.findFirst({
      where: { userId: clientId, leftAt: null },
      orderBy: { joinedAt: 'desc' },
    });

    const clubId = membershipRow?.clubId ?? user.clubId;
    const extId = membershipRow?.externalId ?? client.externalId ?? undefined;

    let membershipValidUntil: string | undefined;
    let sessionsRemaining: number | undefined;
    let lastHallVisit: string | undefined;
    let membershipSyncedAt: string | null = null;
    /** null = no snapshot / unknown; do not invent 0 as a known debt. */
    let clubDebtAmount: number | null = null;
    let hadMembershipSnapshot = false;

    if (clubId && extId) {
      const snap = await this.prisma.clubMembershipSnapshot.findUnique({
        where: {
          clubId_clientExternalId: {
            clubId,
            clientExternalId: extId,
          },
        },
      });
      if (snap) {
        hadMembershipSnapshot = true;
        membershipSyncedAt = snap.syncedAt.toISOString();
        clubDebtAmount =
          typeof snap.debtAmount === 'number' && Number.isFinite(snap.debtAmount)
            ? snap.debtAmount
            : null;
        membershipName = snap.packageName ?? membershipName;
        membershipStatus =
          (snap.status
            ? (Object.values(MembershipStatus) as string[]).includes(
                snap.status.toUpperCase(),
              )
              ? (snap.status.toUpperCase() as MembershipStatus)
              : membershipStatus
            : membershipStatus) ?? membershipStatus;
        membershipValidUntil = snap.endDate ?? undefined;
        if (Array.isArray(snap.servicesJson)) {
          let sum = 0;
          let any = false;
          for (const row of snap.servicesJson as Array<{ remaining?: number }>) {
            if (typeof row?.remaining === 'number') {
              sum += row.remaining;
              any = true;
            }
          }
          if (any) sessionsRemaining = sum;
        }
      }
      const hall = await this.prisma.clubHallVisit.findFirst({
        where: { clubId, clientExternalId: extId, isActive: true },
        orderBy: { visitDate: 'desc' },
        select: { visitDate: true },
      });
      if (hall?.visitDate) {
        lastHallVisit = String(hall.visitDate).slice(0, 10);
      }
    }

    if ((!membershipName || !membershipStatus) && extId) {
      const membership = await provider.getMembership(extId);
      membershipName = membershipName ?? membership?.name;
      membershipStatus = membershipStatus ?? membership?.status;
      membershipValidUntil =
        membershipValidUntil ??
        (membership as { validUntil?: string } | null)?.validUntil;
      if (
        !hadMembershipSnapshot &&
        membership &&
        typeof (membership as { debtAmount?: number }).debtAmount === 'number'
      ) {
        clubDebtAmount = (membership as { debtAmount: number }).debtAmount;
      }
    }

    const since90 = new Date(Date.now() - 90 * 24 * 60 * 60_000);
    const [goals, notes, measurements, questionnaire, cancelNoShows, recentDone] =
      await Promise.all([
        this.prisma.clientGoal.findMany({
          where: { clientId, trainerId: user.sub },
          orderBy: { updatedAt: 'desc' },
        }),
        this.prisma.trainerNote.findMany({
          where: { clientId, trainerId: user.sub },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        this.prisma.clientMeasurement.findMany({
          where: { clientId, trainerId: user.sub },
          orderBy: { recordedAt: 'desc' },
          take: 10,
        }),
        this.clientProfile.getQuestionnaireForTrainer(clientId),
        this.prisma.personalTrainingBooking.count({
          where: {
            trainerId: user.sub,
            clientId,
            startAt: { gte: since90 },
            OR: [
              { status: PersonalBookingStatus.CANCELLED },
              { usageStatus: { in: ['NO_SHOW', 'CANCELLED'] } },
            ],
          },
        }),
        this.prisma.personalTrainingBooking.count({
          where: {
            trainerId: user.sub,
            clientId,
            status: PersonalBookingStatus.COMPLETED,
            startAt: { gte: since90 },
          },
        }),
      ]);

    const weeks = 90 / 7;
    const visitFrequencyPerWeek =
      recentDone > 0 ? Math.round((recentDone / weeks) * 10) / 10 : 0;

    const me = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { trainerClub: true },
    });
    const ownLedger = me?.trainerClub
      ? await this.ledger.clientCardSnippet(user.sub, clientId)
      : undefined;

    return {
      id: client.id,
      externalId: extId,
      firstName: client.firstName,
      lastName: client.lastName,
      phone: client.phone ?? undefined,
      gender: client.gender ?? null,
      dateOfBirth: client.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      hasApp: client.accountStatus === AccountStatus.ACTIVE,
      crmStatus:
        membershipRow?.crmStatus ??
        (extId
          ? 'LINKED'
          : membershipRow
            ? 'PENDING_CRM'
            : null),
      membershipName,
      membershipStatus,
      membershipValidUntil,
      sessionsRemaining,
      membershipSyncedAt,
      clubDebtAmount,
      lastVisit,
      lastHallVisit,
      cancelNoShowCount: cancelNoShows,
      visitFrequencyPerWeek,
      questionnaire,
      ownLedger,
      sessions,
      goals: goals.map((g) => ({
        id: g.id,
        title: g.title,
        target: g.target ?? undefined,
        progress: g.progress ?? undefined,
      })),
      notes: notes.map((n) => ({
        id: n.id,
        content: n.content,
        createdAt: n.createdAt.toISOString(),
      })),
      measurements: measurements.map((m) => ({
        id: m.id,
        weight: m.weight ?? undefined,
        notes: m.notes ?? undefined,
        recordedAt: m.recordedAt.toISOString(),
      })),
    };
  }

  async getClientProgress(user: JwtPayload, clientId: string) {
    await this.roster.ensureRosterAccess(user.sub, clientId);
    const since = new Date(Date.now() - 180 * 24 * 60 * 60_000);

    const [measurements, bookings] = await Promise.all([
      this.prisma.clientMeasurement.findMany({
        where: {
          clientId,
          trainerId: user.sub,
          weight: { not: null },
          recordedAt: { gte: since },
        },
        orderBy: { recordedAt: 'asc' },
        take: 60,
      }),
      this.prisma.personalTrainingBooking.findMany({
        where: {
          trainerId: user.sub,
          clientId,
          startAt: { gte: since },
        },
        orderBy: { startAt: 'desc' },
        take: 80,
      }),
    ]);

    const weightSeries = measurements
      .filter((m) => m.weight != null)
      .map((m) => ({
        at: m.recordedAt.toISOString(),
        weightKg: m.weight as number,
      }));

    const byWeek = new Map<string, number>();
    for (const b of bookings) {
      if (b.status === PersonalBookingStatus.CANCELLED) continue;
      const d = new Date(b.startAt);
      const day = d.getUTCDay() || 7;
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - (day - 1));
      const key = monday.toISOString().slice(0, 10);
      byWeek.set(key, (byWeek.get(key) ?? 0) + 1);
    }
    const visitFrequency = [...byWeek.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, count]) => ({ weekStart, count }));

    const recentSessions = bookings.slice(0, 20).map((booking) => ({
      id: booking.id,
      startAt: booking.startAt.toISOString(),
      status: booking.status,
      hasWorkoutSheet: workoutSheetHasData(
        normalizeWorkoutSheet(booking.workoutSheet),
      ),
    }));

    return {
      clientId,
      weightSeries,
      visitFrequency,
      recentSessions,
    };
  }

  async addNote(user: JwtPayload, clientId: string, content: string) {
    await this.roster.ensureRosterAccess(user.sub, clientId);
    return this.prisma.trainerNote.create({
      data: { trainerId: user.sub, clientId, content },
    });
  }

  async addGoal(
    user: JwtPayload,
    clientId: string,
    data: { title: string; target?: string; progress?: string },
  ) {
    await this.roster.ensureRosterAccess(user.sub, clientId);
    return this.prisma.clientGoal.create({
      data: {
        trainerId: user.sub,
        clientId,
        title: data.title,
        target: data.target,
        progress: data.progress,
      },
    });
  }

  async addMeasurement(
    user: JwtPayload,
    clientId: string,
    data: { weight?: number; notes?: string },
  ) {
    await this.roster.ensureRosterAccess(user.sub, clientId);
    const measurement = await this.prisma.clientMeasurement.create({
      data: {
        trainerId: user.sub,
        clientId,
        weight: data.weight,
        notes: data.notes,
      },
    });
    if (data.weight) {
      await this.prisma.clientBodyLog.create({
        data: {
          clientId,
          recordedById: user.sub,
          source: BodyLogSource.TRAINER,
          weightKg: data.weight,
          notes: data.notes,
        },
      });
    }
    return measurement;
  }

  async sendClientMessage(user: JwtPayload, clientId: string, message: string) {
    await this.roster.ensureClientMessagingAllowed(user.sub, clientId);

    const client = await this.prisma.user.findFirst({
      where: {
        id: clientId,
        roles: { some: { role: Role.CLIENT } },
      },
    });
    if (!client) throw new NotFoundException('Клиент не найден');

    const trainer = await this.prisma.user.findUnique({
      where: { id: user.sub },
    });
    const trainerName = trainer
      ? `${trainer.firstName} ${trainer.lastName}`.trim()
      : 'тренера';

    return this.notifications.sendDirectMessage(
      clientId,
      `Сообщение от ${trainerName}`,
      message,
      user.sub,
    );
  }

  /** Confirm client attended a group class (verified visit without relying on 1C). */
  async confirmGroupAttendance(user: JwtPayload, bookingId: string) {
    const booking = await this.prisma.groupClassBooking.findFirst({
      where: {
        id: bookingId,
        status: { not: GroupClassBookingStatus.CANCELLED },
      },
      include: { client: true },
    });
    if (!booking) {
      throw new NotFoundException('Запись на занятие не найдена');
    }

    if (booking.endAt > new Date()) {
      throw new BadRequestException('Занятие ещё не закончилось');
    }

    const clubId =
      booking.client.clubId ??
      (await this.clubMembership.getActiveMembership(booking.clientId))?.clubId ??
      requireClubId(user);

    const trainer = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (
      trainer?.clubId &&
      booking.client.clubId &&
      trainer.clubId !== booking.client.clubId
    ) {
      throw new BadRequestException('Клиент из другого клуба');
    }

    await this.prisma.groupClassBooking.update({
      where: { id: bookingId },
      data: { status: GroupClassBookingStatus.COMPLETED },
    });

    await this.serviceUsage.markPerformerConfirmed(bookingId, 'GROUP');

    const event = await this.visitSync.recordTrainerConfirm({
      userId: booking.clientId,
      clubId,
      bookingId,
      kind: 'GROUP',
      occurredAt: booking.startAt,
      title: booking.title,
      checkIn: booking.startAt.toISOString().slice(11, 16),
      checkOut: booking.endAt.toISOString().slice(11, 16),
    });

    return {
      bookingId,
      visitEventId: event.id,
      verification: 'VERIFIED_TRAINER',
    };
  }

  listTimerPresets(user: JwtPayload) {
    return this.prisma.trainerTimerPreset.findMany({
      where: { trainerId: user.sub },
      orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  createTimerPreset(
    user: JwtPayload,
    data: {
      name: string;
      phases: Array<{
        kind: string;
        durationSec?: number | null;
        label: string;
      }>;
      soundPack?: string;
      sortOrder?: number;
    },
  ) {
    return this.prisma.trainerTimerPreset.create({
      data: {
        trainerId: user.sub,
        name: data.name.trim(),
        phases: data.phases as object[],
        soundPack: data.soundPack ?? 'classic',
        sortOrder: data.sortOrder ?? 0,
      },
    });
  }

  async updateTimerPreset(
    user: JwtPayload,
    presetId: string,
    data: {
      name?: string;
      phases?: Array<{
        kind: string;
        durationSec?: number | null;
        label: string;
      }>;
      soundPack?: string;
      sortOrder?: number;
    },
  ) {
    const existing = await this.prisma.trainerTimerPreset.findFirst({
      where: { id: presetId, trainerId: user.sub },
    });
    if (!existing) throw new NotFoundException('Пресет не найден');
    return this.prisma.trainerTimerPreset.update({
      where: { id: presetId },
      data: {
        ...(data.name != null ? { name: data.name.trim() } : {}),
        ...(data.phases != null ? { phases: data.phases as object[] } : {}),
        ...(data.soundPack != null ? { soundPack: data.soundPack } : {}),
        ...(data.sortOrder != null ? { sortOrder: data.sortOrder } : {}),
      },
    });
  }

  async deleteTimerPreset(user: JwtPayload, presetId: string) {
    const existing = await this.prisma.trainerTimerPreset.findFirst({
      where: { id: presetId, trainerId: user.sub },
    });
    if (!existing) throw new NotFoundException('Пресет не найден');
    await this.prisma.trainerTimerPreset.delete({ where: { id: presetId } });
    return { ok: true as const };
  }

  async createHomework(
    user: JwtPayload,
    data: {
      clientId: string;
      bookingId?: string;
      summary?: string;
      dueAt?: string;
      items?: Array<{
        kind?: string;
        title: string;
        target?: string;
        timesRequired?: number;
      }>;
    },
  ) {
    await this.roster.ensureRosterAccess(user.sub, data.clientId);

    let dueAt: Date | undefined;
    if (data.dueAt) {
      dueAt = new Date(data.dueAt);
    } else {
      const next = await this.prisma.personalTrainingBooking.findFirst({
        where: {
          trainerId: user.sub,
          clientId: data.clientId,
          startAt: { gt: new Date() },
          status: { not: PersonalBookingStatus.CANCELLED },
        },
        orderBy: { startAt: 'asc' },
      });
      dueAt = next?.startAt;
    }

    const items =
      data.items && data.items.length > 0
        ? data.items
        : data.summary?.trim()
          ? [{ kind: 'habit', title: data.summary.trim(), timesRequired: 1 }]
          : [];
    if (items.length === 0) {
      throw new BadRequestException('Добавьте пункты задания или текст');
    }

    // Cancel previous active homework for this pair.
    await this.prisma.clientHomework.updateMany({
      where: {
        trainerId: user.sub,
        clientId: data.clientId,
        status: 'ACTIVE',
      },
      data: { status: 'CANCELLED' },
    });

    const homework = await this.prisma.clientHomework.create({
      data: {
        trainerId: user.sub,
        clientId: data.clientId,
        bookingId: data.bookingId,
        summary: data.summary?.trim() || null,
        dueAt: dueAt ?? null,
        items: {
          create: items.map((item, i) => ({
            kind: item.kind ?? 'habit',
            title: item.title.trim(),
            target: item.target?.trim() || null,
            timesRequired: item.timesRequired ?? 1,
            sortOrder: i,
          })),
        },
      },
      include: { items: { include: { checks: true } } },
    });

    const trainer = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { firstName: true, lastName: true },
    });
    const trainerName =
      `${trainer?.firstName ?? ''} ${trainer?.lastName ?? ''}`.trim() ||
      'Тренер';
    await this.notifications.notifyTrainerSessionNotes({
      clientId: data.clientId,
      trainerId: user.sub,
      trainerName,
      hasHomework: true,
      bookingId: data.bookingId,
    });

    return this.mapHomework(homework);
  }

  async listClientHomework(user: JwtPayload, clientId: string) {
    await this.roster.ensureRosterAccess(user.sub, clientId);
    const rows = await this.prisma.clientHomework.findMany({
      where: { trainerId: user.sub, clientId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { items: { include: { checks: true }, orderBy: { sortOrder: 'asc' } } },
    });
    return rows.map((r) => this.mapHomework(r));
  }

  async getActiveHomeworkForClient(clientId: string) {
    const row = await this.prisma.clientHomework.findFirst({
      where: { clientId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      include: {
        items: { include: { checks: true }, orderBy: { sortOrder: 'asc' } },
        trainer: { select: { firstName: true, lastName: true } },
      },
    });
    if (!row) return null;
    return {
      ...this.mapHomework(row),
      trainerName: `${row.trainer.firstName} ${row.trainer.lastName}`.trim(),
    };
  }

  async checkHomeworkItem(
    clientId: string,
    itemId: string,
    dayKey: string,
    done = true,
  ) {
    const item = await this.prisma.clientHomeworkItem.findFirst({
      where: { id: itemId, homework: { clientId, status: 'ACTIVE' } },
      include: { homework: true, checks: true },
    });
    if (!item) throw new NotFoundException('Пункт задания не найден');

    await this.prisma.clientHomeworkCheck.upsert({
      where: { itemId_dayKey: { itemId, dayKey } },
      create: { itemId, dayKey, done },
      update: { done },
    });

    const refreshed = await this.prisma.clientHomework.findUnique({
      where: { id: item.homeworkId },
      include: {
        items: { include: { checks: true }, orderBy: { sortOrder: 'asc' } },
        trainer: { select: { firstName: true, lastName: true } },
      },
    });
    if (!refreshed) throw new NotFoundException('Задание не найдено');

    const mapped = this.mapHomework(refreshed);
    if (mapped.progress.done >= mapped.progress.total && mapped.progress.total > 0) {
      await this.prisma.clientHomework.update({
        where: { id: refreshed.id },
        data: { status: 'DONE', completedAt: new Date() },
      });
      mapped.status = 'DONE';
    }

    return {
      ...mapped,
      trainerName: `${refreshed.trainer.firstName} ${refreshed.trainer.lastName}`.trim(),
    };
  }

  async getPreviousHomework(user: JwtPayload, clientId: string) {
    await this.roster.ensureRosterAccess(user.sub, clientId);
    const include = {
      items: { orderBy: { sortOrder: 'asc' as const } },
    };
    // Prefer finished / cancelled as «прошлое»; fallback to current ACTIVE.
    const row =
      (await this.prisma.clientHomework.findFirst({
        where: {
          trainerId: user.sub,
          clientId,
          status: { in: ['DONE', 'CANCELLED'] },
        },
        orderBy: { createdAt: 'desc' },
        include,
      })) ??
      (await this.prisma.clientHomework.findFirst({
        where: { trainerId: user.sub, clientId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        include,
      }));
    if (!row) return null;
    return {
      id: row.id,
      summary: row.summary,
      items: row.items.map((i) => ({
        kind: i.kind,
        title: i.title,
        target: i.target,
        timesRequired: i.timesRequired,
      })),
    };
  }

  private mapHomework(row: {
    id: string;
    trainerId: string;
    clientId: string;
    bookingId: string | null;
    summary: string | null;
    status: string;
    dueAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    items: Array<{
      id: string;
      kind: string;
      title: string;
      target: string | null;
      timesRequired: number;
      sortOrder: number;
      checks: Array<{ id: string; dayKey: string; done: boolean }>;
    }>;
  }) {
    const items = row.items.map((item) => {
      const doneCount = item.checks.filter((c) => c.done).length;
      return {
        id: item.id,
        kind: item.kind,
        title: item.title,
        target: item.target ?? undefined,
        timesRequired: item.timesRequired,
        sortOrder: item.sortOrder,
        doneCount,
        checks: item.checks.map((c) => ({
          dayKey: c.dayKey,
          done: c.done,
        })),
        complete: doneCount >= item.timesRequired,
      };
    });
    const total = items.length;
    const done = items.filter((i) => i.complete).length;
    return {
      id: row.id,
      trainerId: row.trainerId,
      clientId: row.clientId,
      bookingId: row.bookingId ?? undefined,
      summary: row.summary ?? undefined,
      status: row.status,
      dueAt: row.dueAt?.toISOString(),
      completedAt: row.completedAt?.toISOString(),
      createdAt: row.createdAt.toISOString(),
      items,
      progress: { done, total },
    };
  }

  async notifySessionNotes(
    user: JwtPayload,
    bookingId: string,
    hasHomework: boolean,
  ) {
    const booking = await this.prisma.personalTrainingBooking.findFirst({
      where: { id: bookingId, trainerId: user.sub },
      include: {
        trainer: { select: { firstName: true, lastName: true } },
      },
    });
    if (!booking) throw new NotFoundException('Запись не найдена');
    const trainerName =
      `${booking.trainer.firstName} ${booking.trainer.lastName}`.trim() ||
      'Тренер';
    await this.notifications.notifyTrainerSessionNotes({
      clientId: booking.clientId,
      trainerId: user.sub,
      trainerName,
      hasHomework,
      bookingId,
    });
    return { ok: true as const };
  }

  async upsertGroupClassNote(
    user: JwtPayload,
    data: { sessionKey: string; text?: string; groupRpe?: number },
  ) {
    const sessionKey = data.sessionKey.trim();
    if (!sessionKey) throw new BadRequestException('sessionKey обязателен');
    return this.prisma.groupClassNote.upsert({
      where: {
        trainerId_sessionKey: { trainerId: user.sub, sessionKey },
      },
      create: {
        trainerId: user.sub,
        sessionKey,
        text: data.text?.trim() ?? '',
        groupRpe: data.groupRpe ?? null,
      },
      update: {
        ...(data.text != null ? { text: data.text.trim() } : {}),
        ...(data.groupRpe !== undefined ? { groupRpe: data.groupRpe } : {}),
      },
    });
  }

  async getGroupClassNote(user: JwtPayload, sessionKey: string) {
    return this.prisma.groupClassNote.findUnique({
      where: {
        trainerId_sessionKey: {
          trainerId: user.sub,
          sessionKey: decodeURIComponent(sessionKey),
        },
      },
    });
  }
}
