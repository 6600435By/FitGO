import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { UserRole } from '@fitgo/shared-types';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ClubMembershipService } from '../common/club-membership.service';
import { PrismaService } from '../prisma/prisma.service';

export interface JwtPayload {
  sub: string;
  email: string;
  clubId?: string;
  roles: UserRole[];
  externalId?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly clubMembership: ClubMembershipService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', 'dev-secret-change-me'),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { isActive: true, clubId: true },
    });

    if (!user?.isActive) {
      throw new UnauthorizedException('Аккаунт деактивирован');
    }

    const clubId = await this.clubMembership.resolveActiveClubId(
      payload.sub,
      user.clubId,
    );

    return { ...payload, clubId };
  }
}
