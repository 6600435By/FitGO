import { Module } from '@nestjs/common';
import { RocketSmsClient } from './rocketsms.client';
import { SmsService } from './sms.service';

@Module({
  providers: [RocketSmsClient, SmsService],
  exports: [SmsService, RocketSmsClient],
})
export class SmsModule {}
