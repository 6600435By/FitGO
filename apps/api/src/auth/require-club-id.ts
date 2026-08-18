import { BadRequestException } from '@nestjs/common';
import type { JwtPayload } from './jwt.strategy';

export function requireClubId(user: JwtPayload): string {
  if (!user.clubId) {
    throw new BadRequestException('Сначала выберите клуб');
  }
  return user.clubId;
}
