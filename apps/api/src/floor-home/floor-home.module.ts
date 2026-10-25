import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { FloorStaffHomeService } from './floor-staff-home.service';

@Module({
  imports: [AnalyticsModule],
  providers: [FloorStaffHomeService],
  exports: [FloorStaffHomeService],
})
export class FloorHomeModule {}
