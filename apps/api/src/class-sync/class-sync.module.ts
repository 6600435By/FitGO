import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { ClubSyncModule } from '../club-sync/club-sync.module';
import { EngagementModule } from '../engagement/engagement.module';
import { FitnessModule } from '../fitness/fitness.module';
import { ServiceUsageModule } from '../service-usage/service-usage.module';
import {
  AdminClassSyncController,
  ClassSyncController,
} from './class-sync.controller';
import { ClassSessionsSyncService } from './class-sessions-sync.service';
import { ClassSyncSchedulerService } from './class-sync-scheduler.service';
import { HallVisitsSyncService } from './hall-visits-sync.service';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    FitnessModule,
    EngagementModule,
    ServiceUsageModule,
    forwardRef(() => ClubSyncModule),
  ],
  controllers: [ClassSyncController, AdminClassSyncController],
  providers: [
    ClassSessionsSyncService,
    HallVisitsSyncService,
    ClassSyncSchedulerService,
  ],
  exports: [ClassSessionsSyncService, HallVisitsSyncService],
})
export class ClassSyncModule {}
