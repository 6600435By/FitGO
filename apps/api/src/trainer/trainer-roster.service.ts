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
import { ClientPhoneLookupService } from '../common/client-phone-lookup.service';
import {
  normalizePhone,
  shadowEmailForPhone,
} from '../common/phone.util';
import type { JwtPayload } from '../auth/jwt.strategy';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

export const INVITE_GENERIC_MESSAGE =
  'Приглашение отправлено. Клиент должен подтвердить в приложении.';

function parseMembershipStatus(
  raw: string | null | undefined,
): MembershipStatus | undefined {
  if (!raw) return undefined;
  const u = raw.trim().toUpperCase();
  if (u === 'ACTIVE' || u === 'АКТИВНЫЙ' || u === 'ДЕЙСТВУЕТ') {
    return MembershipStatus.ACTIVE;
  }
  if (u === 'EXPIRED' || u === 'ИСТЁК' || u === 'ИСТЕК' || u === 'ЗАВЕРШЕН') {
    return MembershipStatus.EXPIRED;
  }
  if (u === 'FROZEN' || u === 'ЗАМОРОЖЕН' || u === 'ЗАМОРОЗКА') {
    return MembershipStatus.FROZEN;
  }
  if (u === 'PENDING' || u === 'ОЖИДАНИЕ') {
    return MembershipStatus.PENDING;
  }
  // Snapshots often store English enum already
  if ((Object.values(MembershipStatus) as string[]).includes(u)) {
    return u as MembershipStatus;
  }
  return undefined;
}

function sumRemainingSessions(servicesJson: unknown): number | undefined {
  if (!Array.isArray(servicesJson) || servicesJson.length === 0) return undefined;
  let sum = 0;
  let any = false;
  for (const row of servicesJson) {
    if (!row || typeof row !== 'object') continue;
    const rem = (row as { remaining?: unknown }).remaining;
    if (typeof rem === 'number' && Number.isFinite(rem)) {
      sum += rem;
      any = true;
    }
  }
  return any ? sum : undefined;
}

