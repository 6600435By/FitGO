import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { GroupSessionModule } from '../group-session/group-session.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SegmentsModule } from '../segments/segments.module';
import { DiscrepanciesController } from './discrepancies.controller';
import { DiscrepanciesService } from './discrepancies.service';
import { DiscrepancyCleanupScheduler } from './discrepancies-cleanup.scheduler';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    PrismaModule,
    SegmentsModule,
    GroupSessionModule,
  ],
  controllers: [DiscrepanciesController],
  providers: [DiscrepanciesService, DiscrepancyCleanupScheduler],
  exports: [DiscrepanciesService],
})
export class DiscrepanciesModule {}
