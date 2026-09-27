import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { AdminSalesModule } from '../admin-sales/admin-sales.module';
import { GroupSessionModule } from '../group-session/group-session.module';
import { PtTimesheetModule } from '../pt-timesheet/pt-timesheet.module';
import { ServiceUsageModule } from '../service-usage/service-usage.module';
import { StaffRosterModule } from '../staff-roster/staff-roster.module';
import {
  AdminPayrollController,
  PayrollController,
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
  ],
  controllers: [
    PayrollController,
    AdminPayrollController,
    SpecialistPayrollController,
  ],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}
