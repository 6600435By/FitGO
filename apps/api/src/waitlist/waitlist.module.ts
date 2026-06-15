import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { FitnessModule } from '../fitness/fitness.module';
import { WaitlistSchedulerService } from './waitlist-scheduler.service';
import { WaitlistService } from './waitlist.service';

@Module({
  imports: [FitnessModule, NotificationsModule],
  providers: [WaitlistService, WaitlistSchedulerService],
  exports: [WaitlistService],
})
export class WaitlistModule {}
