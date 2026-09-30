import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClassSyncModule } from '../class-sync/class-sync.module';
import { BookingControlController } from './booking-control.controller';
import { BookingControlService } from './booking-control.service';

@Module({
  imports: [AuthModule, ClassSyncModule],
  controllers: [BookingControlController],
  providers: [BookingControlService],
  exports: [BookingControlService],
})
export class BookingControlModule {}
