import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '@prisma/client';
import { mkdirSync, writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';

const BIO_MAX = 1000;
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;

@Injectable()
export class StaffProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private uploadsRoot() {
    return (
      this.config.get<string>('UPLOADS_DIR')?.trim() ||
      join(process.cwd(), 'var', 'uploads')
    );
  }

  private staffDir(userId: string) {
    return join(this.uploadsRoot(), 'staff', userId);
  }

  private photoPublicUrl(userId: string, kind: 'full' | 'thumb', v?: Date | null) {
    const q = v ? `?v=${v.getTime()}` : '';
    return `/api/media/staff/${userId}/${kind}.webp${q}`;
  }

  private async ensureStaffUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: true, staffProfile: true },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');
    const roleSet = new Set(user.roles.map((r) => r.role));
    const isStaff =
      roleSet.has(Role.TRAINER) ||
      roleSet.has(Role.SPECIALIST) ||
      roleSet.has(Role.ADMIN) ||
      roleSet.has(Role.MANAGER) ||
      roleSet.has(Role.SUPER_ADMIN);
    if (!isStaff) {
      throw new ForbiddenException('Профиль сотрудника недоступен');
    }
    return user;
  }

  private formatProfile(
    user: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
      phone: string | null;
      groupPrograms: boolean;
      trainerStaff: boolean;
      trainerClub: boolean;
      trainerReformers: boolean;
      employmentKind: string;
      roles: { role: Role }[];
      staffProfile: {
        bio: string;
        photoPath: string | null;
        photoThumbPath: string | null;
        photoUpdatedAt: Date | null;
        bioUpdatedAt: Date | null;
        hiddenByAdminAt: Date | null;
        specializations: string[];
        experienceYears: number | null;
        certificates: unknown;
        onboardedAt: Date | null;
        acceptsClientBookings?: boolean;
      } | null;
    },
    opts?: { forClient?: boolean },
  ) {
    const p = user.staffProfile;
    const hidden = Boolean(p?.hiddenByAdminAt);
    const forClient = opts?.forClient === true;
    const showPublic = !forClient || !hidden;
    return {
      userId: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: forClient ? undefined : user.email,
      phone: forClient ? undefined : (user.phone ?? undefined),
      roles: user.roles.map((r) => r.role),
      groupPrograms: user.groupPrograms,
      trainerStaff: user.trainerStaff,
      trainerClub: user.trainerClub,
      trainerReformers: user.trainerReformers,
      employmentKind: user.employmentKind,
      from1c: true as const,
      bio: showPublic ? (p?.bio ?? '') : '',
      bioUpdatedAt: p?.bioUpdatedAt?.toISOString() ?? null,
      photoUrl:
        showPublic && p?.photoPath
          ? this.photoPublicUrl(user.id, 'full', p.photoUpdatedAt)
          : null,
      photoThumbUrl:
        showPublic && p?.photoThumbPath
          ? this.photoPublicUrl(user.id, 'thumb', p.photoUpdatedAt)
          : null,
      photoUpdatedAt: p?.photoUpdatedAt?.toISOString() ?? null,
      hiddenByAdmin: hidden,
      bioMax: BIO_MAX,
      specializations: showPublic ? (p?.specializations ?? []) : [],
      experienceYears: showPublic ? (p?.experienceYears ?? null) : null,
      certificates: showPublic ? (p?.certificates ?? null) : null,
      onboardedAt: forClient ? null : (p?.onboardedAt?.toISOString() ?? null),
      acceptsClientBookings: forClient
        ? undefined
        : Boolean(p?.acceptsClientBookings),
    };
  }

  async getMine(userId: string) {
    let user = await this.ensureStaffUser(userId);
    if (!user.staffProfile) {
      await this.prisma.staffProfile.create({ data: { userId } });
      user = await this.ensureStaffUser(userId);
    }
    return this.formatProfile(user);
  }

  async updateMine(
    userId: string,
    body: {
      bio?: string;
      specializations?: string[];
      experienceYears?: number | null;
      certificates?: unknown;
      onboardedAt?: string | null | true;
      acceptsClientBookings?: boolean;
    },
  ) {
    const user = await this.ensureStaffUser(userId);
    const data: Prisma.StaffProfileUpdateInput = {};

    if (typeof body.acceptsClientBookings === 'boolean') {
      data.acceptsClientBookings = body.acceptsClientBookings;
    }

    if (typeof body.bio === 'string') {
      const trimmed = body.bio.trim();
      if (trimmed.length > BIO_MAX) {
        throw new BadRequestException(`Описание не длиннее ${BIO_MAX} символов`);
      }
      data.bio = trimmed;
      data.bioUpdatedAt = new Date();
    }

    if (Array.isArray(body.specializations)) {
      data.specializations = body.specializations
        .map((s) => String(s).trim())
        .filter(Boolean)
        .slice(0, 20);
    }

    if (body.experienceYears === null) {
      data.experienceYears = null;
    } else if (typeof body.experienceYears === 'number') {
      if (
        !Number.isFinite(body.experienceYears) ||
        body.experienceYears < 0 ||
        body.experienceYears > 60
      ) {
        throw new BadRequestException('Стаж: от 0 до 60 лет');
      }
      data.experienceYears = Math.round(body.experienceYears);
    }

    if (body.certificates !== undefined) {
      data.certificates =
        body.certificates === null
          ? Prisma.JsonNull
          : (body.certificates as Prisma.InputJsonValue);
    }

    if (body.onboardedAt === true) {
      data.onboardedAt = new Date();
    } else if (body.onboardedAt === null) {
      data.onboardedAt = null;
    } else if (typeof body.onboardedAt === 'string' && body.onboardedAt) {
      const d = new Date(body.onboardedAt);
      if (Number.isNaN(d.getTime())) {
        throw new BadRequestException('Некорректная дата онбординга');
      }
      data.onboardedAt = d;
    }

    if (Object.keys(data).length === 0) {
      return this.getMine(user.id);
    }

    const createData: Prisma.StaffProfileCreateInput = {
      user: { connect: { id: userId } },
      bio: typeof data.bio === 'string' ? data.bio : '',
      bioUpdatedAt:
        data.bioUpdatedAt instanceof Date ? data.bioUpdatedAt : undefined,
      specializations: Array.isArray(data.specializations)
        ? data.specializations
        : [],
      experienceYears:
        typeof data.experienceYears === 'number' ? data.experienceYears : null,
      certificates:
        data.certificates === Prisma.JsonNull
          ? Prisma.JsonNull
          : data.certificates !== undefined
            ? (data.certificates as Prisma.InputJsonValue)
            : undefined,
      onboardedAt: data.onboardedAt instanceof Date ? data.onboardedAt : null,
      acceptsClientBookings:
        typeof data.acceptsClientBookings === 'boolean'
          ? data.acceptsClientBookings
          : false,
    };

    await this.prisma.staffProfile.upsert({
      where: { userId },
      create: createData,
      update: data,
    });
    return this.getMine(user.id);
  }

  /** @deprecated use updateMine — kept for call sites that only patch bio */
  async updateBio(userId: string, bio: string) {
    return this.updateMine(userId, { bio });
  }

  async uploadPhoto(userId: string, buffer: Buffer, mime?: string) {
    await this.ensureStaffUser(userId);
    if (!buffer?.length) throw new BadRequestException('Пустой файл');
    if (buffer.length > PHOTO_MAX_BYTES) {
      throw new BadRequestException('Файл не больше 5 МБ');
    }
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    if (mime && !allowed.includes(mime.toLowerCase())) {
      throw new BadRequestException('Только jpeg, png или webp');
    }

    const dir = this.staffDir(userId);
    mkdirSync(dir, { recursive: true });
    const fullPath = join(dir, 'full.webp');
    const thumbPath = join(dir, 'thumb.webp');

    const full = await sharp(buffer)
      .rotate()
      .resize(800, 800, { fit: 'cover' })
      .webp({ quality: 82 })
      .toBuffer();
    const thumb = await sharp(buffer)
      .rotate()
      .resize(200, 200, { fit: 'cover' })
      .webp({ quality: 80 })
      .toBuffer();

    writeFileSync(fullPath, full);
    writeFileSync(thumbPath, thumb);
    const now = new Date();

    await this.prisma.staffProfile.upsert({
      where: { userId },
      create: {
        userId,
        photoPath: fullPath,
        photoThumbPath: thumbPath,
        photoUpdatedAt: now,
      },
      update: {
        photoPath: fullPath,
        photoThumbPath: thumbPath,
        photoUpdatedAt: now,
      },
    });

    return this.getMine(userId);
  }

  async setHidden(actorClubId: string | null | undefined, userId: string, hidden: boolean, isSuperScope: boolean) {
    const target = await this.ensureStaffUser(userId);
    if (!isSuperScope) {
      if (!actorClubId || target.clubId !== actorClubId) {
        throw new ForbiddenException('Чужой клуб');
      }
    }
    await this.prisma.staffProfile.upsert({
      where: { userId },
      create: {
        userId,
        hiddenByAdminAt: hidden ? new Date() : null,
      },
      update: {
        hiddenByAdminAt: hidden ? new Date() : null,
      },
    });
    return this.getMine(userId);
  }

  async getPublicCard(staffUserId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: staffUserId },
      include: { roles: true, staffProfile: true },
    });
    if (!user) throw new NotFoundException('Сотрудник не найден');
    const roleSet = new Set(user.roles.map((r) => r.role));
    if (!roleSet.has(Role.TRAINER) && !roleSet.has(Role.SPECIALIST)) {
      throw new NotFoundException('Сотрудник не найден');
    }
    return this.formatProfile(user, { forClient: true });
  }

  readMediaFile(userId: string, kind: 'full' | 'thumb'): Buffer | null {
    const path = join(this.staffDir(userId), `${kind}.webp`);
    if (!existsSync(path)) return null;
    return readFileSync(path);
  }

  async deletePhoto(userId: string) {
    await this.ensureStaffUser(userId);
    const dir = this.staffDir(userId);
    for (const name of ['full.webp', 'thumb.webp']) {
      const p = join(dir, name);
      try {
        if (existsSync(p)) unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
    await this.prisma.staffProfile.updateMany({
      where: { userId },
      data: {
        photoPath: null,
        photoThumbPath: null,
        photoUpdatedAt: null,
      },
    });
    return this.getMine(userId);
  }
}
