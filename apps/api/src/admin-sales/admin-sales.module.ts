import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import {
  AdminSalesController,
  SuperAdminSalesController,
} from './admin-sales.controller';
import { AdminSalesSchedulerService } from './admin-sales-scheduler.service';
import { AdminSalesService } from './admin-sales.service';
import { AdminSalesSyncService } from './admin-sales-sync.service';

@Module({
  imports: [ConfigModule, AuthModule, PrismaModule],
  controllers: [AdminSalesController, SuperAdminSalesController],
  providers: [
    AdminSalesService,
    AdminSalesSyncService,
    AdminSalesSchedulerService,
  ],
  exports: [AdminSalesService, AdminSalesSyncService],
})
export class AdminSalesModule {}
