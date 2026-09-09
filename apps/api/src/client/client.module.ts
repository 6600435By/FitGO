import { Module } from '@nestjs/common';
import { ClubCrmLinkService } from '../common/club-crm-link.service';
import { EngagementModule } from '../engagement/engagement.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OsmiModule } from '../osmi/osmi.module';
import { PersonalTrainingModule } from '../personal-training/personal-training.module';
import { TrainerRosterModule } from '../trainer-roster/trainer-roster.module';
import { WaitlistModule } from '../waitlist/waitlist.module';
import { ClientController } from './client.controller';
import { ClientService } from './client.service';
import { ClientProfileService } from './client-profile.service';

@Module({
  imports: [
    PersonalTrainingModule,
    NotificationsModule,
    WaitlistModule,
    OsmiModule,
    TrainerRosterModule,
    EngagementModule,
  ],
  controllers: [ClientController],
  providers: [ClientService, ClientProfileService, ClubCrmLinkService],
  exports: [ClubCrmLinkService],
})
export class ClientModule {}
