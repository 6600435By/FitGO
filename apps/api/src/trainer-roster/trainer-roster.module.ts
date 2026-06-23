import { Module } from '@nestjs/common';
import { FitnessModule } from '../fitness/fitness.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TrainerRosterService } from '../trainer/trainer-roster.service';

@Module({
  imports: [FitnessModule, NotificationsModule],
  providers: [TrainerRosterService],
  exports: [TrainerRosterService],
})
export class TrainerRosterModule {}
