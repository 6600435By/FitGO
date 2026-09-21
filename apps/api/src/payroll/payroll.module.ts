import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GroupSessionModule } from '../group-session/group-session.module';
import { ServiceUsageModule } from '../service-usage/service-usage.module';
import {
  AdminPayrollController,
  PayrollController,
} from './payroll.controller';
import { PayrollService } from './payroll.service';

@Module({
  imports: [AuthModule, ServiceUsageModule, GroupSessionModule],
  controllers: [PayrollController, AdminPayrollController],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}
