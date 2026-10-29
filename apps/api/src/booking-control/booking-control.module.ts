import { Module } from '@nestjs/common';
import { ManagerOriginTasksModule } from '../admin-tasks/manager-origin-tasks.module';
import { AuthModule } from '../auth/auth.module';
import { ClassSyncModule } from '../class-sync/class-sync.module';
import { BookingControlController } from './booking-control.controller';
import { BookingControlService } from './booking-control.service';
import { SessionApprovalService } from './session-approval.service';

@Module({
  imports: [AuthModule, ClassSyncModule, ManagerOriginTasksModule],
  controllers: [BookingControlController],
  providers: [BookingControlService, SessionApprovalService],
  exports: [BookingControlService, SessionApprovalService],
})
export class BookingControlModule {}
