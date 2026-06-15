import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BodyLogSource } from '@prisma/client';
import { OsmiCardService } from '../osmi/osmi-card.service';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtPayload } from '../auth/jwt.strategy';
import type {
  CreateBodyLogDto,
  UpdateBodyProfileDto,
  UpdateClientProfileDto,
  UpdateGamificationSettingsDto,
} from './dto/client-profile.dto';

@Injectable()
export class ClientProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly osmiCards: OsmiCardService,
  ) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        gender: true,
        dateOfBirth: true,
        profileCompletedAt: true,
        gamificationNickname: true,
        useRealNameInPublic: true,
        gamificationStartedAt: true,
      },
    });
    if (!user) throw new NotFoundException();
    return {
      ...user,
      dateOfBirth: user.dateOfBirth?.toISOString().slice(0, 10),
      profileCompletedAt: user.profileCompletedAt?.toISOString(),
      gamificationStartedAt: user.gamificationStartedAt?.toISOString(),
    };
  }

  async updateProfile(userId: string, clubId: string, dto: UpdateClientProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        phone: dto.phone.trim(),
        gender: dto.gender,
        dateOfBirth: new Date(dto.dateOfBirth),
        profileCompletedAt: new Date(),
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        gender: true,
        dateOfBirth: true,
        profileCompletedAt: true,
      },
    });

    await this.syncOsmiCardIfEnabled(userId);

    return {
      ...user,
      dateOfBirth: user.dateOfBirth?.toISOString().slice(0, 10),
      profileCompletedAt: user.profileCompletedAt?.toISOString(),
    };
  }

  private async syncOsmiCardIfEnabled(userId: string) {
    if (!this.osmiCards.isEnabled()) return;
    try {
      await this.osmiCards.syncCardForUser(userId);
    } catch {
      // Profile save should succeed even if OSMI is temporarily unavailable
    }
  }

  async updateGamificationSettings(
    userId: string,
    clubId: string,
    dto: UpdateGamificationSettingsDto,
  ) {
    if (dto.gamificationNickname) {
      const taken = await this.prisma.user.findFirst({
        where: {
          clubId,
          gamificationNickname: dto.gamificationNickname.trim(),
          NOT: { id: userId },
        },
      });
      if (taken) throw new ConflictException('Ник уже занят');
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.useRealNameInPublic !== undefined
          ? { useRealNameInPublic: dto.useRealNameInPublic }
          : {}),
        ...(dto.gamificationNickname !== undefined
          ? { gamificationNickname: dto.gamificationNickname.trim() }
          : {}),
      },
      select: {
        gamificationNickname: true,
        useRealNameInPublic: true,
      },
    });
    return user;
  }

  async getBodyProfile(userId: string) {
    const [profile, logs] = await Promise.all([
      this.prisma.clientBodyProfile.findUnique({ where: { userId } }),
      this.prisma.clientBodyLog.findMany({
        where: { clientId: userId },
        orderBy: { recordedAt: 'desc' },
        take: 100,
      }),
    ]);

    return {
      profile: profile ?? { heightCm: null, targetWeightKg: null },
      logs: logs.map((l) => ({
        id: l.id,
        recordedAt: l.recordedAt.toISOString(),
        source: l.source,
        weightKg: l.weightKg,
        chestCm: l.chestCm,
        waistCm: l.waistCm,
        hipsCm: l.hipsCm,
        bicepsCm: l.bicepsCm,
        thighCm: l.thighCm,
        bodyFatPct: l.bodyFatPct,
        notes: l.notes,
      })),
    };
  }

  async updateBodyProfile(userId: string, dto: UpdateBodyProfileDto) {
    return this.prisma.clientBodyProfile.upsert({
      where: { userId },
      update: {
        heightCm: dto.heightCm,
        targetWeightKg: dto.targetWeightKg,
      },
      create: {
        userId,
        heightCm: dto.heightCm,
        targetWeightKg: dto.targetWeightKg,
      },
    });
  }

  async addBodyLog(userId: string, dto: CreateBodyLogDto) {
    const hasData =
      dto.weightKg ||
      dto.chestCm ||
      dto.waistCm ||
      dto.hipsCm ||
      dto.bicepsCm ||
      dto.thighCm ||
      dto.bodyFatPct;
    if (!hasData) throw new BadRequestException('Укажите хотя бы один параметр');

    return this.prisma.clientBodyLog.create({
      data: {
        clientId: userId,
        source: BodyLogSource.CLIENT_SELF,
        weightKg: dto.weightKg,
        chestCm: dto.chestCm,
        waistCm: dto.waistCm,
        hipsCm: dto.hipsCm,
        bicepsCm: dto.bicepsCm,
        thighCm: dto.thighCm,
        bodyFatPct: dto.bodyFatPct,
        notes: dto.notes,
      },
    });
  }
}
