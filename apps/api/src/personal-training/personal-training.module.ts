import { Module } from '@nestjs/common';
import { BookingControlModule } from '../booking-control/booking-control.module';
import { ClubScheduleModule } from '../club-schedule/club-schedule.module';
import { EngagementModule } from '../engagement/engagement.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ServiceUsageModule } from '../service-usage/service-usage.module';
import { TrainerRosterModule } from '../trainer-roster/trainer-roster.module';
import { TrainerLedgerModule } from '../trainer/trainer-ledger.module';
import { PersonalTrainingController } from './personal-training.controller';
import { PersonalTrainingService } from './personal-training.service';
import { PtReminderSchedulerService } from './pt-reminder.scheduler';
import { ScheduleHoldSchedulerService } from './schedule-hold.scheduler';

@Module({
  imports: [
    NotificationsModule,
    TrainerRosterModule,
    EngagementModule,
    ServiceUsageModule,
    ClubScheduleModule,
    BookingControlModule,
    TrainerLedgerModule,
  ],
  controllers: [PersonalTrainingController],
  providers: [
    PersonalTrainingService,
    ScheduleHoldSchedulerService,
    PtReminderSchedulerService,
  ],
  exports: [PersonalTrainingService],
})
export class PersonalTrainingModule {}
