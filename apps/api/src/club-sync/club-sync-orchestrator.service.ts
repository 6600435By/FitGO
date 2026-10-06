import { Injectable, Logger } from '@nestjs/common';
import {
  ClubSyncProfile,
  ClubSyncRunStatus,
  ClubSyncTrigger,
  Prisma,
} from '@prisma/client';
import { AdminSalesSyncService } from '../admin-sales/admin-sales-sync.service';
import { ClubRevenueSyncService } from '../admin-sales/club-revenue-sync.service';
import { ClassSessionsSyncService } from '../class-sync/class-sessions-sync.service';
import { HallVisitsSyncService } from '../class-sync/hall-visits-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminTasksSchedulerService } from '../super-admin/admin-tasks-scheduler.service';
import {
  MEMBERSHIP_LIMITS,
  MembershipSnapshotSyncService,
} from './membership-snapshot-sync.service';
import {
  addMoscowDays,
  isMoscowNightWindow,
  moscowDayKey,
} from './moscow-time';
import { ScheduleSlotsSyncService } from './schedule-slots-sync.service';
import { SpecialistDebtSyncService } from './specialist-debt-sync.service';
import { TrainerPtSalesSyncService } from './trainer-pt-sales-sync.service';

const ORPHAN_MS = 3 * 60 * 1000;
const HEARTBEAT_MS = 20_000;
const MANUAL_COOLDOWN_MS = 10 * 60 * 1000;

export type SyncStepResult = {
  resource: string;
  from?: string;
  to?: string;
  rows?: number;
  error?: string;
  skipped?: boolean;
};

export type StartSyncResult =
  | {
      status: 'started';
      runId: string;
    }
  | {
      status: 'running';
      runId: string;
      startedAt: string;
      triggeredByUserId: string | null;
    }
  | {
      status: 'cooldown';
      until: string;
      reason: 'manual_cooldown' | 'night_window';
    }
  | {
      status: 'already_nightly';
      nightKey: string;
    };

@Injectable()
export class ClubSyncOrchestrator {
  private readonly logger = new Logger(ClubSyncOrchestrator.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly salesSync: AdminSalesSyncService,
    private readonly revenueSync: ClubRevenueSyncService,
    private readonly classSessions: ClassSessionsSyncService,
    private readonly hallVisits: HallVisitsSyncService,
    private readonly scheduleSlots: ScheduleSlotsSyncService,
    private readonly ptSales: TrainerPtSalesSyncService,
    private readonly specialistDebts: SpecialistDebtSyncService,
    private readonly memberships: MembershipSnapshotSyncService,
    private readonly adminTasks: AdminTasksSchedulerService,
  ) {}

  async reclaimOrphan(clubId: string): Promise<void> {
    const cutoff = new Date(Date.now() - ORPHAN_MS);
    await this.prisma.clubSyncRun.updateMany({
      where: {
        clubId,
        status: ClubSyncRunStatus.RUNNING,
        heartbeatAt: { lt: cutoff },
      },
      data: {
        status: ClubSyncRunStatus.FAILED,
        finishedAt: new Date(),
        lastError: 'Orphaned RUNNING — heartbeat stale (>3 min)',
      },
    });
  }

  async getRunning(clubId: string) {
    return this.prisma.clubSyncRun.findFirst({
      where: { clubId, status: ClubSyncRunStatus.RUNNING },
      orderBy: { startedAt: 'desc' },
    });
  }

  async lastSuccessfulManual(clubId: string) {
    return this.prisma.clubSyncRun.findFirst({
      where: {
        clubId,
        trigger: ClubSyncTrigger.MANUAL,
        status: {
          in: [ClubSyncRunStatus.SUCCESS, ClubSyncRunStatus.PARTIAL],
        },
      },
      orderBy: { finishedAt: 'desc' },
    });
  }

