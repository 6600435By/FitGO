import { Injectable } from '@nestjs/common';
import { VisitSource, VisitVerification } from '@prisma/client';
import { classifyVisitKind, type VisitKind } from '@fitgo/shared-types';
import { FitnessService } from '../fitness/fitness.service';
import { PrismaService } from '../prisma/prisma.service';
import { VisitSyncService } from '../engagement/visit-sync.service';
import { ServiceUsageService } from '../service-usage/service-usage.service';

const RESOURCE_KEY = 'hall_visits';
const PAGE_SIZE = 500;

export type HallVisitsSyncResult = {
  from: string;
  to: string;
  upserted: number;
  linkedEvents: number;
  endpointMissing: boolean;
};

@Injectable()
export class HallVisitsSyncService {
  private readonly running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
    private readonly visitSync: VisitSyncService,
    private readonly serviceUsage: ServiceUsageService,
  ) {}

  yearToDateWindow(now = new Date()): { from: string; to: string } {
    return {
      from: `${now.getUTCFullYear()}-01-01`,
      to: now.toISOString().slice(0, 10),
    };
  }

  /** Last 14 days — operational. */
  operationalWindow(now = new Date()): { from: string; to: string } {
    const to = now.toISOString().slice(0, 10);
    const fromD = new Date(now);
    fromD.setUTCDate(fromD.getUTCDate() - 14);
    return { from: fromD.toISOString().slice(0, 10), to };
  }

  async syncClub(
    clubId: string,
    opts?: { from?: string; to?: string; forceYear?: boolean },
  ): Promise<HallVisitsSyncResult> {
    if (this.running.has(clubId)) {
      return {
        from: opts?.from ?? '',
        to: opts?.to ?? '',
        upserted: 0,
        linkedEvents: 0,
        endpointMissing: false,
      };
    }
    this.running.add(clubId);
    try {
      const win =
        opts?.from && opts?.to
          ? { from: opts.from, to: opts.to }
          : opts?.forceYear
            ? this.yearToDateWindow()
            : this.operationalWindow();
      return await this.syncRange(clubId, win.from, win.to);
    } finally {
      this.running.delete(clubId);
    }
  }

  async syncRange(
    clubId: string,
    from: string,
    to: string,
  ): Promise<HallVisitsSyncResult> {
    const provider = this.fitness.getProvider();
    if (!provider.getClubVisitsPage) {
      return {
        from,
        to,
        upserted: 0,
        linkedEvents: 0,
        endpointMissing: true,
      };
    }

    // Prefer day-by-day to keep 1C memory small
    const days = eachUtcDay(from, to);
    let upserted = 0;
    let linkedEvents = 0;
    let endpointMissing = false;

    for (const day of days) {
      let page = 1;
      let total = Infinity;
      while ((page - 1) * PAGE_SIZE < total) {
        const batch = await provider.getClubVisitsPage({
          from: day,
          to: day,
          page,
          pageSize: PAGE_SIZE,
        });
        if (!batch) {
          if (page === 1 && day === days[0]) endpointMissing = true;
          break;
        }
        total = batch.total;
        if (batch.data.length === 0) break;

        for (const row of batch.data) {
          if (!row.id?.trim()) continue;
          const visitDate = (row.date || day).slice(0, 10);
          const checkIn = row.checkIn ? new Date(row.checkIn) : null;
          const checkOut = row.checkOut ? new Date(row.checkOut) : null;
          const kind = row.kind
            ? classifyVisitKind({ kind: row.kind, title: row.title })
            : undefined;

          await this.prisma.clubHallVisit.upsert({
            where: {
              clubId_externalId: { clubId, externalId: row.id.trim() },
            },
            create: {
              clubId,
              externalId: row.id.trim(),
              clientExternalId: row.externalId?.trim() || null,
              visitDate,
              checkIn:
                checkIn && !Number.isNaN(checkIn.getTime()) ? checkIn : null,
              checkOut:
                checkOut && !Number.isNaN(checkOut.getTime()) ? checkOut : null,
              title: row.title ?? null,
              kind: kind ?? row.kind ?? null,
              basisType: row.basisType ?? null,
              isActive: true,
              syncedAt: new Date(),
            },
            update: {
              clientExternalId: row.externalId?.trim() || null,
              visitDate,
              checkIn:
                checkIn && !Number.isNaN(checkIn.getTime()) ? checkIn : null,
              checkOut:
                checkOut && !Number.isNaN(checkOut.getTime()) ? checkOut : null,
              title: row.title ?? null,
              kind: kind ?? row.kind ?? null,
              basisType: row.basisType ?? null,
              isActive: true,
              syncedAt: new Date(),
            },
          });
          upserted += 1;

          const clientExt = row.externalId?.trim();
          if (!clientExt) continue;
          const user = await this.prisma.user.findFirst({
            where: { clubId, externalId: clientExt },
          });
          if (!user) continue;

          const occurredAt =
            checkIn && !Number.isNaN(checkIn.getTime())
              ? checkIn
              : new Date(`${visitDate}T12:00:00.000Z`);

          await this.visitSync.upsertEvent({
            userId: user.id,
            clubId,
            externalKey: `1c:${row.id.trim()}`,
            kind: (kind ?? 'UNKNOWN') as VisitKind,
            verification: VisitVerification.VERIFIED_1C,
            source: VisitSource.ONEC_SYNC,
            occurredAt,
            title: row.title,
            externalId: row.id.trim(),
            checkIn: row.checkIn,
            checkOut: row.checkOut,
          });
          linkedEvents += 1;
          await this.serviceUsage
            .markPresenceFromVisit(user.id, occurredAt)
            .catch(() => undefined);
        }
        page += 1;
        if (page > 200) break;
      }
      if (endpointMissing) break;
    }

    await this.prisma.salesSyncState.upsert({
      where: {
        clubId_resourceKey: { clubId, resourceKey: RESOURCE_KEY },
      },
      create: {
        clubId,
        resourceKey: RESOURCE_KEY,
        lastRunAt: new Date(),
        lastSuccessAt: new Date(),
        lastStatus: endpointMissing ? 'missing_endpoint' : 'ok',
        lastError: endpointMissing
          ? 'Club GET /v1/visits (from/to) not published'
          : null,
      },
      update: {
        lastRunAt: new Date(),
        lastSuccessAt: endpointMissing ? undefined : new Date(),
        lastStatus: endpointMissing ? 'missing_endpoint' : 'ok',
        lastError: endpointMissing
          ? 'Club GET /v1/visits (from/to) not published'
          : null,
      },
    });

    return { from, to, upserted, linkedEvents, endpointMissing };
  }
}

function eachUtcDay(fromStr: string, toStr: string): string[] {
  const days: string[] = [];
  const cur = new Date(`${fromStr}T00:00:00.000Z`);
  const end = new Date(`${toStr}T00:00:00.000Z`);
  while (cur <= end) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}
