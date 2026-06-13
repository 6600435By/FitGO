import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PersonalTrainingController } from './personal-training.controller';
import { PersonalTrainingService } from './personal-training.service';

@Module({
  imports: [NotificationsModule],
  controllers: [PersonalTrainingController],
  providers: [PersonalTrainingService],
  exports: [PersonalTrainingService],
})
export class PersonalTrainingModule {}
