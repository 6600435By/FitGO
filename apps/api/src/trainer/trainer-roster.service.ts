import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccountStatus,
  Role,
  TrainerClientInviteStatus,
  TrainerClientLinkStatus,
  TrainerClientSource,
} from '@prisma/client';
import { MembershipStatus } from '@fitgo/shared-types';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import {
  normalizePhone,
  shadowEmailForPhone,
} from '../common/phone.util';
import { FitnessService } from '../fitness/fitness.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

export const INVITE_GENERIC_MESSAGE =
  'Приглашение отправлено. Клиент должен подтвердить в приложении.';

@Injectable()
export class TrainerRosterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly fitness: FitnessService,
  ) {}

  async getMessagableClientIds(trainerId: string): Promise<string[]> {
    const links = await this.prisma.trainerClientLink.findMany({
      where: {
        trainerId,
        status: TrainerClientLinkStatus.CONFIRMED,
        clientAcceptedAt: { not: null },
        client: { accountStatus: AccountStatus.ACTIVE },
      },
      select: { clientId: true },
    });
    return links.map((l) => l.clientId);
  }

  async ensureClientMessagingAllowed(trainerId: string, clientId: string) {
    const link = await this.prisma.trainerClientLink.findUnique({
      where: { trainerId_clientId: { trainerId, clientId } },
      include: { client: true },
    });
    if (!link || link.status !== TrainerClientLinkStatus.CONFIRMED) {
      throw new ForbiddenException(
        'Клиент должен подтвердить связь с вами перед отправкой сообщений',
      );
    }
    if (link.client.accountStatus === AccountStatus.SHADOW) {
      throw new ForbiddenException(
        'Клиент ещё не зарегистрировался в приложении',
      );
    }
    if (!link.clientAcceptedAt) {
      throw new ForbiddenException(
        'Клиент должен подтвердить связь с вами в приложении',
      );
    }
  }

  private async expireStaleInvites() {
    await this.prisma.trainerClientInvite.updateMany({
      where: {
        status: TrainerClientInviteStatus.PENDING,
        expiresAt: { lt: new Date() },
      },
      data: { status: TrainerClientInviteStatus.EXPIRED },
    });
  }

  async listClients(trainerId: string, clubId?: string | null) {
    const links = await this.prisma.trainerClientLink.findMany({
      where: { trainerId },
      include: { client: true },
      orderBy: { createdAt: 'desc' },
    });

    const provider = this.fitness.getProvider();

    return Promise.all(
      links.map(async (link) => {
        const client = link.client;
        let membershipName: string | undefined;
        let membershipStatus: MembershipStatus | undefined;
        let lastVisit: string | undefined;

        if (clubId) {
          const clientMembership = await this.prisma.userClubMembership.findFirst({
            where: {
              userId: client.id,
              clubId,
              leftAt: null,
            },
          });
          const externalId =
            clientMembership?.externalId ?? client.externalId ?? undefined;
          if (externalId) {
            const membership = await provider.getMembership(externalId);
            const visits = await provider.getVisits(externalId);
            membershipName = membership?.name;
            membershipStatus = membership?.status;
            lastVisit = visits[0]?.date;
          }
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
          rosterStatus: link.status,
          hasApp: client.accountStatus === AccountStatus.ACTIVE,
          clientAccepted: link.clientAcceptedAt != null,
          inRosterSince: link.createdAt.toISOString(),
          source: link.source,
        };
      }),
    );
  }

  async getConfirmedClientIds(trainerId: string): Promise<string[]> {
    const links = await this.prisma.trainerClientLink.findMany({
      where: {
        trainerId,
        status: TrainerClientLinkStatus.CONFIRMED,
      },
      select: { clientId: true },
    });
    return links.map((l) => l.clientId);
  }

  async ensureConfirmedLink(trainerId: string, clientId: string) {
    const link = await this.prisma.trainerClientLink.findUnique({
      where: { trainerId_clientId: { trainerId, clientId } },
    });
    if (!link || link.status !== TrainerClientLinkStatus.CONFIRMED) {
      throw new ForbiddenException(
        'Клиент должен подтвердить связь с вами перед назначением тренировок',
      );
    }
  }

  async ensureRosterAccess(trainerId: string, clientId: string) {
    const link = await this.prisma.trainerClientLink.findUnique({
      where: { trainerId_clientId: { trainerId, clientId } },
    });
    if (!link || link.status === TrainerClientLinkStatus.REJECTED) {
      throw new ForbiddenException('Клиент не в вашей базе');
    }
  }

  async addOfflineClient(
    trainerId: string,
    dto: { firstName: string; lastName: string; phone: string; notes?: string },
  ) {
    const phoneNormalized = normalizePhone(dto.phone);
    if (phoneNormalized.length < 9) {
      throw new BadRequestException('Некорректный номер телефона');
    }

    const existing = await this.prisma.user.findFirst({
      where: { phoneNormalized },
    });

    if (existing) {
      return { message: INVITE_GENERIC_MESSAGE };
    }

    const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);

    const client = await this.prisma.user.create({
      data: {
        email: shadowEmailForPhone(phoneNormalized),
        password: passwordHash,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        phone: dto.phone.trim(),
        phoneNormalized,
        accountStatus: AccountStatus.SHADOW,
        createdByTrainerId: trainerId,
        roles: { create: { role: Role.CLIENT } },
      },
    });

    await this.prisma.trainerClientLink.create({
      data: {
        trainerId,
        clientId: client.id,
        status: TrainerClientLinkStatus.CONFIRMED,
        source: TrainerClientSource.MANUAL,
        notes: dto.notes,
        confirmedAt: new Date(),
      },
    });

    return {
      id: client.id,
      firstName: client.firstName,
      lastName: client.lastName,
      phone: client.phone ?? undefined,
      rosterStatus: TrainerClientLinkStatus.CONFIRMED,
      hasApp: false,
      clientAccepted: false,
      inRosterSince: new Date().toISOString(),
      source: TrainerClientSource.MANUAL,
    };
  }

  async inviteClient(trainerId: string, phone: string) {
    await this.expireStaleInvites();

    const phoneNormalized = normalizePhone(phone);
    if (phoneNormalized.length < 9) {
      throw new BadRequestException('Некорректный номер телефона');
    }

    const trainer = await this.prisma.user.findUnique({
      where: { id: trainerId },
    });
    const trainerName = trainer
      ? `${trainer.firstName} ${trainer.lastName}`.trim()
      : 'Тренер';

    const existingUser = await this.prisma.user.findFirst({
      where: {
        phoneNormalized,
        accountStatus: AccountStatus.ACTIVE,
      },
    });

    const existingInvite = await this.prisma.trainerClientInvite.findFirst({
      where: {
        trainerId,
        phoneNormalized,
        status: TrainerClientInviteStatus.PENDING,
      },
    });

    if (!existingInvite) {
      await this.prisma.trainerClientInvite.create({
        data: {
          trainerId,
          phoneNormalized,
          clientId: existingUser?.id,
          status: TrainerClientInviteStatus.PENDING,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
        },
      });
    }

    if (existingUser) {
      const pendingLink = await this.prisma.trainerClientLink.findUnique({
        where: {
          trainerId_clientId: { trainerId, clientId: existingUser.id },
        },
      });
      if (!pendingLink) {
        await this.prisma.trainerClientLink.create({
          data: {
            trainerId,
            clientId: existingUser.id,
            status: TrainerClientLinkStatus.PENDING,
            source: TrainerClientSource.INVITE,
          },
        });
      }

      const invite = await this.prisma.trainerClientInvite.findFirst({
        where: {
          trainerId,
          phoneNormalized,
          status: TrainerClientInviteStatus.PENDING,
        },
        orderBy: { createdAt: 'desc' },
      });

      await this.notifications.sendDirectMessage(
        existingUser.id,
        'Приглашение от тренера',
        `${trainerName} хочет вести вас как клиента. Откройте раздел «Приглашения тренеров», чтобы принять или отклонить.${invite ? ` invite:${invite.id}` : ''}`,
        trainerId,
      );
    }

    return { message: INVITE_GENERIC_MESSAGE };
  }

  async getClientAcceptedTrainerIds(clientId: string): Promise<string[]> {
    const links = await this.prisma.trainerClientLink.findMany({
      where: {
        clientId,
        status: TrainerClientLinkStatus.CONFIRMED,
        clientAcceptedAt: { not: null },
      },
      select: { trainerId: true },
    });
    return links.map((l) => l.trainerId);
  }

  async getPendingTrainerRequests(clientId: string) {
    await this.expireStaleInvites();

    const user = await this.prisma.user.findUnique({
      where: { id: clientId },
    });
    if (!user) throw new NotFoundException();

    const phoneNormalized = user.phoneNormalized;

    const [pendingLinks, pendingInvites] = await Promise.all([
      this.prisma.trainerClientLink.findMany({
        where: {
          clientId,
          status: {
            in: [
              TrainerClientLinkStatus.PENDING,
              TrainerClientLinkStatus.CONFIRMED,
            ],
          },
          clientAcceptedAt: null,
        },
        include: { trainer: true },
      }),
      phoneNormalized
        ? this.prisma.trainerClientInvite.findMany({
            where: {
              phoneNormalized,
              status: TrainerClientInviteStatus.PENDING,
              OR: [{ clientId }, { clientId: null }],
            },
            include: { trainer: true },
          })
        : Promise.resolve([]),
    ]);

    const seen = new Set<string>();
    const items: Array<{
      id: string;
      trainerId: string;
      trainerName: string;
      source: 'link' | 'invite';
      highlight: boolean;
    }> = [];

    for (const link of pendingLinks) {
      if (seen.has(link.trainerId)) continue;
      seen.add(link.trainerId);
      items.push({
        id: link.id,
        trainerId: link.trainerId,
        trainerName:
          `${link.trainer.firstName} ${link.trainer.lastName}`.trim(),
        source: 'link',
        highlight: user.createdByTrainerId === link.trainerId,
      });
    }

    for (const invite of pendingInvites) {
      if (seen.has(invite.trainerId)) continue;
      seen.add(invite.trainerId);
      items.push({
        id: invite.id,
        trainerId: invite.trainerId,
        trainerName:
          `${invite.trainer.firstName} ${invite.trainer.lastName}`.trim(),
        source: 'invite',
        highlight: false,
      });
    }

    return items;
  }

  async acceptTrainerRequest(clientId: string, trainerId: string) {
    const now = new Date();

    await this.prisma.trainerClientLink.upsert({
      where: { trainerId_clientId: { trainerId, clientId } },
      create: {
        trainerId,
        clientId,
        status: TrainerClientLinkStatus.CONFIRMED,
        source: TrainerClientSource.INVITE,
        confirmedAt: now,
        clientAcceptedAt: now,
      },
      update: {
        status: TrainerClientLinkStatus.CONFIRMED,
        clientAcceptedAt: now,
        confirmedAt: now,
      },
    });

    const user = await this.prisma.user.findUnique({ where: { id: clientId } });
    if (user?.phoneNormalized) {
      await this.prisma.trainerClientInvite.updateMany({
        where: {
          trainerId,
          phoneNormalized: user.phoneNormalized,
          status: TrainerClientInviteStatus.PENDING,
        },
        data: {
          status: TrainerClientInviteStatus.ACCEPTED,
          clientId,
          respondedAt: now,
        },
      });
    }

    return { success: true };
  }

  async rejectTrainerRequest(clientId: string, trainerId: string) {
    const now = new Date();

    await this.prisma.trainerClientLink.upsert({
      where: { trainerId_clientId: { trainerId, clientId } },
      create: {
        trainerId,
        clientId,
        status: TrainerClientLinkStatus.REJECTED,
        source: TrainerClientSource.INVITE,
      },
      update: {
        status: TrainerClientLinkStatus.REJECTED,
      },
    });

    const user = await this.prisma.user.findUnique({ where: { id: clientId } });
    if (user?.phoneNormalized) {
      await this.prisma.trainerClientInvite.updateMany({
        where: {
          trainerId,
          phoneNormalized: user.phoneNormalized,
          status: TrainerClientInviteStatus.PENDING,
        },
        data: {
          status: TrainerClientInviteStatus.REJECTED,
          clientId,
          respondedAt: now,
        },
      });
    }

    return { success: true };
  }

  async attachPendingInvitesOnActivation(clientId: string, phoneNormalized: string) {
    await this.expireStaleInvites();

    await this.prisma.trainerClientInvite.updateMany({
      where: {
        phoneNormalized,
        status: TrainerClientInviteStatus.PENDING,
        clientId: null,
      },
      data: { clientId },
    });

    const invites = await this.prisma.trainerClientInvite.findMany({
      where: {
        phoneNormalized,
        status: TrainerClientInviteStatus.PENDING,
      },
    });

    for (const invite of invites) {
      const existing = await this.prisma.trainerClientLink.findUnique({
        where: {
          trainerId_clientId: { trainerId: invite.trainerId, clientId },
        },
      });
      if (!existing) {
        await this.prisma.trainerClientLink.create({
          data: {
            trainerId: invite.trainerId,
            clientId,
            status: TrainerClientLinkStatus.PENDING,
            source: TrainerClientSource.INVITE,
          },
        });
      }
    }
  }
}
