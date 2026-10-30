import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole as SharedUserRole } from '@fitgo/shared-types';
import * as bcrypt from 'bcryptjs';
import { AccountStatus, PhoneOtpPurpose, Role } from '@prisma/client';
import { normalizePhone } from '../common/phone.util';
import { AppPresenceService } from '../app-presence/app-presence.service';
import { ClubMembershipService } from '../common/club-membership.service';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { TrainerRosterService } from '../trainer/trainer-roster.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

const ROLE_MAP: Record<Role, SharedUserRole> = {
  [Role.CLIENT]: SharedUserRole.CLIENT,
  [Role.TRAINER]: SharedUserRole.TRAINER,
  [Role.SPECIALIST]: SharedUserRole.SPECIALIST,
  [Role.TECH]: SharedUserRole.TECH,
  [Role.ADMIN]: SharedUserRole.ADMIN,
  [Role.MANAGER]: SharedUserRole.MANAGER,
  [Role.SUPER_ADMIN]: SharedUserRole.SUPER_ADMIN,
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly roster: TrainerRosterService,
    private readonly clubMembership: ClubMembershipService,
    private readonly appPresence: AppPresenceService,
    private readonly sms: SmsService,
  ) {}

  private formatUserResponse(user: {
    id: string;
    externalId: string | null;
    clubId: string | null;
    email: string;
    phone: string | null;
    phoneVerifiedAt?: Date | null;
    pwaInstalledAt?: Date | null;
    firstName: string;
    lastName: string;
    groupPrograms?: boolean;
    trainerStaff?: boolean;
    trainerClub?: boolean;
    trainerReformers?: boolean;
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
      phoneVerified: Boolean(user.phoneVerifiedAt),
      pwaInstalled: Boolean(user.pwaInstalledAt),
      firstName: user.firstName,
      lastName: user.lastName,
      groupPrograms: Boolean(user.groupPrograms),
      trainerStaff: Boolean(user.trainerStaff),
      trainerClub: Boolean(user.trainerClub),
      trainerReformers: Boolean(user.trainerReformers),
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
    const login = dto.email.trim();
    const phoneGuess = normalizePhone(login);
    const user =
      (await this.prisma.user.findFirst({
        where: { email: { equals: login, mode: 'insensitive' } },
        include: {
          roles: true,
          club: true,
        },
      })) ??
      (phoneGuess.length >= 11
        ? await this.prisma.user.findFirst({
            where: {
              phoneNormalized: phoneGuess,
              accountStatus: AccountStatus.ACTIVE,
            },
            include: { roles: true, club: true },
          })
        : null);

    if (!user) {
      throw new UnauthorizedException('Неверный логин или пароль');
    }

    if (user.accountStatus === AccountStatus.SHADOW) {
      throw new UnauthorizedException(
        'Аккаунт ещё не активирован. Зарегистрируйтесь в приложении.',
      );
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Аккаунт деактивирован');
    }

    if (!user.loginEnabled) {
      throw new UnauthorizedException('Вход для этого сотрудника ещё не открыт');
    }

    const clubId = await this.clubMembership.resolveActiveClubId(
      user.id,
      user.clubId,
    );
    if (clubId !== (user.clubId ?? undefined)) {
      const refreshed = await this.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        include: { roles: true, club: true },
      });
      Object.assign(user, refreshed);
    }

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) {
      throw new UnauthorizedException('Неверный логин или пароль');
    }

    const { accessToken } = await this.signToken(user);

    void this.appPresence.recordLogin(
      user.id,
      user.roles.map((r) => r.role),
    );

    return {
      accessToken,
      user: this.formatUserResponse(user),
    };
  }

  async sendPhoneCode(phone: string, purpose: 'register' | 'reset_password') {
    const otpPurpose =
      purpose === 'reset_password'
        ? PhoneOtpPurpose.RESET_PASSWORD
        : PhoneOtpPurpose.REGISTER;
    return this.sms.sendOtp(phone, otpPurpose);
  }

  async register(dto: RegisterDto) {
    const { phoneNormalized } = await this.sms.verifyOtp(
      dto.phone,
      PhoneOtpPurpose.REGISTER,
      dto.verificationCode,
    );

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
    const consent = {
      phoneVerifiedAt: now,
      privacyConsentVersion: dto.privacyConsentVersion.trim(),
      privacyConsentAt: now,
      termsConsentVersion: dto.termsConsentVersion.trim(),
      termsConsentAt: now,
      marketingConsentAt: dto.marketingConsent ? now : null,
    };

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
          ...consent,
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
        ...consent,
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

  async resetPassword(dto: ResetPasswordDto) {
    const { phoneNormalized } = await this.sms.verifyOtp(
      dto.phone,
      PhoneOtpPurpose.RESET_PASSWORD,
      dto.verificationCode,
    );

    const user = await this.prisma.user.findFirst({
      where: {
        phoneNormalized,
        accountStatus: AccountStatus.ACTIVE,
        roles: { some: { role: Role.CLIENT } },
      },
    });
    if (!user) {
      throw new UnauthorizedException('Клиент с таким номером не найден');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: passwordHash,
        phoneVerifiedAt: user.phoneVerifiedAt ?? new Date(),
      },
    });

    return { ok: true as const };
  }

  async markPwaInstalled(userId: string, installed: boolean) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        pwaInstalledAt: installed ? new Date() : null,
      },
    });
    return { ok: true as const, pwaInstalled: installed };
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
