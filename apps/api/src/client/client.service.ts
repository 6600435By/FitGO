import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@fitgo/shared-types';
import { FitnessService } from '../fitness/fitness.service';
import { PersonalTrainingService } from '../personal-training/personal-training.service';
import type { JwtPayload } from '../auth/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClientService {
  constructor(
    private readonly fitness: FitnessService,
    private readonly prisma: PrismaService,
    private readonly personalTraining: PersonalTrainingService,
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

  private async getBookingContext(user: JwtPayload) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
    });
    return {
      phone: dbUser?.phone ?? undefined,
      name: dbUser
        ? `${dbUser.firstName} ${dbUser.lastName}`.trim()
        : undefined,
    };
  }

  async getDashboard(user: JwtPayload) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
      include: { club: true },
    });
    const externalId = user.externalId ?? dbUser?.externalId ?? undefined;
    const provider = this.fitness.getProvider();

    const [membership, visits, accessCard] = await Promise.all([
      externalId
        ? provider.getMembership(externalId)
        : Promise.resolve(null),
      externalId ? provider.getVisits(externalId) : Promise.resolve([]),
      externalId
        ? provider.getAccessCard(externalId)
        : Promise.resolve(null),
    ]);

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
    const context = await this.getBookingContext(user);
    const personalBookings =
      await this.personalTraining.getClientPersonalBookings(user);
    const personalItems =
      this.personalTraining.toBookingItems(personalBookings);

    try {
      const externalId = await this.resolveExternalId(user);
      const oneCBookings = await this.fitness
        .getProvider()
        .getBookings(externalId, context);
      return [...oneCBookings, ...personalItems].sort((a, b) =>
        a.startAt.localeCompare(b.startAt),
      );
    } catch {
      return personalItems;
    }
  }

  async bookSession(user: JwtPayload, sessionId: string) {
    const context = await this.getBookingContext(user);
    const externalId = user.externalId ?? user.sub;
    return this.fitness
      .getProvider()
      .bookSession(externalId, sessionId, context);
  }

  async cancelBooking(user: JwtPayload, sessionId: string) {
    const context = await this.getBookingContext(user);
    const externalId = user.externalId ?? user.sub;
    return this.fitness
      .getProvider()
      .cancelBooking(externalId, sessionId, context);
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
