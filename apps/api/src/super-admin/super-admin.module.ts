import { Module } from '@nestjs/common';
import { AdminSalesModule } from '../admin-sales/admin-sales.module';
import { AuthModule } from '../auth/auth.module';
import { FeaturesModule } from '../features/features.module';
import { FitnessModule } from '../fitness/fitness.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ServiceUsageModule } from '../service-usage/service-usage.module';
import { AdminTasksSchedulerService } from './admin-tasks-scheduler.service';
import { SuperAdminAnalyticsService } from './super-admin-analytics.service';
import { SuperAdminController } from './super-admin.controller';
import { SuperAdminService } from './super-admin.service';

@Module({
  imports: [
    AuthModule,
    FitnessModule,
    ServiceUsageModule,
    FeaturesModule,
    AdminSalesModule,
    NotificationsModule,
  ],
  controllers: [SuperAdminController],
  providers: [
    SuperAdminService,
    SuperAdminAnalyticsService,
    AdminTasksSchedulerService,
  ],
  exports: [AdminTasksSchedulerService],
})
export class SuperAdminModule {}
