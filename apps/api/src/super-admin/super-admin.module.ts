import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FitnessModule } from '../fitness/fitness.module';
import { SuperAdminAnalyticsService } from './super-admin-analytics.service';
import { SuperAdminController } from './super-admin.controller';
import { SuperAdminService } from './super-admin.service';

@Module({
  imports: [AuthModule, FitnessModule],
  controllers: [SuperAdminController],
  providers: [SuperAdminService, SuperAdminAnalyticsService],
})
export class SuperAdminModule {}
