import { Global, Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminSalesModule } from '../admin-sales/admin-sales.module';
import { AuthModule } from '../auth/auth.module';
import { ClassSyncModule } from '../class-sync/class-sync.module';
import { FitnessModule } from '../fitness/fitness.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BookingGateway } from './booking-gateway.service';
import { BookingReconcileScheduler } from './booking-reconcile.scheduler';
import { ClubSyncController } from './club-sync.controller';
import { ClubSyncOrchestrator } from './club-sync-orchestrator.service';
import { ClubSyncStatusService } from './club-sync-status.service';
import { MembershipSnapshotSyncService } from './membership-snapshot-sync.service';
import { MembersSummarySyncService } from './members-summary-sync.service';
import { NightlySyncScheduler } from './nightly-sync-scheduler.service';
import { ScheduleSlotsSyncService } from './schedule-slots-sync.service';
import { SpecialistDebtSyncService } from './specialist-debt-sync.service';
import { TrainerPtSalesSyncService } from './trainer-pt-sales-sync.service';

/**
 * Global so sales / class-sync / booking-control controllers can inject
 * ClubSyncOrchestrator without importing this module (avoids circular
 * AdminSalesModule ↔ ClubSyncModule file init / TDZ crash).
 */
@Global()
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuthModule,
    FitnessModule,
    // One-way only: ClubSync → AdminSales / ClassSync (never the reverse).
    forwardRef(() => AdminSalesModule),
    forwardRef(() => ClassSyncModule),
  ],
  controllers: [ClubSyncController],
  providers: [
    ClubSyncOrchestrator,
    ClubSyncStatusService,
    NightlySyncScheduler,
    ScheduleSlotsSyncService,
    TrainerPtSalesSyncService,
    SpecialistDebtSyncService,
    MembershipSnapshotSyncService,
    MembersSummarySyncService,
    BookingGateway,
    BookingReconcileScheduler,
  ],
  exports: [
    ClubSyncOrchestrator,
    ClubSyncStatusService,
    BookingGateway,
    ScheduleSlotsSyncService,
  ],
})
export class ClubSyncModule {}
