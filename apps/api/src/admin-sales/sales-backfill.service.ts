import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AdminSalesSyncService } from './admin-sales-sync.service';
import { ClubRevenueSyncService } from './club-revenue-sync.service';
import { eachUtcDay } from './sales-sync-window';

const RESOURCE_KEY = 'sales_backfill';

/** Closed years after debt cleanup — load once, no debt/change-log. */
export const DEFAULT_SEALED_UNTIL = '2024-12-31';
export const DEFAULT_BACKFILL_FROM = '2018-01-01';

const SEALED_DAYS_PER_TICK = 10;
const MUTABLE_DAYS_PER_TICK = 5;
const DELAY_MS_BETWEEN_DAYS = 400;
const PAUSE_MS_BETWEEN_CHUNKS = 8_000;
const ORPHAN_MS = 30 * 60 * 1000;

export type BackfillPhase = 'sealed' | 'mutable' | 'done';

export type BackfillCursor = {
  planFrom: string;
  planTo: string;
  sealedUntil: string;
  nextDay: string;
  phase: BackfillPhase;
  daysDone: number;
  daysTotal: number;
  upsertedSales: number;
  upsertedRevenue: number;
  lastChunkFrom: string | null;
  lastChunkTo: string | null;
  /** How many full passes over mutable range (2025–now). */
  mutablePass: number;
  note: string | null;
};

export type StartBackfillBody = {
  /** Inclusive start YYYY-MM-DD (default 2018-01-01). */
  from?: string;
  /** Inclusive end YYYY-MM-DD (default yesterday UTC). */
  to?: string;
  /** Last day of sealed history (default 2024-12-31). */
  sealedUntil?: string;
  /**
   * `full` — sealed then mutable from `from`.
   * `mutable-refresh` — only re-read mutable years (after 1C debt cleanup week).
   */
  mode?: 'full' | 'mutable-refresh';
};

