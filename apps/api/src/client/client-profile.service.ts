import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BodyLogSource,
  ExperienceLevel,
  PreferredIntensity,
  PreferredTimeOfDay,
  type ClientTrainingProfile as PrismaTrainingProfile,
} from '@prisma/client';
import {
  emptyTrainingProfile,
  type ClientTrainingProfile,
} from '@fitgo/shared-types';
import { OsmiCardService } from '../osmi/osmi-card.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateBodyLogDto,
  UpdateBodyLogDto,
  UpdateBodyProfileDto,
  UpdateClientProfileDto,
  UpdateGamificationSettingsDto,
  UpdateTrainingProfileDto,
} from './dto/client-profile.dto';

function mapTrainingProfile(
  row: PrismaTrainingProfile | null,
): ClientTrainingProfile {
  if (!row) return emptyTrainingProfile();
  return {
    primaryGoals: row.primaryGoals as ClientTrainingProfile['primaryGoals'],
    goalNotes: row.goalNotes,
    goalHorizonWeeks: row.goalHorizonWeeks,
    experienceLevel: row.experienceLevel as ClientTrainingProfile['experienceLevel'],
    yearsTraining: row.yearsTraining,
    sessionsPerWeek: row.sessionsPerWeek,
    preferredModalities:
      row.preferredModalities as ClientTrainingProfile['preferredModalities'],
    limitations: row.limitations as ClientTrainingProfile['limitations'],
    limitationNotes: row.limitationNotes,
    pregnancyFlag: row.pregnancyFlag,
    bloodPressureFlag: row.bloodPressureFlag,
    preferredSessionMin: row.preferredSessionMin,
    homeEquipment: row.homeEquipment as ClientTrainingProfile['homeEquipment'],
    preferredTimeOfDay:
      row.preferredTimeOfDay as ClientTrainingProfile['preferredTimeOfDay'],
    preferredIntensity:
      row.preferredIntensity as ClientTrainingProfile['preferredIntensity'],
    updatedAt: row.updatedAt.toISOString(),
  };
}

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
        trainingProfile: true,
      },
    });
    if (!user) throw new NotFoundException();
    const { trainingProfile, ...rest } = user;
    return {
      ...rest,
      dateOfBirth: user.dateOfBirth?.toISOString().slice(0, 10),
      profileCompletedAt: user.profileCompletedAt?.toISOString(),
      gamificationStartedAt: user.gamificationStartedAt?.toISOString(),
      training: mapTrainingProfile(trainingProfile),
    };
  }

  async updateProfile(userId: string, clubId: string, dto: UpdateClientProfileDto) {
    void clubId;
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

  async getTrainingProfile(userId: string) {
    const row = await this.prisma.clientTrainingProfile.findUnique({
      where: { userId },
    });
    return mapTrainingProfile(row);
  }

  async updateTrainingProfile(userId: string, dto: UpdateTrainingProfileDto) {
    const limitations = dto.limitations;
    if (limitations?.includes('NONE') && limitations.length > 1) {
      throw new BadRequestException(
        'Нельзя совмещать «Нет ограничений» с другими зонами',
      );
    }

    const data = {
      ...(dto.primaryGoals !== undefined ? { primaryGoals: dto.primaryGoals } : {}),
      ...(dto.goalNotes !== undefined ? { goalNotes: dto.goalNotes.trim() || null } : {}),
      ...(dto.goalHorizonWeeks !== undefined
        ? { goalHorizonWeeks: dto.goalHorizonWeeks }
        : {}),
      ...(dto.experienceLevel !== undefined
        ? {
            experienceLevel: dto.experienceLevel
              ? (dto.experienceLevel as ExperienceLevel)
              : null,
          }
        : {}),
      ...(dto.yearsTraining !== undefined ? { yearsTraining: dto.yearsTraining } : {}),
      ...(dto.sessionsPerWeek !== undefined
        ? { sessionsPerWeek: dto.sessionsPerWeek }
        : {}),
      ...(dto.preferredModalities !== undefined
        ? { preferredModalities: dto.preferredModalities }
        : {}),
      ...(dto.limitations !== undefined ? { limitations: dto.limitations } : {}),
      ...(dto.limitationNotes !== undefined
        ? { limitationNotes: dto.limitationNotes.trim() || null }
        : {}),
      ...(dto.pregnancyFlag !== undefined
        ? { pregnancyFlag: dto.pregnancyFlag }
        : {}),
      ...(dto.bloodPressureFlag !== undefined
        ? { bloodPressureFlag: dto.bloodPressureFlag }
        : {}),
      ...(dto.preferredSessionMin !== undefined
        ? { preferredSessionMin: dto.preferredSessionMin }
        : {}),
      ...(dto.homeEquipment !== undefined ? { homeEquipment: dto.homeEquipment } : {}),
      ...(dto.preferredTimeOfDay !== undefined
        ? {
            preferredTimeOfDay: dto.preferredTimeOfDay
              ? (dto.preferredTimeOfDay as PreferredTimeOfDay)
              : null,
          }
        : {}),
      ...(dto.preferredIntensity !== undefined
        ? {
            preferredIntensity: dto.preferredIntensity
              ? (dto.preferredIntensity as PreferredIntensity)
              : null,
          }
        : {}),
    };

    const row = await this.prisma.clientTrainingProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return mapTrainingProfile(row);
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
      logs: logs.map((l) => this.mapBodyLog(l)),
    };
  }

  async updateBodyProfile(userId: string, dto: UpdateBodyProfileDto) {
    const data = {
      ...(dto.heightCm !== undefined ? { heightCm: dto.heightCm } : {}),
      ...(dto.targetWeightKg !== undefined
        ? { targetWeightKg: dto.targetWeightKg }
        : {}),
    };
    return this.prisma.clientBodyProfile.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
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

  private mapBodyLog(l: {
    id: string;
    recordedAt: Date;
    source: BodyLogSource;
    weightKg: number | null;
    chestCm: number | null;
    waistCm: number | null;
    hipsCm: number | null;
    bicepsCm: number | null;
    thighCm: number | null;
    bodyFatPct: number | null;
    notes: string | null;
  }) {
    return {
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
    };
  }

  async updateBodyLog(userId: string, logId: string, dto: UpdateBodyLogDto) {
    const existing = await this.prisma.clientBodyLog.findFirst({
      where: { id: logId, clientId: userId },
    });
    if (!existing) throw new NotFoundException('Запись не найдена');

    const data = {
      ...(dto.weightKg !== undefined ? { weightKg: dto.weightKg } : {}),
      ...(dto.chestCm !== undefined ? { chestCm: dto.chestCm } : {}),
      ...(dto.waistCm !== undefined ? { waistCm: dto.waistCm } : {}),
      ...(dto.hipsCm !== undefined ? { hipsCm: dto.hipsCm } : {}),
      ...(dto.bicepsCm !== undefined ? { bicepsCm: dto.bicepsCm } : {}),
      ...(dto.thighCm !== undefined ? { thighCm: dto.thighCm } : {}),
      ...(dto.bodyFatPct !== undefined ? { bodyFatPct: dto.bodyFatPct } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    };

    const next = {
      weightKg: data.weightKg !== undefined ? data.weightKg : existing.weightKg,
      chestCm: data.chestCm !== undefined ? data.chestCm : existing.chestCm,
      waistCm: data.waistCm !== undefined ? data.waistCm : existing.waistCm,
      hipsCm: data.hipsCm !== undefined ? data.hipsCm : existing.hipsCm,
      bicepsCm: data.bicepsCm !== undefined ? data.bicepsCm : existing.bicepsCm,
      thighCm: data.thighCm !== undefined ? data.thighCm : existing.thighCm,
      bodyFatPct:
        data.bodyFatPct !== undefined ? data.bodyFatPct : existing.bodyFatPct,
    };
    const hasData = Object.values(next).some((v) => v != null);
    if (!hasData) {
      throw new BadRequestException('Укажите хотя бы один параметр');
    }

    const updated = await this.prisma.clientBodyLog.update({
      where: { id: logId },
      data,
    });
    return this.mapBodyLog(updated);
  }

  async deleteBodyLog(userId: string, logId: string) {
    const existing = await this.prisma.clientBodyLog.findFirst({
      where: { id: logId, clientId: userId },
    });
    if (!existing) throw new NotFoundException('Запись не найдена');
    await this.prisma.clientBodyLog.delete({ where: { id: logId } });
    return { ok: true };
  }

  /** Snapshot for trainer client card. */
  async getQuestionnaireForTrainer(clientId: string) {
    const [training, body, latestLog] = await Promise.all([
      this.prisma.clientTrainingProfile.findUnique({ where: { userId: clientId } }),
      this.prisma.clientBodyProfile.findUnique({ where: { userId: clientId } }),
      this.prisma.clientBodyLog.findFirst({
        where: { clientId, weightKg: { not: null } },
        orderBy: { recordedAt: 'desc' },
      }),
    ]);

    return {
      training: mapTrainingProfile(training),
      body: {
        heightCm: body?.heightCm ?? null,
        targetWeightKg: body?.targetWeightKg ?? null,
        latestWeightKg: latestLog?.weightKg ?? null,
        latestLoggedAt: latestLog?.recordedAt.toISOString() ?? null,
      },
    };
  }
}
