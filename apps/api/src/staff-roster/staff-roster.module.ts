import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  AdminStaffRosterController,
  SuperAdminStaffRosterController,
  TrainerStaffRosterController,
} from './staff-roster.controller';
import { StaffRosterService } from './staff-roster.service';

@Module({
  imports: [AuthModule],
  controllers: [
    AdminStaffRosterController,
    SuperAdminStaffRosterController,
    TrainerStaffRosterController,
  ],
  providers: [StaffRosterService],
  exports: [StaffRosterService],
})
export class StaffRosterModule {}
