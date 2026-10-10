import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
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
/** Manual LIGHT must finish fast so staff don't hammer 1C. */
const LIGHT_RUN_BUDGET_MS = 3 * 60 * 1000;
/** Nightly FULL has the whole night window; hard cap avoids orphan forever. */
const FULL_RUN_BUDGET_MS = 40 * 60 * 1000;
/** TODAY profile: classes + visits + slots for one day. */
const TODAY_RUN_BUDGET_MS = 60 * 1000;
/** Min gap between AUTO TODAY syncs per club (success or failure). */
const TODAY_COOLDOWN_MS = 10 * 60 * 1000;
/** Extra backoff after a FAILED/PARTIAL TODAY run. */
const TODAY_FAILURE_BACKOFF_MS = 15 * 60 * 1000;

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
    private readonly moduleRef: ModuleRef,
    private readonly salesSync: AdminSalesSyncService,
    private readonly revenueSync: ClubRevenueSyncService,
    private readonly classSessions: ClassSessionsSyncService,
    private readonly hallVisits: HallVisitsSyncService,
    private readonly scheduleSlots: ScheduleSlotsSyncService,
    private readonly ptSales: TrainerPtSalesSyncService,
    private readonly specialistDebts: SpecialistDebtSyncService,
    private readonly memberships: MembershipSnapshotSyncService,
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

  async lastSuccessfulToday(clubId: string) {
    return this.prisma.clubSyncRun.findFirst({
      where: {
        clubId,
        profile: ClubSyncProfile.TODAY,
        status: {
          in: [ClubSyncRunStatus.SUCCESS, ClubSyncRunStatus.PARTIAL],
        },
      },
      orderBy: { finishedAt: 'desc' },
    });
  }

  /**
   * Fire-and-forget today-only sync for staff screens.
   * At most one run per club every TODAY_COOLDOWN_MS; skips night window
   * and when another sync is already RUNNING.
   */
  ensureFreshToday(clubId: string): void {
    void this.ensureFreshTodayAsync(clubId).catch((err) => {
      this.logger.warn(
        `ensureFreshToday ${clubId}: ${err instanceof Error ? err.message : err}`,
      );
    });
  }

  private async ensureFreshTodayAsync(clubId: string): Promise<void> {
    if (isMoscowNightWindow()) return;

    await this.reclaimOrphan(clubId);
    const running = await this.getRunning(clubId);
    if (running) return;

    // Cooldown from any finished TODAY run (SUCCESS / PARTIAL / FAILED),
    // so a failing sync does not re-hit 1C on every staff screen open.
    const last = await this.prisma.clubSyncRun.findFirst({
      where: {
        clubId,
        profile: ClubSyncProfile.TODAY,
        status: {
          in: [
            ClubSyncRunStatus.SUCCESS,
            ClubSyncRunStatus.PARTIAL,
            ClubSyncRunStatus.FAILED,
          ],
        },
        finishedAt: { not: null },
      },
      orderBy: { finishedAt: 'desc' },
    });
    if (last?.finishedAt) {
      const failed =
        last.status === ClubSyncRunStatus.FAILED ||
        last.status === ClubSyncRunStatus.PARTIAL;
      const cooldown = failed
        ? TODAY_COOLDOWN_MS + TODAY_FAILURE_BACKOFF_MS
        : TODAY_COOLDOWN_MS;
      if (Date.now() < last.finishedAt.getTime() + cooldown) return;
    }

    await this.start(clubId, {
      trigger: ClubSyncTrigger.AUTO,
      profile: ClubSyncProfile.TODAY,
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

    try {
      const today = moscowDayKey();
      const isFull = profile === ClubSyncProfile.FULL;
      const isToday = profile === ClubSyncProfile.TODAY;
      const deadline =
        Date.now() +
        (isFull
          ? FULL_RUN_BUDGET_MS
          : isToday
            ? TODAY_RUN_BUDGET_MS
            : LIGHT_RUN_BUDGET_MS);

      const schedFrom = today;
      const schedTo = isToday
        ? today
        : addMoscowDays(today, isFull ? 14 : 2);
      const classFrom = isToday
        ? today
        : isFull
          ? undefined
          : addMoscowDays(today, -1);
      const classTo = isToday
        ? today
        : isFull
          ? undefined
          : addMoscowDays(today, 1);

      const runStep = async (
        resource: string,
        fn: () => Promise<{ rows?: number; from?: string; to?: string }>,
      ) => {
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
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          steps.push({
            resource,
            skipped: true,
            error: 'Run budget exceeded',
          });
          await this.prisma.clubSyncRun.update({
            where: { id: runId },
            data: { steps, heartbeatAt: new Date() },
          });
          return;
        }
        try {
          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          const res = await Promise.race([
            fn().finally(() => {
              if (timeoutId !== undefined) clearTimeout(timeoutId);
            }),
            new Promise<never>((_, reject) => {
              timeoutId = setTimeout(
                () =>
                  reject(
                    new Error(
                      `Step timed out (run budget, ${Math.round(remaining / 1000)}s left)`,
                    ),
                  ),
                remaining,
              );
            }),
          ]);
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
          this.logger.error(
            `Sync step ${resource} failed club=${clubId}: ${msg}`,
          );
          steps.push({ resource, error: msg });
          await this.prisma.clubSyncRun.update({
            where: { id: runId },
            data: { steps, heartbeatAt: new Date() },
          });
        }
      };

      if (isToday) {
        await runStep('class_sessions', async () => {
          const r = await this.classSessions.syncClub(clubId, {
            from: today,
            to: today,
          });
          return {
            rows: r.sessionsUpserted,
            from: r.from,
            to: r.to,
          };
        });

        await runStep('hall_visits', async () => {
          const r = await this.hallVisits.syncClub(clubId, {
            from: today,
            to: today,
          });
          return { rows: r.upserted, from: r.from, to: r.to };
        });

        await runStep('schedule_slots', async () => {
          const r = await this.scheduleSlots.syncClub(clubId, {
            from: today,
            to: today,
          });
          return { rows: r.upserted, from: r.from, to: r.to };
        });
      } else {
        await runStep('admin_sales', async () => {
          if (isFull) {
            const r = await this.salesSync.syncClub(clubId, 'incremental');
            return { rows: r.upserted, from: r.from, to: r.to };
          }
          const r = await this.salesSync.syncClubQuick(clubId);
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

        // Full: ~1.5 months so «ЗП по тренерам» can fall back to DB when live 1C is slow.
        const ptFrom = isFull
          ? addMoscowDays(today, -45)
          : addMoscowDays(today, -1);
        const ptTo = today;

        await runStep('trainer_pt_sales', async () => {
          const r = await this.ptSales.syncClub(clubId, {
            from: ptFrom,
            to: ptTo,
          });
          return { rows: r.upserted, from: r.from, to: r.to };
        });

        if (isFull) {
          await runStep('specialist_debts', async () => {
            const r = await this.specialistDebts.syncClub(clubId, {
              from: ptFrom,
              to: ptTo,
            });
            return { rows: r.upserted, from: r.from, to: r.to };
          });

          await runStep('membership_snapshots', async () => {
            const r = await this.memberships.syncClub(clubId, {
              limit: MEMBERSHIP_LIMITS.FULL,
            });
            return { rows: r.upserted };
          });

          await runStep('admin_tasks', async () => {
            const adminTasks = this.moduleRef.get(AdminTasksSchedulerService, {
              strict: false,
            });
            const club = await this.prisma.club.findUnique({
              where: { id: clubId },
              select: { externalId: true },
            });
            const r = await adminTasks.generateForClub(
              clubId,
              club?.externalId ?? null,
              today,
            );
            return {
              rows:
                (r?.debt ?? 0) +
                (r?.membership ?? 0) +
                (r?.installment ?? 0),
            };
          });
        }

        // Warm installments cache so analytics does not cold-hit 1C.
        try {
          const { ClubAnalyticsService } = await import(
            '../analytics/club-analytics.service'
          );
          const clubAnalytics = this.moduleRef.get(ClubAnalyticsService, {
            strict: false,
          });
          clubAnalytics?.warmInstallmentsCache?.(clubId);
        } catch {
          /* analytics module may be unavailable in tests */
        }
      }

      const failed = steps.filter((s) => s.error && !s.skipped);
      const skipped = steps.filter((s) => s.skipped);
      const status =
        failed.length === 0 && skipped.length === 0
          ? ClubSyncRunStatus.SUCCESS
          : failed.length === steps.length
            ? ClubSyncRunStatus.FAILED
            : ClubSyncRunStatus.PARTIAL;

      const firstIssue = failed[0] ?? skipped[0];
      const lastError = firstIssue?.error
        ? `${firstIssue.resource}: ${firstIssue.error}`
        : null;

      stopHeartbeat();
      await this.prisma.clubSyncRun.update({
        where: { id: runId },
        data: {
          status,
          finishedAt: new Date(),
          heartbeatAt: new Date(),
          steps,
          lastError,
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
