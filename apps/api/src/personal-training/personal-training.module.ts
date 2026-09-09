import { Module } from '@nestjs/common';
import { EngagementModule } from '../engagement/engagement.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TrainerRosterModule } from '../trainer-roster/trainer-roster.module';
import { PersonalTrainingController } from './personal-training.controller';
import { PersonalTrainingService } from './personal-training.service';

@Module({
  imports: [NotificationsModule, TrainerRosterModule, EngagementModule],
  controllers: [PersonalTrainingController],
  providers: [PersonalTrainingService],
  exports: [PersonalTrainingService],
})
export class PersonalTrainingModule {}
