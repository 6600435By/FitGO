import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { OsmiModule } from '../osmi/osmi.module';
import { PersonalTrainingModule } from '../personal-training/personal-training.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { ClientController } from './client.controller';
import { ClientService } from './client.service';
import { ClientProfileService } from './client-profile.service';

@Module({
  imports: [PersonalTrainingModule, NotificationsModule, WaitlistModule, OsmiModule],
  controllers: [ClientController],
  providers: [ClientService, ClientProfileService],
})
export class ClientModule {}
