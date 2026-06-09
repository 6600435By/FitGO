import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@fitgo/shared-types';
import { FitnessService } from '../fitness/fitness.service';
import type { JwtPayload } from '../auth/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClientService {
  constructor(
    private readonly fitness: FitnessService,
    private readonly prisma: PrismaService,
  ) {}

  private async resolveExternalId(user: JwtPayload): Promise<string> {
    if (user.externalId) return user.externalId;

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
    });
    if (!dbUser?.externalId) {
      throw new NotFoundException('Клиент не привязан к 1С');
    }
    return dbUser.externalId;
  }

  async getDashboard(user: JwtPayload) {
    const externalId = await this.resolveExternalId(user);
    const provider = this.fitness.getProvider();

    const [membership, visits, accessCard, dbUser] = await Promise.all([
      provider.getMembership(externalId),
      provider.getVisits(externalId),
      provider.getAccessCard(externalId),
      this.prisma.user.findUnique({
        where: { id: user.sub },
        include: { club: true },
      }),
    ]);

    if (!accessCard) {
      throw new NotFoundException('Карта доступа не найдена');
    }

    return {
      profile: {
        id: user.sub,
        externalId,
        clubId: user.clubId,
        email: user.email,
        firstName: dbUser?.firstName ?? '',
        lastName: dbUser?.lastName ?? '',
        phone: dbUser?.phone ?? undefined,
        roles: user.roles,
      },
      membership,
      visits,
      accessCard,
      club: dbUser?.club
        ? {
            id: dbUser.club.id,
            name: dbUser.club.name,
            slug: dbUser.club.slug,
            address: dbUser.club.address ?? undefined,
          }
        : null,
    };
  }

  async getSchedule(user: JwtPayload) {
    const club = await this.prisma.club.findUnique({
      where: { id: user.clubId },
    });
    if (!club?.externalId) {
      throw new NotFoundException('Клуб не привязан к 1С');
    }
    return this.fitness.getProvider().getSchedule(club.externalId);
  }

  async getProducts(user: JwtPayload) {
    const club = await this.prisma.club.findUnique({
      where: { id: user.clubId },
    });
    if (!club?.externalId) {
      throw new NotFoundException('Клуб не привязан к 1С');
    }
    return this.fitness.getProvider().getMembershipProducts(club.externalId);
  }

  async getBookings(user: JwtPayload) {
    const externalId = await this.resolveExternalId(user);
    return this.fitness.getProvider().getBookings(externalId);
  }

  async bookSession(user: JwtPayload, sessionId: string) {
    const externalId = await this.resolveExternalId(user);
    return this.fitness.getProvider().bookSession(externalId, sessionId);
  }

  async cancelBooking(user: JwtPayload, sessionId: string) {
    const externalId = await this.resolveExternalId(user);
    return this.fitness.getProvider().cancelBooking(externalId, sessionId);
  }

  async createPayment(user: JwtPayload, productId: string) {
    const externalId = await this.resolveExternalId(user);
    return this.fitness.getProvider().createPayment(externalId, productId);
  }

  ensureClientRole(user: JwtPayload) {
    if (!user.roles.includes(UserRole.CLIENT)) {
      throw new NotFoundException();
    }
  }
}
