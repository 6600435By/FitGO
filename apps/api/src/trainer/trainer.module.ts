import { Module } from '@nestjs/common';
import { EngagementModule } from '../engagement/engagement.module';
import { FitnessModule } from '../fitness/fitness.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TrainerController } from './trainer.controller';
import { TrainerService } from './trainer.service';

@Module({
  imports: [FitnessModule, NotificationsModule, EngagementModule],
  controllers: [TrainerController],
  providers: [TrainerService],
})
export class TrainerModule {}
