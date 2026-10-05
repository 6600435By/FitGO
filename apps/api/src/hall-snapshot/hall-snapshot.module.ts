import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { BookingControlModule } from '../booking-control/booking-control.module';
import { HallSnapshotAgentGuard } from './hall-snapshot-agent.guard';
import { HallSnapshotController } from './hall-snapshot.controller';
import { HallSnapshotSchedulerService } from './hall-snapshot-scheduler.service';
import { HallSnapshotService } from './hall-snapshot.service';

@Module({
  imports: [ConfigModule, AuthModule, BookingControlModule],
  controllers: [HallSnapshotController],
  providers: [
    HallSnapshotService,
    HallSnapshotAgentGuard,
    HallSnapshotSchedulerService,
  ],
  exports: [HallSnapshotService],
})
export class HallSnapshotModule {}
