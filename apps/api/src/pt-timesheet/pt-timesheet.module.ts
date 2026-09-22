import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FitnessModule } from '../fitness/fitness.module';
import { ServiceUsageModule } from '../service-usage/service-usage.module';
import { TrainerRosterModule } from '../trainer-roster/trainer-roster.module';
import {
  AdminPtTimesheetController,
  SuperAdminPtTimesheetController,
  TrainerPtTimesheetController,
} from './pt-timesheet.controller';
import { PtTimesheetService } from './pt-timesheet.service';

@Module({
  imports: [
    AuthModule,
    ServiceUsageModule,
    TrainerRosterModule,
    FitnessModule,
  ],
  controllers: [
    TrainerPtTimesheetController,
    AdminPtTimesheetController,
    SuperAdminPtTimesheetController,
  ],
  providers: [PtTimesheetService],
  exports: [PtTimesheetService],
})
export class PtTimesheetModule {}