@Injectable()
export class SalesBackfillService {
  private readonly logger = new Logger(SalesBackfillService.name);
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly salesSync: AdminSalesSyncService,
    private readonly revenueSync: ClubRevenueSyncService,
  ) {}

  async status(clubId: string) {
    await this.reclaimOrphan(clubId);
    const row = await this.prisma.salesSyncState.findUnique({
      where: { clubId_resourceKey: { clubId, resourceKey: RESOURCE_KEY } },
    });
    const cursor = parseCursor(row?.cursor);
    const running =
      this.inFlight.has(clubId) ||
      (row?.lastStatus === 'running' &&
        !!row.lastRunAt &&
        Date.now() - row.lastRunAt.getTime() < ORPHAN_MS);

    return {
      running,
      jobStatus: row?.lastStatus ?? null,
      error: row?.lastError ?? null,
      lastRunAt: row?.lastRunAt?.toISOString() ?? null,
      lastSuccessAt: row?.lastSuccessAt?.toISOString() ?? null,
      cursor,
      hint: hintFor(cursor, row?.lastStatus ?? null),
    };
  }

  /**
   * Start (or resume) background backfill. Does not touch operational
   * admin_sales / club_revenue lastSuccessAt.
   */
  async start(clubId: string, body: StartBackfillBody = {}) {
    await this.reclaimOrphan(clubId);
    if (this.inFlight.has(clubId)) {
      return { status: 'running' as const, ...(await this.status(clubId)) };
    }

    const opsBusy = await this.operationalSyncBusy(clubId);
    if (opsBusy) {
      throw new BadRequestException(
        'Сначала дождитесь окончания «Обновить из 1С» — backfill не параллелится с операционным синком.',
      );
    }

    const mode = body.mode ?? 'full';
    const planFrom = assertDate(body.from ?? DEFAULT_BACKFILL_FROM, 'from');
    const planTo = assertDate(body.to ?? yesterdayUtc(), 'to');
    const sealedUntil = assertDate(
      body.sealedUntil ?? DEFAULT_SEALED_UNTIL,
      'sealedUntil',
    );
    if (planFrom > planTo) {
      throw new BadRequestException('from must be ≤ to');
    }
    if (sealedUntil < planFrom) {
      throw new BadRequestException('sealedUntil must be ≥ from');
    }

    let cursor: BackfillCursor;
    if (mode === 'mutable-refresh') {
      const mutableFrom =
        addDays(sealedUntil, 1) > planFrom ? addDays(sealedUntil, 1) : planFrom;
      if (mutableFrom > planTo) {
        throw new BadRequestException(
          'Нет «живого» периода после sealedUntil — нечего обновлять.',
        );
      }
      const existing = parseCursor(
        (
          await this.prisma.salesSyncState.findUnique({
            where: {
              clubId_resourceKey: { clubId, resourceKey: RESOURCE_KEY },
            },
          })
        )?.cursor,
      );
      cursor = {
        planFrom,
        planTo,
        sealedUntil,
        nextDay: mutableFrom,
        phase: 'mutable',
        daysDone: 0,
        daysTotal: eachUtcDay(mutableFrom, planTo).length,
        upsertedSales: existing?.upsertedSales ?? 0,
        upsertedRevenue: existing?.upsertedRevenue ?? 0,
        lastChunkFrom: null,
        lastChunkTo: null,
        mutablePass: (existing?.mutablePass ?? 0) + 1,
        note:
          'Повтор 2025–2026 после правок долгов в 1С. Закрытые годы не трогаем.',
      };
    } else {
      cursor = {
        planFrom,
        planTo,
        sealedUntil,
        nextDay: planFrom,
        phase: planFrom <= sealedUntil ? 'sealed' : 'mutable',
        daysDone: 0,
        daysTotal: eachUtcDay(planFrom, planTo).length,
        upsertedSales: 0,
        upsertedRevenue: 0,
        lastChunkFrom: null,
        lastChunkTo: null,
        mutablePass: 0,
        note:
          'Сначала закрытые годы (без долгов), затем 2025–2026 кусками. Долг подтянет обычный синк.',
      };
    }

    await this.prisma.salesSyncState.upsert({
      where: { clubId_resourceKey: { clubId, resourceKey: RESOURCE_KEY } },
      create: {
        clubId,
        resourceKey: RESOURCE_KEY,
        cursor: JSON.stringify(cursor),
        lastStatus: 'running',
        lastRunAt: new Date(),
        lastError: null,
      },
      update: {
        cursor: JSON.stringify(cursor),
        lastStatus: 'running',
        lastRunAt: new Date(),
        lastError: null,
      },
    });

    this.inFlight.add(clubId);
    void this.runLoop(clubId);

    return { status: 'started' as const, ...(await this.status(clubId)) };
  }

  async stop(clubId: string) {
    const row = await this.prisma.salesSyncState.findUnique({
      where: { clubId_resourceKey: { clubId, resourceKey: RESOURCE_KEY } },
    });
    const cursor = parseCursor(row?.cursor);
    if (cursor && cursor.phase !== 'done') {
      cursor.note = 'Остановлено вручную. Можно продолжить start без сброса курсора — см. resume.';
    }
    await this.prisma.salesSyncState.upsert({
      where: { clubId_resourceKey: { clubId, resourceKey: RESOURCE_KEY } },
      create: {
        clubId,
        resourceKey: RESOURCE_KEY,
        lastStatus: 'stopped',
        lastRunAt: new Date(),
        cursor: cursor ? JSON.stringify(cursor) : null,
      },
      update: {
        lastStatus: 'stopped',
        lastRunAt: new Date(),
        lastError: null,
        ...(cursor ? { cursor: JSON.stringify(cursor) } : {}),
      },
    });
    this.inFlight.delete(clubId);
    return this.status(clubId);
  }

  /** Continue from saved nextDay (after stop or crash). */
  async resume(clubId: string) {
    const row = await this.prisma.salesSyncState.findUnique({
      where: { clubId_resourceKey: { clubId, resourceKey: RESOURCE_KEY } },
    });
    const cursor = parseCursor(row?.cursor);
    if (!cursor || cursor.phase === 'done') {
      throw new BadRequestException(
        'Нет незавершённого backfill — запустите start (full или mutable-refresh).',
      );
    }
    if (this.inFlight.has(clubId)) {
      return { status: 'running' as const, ...(await this.status(clubId)) };
    }
    if (await this.operationalSyncBusy(clubId)) {
      throw new BadRequestException(
        'Сначала дождитесь окончания «Обновить из 1С».',
      );
    }

    cursor.note = 'Продолжение с курсора.';
    await this.prisma.salesSyncState.update({
      where: { id: row!.id },
      data: {
        cursor: JSON.stringify(cursor),
        lastStatus: 'running',
        lastRunAt: new Date(),
        lastError: null,
      },
    });
    this.inFlight.add(clubId);
    void this.runLoop(clubId);
    return { status: 'started' as const, ...(await this.status(clubId)) };
  }

  private async runLoop(clubId: string) {
    try {
      for (;;) {
        const row = await this.prisma.salesSyncState.findUnique({
          where: { clubId_resourceKey: { clubId, resourceKey: RESOURCE_KEY } },
        });
        if (!row || row.lastStatus !== 'running') break;
        if (await this.operationalSyncBusy(clubId)) {
          await this.pauseForOps(clubId, row.id);
          break;
        }

        const cursor = parseCursor(row.cursor);
        if (!cursor || cursor.phase === 'done') {
          await this.prisma.salesSyncState.update({
            where: { id: row.id },
            data: {
              lastStatus: 'ok',
              lastSuccessAt: new Date(),
              lastRunAt: new Date(),
            },
          });
          break;
        }

        const chunk = nextChunk(cursor);
        if (!chunk) {
          cursor.phase = 'done';
          cursor.note =
            cursor.mutablePass > 0
              ? 'Готово. После чистки долгов 2025–2026 в 1С: POST backfill mode=mutable-refresh.'
              : 'Готово. Закрытые годы залиты; 2025–2026 — после правок в 1С сделайте mutable-refresh.';
          await this.prisma.salesSyncState.update({
            where: { id: row.id },
            data: {
              cursor: JSON.stringify(cursor),
              lastStatus: 'ok',
              lastSuccessAt: new Date(),
              lastRunAt: new Date(),
              lastError: null,
            },
          });
          break;
        }

        const sealed = chunk.to <= cursor.sealedUntil;
        const rangeOpts = {
          skipChangeLog: true,
          delayMsBetweenDays: DELAY_MS_BETWEEN_DAYS,
        };

        this.logger.log(
          `Backfill club=${clubId} phase=${cursor.phase} chunk=${chunk.from}..${chunk.to} sealed=${sealed}`,
        );

        const sales = await this.salesSync.syncClubRange(
          clubId,
          chunk.from,
          chunk.to,
          rangeOpts,
        );
        const revenue = await this.revenueSync.syncClubRange(
          clubId,
          chunk.from,
          chunk.to,
          {
            ...rangeOpts,
            skipDebt: true,
            skipLegacyCleanup: true,
          },
        );

        cursor.upsertedSales += sales.upserted;
        cursor.upsertedRevenue += revenue.upserted;
        cursor.lastChunkFrom = chunk.from;
        cursor.lastChunkTo = chunk.to;
        cursor.daysDone += eachUtcDay(chunk.from, chunk.to).length;
        cursor.nextDay = addDays(chunk.to, 1);

        if (cursor.nextDay > cursor.planTo) {
          cursor.phase = 'done';
          cursor.note =
            'Готово. Операционный «Обновить из 1С» подтянет долги и последние дни. После чистки 2025–2026 — mode=mutable-refresh.';
        } else if (cursor.nextDay > cursor.sealedUntil) {
          cursor.phase = 'mutable';
          if (!cursor.mutablePass) cursor.mutablePass = 1;
          cursor.note =
            'Закрытые годы готовы. Идёт 2025–2026 (без долгов; долг — обычный синк).';
        } else {
          cursor.phase = 'sealed';
        }

        await this.prisma.salesSyncState.update({
          where: { id: row.id },
          data: {
            cursor: JSON.stringify(cursor),
            lastStatus: cursor.phase === 'done' ? 'ok' : 'running',
            lastSuccessAt: new Date(),
            lastRunAt: new Date(),
            lastError: null,
          },
        });

        if (cursor.phase === 'done') break;
        await sleep(PAUSE_MS_BETWEEN_CHUNKS);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Backfill failed club=${clubId}: ${message}`);
      await this.prisma.salesSyncState.updateMany({
        where: { clubId, resourceKey: RESOURCE_KEY },
        data: {
          lastStatus: 'error',
          lastError: message.slice(0, 500),
          lastRunAt: new Date(),
        },
      });
    } finally {
      this.inFlight.delete(clubId);
    }
  }

  private async pauseForOps(clubId: string, stateId: string) {
    const row = await this.prisma.salesSyncState.findUnique({
      where: { id: stateId },
    });
    const cursor = parseCursor(row?.cursor);
    if (cursor) {
      cursor.note =
        'Пауза: идёт операционный синк. После него — POST .../backfill/resume.';
    }
    await this.prisma.salesSyncState.update({
      where: { id: stateId },
      data: {
        lastStatus: 'paused',
        lastRunAt: new Date(),
        lastError: null,
        ...(cursor ? { cursor: JSON.stringify(cursor) } : {}),
      },
    });
    this.logger.warn(`Backfill paused club=${clubId} — operational sync busy`);
  }

  private async operationalSyncBusy(clubId: string): Promise<boolean> {
    const rows = await this.prisma.salesSyncState.findMany({
      where: {
        clubId,
        resourceKey: { in: ['admin_sales', 'club_revenue'] },
        lastStatus: 'running',
      },
    });
    const now = Date.now();
    return rows.some(
      (r) => r.lastRunAt && now - r.lastRunAt.getTime() < 15 * 60 * 1000,
    );
  }

  private async reclaimOrphan(clubId: string) {
    if (this.inFlight.has(clubId)) return;
    const cutoff = new Date(Date.now() - ORPHAN_MS);
    await this.prisma.salesSyncState.updateMany({
      where: {
        clubId,
        resourceKey: RESOURCE_KEY,
        lastStatus: 'running',
        OR: [{ lastRunAt: null }, { lastRunAt: { lt: cutoff } }],
      },
      data: {
        lastStatus: 'error',
        lastError:
          'Backfill прерван (перезапуск API). POST .../backfill/resume.',
        lastRunAt: new Date(),
      },
    });
  }
}

function nextChunk(
  cursor: BackfillCursor,
): { from: string; to: string } | null {
  if (cursor.nextDay > cursor.planTo) return null;
  const sealedCap =
    cursor.nextDay <= cursor.sealedUntil ? cursor.sealedUntil : null;
  const daysPerTick = sealedCap ? SEALED_DAYS_PER_TICK : MUTABLE_DAYS_PER_TICK;
  let to = cursor.nextDay;
  for (let i = 1; i < daysPerTick; i++) {
    const next = addDays(to, 1);
    if (next > cursor.planTo) break;
    if (sealedCap && next > sealedCap) break;
    // Don't cross into mutable mid-chunk when still in sealed phase.
    if (!sealedCap && cursor.nextDay <= cursor.sealedUntil) break;
    to = next;
  }
  // Cap sealed chunk at sealedUntil
  if (cursor.nextDay <= cursor.sealedUntil && to > cursor.sealedUntil) {
    to = cursor.sealedUntil;
  }
  return { from: cursor.nextDay, to };
}

function parseCursor(raw: string | null | undefined): BackfillCursor | null {
  if (!raw?.trim()) return null;
  try {
    const v = JSON.parse(raw) as BackfillCursor;
    if (!v?.planFrom || !v?.planTo || !v?.nextDay) return null;
    return v;
  } catch {
    return null;
  }
}

function hintFor(
  cursor: BackfillCursor | null,
  status: string | null,
): string | null {
  if (!cursor) {
    return 'Ещё не запускали. POST /super-admin/sales/backfill { } — 2018…вчера, sealed до 2024-12-31.';
  }
  if (status === 'running') {
    return `Идёт ${cursor.phase}: следующий день ${cursor.nextDay} (${cursor.daysDone}/${cursor.daysTotal}).`;
  }
  if (status === 'paused') {
    return cursor.note ?? 'Пауза из‑за операционного синка — resume.';
  }
  if (status === 'stopped') {
    return 'Остановлено — resume или новый start.';
  }
  if (status === 'error') {
    return 'Ошибка — resume с того же курсора или start заново.';
  }
  if (cursor.phase === 'done') {
    return (
      cursor.note ??
      'Готово. Для 2025–2026 после чистки долгов: { "mode": "mutable-refresh" }.'
    );
  }
  return cursor.note;
}

function assertDate(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${field} must be YYYY-MM-DD`);
  }
  return value;
}

function yesterdayUtc(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
