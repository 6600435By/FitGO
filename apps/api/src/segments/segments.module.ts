import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FitnessModule } from '../fitness/fitness.module';
import { PayrollModule } from '../payroll/payroll.module';
import { SegmentsController } from './segments.controller';
import { SegmentsService } from './segments.service';

@Module({
  imports: [AuthModule, FitnessModule, PayrollModule],
  controllers: [SegmentsController],
  providers: [SegmentsService],
  exports: [SegmentsService],
})
export class SegmentsModule {}
