import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { ClubSyncModule } from '../club-sync/club-sync.module';
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
import { SalesBackfillService } from './sales-backfill.service';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    PrismaModule,
    forwardRef(() => ClubSyncModule),
  ],
  controllers: [AdminSalesController, SuperAdminSalesController],
  providers: [
    AdminSalesService,
    AdminSalesSyncService,
    AdminSalesSchedulerService,
    ClubRevenueService,
    ClubRevenueSyncService,
    SalesBackfillService,
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
