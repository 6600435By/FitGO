import { Injectable, NotFoundException } from '@nestjs/common';
import { ClubCrmLinkStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClubMembershipService {
  constructor(private readonly prisma: PrismaService) {}

  getActiveMembership(userId: string) {
    return this.prisma.userClubMembership.findFirst({
      where: { userId, leftAt: null },
      include: { club: true },
      orderBy: { joinedAt: 'desc' },
    });
  }

  async resolveActiveClubId(userId: string, storedClubId?: string | null) {
    const membership = await this.getActiveMembership(userId);
    const clubId = membership?.clubId ?? storedClubId ?? null;

    if (clubId && storedClubId !== clubId) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { clubId },
      });
    }

    return clubId ?? undefined;
  }

  resolveExternalId(
    membership: { externalId: string | null } | null,
    userExternalId?: string | null,
  ): string | undefined {
    return membership?.externalId ?? userExternalId ?? undefined;
  }

  async joinClub(userId: string, clubSlug: string, externalId?: string) {
    const club = await this.prisma.club.findUnique({
      where: { slug: clubSlug },
    });
    if (!club) {
      throw new NotFoundException('Клуб не найден');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const resolvedExternalId = externalId ?? user?.externalId ?? undefined;

    await this.prisma.userClubMembership.updateMany({
      where: { userId, leftAt: null, clubId: { not: club.id } },
      data: { leftAt: new Date() },
    });

    const membership = await this.prisma.userClubMembership.upsert({
      where: { userId_clubId: { userId, clubId: club.id } },
      update: {
        leftAt: null,
        externalId: resolvedExternalId,
        crmStatus: resolvedExternalId
          ? ClubCrmLinkStatus.LINKED
          : ClubCrmLinkStatus.PENDING_CRM,
        lastCrmSyncAt: resolvedExternalId ? new Date() : null,
      },
      create: {
        userId,
        clubId: club.id,
        externalId: resolvedExternalId,
        crmStatus: resolvedExternalId
          ? ClubCrmLinkStatus.LINKED
          : ClubCrmLinkStatus.PENDING_CRM,
        lastCrmSyncAt: resolvedExternalId ? new Date() : null,
      },
      include: { club: true },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { clubId: club.id },
    });

    return membership;
  }
}
