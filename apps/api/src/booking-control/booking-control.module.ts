import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BookingControlController } from './booking-control.controller';
import { BookingControlService } from './booking-control.service';

@Module({
  imports: [AuthModule],
  controllers: [BookingControlController],
  providers: [BookingControlService],
  exports: [BookingControlService],
})
export class BookingControlModule {}
