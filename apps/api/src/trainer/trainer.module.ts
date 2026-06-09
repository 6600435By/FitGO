import { Module } from '@nestjs/common';
import { FitnessModule } from '../fitness/fitness.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TrainerController } from './trainer.controller';
import { TrainerService } from './trainer.service';

@Module({
  imports: [FitnessModule, NotificationsModule],
  controllers: [TrainerController],
  providers: [TrainerService],
})
export class TrainerModule {}
