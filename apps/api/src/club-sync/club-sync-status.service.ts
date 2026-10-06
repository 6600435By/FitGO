import { Injectable } from '@nestjs/common';
import { ClubSyncRunStatus, ClubSyncTrigger } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  formatMoscowDataAsOf,
  isMoscowNightWindow,
  nextNightlyAtIso,
} from './moscow-time';
import { MANUAL_COOLDOWN_MS } from './club-sync-orchestrator.service';

/** Resources that feed the global «Данные на …» label (updated by LIGHT + FULL). */
const FRESHNESS_RESOURCES = [
  'admin_sales',
  'club_revenue',
  'class_sessions',
  'hall_visits',
  'schedule_slots',
  'trainer_pt_sales',
] as const;

/** Night-only extras still exposed in `resources` for debugging. */
const NIGHT_ONLY_RESOURCES = [
  'specialist_debts',
  'membership_snapshots',
] as const;

const KEY_RESOURCES = [...FRESHNESS_RESOURCES, ...NIGHT_ONLY_RESOURCES] as const;

export type ClubSyncStatusDto = {
  dataAsOf: string | null;
  dataAsOfIso: string | null;
  freshness: 'green' | 'yellow' | 'red';
  sourceLabel: string | null;
  resources: Record<
    string,
    { lastSuccessAt: string | null; lastStatus: string | null; lastError: string | null }
  >;
  running: {
    runId: string;
    startedAt: string;
    triggeredByUserId: string | null;
    triggeredByName: string | null;
    trigger: ClubSyncTrigger;
    profile: string;
  } | null;
  cooldownUntil: string | null;
  nextNightlyAt: string;
  inNightWindow: boolean;
  lastError: string | null;
  lastRun: {
    id: string;
    status: ClubSyncRunStatus;
    trigger: ClubSyncTrigger;
    finishedAt: string | null;
    startedAt: string;
  } | null;
};

@Injectable()
export class ClubSyncStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async status(clubId: string, opts?: { includeErrors?: boolean }): Promise<ClubSyncStatusDto> {
    const states = await this.prisma.salesSyncState.findMany({
      where: { clubId, resourceKey: { in: [...KEY_RESOURCES] } },
    });
    const resources: ClubSyncStatusDto['resources'] = {};
    let minSuccess: Date | null = null;
    for (const key of KEY_RESOURCES) {
      const s = states.find((x) => x.resourceKey === key);
      resources[key] = {
        lastSuccessAt: s?.lastSuccessAt?.toISOString() ?? null,
        lastStatus: s?.lastStatus ?? null,
        lastError: opts?.includeErrors ? (s?.lastError ?? null) : null,
      };
      if (
        (FRESHNESS_RESOURCES as readonly string[]).includes(key) &&
        s?.lastSuccessAt
      ) {
        if (!minSuccess || s.lastSuccessAt < minSuccess) {
          minSuccess = s.lastSuccessAt;
        }
      }
    }

    const running = await this.prisma.clubSyncRun.findFirst({
      where: { clubId, status: ClubSyncRunStatus.RUNNING },
      orderBy: { startedAt: 'desc' },
    });

    let triggeredByName: string | null = null;
    if (running?.triggeredByUserId) {
      const u = await this.prisma.user.findUnique({
        where: { id: running.triggeredByUserId },
        select: { firstName: true, lastName: true },
      });
      if (u) triggeredByName = `${u.firstName} ${u.lastName}`.trim();
    }

    const lastRun = await this.prisma.clubSyncRun.findFirst({
      where: { clubId },
      orderBy: { startedAt: 'desc' },
    });

    const lastManualOk = await this.prisma.clubSyncRun.findFirst({
      where: {
        clubId,
        trigger: ClubSyncTrigger.MANUAL,
        status: {
          in: [ClubSyncRunStatus.SUCCESS, ClubSyncRunStatus.PARTIAL],
        },
      },
      orderBy: { finishedAt: 'desc' },
    });

    let cooldownUntil: string | null = null;
    if (lastManualOk?.finishedAt) {
      const until = lastManualOk.finishedAt.getTime() + MANUAL_COOLDOWN_MS;
      if (Date.now() < until) cooldownUntil = new Date(until).toISOString();
    }

    let sourceLabel: string | null = null;
    if (lastRun?.trigger === ClubSyncTrigger.NIGHTLY && lastRun.finishedAt) {
      sourceLabel = 'ночная выгрузка';
    } else if (lastManualOk?.triggeredByUserId) {
      const u = await this.prisma.user.findUnique({
        where: { id: lastManualOk.triggeredByUserId },
        select: { firstName: true, lastName: true },
      });
      if (u) sourceLabel = `обновил ${u.firstName} ${u.lastName}`.trim();
      else sourceLabel = 'ручное обновление';
    } else if (minSuccess) {
      sourceLabel = 'кэш FitGO';
    }

    const freshness = computeFreshness(minSuccess, lastRun);

    return {
      dataAsOf: formatMoscowDataAsOf(minSuccess),
      dataAsOfIso: minSuccess?.toISOString() ?? null,
      freshness,
      sourceLabel,
      resources,
      running: running
        ? {
            runId: running.id,
            startedAt: running.startedAt.toISOString(),
            triggeredByUserId: running.triggeredByUserId,
            triggeredByName,
            trigger: running.trigger,
            profile: running.profile,
          }
        : null,
      cooldownUntil,
      nextNightlyAt: nextNightlyAtIso(),
      inNightWindow: isMoscowNightWindow(),
      lastError: opts?.includeErrors ? (lastRun?.lastError ?? null) : null,
      lastRun: lastRun
        ? {
            id: lastRun.id,
            status: lastRun.status,
            trigger: lastRun.trigger,
            finishedAt: lastRun.finishedAt?.toISOString() ?? null,
            startedAt: lastRun.startedAt.toISOString(),
          }
        : null,
    };
  }

  /** Per-resource dataAsOf for embedding in API responses. */
  async resourceDataAsOf(clubId: string, resourceKey: string): Promise<string | null> {
    const s = await this.prisma.salesSyncState.findUnique({
      where: { clubId_resourceKey: { clubId, resourceKey } },
    });
    return formatMoscowDataAsOf(s?.lastSuccessAt ?? null);
  }
}

function computeFreshness(
  minSuccess: Date | null,
  lastRun: {
    status: ClubSyncRunStatus;
    trigger: ClubSyncTrigger;
    finishedAt: Date | null;
  } | null,
): 'green' | 'yellow' | 'red' {
  if (
    lastRun?.trigger === ClubSyncTrigger.NIGHTLY &&
    lastRun.status === ClubSyncRunStatus.FAILED
  ) {
    return 'red';
  }
  if (!minSuccess) return 'red';
  const ageMs = Date.now() - minSuccess.getTime();
  if (ageMs > 24 * 3600_000) return 'red';
  if (ageMs <= 60 * 60_000) return 'green';
  // After nightly until 10:00 Moscow → green
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Moscow',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date()),
  );
  if (
    lastRun?.trigger === ClubSyncTrigger.NIGHTLY &&
    lastRun.status !== ClubSyncRunStatus.FAILED &&
    hour < 10
  ) {
    return 'green';
  }
  return 'yellow';
}
