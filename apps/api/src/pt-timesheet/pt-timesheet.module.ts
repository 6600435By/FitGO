import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BookingControlModule } from '../booking-control/booking-control.module';
import { FitnessModule } from '../fitness/fitness.module';
import { PayrollModule } from '../payroll/payroll.module';
import { ServiceUsageModule } from '../service-usage/service-usage.module';
import { StaffRosterModule } from '../staff-roster/staff-roster.module';
import { TrainerRosterModule } from '../trainer-roster/trainer-roster.module';
import {
  AdminPtTimesheetController,
  SuperAdminPtTimesheetController,
  TrainerPtTimesheetController,
} from './pt-timesheet.controller';
import { PtTimesheetStatsService } from './pt-timesheet-stats.service';
import { PtTimesheetService } from './pt-timesheet.service';

@Module({
  imports: [
    AuthModule,
    ServiceUsageModule,
    TrainerRosterModule,
    FitnessModule,
    BookingControlModule,
    PayrollModule,
    StaffRosterModule,
  ],
  controllers: [
    TrainerPtTimesheetController,
    AdminPtTimesheetController,
    SuperAdminPtTimesheetController,
  ],
  providers: [PtTimesheetService, PtTimesheetStatsService],
  exports: [PtTimesheetService, PtTimesheetStatsService],
})
export class PtTimesheetModule {}
