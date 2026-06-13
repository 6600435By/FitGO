import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MembershipStatus } from '@fitgo/shared-types';
import { Role } from '@prisma/client';
import type { JwtPayload } from '../auth/jwt.strategy';
import { FitnessService } from '../fitness/fitness.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TrainerService {
  constructor(
    private readonly fitness: FitnessService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async getDashboard(user: JwtPayload) {
    const externalId = user.externalId ?? '1c-trainer-001';
    const club = await this.prisma.club.findUnique({
      where: { id: user.clubId },
    });

    const schedule = club?.externalId
      ? await this.fitness
          .getProvider()
          .getSchedule(club.externalId, { trainerId: externalId })
      : [];

    const clients = await this.getClients(user.sub, user.clubId);

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
          s.startAt.startsWith(new Date().toISOString().slice(0, 10)),
        ).length,
        upcomingSessions: schedule.filter((s) => s.available).length,
      },
    };
  }

  async getMessageRecipients(user: JwtPayload) {
    const eligibleIds = await this.getEligibleClientIds(user.sub, user.clubId);
    if (eligibleIds.length === 0) return [];

    const clients = await this.prisma.user.findMany({
      where: {
        id: { in: eligibleIds },
        clubId: user.clubId,
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
    await this.ensureClientAccess(user, clientId);

    const client = await this.prisma.user.findFirst({
      where: {
        id: clientId,
        clubId: user.clubId,
        roles: { some: { role: Role.CLIENT } },
      },
    });
    if (!client) throw new NotFoundException('Клиент не найден');

    const provider = this.fitness.getProvider();
    let membershipName: string | undefined;
    let membershipStatus: MembershipStatus | undefined;
    let lastVisit: string | undefined;

    if (client.externalId) {
      const membership = await provider.getMembership(client.externalId);
      const visits = await provider.getVisits(client.externalId);
      membershipName = membership?.name;
      membershipStatus = membership?.status;
      lastVisit = visits[0]?.date;
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
      phone: client.phone ?? undefined,
      membershipName,
      membershipStatus,
      lastVisit,
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
    await this.ensureClubClient(user, clientId);
    return this.prisma.trainerNote.create({
      data: { trainerId: user.sub, clientId, content },
    });
  }

  async addGoal(
    user: JwtPayload,
    clientId: string,
    data: { title: string; target?: string; progress?: string },
  ) {
    await this.ensureClubClient(user, clientId);
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
    await this.ensureClubClient(user, clientId);
    return this.prisma.clientMeasurement.create({
      data: {
        trainerId: user.sub,
        clientId,
        weight: data.weight,
        notes: data.notes,
      },
    });
  }

  async sendClientMessage(user: JwtPayload, clientId: string, message: string) {
    await this.ensureClientAccess(user, clientId);

    const client = await this.prisma.user.findFirst({
      where: {
        id: clientId,
        clubId: user.clubId,
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

  private async ensureClubClient(user: JwtPayload, clientId: string) {
    const client = await this.prisma.user.findFirst({
      where: {
        id: clientId,
        clubId: user.clubId,
        roles: { some: { role: Role.CLIENT } },
      },
    });
    if (!client) throw new NotFoundException('Клиент не найден');
  }

  private async ensureClientAccess(user: JwtPayload, clientId: string) {
    const eligibleIds = await this.getEligibleClientIds(user.sub, user.clubId);
    if (!eligibleIds.includes(clientId)) {
      throw new ForbiddenException(
        'Можно писать только клиентам из вашей базы или записанным к вам на тренировку',
      );
    }
  }

  private async getEligibleClientIds(
    trainerId: string,
    clubId: string,
  ): Promise<string[]> {
    const trainer = await this.prisma.user.findUnique({
      where: { id: trainerId },
    });
    if (!trainer) return [];

    const fullName = `${trainer.firstName} ${trainer.lastName}`.trim();
    const nameParts = [trainer.firstName, trainer.lastName].filter(Boolean);

    const [
      personalBookings,
      notes,
      goals,
      measurements,
      groupBookings,
    ] = await Promise.all([
      this.prisma.personalTrainingBooking.findMany({
        where: { trainerId },
        select: { clientId: true },
        distinct: ['clientId'],
      }),
      this.prisma.trainerNote.findMany({
        where: { trainerId },
        select: { clientId: true },
        distinct: ['clientId'],
      }),
      this.prisma.clientGoal.findMany({
        where: { trainerId },
        select: { clientId: true },
        distinct: ['clientId'],
      }),
      this.prisma.clientMeasurement.findMany({
        where: { trainerId },
        select: { clientId: true },
        distinct: ['clientId'],
      }),
      fullName
        ? this.prisma.groupClassBooking.findMany({
            where: {
              client: { clubId },
              OR: nameParts.map((part) => ({
                trainerName: { contains: part, mode: 'insensitive' as const },
              })),
            },
            select: { clientId: true },
            distinct: ['clientId'],
          })
        : Promise.resolve([]),
    ]);

    const ids = new Set<string>();
    for (const row of [
      ...personalBookings,
      ...notes,
      ...goals,
      ...measurements,
      ...groupBookings,
    ]) {
      ids.add(row.clientId);
    }

    return [...ids];
  }

  private async getClients(trainerId: string, clubId: string) {
    const eligibleIds = await this.getEligibleClientIds(trainerId, clubId);
    if (eligibleIds.length === 0) return [];

    const users = await this.prisma.user.findMany({
      where: {
        id: { in: eligibleIds },
        clubId,
        roles: { some: { role: Role.CLIENT } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    const provider = this.fitness.getProvider();

    return Promise.all(
      users.map(async (client) => {
        const externalId = client.externalId;
        let membershipName: string | undefined;
        let membershipStatus: MembershipStatus | undefined;
        let lastVisit: string | undefined;

        if (externalId) {
          const membership = await provider.getMembership(externalId);
          const visits = await provider.getVisits(externalId);
          membershipName = membership?.name;
          membershipStatus = membership?.status;
          lastVisit = visits[0]?.date;
        }

        return {
          id: client.id,
          externalId: client.externalId ?? undefined,
          firstName: client.firstName,
          lastName: client.lastName,
          phone: client.phone ?? undefined,
          membershipName,
          membershipStatus,
          lastVisit,
        };
      }),
    );
  }
}