@Injectable()
export class TrainerRosterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly phoneLookup: ClientPhoneLookupService,
  ) {}

  /** Confirm roster link for assign/timesheet without waiting for app accept. */
  async upsertConfirmedManualLink(trainerId: string, clientId: string) {
    await this.prisma.trainerClientLink.upsert({
      where: {
        trainerId_clientId: { trainerId, clientId },
      },
      create: {
        trainerId,
        clientId,
        status: TrainerClientLinkStatus.CONFIRMED,
        source: TrainerClientSource.MANUAL,
        confirmedAt: new Date(),
      },
      update: {
        status: TrainerClientLinkStatus.CONFIRMED,
        confirmedAt: new Date(),
      },
    });
  }

  /**
   * Resolve client for PT assign: existing clientId, or guest phone+FIO
   * (lookup → link found / create offline with «нет в 1С»).
   */
  async resolveClientForAssign(
    trainerId: string,
    actor: JwtPayload,
    input: {
      clientId?: string | null;
      phone?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      clientExternalId?: string | null;
    },
  ): Promise<string> {
    const clientId = input.clientId?.trim();
    if (clientId) {
      await this.ensureConfirmedLink(trainerId, clientId);
      return clientId;
    }

    const phoneRaw = input.phone?.trim() ?? '';
    const phoneNormalized = normalizePhone(phoneRaw);
    if (phoneNormalized.length < 9) {
      throw new BadRequestException(
        'Укажите клиента из базы или телефон с именем и фамилией',
      );
    }

    let firstName = (input.firstName ?? '').trim();
    let lastName = (input.lastName ?? '').trim();
    let externalId = input.clientExternalId?.trim() || undefined;

    const found = await this.phoneLookup.lookupByPhone(actor, phoneRaw);
    if (found.clientId) {
      await this.upsertConfirmedManualLink(trainerId, found.clientId);
      if (found.externalId) {
        const u = await this.prisma.user.findUnique({
          where: { id: found.clientId },
          select: { externalId: true },
        });
        if (u && !u.externalId) {
          await this.prisma.user.update({
            where: { id: found.clientId },
            data: { externalId: found.externalId },
          });
        }
      }
      return found.clientId;
    }

    if (found.found) {
      externalId = externalId || found.externalId;
      if (!firstName && found.firstName) firstName = found.firstName.trim();
      if (!lastName && found.lastName) lastName = found.lastName.trim();
    }

    if (!firstName || !lastName) {
      throw new BadRequestException(
        'Клиент не найден — введите имя и фамилию для записи гостя',
      );
    }

    const created = await this.addOfflineClient(trainerId, {
      firstName,
      lastName,
      phone: phoneRaw,
      clientExternalId: externalId,
      notes: externalId ? undefined : 'нет в 1С',
    });

    if ('id' in created && created.id) {
      return created.id;
    }

    // Existing app user without usable link — link manually (same as timesheet).
    const existing = await this.prisma.user.findFirst({
      where: { phoneNormalized },
      select: { id: true },
    });
    if (!existing) {
      throw new BadRequestException(
        'Не удалось создать клиента для записи',
      );
    }
    await this.upsertConfirmedManualLink(trainerId, existing.id);
    return existing.id;
  }

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

    // Membership + last visit from Postgres snapshots (club-sync), not live 1C.
    const memberships = clubId
      ? await this.prisma.userClubMembership.findMany({
          where: {
            clubId,
            leftAt: null,
            userId: { in: links.map((l) => l.clientId) },
          },
          select: { userId: true, externalId: true },
        })
      : [];
    const extByUser = new Map(
      memberships.map((m) => [m.userId, m.externalId ?? null]),
    );
    const externalIds = [
      ...new Set(
        links
          .map(
            (l) =>
              extByUser.get(l.clientId) ?? l.client.externalId ?? null,
          )
          .filter((id): id is string => Boolean(id)),
      ),
    ];

        const snapshots =
      clubId && externalIds.length
        ? await this.prisma.clubMembershipSnapshot.findMany({
            where: { clubId, clientExternalId: { in: externalIds } },
            select: {
              clientExternalId: true,
              packageName: true,
              status: true,
              endDate: true,
              servicesJson: true,
            },
          })
        : [];
    const snapByExt = new Map(
      snapshots.map((s) => [s.clientExternalId, s]),
    );

    const clientIds = links.map((l) => l.clientId);
    const recentBookings =
      clientIds.length > 0
        ? await this.prisma.personalTrainingBooking.findMany({
            where: {
              trainerId,
              clientId: { in: clientIds },
              OR: [
                { status: 'CANCELLED' },
                { usageStatus: { in: ['NO_SHOW', 'CANCELLED'] } },
              ],
              startAt: {
                gte: new Date(Date.now() - 90 * 24 * 60 * 60_000),
              },
            },
            select: { clientId: true },
          })
        : [];
    const cancelNoShowByClient = new Map<string, number>();
    for (const b of recentBookings) {
      if (!b.clientId) continue;
      cancelNoShowByClient.set(
        b.clientId,
        (cancelNoShowByClient.get(b.clientId) ?? 0) + 1,
      );
    }

    const lastVisits =
      clubId && externalIds.length
        ? await this.prisma.clubHallVisit.findMany({
            where: {
              clubId,
              isActive: true,
              clientExternalId: { in: externalIds },
            },
            orderBy: { visitDate: 'desc' },
            distinct: ['clientExternalId'],
            select: { clientExternalId: true, visitDate: true },
          })
        : [];
    const visitByExt = new Map(
      lastVisits
        .filter((v) => v.clientExternalId)
        .map((v) => [v.clientExternalId!, v.visitDate]),
    );

    const userIdsNeedingVisit = links
      .filter((l) => {
        const ext =
          extByUser.get(l.clientId) ?? l.client.externalId ?? null;
        return !ext || !visitByExt.has(ext);
      })
      .map((l) => l.clientId);
    const clubVisits =
      clubId && userIdsNeedingVisit.length
        ? await this.prisma.clubVisit.findMany({
            where: {
              clubId,
              userId: { in: userIdsNeedingVisit },
            },
            orderBy: { visitedAt: 'desc' },
            distinct: ['userId'],
            select: { userId: true, visitDate: true },
          })
        : [];
    const visitByUser = new Map(clubVisits.map((v) => [v.userId, v.visitDate]));

    return links.map((link) => {
      const client = link.client;
      const externalId =
        extByUser.get(client.id) ?? client.externalId ?? undefined;
      const snap = externalId ? snapByExt.get(externalId) : undefined;
      const lastVisit =
        (externalId ? visitByExt.get(externalId) : undefined) ??
        visitByUser.get(client.id);

      const hallVisit = externalId ? visitByExt.get(externalId) : undefined;
      return {
        id: client.id,
        externalId: client.externalId ?? undefined,
        firstName: client.firstName,
        lastName: client.lastName,
        phone: client.phone ?? undefined,
        dateOfBirth: client.dateOfBirth
          ? client.dateOfBirth.toISOString().slice(0, 10)
          : undefined,
        membershipName: snap?.packageName ?? undefined,
        membershipStatus: parseMembershipStatus(snap?.status),
        membershipValidUntil: snap?.endDate ?? undefined,
        sessionsRemaining: sumRemainingSessions(snap?.servicesJson),
        lastVisit,
        lastHallVisit: hallVisit
          ? String(hallVisit).slice(0, 10)
          : undefined,
        cancelNoShowCount: cancelNoShowByClient.get(client.id) ?? 0,
        rosterStatus: link.status,
        rosterNotes: link.notes ?? undefined,
        hasApp: client.accountStatus === AccountStatus.ACTIVE,
        clientAccepted: link.clientAcceptedAt != null,
        inRosterSince: link.createdAt.toISOString(),
        source: link.source,
      };
    });
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
    dto: {
      firstName: string;
      lastName: string;
      phone: string;
      notes?: string;
      clientExternalId?: string;
    },
  ) {
    const phoneNormalized = normalizePhone(dto.phone);
    if (phoneNormalized.length < 9) {
      throw new BadRequestException('Некорректный номер телефона');
    }

    const externalId = dto.clientExternalId?.trim() || undefined;
    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();
    const now = new Date();

    const existing = await this.prisma.user.findFirst({
      where: { phoneNormalized },
    });

    if (existing) {
      const userPatch: {
        externalId?: string;
        firstName?: string;
        lastName?: string;
      } = {};
      if (externalId && !existing.externalId) userPatch.externalId = externalId;
      if (firstName && existing.firstName !== firstName) {
        userPatch.firstName = firstName;
      }
      if (lastName && existing.lastName !== lastName) {
        userPatch.lastName = lastName;
      }
      if (Object.keys(userPatch).length > 0) {
        await this.prisma.user.update({
          where: { id: existing.id },
          data: userPatch,
        });
      }

      const link = await this.prisma.trainerClientLink.upsert({
        where: {
          trainerId_clientId: { trainerId, clientId: existing.id },
        },
        create: {
          trainerId,
          clientId: existing.id,
          status: TrainerClientLinkStatus.CONFIRMED,
          source: TrainerClientSource.MANUAL,
          notes: dto.notes,
          confirmedAt: now,
          clientAcceptedAt: now,
        },
        update: {
          status: TrainerClientLinkStatus.CONFIRMED,
          source: TrainerClientSource.MANUAL,
          notes: dto.notes ?? undefined,
          confirmedAt: now,
          clientAcceptedAt: now,
        },
      });

      return {
        id: existing.id,
        firstName: userPatch.firstName ?? existing.firstName,
        lastName: userPatch.lastName ?? existing.lastName,
        phone: existing.phone ?? undefined,
        externalId: userPatch.externalId ?? existing.externalId ?? externalId,
        rosterStatus: TrainerClientLinkStatus.CONFIRMED,
        hasApp: existing.accountStatus === AccountStatus.ACTIVE,
        clientAccepted: true,
        inRosterSince: link.createdAt.toISOString(),
        source: TrainerClientSource.MANUAL,
      };
    }

    const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);

    const client = await this.prisma.user.create({
      data: {
        email: shadowEmailForPhone(phoneNormalized),
        password: passwordHash,
        firstName,
        lastName,
        phone: dto.phone.trim(),
        phoneNormalized,
        externalId,
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
        confirmedAt: now,
        clientAcceptedAt: now,
      },
    });

    return {
      id: client.id,
      firstName: client.firstName,
      lastName: client.lastName,
      phone: client.phone ?? undefined,
      externalId: client.externalId ?? undefined,
      rosterStatus: TrainerClientLinkStatus.CONFIRMED,
      hasApp: false,
      clientAccepted: true,
      inRosterSince: now.toISOString(),
      source: TrainerClientSource.MANUAL,
    };
  }

  async updateClient(
    trainerId: string,
    clientId: string,
    dto: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      notes?: string;
    },
  ) {
    const link = await this.prisma.trainerClientLink.findUnique({
      where: { trainerId_clientId: { trainerId, clientId } },
      include: { client: true },
    });
    if (!link || link.status === TrainerClientLinkStatus.REJECTED) {
      throw new ForbiddenException('Клиент не в вашей базе');
    }

    const client = link.client;
    const userPatch: {
      firstName?: string;
      lastName?: string;
      phone?: string;
      phoneNormalized?: string;
      email?: string;
    } = {};

    if (dto.firstName !== undefined) {
      const firstName = dto.firstName.trim();
      if (!firstName) throw new BadRequestException('Укажите имя');
      if (firstName !== client.firstName) userPatch.firstName = firstName;
    }
    if (dto.lastName !== undefined) {
      const lastName = dto.lastName.trim();
      if (!lastName) throw new BadRequestException('Укажите фамилию');
      if (lastName !== client.lastName) userPatch.lastName = lastName;
    }

    if (dto.phone !== undefined) {
      const phoneTrimmed = dto.phone.trim();
      const phoneNormalized = normalizePhone(phoneTrimmed);
      if (phoneNormalized.length < 9) {
        throw new BadRequestException('Некорректный номер телефона');
      }
      if (phoneNormalized !== (client.phoneNormalized ?? '')) {
        const conflict = await this.prisma.user.findFirst({
          where: {
            phoneNormalized,
            NOT: { id: clientId },
          },
          select: { id: true },
        });
        if (conflict) {
          throw new ConflictException(
            'Этот номер уже занят другим клиентом в FitGO',
          );
        }
        userPatch.phone = phoneTrimmed;
        userPatch.phoneNormalized = phoneNormalized;
        if (client.accountStatus === AccountStatus.SHADOW) {
          userPatch.email = shadowEmailForPhone(phoneNormalized);
        }
      }
    }

    if (Object.keys(userPatch).length > 0) {
      await this.prisma.user.update({
        where: { id: clientId },
        data: userPatch,
      });
    }

    const linkPatch: { notes?: string | null } = {};
    if (dto.notes !== undefined) {
      const notes = dto.notes.trim();
      linkPatch.notes = notes.length > 0 ? notes : null;
    }
    if (Object.keys(linkPatch).length > 0) {
      await this.prisma.trainerClientLink.update({
        where: { id: link.id },
        data: linkPatch,
      });
    }

    const updated = await this.prisma.user.findUniqueOrThrow({
      where: { id: clientId },
    });
    const updatedLink = await this.prisma.trainerClientLink.findUniqueOrThrow({
      where: { id: link.id },
    });

    return {
      id: updated.id,
      firstName: updated.firstName,
      lastName: updated.lastName,
      phone: updated.phone ?? undefined,
      externalId: updated.externalId ?? undefined,
      rosterNotes: updatedLink.notes ?? undefined,
      rosterStatus: updatedLink.status,
      hasApp: updated.accountStatus === AccountStatus.ACTIVE,
      clientAccepted: updatedLink.clientAcceptedAt != null,
      inRosterSince: updatedLink.createdAt.toISOString(),
      source: updatedLink.source,
    };
  }

  /**
   * Remove client from trainer roster. Shadow guests created by this trainer
   * with no other links/bookings are deleted; app accounts are only unlinked.
   */
  async removeClient(trainerId: string, clientId: string) {
    const link = await this.prisma.trainerClientLink.findUnique({
      where: { trainerId_clientId: { trainerId, clientId } },
      include: { client: true },
    });
    if (!link) {
      throw new NotFoundException('Клиент не в вашей базе');
    }

    const phoneNormalized = link.client.phoneNormalized;
    await this.prisma.trainerClientLink.delete({ where: { id: link.id } });

    if (phoneNormalized) {
      await this.prisma.trainerClientInvite.updateMany({
        where: {
          trainerId,
          phoneNormalized,
          status: TrainerClientInviteStatus.PENDING,
        },
        data: {
          status: TrainerClientInviteStatus.REJECTED,
          clientId,
          respondedAt: new Date(),
        },
      });
    }

    const client = link.client;
    let deletedUser = false;
    if (
      client.accountStatus === AccountStatus.SHADOW &&
      client.createdByTrainerId === trainerId
    ) {
      const [otherLinks, bookings] = await Promise.all([
        this.prisma.trainerClientLink.count({ where: { clientId } }),
        this.prisma.personalTrainingBooking.count({ where: { clientId } }),
      ]);
      if (otherLinks === 0 && bookings === 0) {
        await this.prisma.user.delete({ where: { id: clientId } });
        deletedUser = true;
      }
    }

    return { success: true as const, deletedUser };
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

    if (!existingUser || existingUser.accountStatus !== AccountStatus.ACTIVE) {
      return {
        message:
          'У клиента нет приложения Forma. Используйте «Добавить» — клиент попадёт в базу сразу, без подтверждения.',
      };
    }

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
