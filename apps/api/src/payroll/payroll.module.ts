import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { AdminSalesModule } from '../admin-sales/admin-sales.module';
import { GroupSessionModule } from '../group-session/group-session.module';
import { PtTimesheetModule } from '../pt-timesheet/pt-timesheet.module';
import { ServiceUsageModule } from '../service-usage/service-usage.module';
import { StaffRosterModule } from '../staff-roster/staff-roster.module';
import { ClassSyncModule } from '../class-sync/class-sync.module';
import { BookingControlModule } from '../booking-control/booking-control.module';
import {
  AdminPayrollController,
  PayrollController,
  SelfPayrollController,
  SpecialistPayrollController,
} from './payroll.controller';
import { PayrollService } from './payroll.service';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    AdminSalesModule,
    ServiceUsageModule,
    GroupSessionModule,
    PtTimesheetModule,
    StaffRosterModule,
    ClassSyncModule,
    BookingControlModule,
  ],
  controllers: [
    PayrollController,
    AdminPayrollController,
    SpecialistPayrollController,
    SelfPayrollController,
  ],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}
