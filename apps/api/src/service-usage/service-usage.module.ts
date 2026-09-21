import { Module } from '@nestjs/common';
import { FitnessModule } from '../fitness/fitness.module';
import { ServiceUsageService } from './service-usage.service';

@Module({
  imports: [FitnessModule],
  providers: [ServiceUsageService],
  exports: [ServiceUsageService],
})
export class ServiceUsageModule {}
