import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { WebkassaService } from './webkassa.service';

@Injectable()
export class WebkassaSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(WebkassaSchedulerService.name);
  private lastNightly = '';
  private last2hSlot = '';

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly webkassa: WebkassaService,
  ) {}

  onModuleInit() {
    if (this.config.get('ENABLE_WEBKASSA_CRON') === 'false') return;
    if (!this.config.get<string>('WEBKASSA_LOGIN')?.trim()) return;
    setInterval(() => void this.tick(), 30 * 60 * 1000);
    void this.tick();
  }

  private async tick() {
    const now = new Date();
    const dayKey = now.toISOString().slice(0, 10);
    // Nightly full-ish window (last 7 days) at 02:xx
    if (now.getHours() === 2 && this.lastNightly !== dayKey) {
      this.lastNightly = dayKey;
      await this.runAll(7);
      return;
    }
    // Every 2 hours: last 2 days
    const slot = `${dayKey}-${Math.floor(now.getHours() / 2)}`;
    if (this.last2hSlot === slot) return;
    if (now.getHours() === 2) return;
    this.last2hSlot = slot;
    await this.runAll(2);
  }

  private async runAll(lookbackDays: number) {
    const to = new Date();
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - lookbackDays);
    const clubs = await this.prisma.club.findMany({ select: { id: true } });
    for (const club of clubs) {
      try {
        const r = await this.webkassa.syncClub(club.id, from, to);
        this.logger.log(
          `Webkassa sync club=${club.id} count=${r.count} skipped=${r.skipped}`,
        );
      } catch (err) {
        this.logger.error(
          `Webkassa sync failed club=${club.id}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }
  }
}
