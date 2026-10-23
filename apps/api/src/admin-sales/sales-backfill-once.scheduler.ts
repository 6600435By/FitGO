import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { moscowParts } from '../club-sync/moscow-time';
import {
  HISTORY_ONCE_FROM,
  isHistoryOnceDone,
  isHistoryOnceResumable,
  SalesBackfillService,
} from './sales-backfill.service';

const TICK_MS = 5 * 60 * 1000;
/** After error, do not hammer resume more often than this. */
const ERROR_BACKOFF_MS = 15 * 60 * 1000;

/**
 * One-shot night load of paid sales + cash for analytics (2025-01-01 → yesterday).
 * Enable with SALES_HISTORY_ONCE=true on the Windows API host only.
 */
@Injectable()
export class SalesBackfillOnceScheduler implements OnModuleInit {
  private readonly logger = new Logger(SalesBackfillOnceScheduler.name);
  private ticking = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly backfill: SalesBackfillService,
  ) {}

  onModuleInit() {
    if (this.config.get('SALES_HISTORY_ONCE') !== 'true') return;
    this.logger.log(
      `SALES_HISTORY_ONCE enabled — will load ${HISTORY_ONCE_FROM}→yesterday in 23:00–03:00 Moscow`,
    );
    setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
  }

  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const clubs = await this.prisma.club.findMany({ select: { id: true } });
      for (const club of clubs) {
        try {
          await this.ensureClub(club.id);
        } catch (err) {
          this.logger.error(
            `History once tick failed club=${club.id}`,
            err instanceof Error ? err.stack : err,
          );
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  private async ensureClub(clubId: string) {
    const st = await this.backfill.status(clubId);
    if (st.running) return;
    if (isHistoryOnceDone(st.cursor)) return;

    if (isHistoryOnceResumable(st.cursor)) {
      if (
        st.jobStatus === 'error' &&
        st.lastRunAt &&
        Date.now() - new Date(st.lastRunAt).getTime() < ERROR_BACKOFF_MS
      ) {
        return;
      }
      try {
        await this.backfill.resume(clubId);
        this.logger.log(`History once resumed club=${clubId}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.debug(`History once resume skipped club=${clubId}: ${msg}`);
      }
      return;
    }

    // No cursor, or cursor still in sealed years (< 2025) — start mutable pass.
    if (!isHistoryOnceStartWindow()) return;
    try {
      await this.backfill.start(clubId, {
        mode: 'mutable-refresh',
        from: HISTORY_ONCE_FROM,
      });
      this.logger.log(
        `History once started club=${clubId} from=${HISTORY_ONCE_FROM}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.debug(`History once start skipped club=${clubId}: ${msg}`);
    }
  }
}

/** Start new load 23:00–02:59 Moscow (before nightly FULL at 03:00). */
export function isHistoryOnceStartWindow(now = new Date()): boolean {
  const { hour } = moscowParts(now);
  return hour >= 23 || hour < 3;
}
