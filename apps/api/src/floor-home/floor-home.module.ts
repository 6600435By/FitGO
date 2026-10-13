import { Module } from '@nestjs/common';
import { FloorStaffHomeService } from './floor-staff-home.service';

@Module({
  providers: [FloorStaffHomeService],
  exports: [FloorStaffHomeService],
})
export class FloorHomeModule {}
