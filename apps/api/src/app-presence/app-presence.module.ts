import { Module } from '@nestjs/common';
import { AppPresenceService } from './app-presence.service';

@Module({
  providers: [AppPresenceService],
  exports: [AppPresenceService],
})
export class AppPresenceModule {}
