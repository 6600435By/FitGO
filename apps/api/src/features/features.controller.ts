import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { FeaturesService } from './features.service';

@Controller('features')
@UseGuards(JwtAuthGuard)
export class FeaturesController {
  constructor(private readonly features: FeaturesService) {}

  /** Module map for the signed-in user (includes Forma Coach pilot). */
  @Get()
  async getFeatures(@CurrentUser() user: JwtPayload) {
    return { modules: await this.features.getModulesForUser(user.sub) };
  }
}
