import { Module, forwardRef } from '@nestjs/common';
import { AdminSalesModule } from '../admin-sales/admin-sales.module';
import { AuthModule } from '../auth/auth.module';
import { BookingControlModule } from '../booking-control/booking-control.module';
import { ClubScheduleModule } from '../club-schedule/club-schedule.module';
import { FitnessModule } from '../fitness/fitness.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SuperAdminModule } from '../super-admin/super-admin.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [
    FitnessModule,
    NotificationsModule,
    AuthModule,
    BookingControlModule,
    ClubScheduleModule,
    AdminSalesModule,
    forwardRef(() => SuperAdminModule),
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
