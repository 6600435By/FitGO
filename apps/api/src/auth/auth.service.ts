import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole as SharedUserRole } from '@fitgo/shared-types';
import * as bcrypt from 'bcryptjs';
import { AccountStatus, Role } from '@prisma/client';
import { normalizePhone } from '../common/phone.util';
import { PrismaService } from '../prisma/prisma.service';
import { TrainerRosterService } from '../trainer/trainer-roster.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

const ROLE_MAP: Record<Role, SharedUserRole> = {
  [Role.CLIENT]: SharedUserRole.CLIENT,
  [Role.TRAINER]: SharedUserRole.TRAINER,
  [Role.ADMIN]: SharedUserRole.ADMIN,
  [Role.SUPER_ADMIN]: SharedUserRole.SUPER_ADMIN,
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly roster: TrainerRosterService,
  ) {}

  private formatUserResponse(user: {
    id: string;
    externalId: string | null;
    clubId: string | null;
    email: string;
    phone: string | null;
    firstName: string;
    lastName: string;
    roles: { role: Role }[];
    club: {
      id: string;
      name: string;
      slug: string;
      address: string | null;
    } | null;
  }) {
    const roles = user.roles.map((r) => ROLE_MAP[r.role]);
    return {
      id: user.id,
      externalId: user.externalId ?? undefined,
      clubId: user.clubId ?? undefined,
      email: user.email,
      phone: user.phone ?? undefined,
      firstName: user.firstName,
      lastName: user.lastName,
      roles,
      club: user.club
        ? {
            id: user.club.id,
            name: user.club.name,
            slug: user.club.slug,
            address: user.club.address ?? undefined,
          }
        : undefined,
    };
  }

  private async signToken(user: {
    id: string;
    email: string;
    clubId: string | null;
    externalId: string | null;
    roles: { role: Role }[];
  }) {
    const roles = user.roles.map((r) => ROLE_MAP[r.role]);
    const payload = {
      sub: user.id,
      email: user.email,
      clubId: user.clubId ?? undefined,
      roles,
      externalId: user.externalId ?? undefined,
    };
    const accessToken = await this.jwtService.signAsync(payload);
    return { accessToken, roles };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email },
      include: {
        roles: true,
        club: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Неверный email или пароль');
    }

    if (user.accountStatus === AccountStatus.SHADOW) {
      throw new UnauthorizedException(
        'Аккаунт ещё не активирован. Зарегистрируйтесь в приложении.',
      );
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Аккаунт деактивирован');
    }

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) {
      throw new UnauthorizedException('Неверный email или пароль');
    }

    const { accessToken } = await this.signToken(user);

    return {
      accessToken,
      user: this.formatUserResponse(user),
    };
  }

  async register(dto: RegisterDto) {
    const phoneNormalized = normalizePhone(dto.phone);
    if (phoneNormalized.length < 9) {
      throw new ConflictException('Некорректный номер телефона');
    }

    const emailTaken = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (emailTaken && emailTaken.accountStatus !== AccountStatus.SHADOW) {
      throw new ConflictException('Email уже используется');
    }

    const activeByPhone = await this.prisma.user.findFirst({
      where: {
        phoneNormalized,
        accountStatus: AccountStatus.ACTIVE,
        NOT: emailTaken ? { id: emailTaken.id } : undefined,
      },
    });
    if (activeByPhone) {
      throw new ConflictException(
        'Номер уже зарегистрирован. Войдите в существующий аккаунт.',
      );
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const now = new Date();

    let userId: string;

    const shadow = await this.prisma.user.findFirst({
      where: { phoneNormalized, accountStatus: AccountStatus.SHADOW },
    });

    if (shadow) {
      const updated = await this.prisma.user.update({
        where: { id: shadow.id },
        data: {
          email: dto.email,
          password: passwordHash,
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          phone: dto.phone.trim(),
          phoneNormalized,
          accountStatus: AccountStatus.ACTIVE,
          activatedAt: now,
        },
        include: { roles: true, club: true },
      });
      userId = updated.id;

      const hasClientRole = updated.roles.some((r) => r.role === Role.CLIENT);
      if (!hasClientRole) {
        await this.prisma.userRole.create({
          data: { userId: updated.id, role: Role.CLIENT },
        });
      }

      await this.roster.attachPendingInvitesOnActivation(
        updated.id,
        phoneNormalized,
      );

      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: updated.id },
        include: { roles: true, club: true },
      });

      const pendingTrainers = await this.roster.getPendingTrainerRequests(
        user.id,
      );
      const { accessToken } = await this.signToken(user);

      return {
        accessToken,
        user: this.formatUserResponse(user),
        pendingTrainers,
      };
    }

    const created = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: passwordHash,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        phone: dto.phone.trim(),
        phoneNormalized,
        accountStatus: AccountStatus.ACTIVE,
        activatedAt: now,
        roles: { create: { role: Role.CLIENT } },
        notificationPrefs: { create: {} },
      },
      include: { roles: true, club: true },
    });
    userId = created.id;

    await this.roster.attachPendingInvitesOnActivation(
      created.id,
      phoneNormalized,
    );

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { roles: true, club: true },
    });

    const pendingTrainers = await this.roster.getPendingTrainerRequests(
      user.id,
    );
    const { accessToken } = await this.signToken(user);

    return {
      accessToken,
      user: this.formatUserResponse(user),
      pendingTrainers,
    };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: true, club: true },
    });

    if (!user) {
      throw new UnauthorizedException();
    }

    return this.formatUserResponse(user);
  }
}
