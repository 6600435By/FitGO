import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
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
      employmentKind: string;
      roles: { role: Role }[];
      staffProfile: {
        bio: string;
        photoPath: string | null;
        photoThumbPath: string | null;
        photoUpdatedAt: Date | null;
        bioUpdatedAt: Date | null;
        hiddenByAdminAt: Date | null;
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

  async updateBio(userId: string, bio: string) {
    const user = await this.ensureStaffUser(userId);
    const trimmed = (bio ?? '').trim();
    if (trimmed.length > BIO_MAX) {
      throw new BadRequestException(`Описание не длиннее ${BIO_MAX} символов`);
    }
    const profile = await this.prisma.staffProfile.upsert({
      where: { userId },
      create: {
        userId,
        bio: trimmed,
        bioUpdatedAt: new Date(),
      },
      update: {
        bio: trimmed,
        bioUpdatedAt: new Date(),
      },
    });
    void profile;
    return this.getMine(user.id);
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
