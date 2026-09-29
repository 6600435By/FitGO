import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ClassSessionsSyncService } from './class-sessions-sync.service';
import { HallVisitsSyncService } from './hall-visits-sync.service';

@Injectable()
export class ClassSyncSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(ClassSyncSchedulerService.name);
  private lastDailyKey = '';

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly classSessions: ClassSessionsSyncService,
    private readonly hallVisits: HallVisitsSyncService,
  ) {}

  onModuleInit() {
    if (this.config.get('ENABLE_CLASS_SYNC_CRON') === 'false') return;
    setInterval(() => void this.tick(), 60 * 60 * 1000);
    void this.tick();
  }

  private async tick() {
    const now = new Date();
    const dayKey = now.toISOString().slice(0, 10);
    // Once per day after 03:00 — past month + today for classes; 14d for visits
    if (now.getHours() < 3) return;
    if (this.lastDailyKey === dayKey) return;
    this.lastDailyKey = dayKey;

    const clubs = await this.prisma.club.findMany({ select: { id: true } });
    for (const club of clubs) {
      try {
        const classRes = await this.classSessions.syncClub(club.id);
        this.logger.log(
          `Class sessions ${club.id}: ${classRes.sessionsUpserted} docs (${classRes.from}…${classRes.to})` +
            (classRes.endpointMissing ? ' [endpoint missing]' : ''),
        );
      } catch (err) {
        this.logger.error(`Class sessions sync failed ${club.id}`, err);
      }
      try {
        const visits = await this.hallVisits.syncClub(club.id);
        this.logger.log(
          `Hall visits ${club.id}: ${visits.upserted} (${visits.from}…${visits.to})` +
            (visits.endpointMissing ? ' [endpoint missing]' : ''),
        );
      } catch (err) {
        this.logger.error(`Hall visits sync failed ${club.id}`, err);
      }
    }
  }
}
