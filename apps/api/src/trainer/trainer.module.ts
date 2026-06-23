import { Module } from '@nestjs/common';
import { EngagementModule } from '../engagement/engagement.module';
import { FitnessModule } from '../fitness/fitness.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TrainerRosterModule } from '../trainer-roster/trainer-roster.module';
import { TrainerController } from './trainer.controller';
import { TrainerService } from './trainer.service';

@Module({
  imports: [FitnessModule, NotificationsModule, EngagementModule, TrainerRosterModule],
  controllers: [TrainerController],
  providers: [TrainerService],
})
export class TrainerModule {}
