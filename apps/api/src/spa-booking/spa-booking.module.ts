import { Module } from '@nestjs/common';
import { ClubCrmLinkService } from '../common/club-crm-link.service';
import { FeaturesModule } from '../features/features.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ServiceUsageModule } from '../service-usage/service-usage.module';
import { SpaBookingController } from './spa-booking.controller';
import { SpaBookingService } from './spa-booking.service';

@Module({
  imports: [FeaturesModule, NotificationsModule, ServiceUsageModule],
  controllers: [SpaBookingController],
  providers: [SpaBookingService, ClubCrmLinkService],
  exports: [SpaBookingService],
})
export class SpaBookingModule {}
