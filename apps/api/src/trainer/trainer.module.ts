import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ClientModule } from '../client/client.module';
import { ClubScheduleModule } from '../club-schedule/club-schedule.module';
import { EngagementModule } from '../engagement/engagement.module';
import { FeaturesModule } from '../features/features.module';
import { FloorHomeModule } from '../floor-home/floor-home.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ServiceUsageModule } from '../service-usage/service-usage.module';
import { TrainerRosterModule } from '../trainer-roster/trainer-roster.module';
import { GpScheduleService } from './gp-schedule.service';
import { TrainerClientLookupService } from './trainer-client-lookup.service';
import { ClientHomeworkController } from './client-homework.controller';
import { TrainerController } from './trainer.controller';
import { TrainerInsightsSchedulerService } from './trainer-insights.scheduler';
import { TrainerInsightsService } from './trainer-insights.service';
import { TrainerLedgerModule } from './trainer-ledger.module';
import { TrainerPersonalGoalsService } from './trainer-personal-goals.service';
import { TrainerService } from './trainer.service';

@Module({
  imports: [
    NotificationsModule,
    EngagementModule,
    FeaturesModule,
    TrainerRosterModule,
    ClientModule,
    ServiceUsageModule,
    ClubScheduleModule,
    FloorHomeModule,
    TrainerLedgerModule,
    AnalyticsModule,
  ],
  controllers: [TrainerController, ClientHomeworkController],
  providers: [
    TrainerService,
    GpScheduleService,
    TrainerClientLookupService,
    TrainerInsightsService,
    TrainerInsightsSchedulerService,
    TrainerPersonalGoalsService,
  ],
  exports: [TrainerLedgerModule, TrainerInsightsService, TrainerService],
})
export class TrainerModule {}
