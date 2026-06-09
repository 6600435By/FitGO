import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserRole as SharedUserRole } from '@fitgo/shared-types';
import * as bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';

const ROLE_MAP: Record<Role, SharedUserRole> = {
  [Role.CLIENT]: SharedUserRole.CLIENT,
  [Role.TRAINER]: SharedUserRole.TRAINER,
  [Role.ADMIN]: SharedUserRole.ADMIN,
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

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

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) {
      throw new UnauthorizedException('Неверный email или пароль');
    }

    const roles = user.roles.map((r) => ROLE_MAP[r.role]);
    const payload = {
      sub: user.id,
      email: user.email,
      clubId: user.clubId,
      roles,
      externalId: user.externalId,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      user: {
        id: user.id,
        externalId: user.externalId ?? undefined,
        clubId: user.clubId,
        email: user.email,
        phone: user.phone ?? undefined,
        firstName: user.firstName,
        lastName: user.lastName,
        roles,
        club: {
          id: user.club.id,
          name: user.club.name,
          slug: user.club.slug,
          address: user.club.address ?? undefined,
        },
      },
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

    return {
      id: user.id,
      externalId: user.externalId ?? undefined,
      clubId: user.clubId,
      email: user.email,
      phone: user.phone ?? undefined,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: user.roles.map((r) => ROLE_MAP[r.role]),
      club: {
        id: user.club.id,
        name: user.club.name,
        slug: user.club.slug,
        address: user.club.address ?? undefined,
      },
    };
  }
}
