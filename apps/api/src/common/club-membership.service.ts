import { Injectable, NotFoundException } from '@nestjs/common';
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
      },
      create: {
        userId,
        clubId: club.id,
        externalId: resolvedExternalId,
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
