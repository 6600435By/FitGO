import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BookingControlModule } from '../booking-control/booking-control.module';
import { FitnessModule } from '../fitness/fitness.module';
import { ClubScheduleController } from './club-schedule.controller';
import { ClubScheduleService } from './club-schedule.service';
import { FormaScheduleCacheService } from './forma-schedule-cache.service';

@Module({
  imports: [AuthModule, FitnessModule, BookingControlModule],
  controllers: [ClubScheduleController],
  providers: [ClubScheduleService, FormaScheduleCacheService],
  exports: [ClubScheduleService, FormaScheduleCacheService],
})
export class ClubScheduleModule {}
