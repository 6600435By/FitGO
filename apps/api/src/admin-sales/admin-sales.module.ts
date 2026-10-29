import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ManagerOriginTasksModule } from '../admin-tasks/manager-origin-tasks.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import {
  AdminSalesController,
  SuperAdminSalesController,
} from './admin-sales.controller';
import { AdminSalesSchedulerService } from './admin-sales-scheduler.service';
import { AdminSalesService } from './admin-sales.service';
import { AdminSalesSyncService } from './admin-sales-sync.service';
import { ClubRevenueService } from './club-revenue.service';
import { ClubRevenueSyncService } from './club-revenue-sync.service';
import { SalesBackfillOnceScheduler } from './sales-backfill-once.scheduler';
import { SalesBackfillService } from './sales-backfill.service';

@Module({
  imports: [ConfigModule, AuthModule, PrismaModule, ManagerOriginTasksModule],
  controllers: [AdminSalesController, SuperAdminSalesController],
  providers: [
    AdminSalesService,
    AdminSalesSyncService,
    AdminSalesSchedulerService,
    ClubRevenueService,
    ClubRevenueSyncService,
    SalesBackfillService,
    SalesBackfillOnceScheduler,
  ],
  exports: [
    AdminSalesService,
    AdminSalesSyncService,
    ClubRevenueService,
    ClubRevenueSyncService,
    SalesBackfillService,
  ],
})
export class AdminSalesModule {}
