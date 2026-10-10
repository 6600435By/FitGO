import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminSalesModule } from '../admin-sales/admin-sales.module';
import { AuthModule } from '../auth/auth.module';
import { PayrollModule } from '../payroll/payroll.module';
import { AnalyticsController } from './analytics.controller';
import { ClubAnalyticsService } from './club-analytics.service';
import { StaffAnalyticsService } from './staff-analytics.service';

@Module({
  imports: [ConfigModule, AuthModule, AdminSalesModule, PayrollModule],
  controllers: [AnalyticsController],
  providers: [ClubAnalyticsService, StaffAnalyticsService],
  exports: [ClubAnalyticsService, StaffAnalyticsService],
})
export class AnalyticsModule {}
