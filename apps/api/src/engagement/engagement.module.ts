import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FitnessModule } from '../fitness/fitness.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EngagementController } from './engagement.controller';
import { EngagementService } from './engagement.service';
import { VisitSyncService } from './visit-sync.service';
import { LoyaltyService } from './loyalty.service';
import { LeagueService } from './league.service';
import { BadgeEvaluatorService } from './badge-evaluator.service';
import { EngagementSchedulerService } from './engagement-scheduler.service';

@Module({
  imports: [AuthModule, FitnessModule, NotificationsModule],
  controllers: [EngagementController],
  providers: [
    EngagementService,
    VisitSyncService,
    LoyaltyService,
    LeagueService,
    BadgeEvaluatorService,
    EngagementSchedulerService,
  ],
  exports: [EngagementService, VisitSyncService, LeagueService, BadgeEvaluatorService],
})
export class EngagementModule {}