  /**
   * Try to start a sync. Returns immediately; work runs in background.
   * DB partial unique on RUNNING(clubId) is the real lock.
   */
  async start(
    clubId: string,
    opts: {
      trigger: ClubSyncTrigger;
      profile: ClubSyncProfile;
      userId?: string | null;
      /** Skip cooldown / night checks (used by nightly scheduler). */
      force?: boolean;
    },
  ): Promise<StartSyncResult> {
    await this.reclaimOrphan(clubId);

    const running = await this.getRunning(clubId);
    if (running) {
      return {
        status: 'running',
        runId: running.id,
        startedAt: running.startedAt.toISOString(),
        triggeredByUserId: running.triggeredByUserId,
      };
    }

    if (!opts.force && opts.trigger === ClubSyncTrigger.MANUAL) {
      if (isMoscowNightWindow()) {
        return {
          status: 'cooldown',
          until: new Date(Date.now() + 60_000).toISOString(),
          reason: 'night_window',
        };
      }
      const last = await this.lastSuccessfulManual(clubId);
      if (last?.finishedAt) {
        const until = last.finishedAt.getTime() + MANUAL_COOLDOWN_MS;
        if (Date.now() < until) {
          return {
            status: 'cooldown',
            until: new Date(until).toISOString(),
            reason: 'manual_cooldown',
          };
        }
      }
    }

    const nightKey =
      opts.trigger === ClubSyncTrigger.NIGHTLY ? moscowDayKey() : null;

    if (nightKey) {
      const existingNight = await this.prisma.clubSyncRun.findFirst({
        where: { clubId, nightKey },
      });
      if (existingNight) {
        return { status: 'already_nightly', nightKey };
      }
    }

    let run;
    try {
      run = await this.prisma.clubSyncRun.create({
        data: {
          clubId,
          trigger: opts.trigger,
          profile: opts.profile,
          status: ClubSyncRunStatus.RUNNING,
          triggeredByUserId: opts.userId ?? null,
          nightKey,
          heartbeatAt: new Date(),
          steps: [],
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const again = await this.getRunning(clubId);
        if (again) {
          return {
            status: 'running',
            runId: again.id,
            startedAt: again.startedAt.toISOString(),
            triggeredByUserId: again.triggeredByUserId,
          };
        }
        if (nightKey) {
          return { status: 'already_nightly', nightKey };
        }
      }
      throw err;
    }

    void this.execute(run.id, clubId, opts.profile, opts.trigger);
    return { status: 'started', runId: run.id };
  }

  private async execute(
    runId: string,
    clubId: string,
    profile: ClubSyncProfile,
    trigger: ClubSyncTrigger,
  ) {
    const steps: SyncStepResult[] = [];
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    const stopHeartbeat = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    };

    heartbeatTimer = setInterval(() => {
      void this.prisma.clubSyncRun
        .update({
          where: { id: runId },
          data: { heartbeatAt: new Date() },
        })
        .catch(() => undefined);
    }, HEARTBEAT_MS);

    const runStep = async (
      resource: string,
      fn: () => Promise<{ rows?: number; from?: string; to?: string }>,
    ) => {
      // Cut LIGHT/FULL early if night window ended for NIGHTLY.
      if (
        trigger === ClubSyncTrigger.NIGHTLY &&
        !isMoscowNightWindow() &&
        steps.length > 0
      ) {
        steps.push({
          resource,
          skipped: true,
          error: 'Night window ended (after 04:00 Moscow)',
        });
        return;
      }
      try {
        const res = await fn();
        steps.push({
          resource,
          from: res.from,
          to: res.to,
          rows: res.rows ?? 0,
        });
        await this.prisma.clubSyncRun.update({
          where: { id: runId },
          data: { steps, heartbeatAt: new Date() },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Sync step ${resource} failed club=${clubId}: ${msg}`);
        steps.push({ resource, error: msg });
        await this.prisma.clubSyncRun.update({
          where: { id: runId },
          data: { steps, heartbeatAt: new Date() },
        });
      }
    };

    try {
      const today = moscowDayKey();
      const isFull = profile === ClubSyncProfile.FULL;

      const schedFrom = today;
      const schedTo = addMoscowDays(today, isFull ? 14 : 7);
      const classFrom = isFull
        ? undefined
        : addMoscowDays(today, -1);
      const classTo = isFull ? undefined : addMoscowDays(today, 1);
      const salesMode = isFull ? 'incremental' : 'incremental';

      await runStep('admin_sales', async () => {
        if (isFull) {
          const r = await this.salesSync.syncClub(clubId, salesMode);
          return { rows: r.upserted, from: r.from, to: r.to };
        }
        // LIGHT: quick window via revenue quick + sales incremental (sales already overlap).
        const r = await this.salesSync.syncClub(clubId, 'incremental');
        return { rows: r.upserted, from: r.from, to: r.to };
      });

      await runStep('club_revenue', async () => {
        if (isFull) {
          const r = await this.revenueSync.syncClub(clubId, 'incremental');
          return { rows: r.upserted, from: r.from, to: r.to };
        }
        const r = await this.revenueSync.syncClubQuick(clubId);
        return { rows: r.upserted, from: r.from, to: r.to };
      });

      await runStep('class_sessions', async () => {
        const r = await this.classSessions.syncClub(clubId, {
          from: classFrom,
          to: classTo,
        });
        return {
          rows: r.sessionsUpserted,
          from: r.from,
          to: r.to,
        };
      });

      await runStep('hall_visits', async () => {
        const r = await this.hallVisits.syncClub(clubId, {
          from: classFrom,
          to: classTo,
        });
        return { rows: r.upserted, from: r.from, to: r.to };
      });

      await runStep('schedule_slots', async () => {
        const r = await this.scheduleSlots.syncClub(clubId, {
          from: schedFrom,
          to: schedTo,
        });
        return { rows: r.upserted, from: r.from, to: r.to };
      });

      const ptFrom = isFull ? addMoscowDays(today, -14) : addMoscowDays(today, -1);
      const ptTo = today;

      await runStep('trainer_pt_sales', async () => {
        const r = await this.ptSales.syncClub(clubId, {
          from: ptFrom,
          to: ptTo,
        });
        return { rows: r.upserted, from: r.from, to: r.to };
      });

      await runStep('specialist_debts', async () => {
        const r = await this.specialistDebts.syncClub(clubId, {
          from: ptFrom,
          to: ptTo,
        });
        return { rows: r.upserted, from: r.from, to: r.to };
      });

      await runStep('membership_snapshots', async () => {
        const r = await this.memberships.syncClub(clubId, {
          limit: isFull ? MEMBERSHIP_LIMITS.FULL : MEMBERSHIP_LIMITS.LIGHT,
        });
        return { rows: r.upserted };
      });

      if (isFull) {
        await runStep('admin_tasks', async () => {
          const club = await this.prisma.club.findUnique({
            where: { id: clubId },
            select: { externalId: true },
          });
          const r = await this.adminTasks.generateForClub(
            clubId,
            club?.externalId ?? null,
            today,
          );
          return { rows: (r?.debt ?? 0) + (r?.membership ?? 0) };
        });
      }

      const failed = steps.filter((s) => s.error && !s.skipped);
      const skipped = steps.filter((s) => s.skipped);
      const status =
        failed.length === 0 && skipped.length === 0
          ? ClubSyncRunStatus.SUCCESS
          : failed.length === steps.length
            ? ClubSyncRunStatus.FAILED
            : ClubSyncRunStatus.PARTIAL;

      stopHeartbeat();
      await this.prisma.clubSyncRun.update({
        where: { id: runId },
        data: {
          status,
          finishedAt: new Date(),
          heartbeatAt: new Date(),
          steps,
          lastError: failed[0]?.error ?? skipped[0]?.error ?? null,
        },
      });
      this.logger.log(
        `Club sync ${clubId} ${profile}/${trigger} → ${status} (${steps.length} steps)`,
      );
    } catch (err) {
      stopHeartbeat();
      const msg = err instanceof Error ? err.message : String(err);
      await this.prisma.clubSyncRun.update({
        where: { id: runId },
        data: {
          status: ClubSyncRunStatus.FAILED,
          finishedAt: new Date(),
          lastError: msg,
          steps,
        },
      });
      this.logger.error(`Club sync ${clubId} crashed: ${msg}`);
    }
  }
}

export { MANUAL_COOLDOWN_MS };
