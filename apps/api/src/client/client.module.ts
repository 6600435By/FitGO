import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PersonalTrainingModule } from '../personal-training/personal-training.module';
import { ClientController } from './client.controller';
import { ClientService } from './client.service';
import { ClientProfileService } from './client-profile.service';

@Module({
  imports: [PersonalTrainingModule, NotificationsModule],
  controllers: [ClientController],
  providers: [ClientService, ClientProfileService],
})
export class ClientModule {}
