import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ClientModule } from '../client/client.module';
import { ClubScheduleModule } from '../club-schedule/club-schedule.module';
import { EngagementModule } from '../engagement/engagement.module';
import { FitnessModule } from '../fitness/fitness.module';
import { FloorHomeModule } from '../floor-home/floor-home.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ServiceUsageModule } from '../service-usage/service-usage.module';
import { TrainerRosterModule } from '../trainer-roster/trainer-roster.module';
import { GpScheduleService } from './gp-schedule.service';
import { TrainerClientLookupService } from './trainer-client-lookup.service';
import { TrainerController } from './trainer.controller';
import { TrainerInsightsSchedulerService } from './trainer-insights.scheduler';
import { TrainerInsightsService } from './trainer-insights.service';
import { TrainerLedgerModule } from './trainer-ledger.module';
import { TrainerService } from './trainer.service';

@Module({
  imports: [
    FitnessModule,
    NotificationsModule,
    EngagementModule,
    TrainerRosterModule,
    ClientModule,
    ServiceUsageModule,
    ClubScheduleModule,
    FloorHomeModule,
    TrainerLedgerModule,
    AnalyticsModule,
  ],
  controllers: [TrainerController],
  providers: [
    TrainerService,
    GpScheduleService,
    TrainerClientLookupService,
    TrainerInsightsService,
    TrainerInsightsSchedulerService,
  ],
  exports: [TrainerLedgerModule, TrainerInsightsService],
})
export class TrainerModule {}
