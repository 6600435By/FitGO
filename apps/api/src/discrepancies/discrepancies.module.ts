import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { GroupSessionModule } from '../group-session/group-session.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SegmentsModule } from '../segments/segments.module';
import {
  DiscrepanciesController,
  StaffTasksController,
} from './discrepancies.controller';
import { DiscrepanciesService } from './discrepancies.service';
import { DiscrepancyCleanupScheduler } from './discrepancies-cleanup.scheduler';
import { DiscrepancyTasksService } from './discrepancy-tasks.service';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    PrismaModule,
    SegmentsModule,
    GroupSessionModule,
  ],
  controllers: [DiscrepanciesController, StaffTasksController],
  providers: [
    DiscrepanciesService,
    DiscrepancyCleanupScheduler,
    DiscrepancyTasksService,
  ],
  exports: [DiscrepanciesService, DiscrepancyTasksService],
})
export class DiscrepanciesModule {}
