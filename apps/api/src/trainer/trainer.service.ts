import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MembershipStatus, SessionType, normalizeWorkoutSheet, workoutSheetHasData, type ScheduleSlot, type Visit } from '@fitgo/shared-types';
import { GroupClassBookingStatus, PersonalBookingStatus, Role, BodyLogSource } from '@prisma/client';
import type { JwtPayload } from '../auth/jwt.strategy';
import { ClubMembershipService } from '../common/club-membership.service';
import { FitnessService } from '../fitness/fitness.service';
import { VisitSyncService } from '../engagement/visit-sync.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
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
  ) {}

  private isFormaEmployeeId(id: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      id,
    );
  }

  private async fetchTrainerGroupSchedule(
    clubExternalId: string,
    trainerExternalId: string,
    trainerUserId: string,
  ): Promise<ScheduleSlot[]> {
    const provider = this.fitness.getProvider();

    try {
      if (this.isFormaEmployeeId(trainerExternalId)) {
        return await provider.getSchedule(clubExternalId, {
          trainerId: trainerExternalId,
        });
      }

      const dbTrainer = await this.prisma.user.findUnique({
        where: { id: trainerUserId },
      });
      const allSlots = await provider.getSchedule(clubExternalId);
      if (!dbTrainer) return allSlots;

      const first = dbTrainer.firstName.trim();
      const last = dbTrainer.lastName.trim();
      return allSlots.filter((slot) => {
        if (slot.trainerId === trainerExternalId) return true;
        const name = slot.trainerName?.toLowerCase() ?? '';
        return (
          (first && name.includes(first.toLowerCase())) ||
          (last && name.includes(last.toLowerCase()))
        );
      });
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
    if (externalId) {
      await this.visitSync.syncUserVisits(clientId, clubId, externalId);
    }

    const provider = this.fitness.getProvider();
    const externalVisits = externalId
      ? await provider.getVisits(externalId)
      : [];

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
    const combined = [...externalVisits, ...syncedVisits, ...appVisits];

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
      };
    });
  }

  async getDashboard(user: JwtPayload) {
    const externalId = user.externalId ?? '1c-trainer-001';
    const activeMembership = await this.clubMembership.getActiveMembership(user.sub);
    const club = activeMembership?.club ?? (user.clubId
      ? await this.prisma.club.findUnique({ where: { id: user.clubId } })
      : null);

    const [groupSchedule, personalSchedule] = club?.externalId
      ? await Promise.all([
          this.fetchTrainerGroupSchedule(
            club.externalId,
            externalId,
            user.sub,
          ),
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

    if (client.externalId) {
      const membership = await provider.getMembership(client.externalId);
      membershipName = membership?.name;
      membershipStatus = membership?.status;
    }

    const [goals, notes, measurements] = await Promise.all([
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
    ]);

    return {
      id: client.id,
      externalId: client.externalId ?? undefined,
      firstName: client.firstName,
      lastName: client.lastName,
      membershipName,
      membershipStatus,
      lastVisit,
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
}
