import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClassSyncModule } from '../class-sync/class-sync.module';
import { BookingControlController } from './booking-control.controller';
import { BookingControlService } from './booking-control.service';
import { SessionApprovalService } from './session-approval.service';

@Module({
  imports: [AuthModule, ClassSyncModule],
  controllers: [BookingControlController],
  providers: [BookingControlService, SessionApprovalService],
  exports: [BookingControlService, SessionApprovalService],
})
export class BookingControlModule {}
