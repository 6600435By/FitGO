import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FeaturesService } from './features.service';

@Controller('features')
@UseGuards(JwtAuthGuard)
export class FeaturesController {
  constructor(private readonly features: FeaturesService) {}

  /** Lightweight module map for client/trainer/admin nav gates. */
  @Get()
  async getFeatures() {
    return { modules: await this.features.getModules() };
  }
}
