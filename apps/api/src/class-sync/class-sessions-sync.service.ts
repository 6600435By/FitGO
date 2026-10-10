import { Injectable } from '@nestjs/common';
import {
  GroupClassSessionStatus,
  GroupSessionBaselineQuality,
  GroupSessionMemberAttendance,
  GroupSessionMemberSource,
  OnexClassKind,
  OnexClassMemberAttendance,
  OnexClassStatus,
  Role,
  TrustBand,
} from '@prisma/client';
import type { FitgoClassSessionRow } from '@fitgo/1c-adapter';
import { FitnessService } from '../fitness/fitness.service';
import { PrismaService } from '../prisma/prisma.service';
import { ServiceUsageService } from '../service-usage/service-usage.service';

const RESOURCE_KEY = 'class_sessions';
const PAGE_SIZE = 100;

export type ClassSyncResult = {
  from: string;
  to: string;
  sessionsUpserted: number;
  membersUpserted: number;
  journalsTouched: number;
  endpointMissing: boolean;
};

@Injectable()
export class ClassSessionsSyncService {
  private readonly running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
    private readonly serviceUsage: ServiceUsageService,
  ) {}

  /** Past calendar month start → today+31d (schedule + open payroll window). */
  operationalWindow(now = new Date()): { from: string; to: string } {
    const prev = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );
    const ahead = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 31),
    );
    return {
      from: prev.toISOString().slice(0, 10),
      to: ahead.toISOString().slice(0, 10),
    };
  }

  /** 1 Jan current year → today. */
  yearToDateWindow(now = new Date()): { from: string; to: string } {
    const y = now.getUTCFullYear();
    return {
      from: `${y}-01-01`,
      to: now.toISOString().slice(0, 10),
    };
  }

  async syncClub(
    clubId: string,
    opts?: { from?: string; to?: string; forceYear?: boolean },
  ): Promise<ClassSyncResult> {
    if (this.running.has(clubId)) {
      return {
        from: opts?.from ?? '',
        to: opts?.to ?? '',
        sessionsUpserted: 0,
        membersUpserted: 0,
        journalsTouched: 0,
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
  ): Promise<ClassSyncResult> {
    const provider = this.fitness.getProvider();
    if (!provider.getClassSessions) {
      return {
        from,
        to,
        sessionsUpserted: 0,
        membersUpserted: 0,
        journalsTouched: 0,
        endpointMissing: true,
      };
    }

    let page = 1;
    let total = Infinity;
    let sessionsUpserted = 0;
    let membersUpserted = 0;
    let journalsTouched = 0;
    let endpointMissing = false;
    const seenIds = new Set<string>();

    while ((page - 1) * PAGE_SIZE < total) {
      const batch = await provider.getClassSessions({
        from,
        to,
        page,
        pageSize: PAGE_SIZE,
      });
      if (!batch) {
        endpointMissing = page === 1;
        break;
      }
      total = batch.total;
      if (batch.data.length === 0) break;

      for (const row of batch.data) {
        if (!row.id?.trim()) continue;
        seenIds.add(row.id.trim());
        const r = await this.upsertSession(clubId, row);
        sessionsUpserted += 1;
        membersUpserted += r.members;
        journalsTouched += r.journal ? 1 : 0;
      }
      page += 1;
      if (page > 500) break;
    }

    // Soft-deactivate sessions in range that disappeared from 1C (not payroll-locked)
    if (!endpointMissing && seenIds.size > 0) {
      const fromD = new Date(`${from}T00:00:00.000Z`);
      const toD = new Date(`${to}T23:59:59.999Z`);
      const stale = await this.prisma.onexClassSession.findMany({
        where: {
          clubId,
          isActive: true,
          payrollLocked: false,
          startAt: { gte: fromD, lte: toD },
          externalId: { notIn: [...seenIds] },
        },
        select: { id: true },
      });
      if (stale.length) {
        await this.prisma.onexClassSession.updateMany({
          where: { id: { in: stale.map((s) => s.id) } },
          data: { isActive: false, syncedAt: new Date() },
        });
      }
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
          ? 'GET /v1/class-sessions not published'
          : null,
      },
      update: {
        lastRunAt: new Date(),
        lastSuccessAt: endpointMissing ? undefined : new Date(),
        lastStatus: endpointMissing ? 'missing_endpoint' : 'ok',
        lastError: endpointMissing
          ? 'GET /v1/class-sessions not published'
          : null,
      },
    });

    return {
      from,
      to,
      sessionsUpserted,
      membersUpserted,
      journalsTouched,
      endpointMissing,
    };
  }

  private async upsertSession(
    clubId: string,
    row: FitgoClassSessionRow,
  ): Promise<{ members: number; journal: boolean }> {
    const externalId = row.id.trim();
    const startAt = parseDateTime(row.startAt);
    if (!startAt) return { members: 0, journal: false };
    const endAt = row.endAt ? parseDateTime(row.endAt) : null;
    const kind = mapKind(row.kind);
    const status = mapStatus(row.status);
    const memberAttended = (row.members ?? []).filter(
      (m) => m.attendance === 'ATTENDED',
    ).length;
    const fromApi =
      typeof row.attendedCount === 'number' ? row.attendedCount : 0;
    const fromHeader =
      typeof row.headerAttendedCount === 'number'
        ? row.headerAttendedCount
        : 0;
    const attendedCount = Math.max(fromApi, fromHeader, memberAttended);

    const existing = await this.prisma.onexClassSession.findUnique({
      where: { clubId_externalId: { clubId, externalId } },
    });

    if (existing?.payrollLocked) {
      // Keep archive members refresh optional — plan: don't rewrite payroll fields
      await this.prisma.onexClassSession.update({
        where: { id: existing.id },
        data: { syncedAt: new Date(), isActive: true },
      });
      return { members: 0, journal: false };
    }

    const data = {
      number: row.number?.trim() || null,
      kind,
      status,
      title: row.title?.trim() || 'Занятие',
      startAt,
      endAt,
      durationMin: row.durationMin ?? null,
      employeeExternalId: row.employeeExternalId?.trim() || null,
      employeeName: row.employeeName?.trim() || null,
      roomTitle: row.roomTitle?.trim() || null,
      serviceExternalId: row.serviceExternalId?.trim() || null,
      fitgoBookingRef: row.fitgoBookingRef?.trim() || null,
      bookedCount: row.bookedCount ?? 0,
      headerAttendedCount: row.headerAttendedCount ?? 0,
      attendedCount,
      capacity:
        typeof row.capacity === 'number' && row.capacity > 0
          ? Math.round(row.capacity)
          : existing?.capacity ?? null,
      isActive: status !== OnexClassStatus.CANCELLED,
      syncedAt: new Date(),
    };

    const session = existing
      ? await this.prisma.onexClassSession.update({
          where: { id: existing.id },
          data,
        })
      : await this.prisma.onexClassSession.create({
          data: { clubId, externalId, ...data },
        });

    const members = row.members ?? [];
    let memberCount = 0;
    const seenMembers = new Set<string>();
    for (const m of members) {
      const mid = m.externalId?.trim();
      if (!mid) continue;
      seenMembers.add(mid);
      await this.prisma.onexClassSessionMember.upsert({
        where: {
          sessionId_externalId: {
            sessionId: session.id,
            externalId: mid,
          },
        },
        create: {
          sessionId: session.id,
          externalId: mid,
          clientName: m.clientName?.trim() || mid,
          attendance: mapMemberAttendance(m.attendance),
          cancelled: Boolean(m.cancelled) || m.attendance === 'CANCELLED',
          paymentBasis: m.paymentBasis?.trim() || null,
          quantity: m.quantity && m.quantity > 0 ? m.quantity : 1,
          paySource: mapPaySource(m.paySource),
          unitPriceMinor: majorToMinorOrNull(m.unitAmount),
        },
        update: {
          clientName: m.clientName?.trim() || mid,
          attendance: mapMemberAttendance(m.attendance),
          cancelled: Boolean(m.cancelled) || m.attendance === 'CANCELLED',
          paymentBasis: m.paymentBasis?.trim() || null,
          quantity: m.quantity && m.quantity > 0 ? m.quantity : 1,
          paySource: mapPaySource(m.paySource),
          unitPriceMinor: majorToMinorOrNull(m.unitAmount),
        },
      });
      memberCount += 1;
    }
    if (seenMembers.size > 0) {
      await this.prisma.onexClassSessionMember.deleteMany({
        where: {
          sessionId: session.id,
          externalId: { notIn: [...seenMembers] },
        },
      });
    }

    const journal = await this.applyToGroupJournal(clubId, session, members);
    if (kind === OnexClassKind.GROUP) {
      await this.importGroupBookingsFromMembers(clubId, session, members);
    }
    if (kind === OnexClassKind.PT || kind === OnexClassKind.SPA) {
      await this.applyBookingPresence(clubId, session, members, kind);
    }
    return { members: memberCount, journal };
  }

  /** Mirror 1C-only enrollments into GroupClassBooking (origin=ONEC_IMPORTED). */
  private async importGroupBookingsFromMembers(
    clubId: string,
    session: {
      externalId: string;
      title: string;
      startAt: Date;
      endAt: Date | null;
      employeeName: string | null;
    },
    members: FitgoClassSessionRow['members'],
  ) {
    const endAt =
      session.endAt ?? new Date(session.startAt.getTime() + 60 * 60_000);
    for (const m of members ?? []) {
      const ext = m.externalId?.trim();
      if (!ext) continue;
      if (m.attendance === 'CANCELLED' || m.attendance === 'NO_SHOW') continue;
      const client = await this.prisma.user.findFirst({
        where: { clubId, externalId: ext },
        select: { id: true },
      });
      if (!client) continue;
      const existing = await this.prisma.groupClassBooking.findUnique({
        where: {
          clientId_appointmentId: {
            clientId: client.id,
            appointmentId: session.externalId,
          },
        },
      });
      if (existing) {
        if (
          existing.status === 'CANCELLED' ||
          existing.status === 'FAILED'
        ) {
          await this.prisma.groupClassBooking.update({
            where: { id: existing.id },
            data: {
              status: 'CONFIRMED',
              cancelledAt: null,
              usageStatus: 'BOOKED',
              title: session.title,
              trainerName: session.employeeName,
              startAt: session.startAt,
              endAt,
            },
          });
        }
        continue;
      }
      await this.prisma.groupClassBooking.create({
        data: {
          clientId: client.id,
          appointmentId: session.externalId,
          title: session.title,
          trainerName: session.employeeName,
          startAt: session.startAt,
          endAt,
          status: 'CONFIRMED',
          origin: 'ONEC_IMPORTED',
          controlLevel: 'BASE',
          reviewFlag: false,
          paymentStatus: 'N_A',
          usageStatus: 'BOOKED',
          presenceStatus: 'PENDING',
          performanceStatus: 'PENDING',
          eligibleForMotivation: false,
        },
      });
    }
  }

  private async applyBookingPresence(
    clubId: string,
    session: {
      startAt: Date;
      endAt: Date | null;
      title: string;
    },
    members: FitgoClassSessionRow['members'],
    _kind: OnexClassKind,
  ) {
    for (const m of members ?? []) {
      if (m.attendance !== 'ATTENDED') continue;
      const ext = m.externalId?.trim();
      if (!ext) continue;
      const client = await this.prisma.user.findFirst({
        where: { clubId, externalId: ext },
      });
      if (!client) continue;
      await this.serviceUsage
        .markPresenceFromVisit(client.id, session.startAt)
        .catch(() => undefined);
    }
  }

  /**
   * Push COMPLETED group facts into GroupClassSession when not LOCKED.
   */
  private async applyToGroupJournal(
    clubId: string,
    session: {
      id: string;
      externalId: string;
      kind: OnexClassKind;
      status: OnexClassStatus;
      title: string;
      startAt: Date;
      endAt: Date | null;
      employeeExternalId: string | null;
      employeeName: string | null;
      roomTitle: string | null;
      serviceExternalId: string | null;
      attendedCount: number;
    },
    members: FitgoClassSessionRow['members'],
  ): Promise<boolean> {
    if (session.kind !== OnexClassKind.GROUP) return false;

    const existing = await this.prisma.groupClassSession.findUnique({
      where: {
        clubId_appointmentId: {
          clubId,
          appointmentId: session.externalId,
        },
      },
    });

    if (existing?.status === GroupClassSessionStatus.LOCKED) {
      await this.prisma.onexClassSession.update({
        where: { id: session.id },
        data: { payrollLocked: true },
      });
      return false;
    }

    const trainer = await this.resolveTrainer(
      clubId,
      session.employeeExternalId,
      session.employeeName,
      existing?.trainerId,
    );
    if (!trainer) return false;

    const endAt =
      session.endAt ??
      new Date(session.startAt.getTime() + 60 * 60 * 1000);
    const completed = session.status === OnexClassStatus.COMPLETED;
    const cancelled = session.status === OnexClassStatus.CANCELLED;
    const qty = completed ? session.attendedCount : 0;

    if (existing) {
      await this.prisma.groupClassSession.update({
        where: { id: existing.id },
        data: {
          title: session.title,
          startAt: session.startAt,
          endAt,
          roomTitle: session.roomTitle,
          serviceExternalId: session.serviceExternalId,
          trainerId: trainer.id,
          approvedAttendedCount: cancelled ? 0 : qty,
          baselineQuality: GroupSessionBaselineQuality.FULL,
          baselineCount: members?.length ?? existing.baselineCount,
          status: cancelled
            ? existing.status
            : completed
              ? existing.status === GroupClassSessionStatus.APPROVED ||
                existing.status === GroupClassSessionStatus.AUTO_READY
                ? existing.status
                : GroupClassSessionStatus.AUTO_READY
              : existing.status === GroupClassSessionStatus.OPEN ||
                  existing.status === GroupClassSessionStatus.SUBMITTED
                ? existing.status
                : GroupClassSessionStatus.OPEN,
        },
      });
      await this.syncJournalMembers(existing.id, clubId, members ?? []);
      return true;
    }

    if (!completed || qty <= 0) return false;

    const created = await this.prisma.groupClassSession.create({
      data: {
        clubId,
        appointmentId: session.externalId,
        trainerId: trainer.id,
        title: session.title,
        startAt: session.startAt,
        endAt,
        roomTitle: session.roomTitle,
        serviceExternalId: session.serviceExternalId,
        status: GroupClassSessionStatus.AUTO_READY,
        baselineQuality: GroupSessionBaselineQuality.FULL,
        baselineCount: members?.length ?? 0,
        approvedAttendedCount: qty,
        baselineFrozenAt: new Date(),
        trustBand: TrustBand.GREEN,
      },
    });
    await this.syncJournalMembers(created.id, clubId, members ?? []);
    return true;
  }

  private async syncJournalMembers(
    sessionId: string,
    clubId: string,
    members: NonNullable<FitgoClassSessionRow['members']>,
  ) {
    for (const m of members) {
      const ext = m.externalId?.trim();
      if (!ext) continue;
      const client = await this.prisma.user.findFirst({
        where: { clubId, externalId: ext },
      });
      const attendance = mapGroupAttendance(m.attendance);
      const existing = await this.prisma.groupClassSessionMember.findFirst({
        where: {
          sessionId,
          OR: [{ externalId: ext }, ...(client ? [{ clientId: client.id }] : [])],
        },
      });
      if (existing) {
        await this.prisma.groupClassSessionMember.update({
          where: { id: existing.id },
          data: {
            attendance,
            visitMatched: m.attendance === 'ATTENDED',
            displayName: m.clientName?.trim() || existing.displayName,
            externalId: ext,
            clientId: client?.id ?? existing.clientId,
          },
        });
      } else {
        await this.prisma.groupClassSessionMember.create({
          data: {
            sessionId,
            clientId: client?.id ?? null,
            externalId: ext,
            displayName: m.clientName?.trim() || ext,
            source: GroupSessionMemberSource.BASELINE_1C,
            attendance,
            visitMatched: m.attendance === 'ATTENDED',
            trustBand: TrustBand.GREEN,
            trustReasons: [],
          },
        });
      }

      // Mark FitGO bookings presence when attended
      if (m.attendance === 'ATTENDED' && client) {
        const booking = await this.prisma.groupClassBooking.findFirst({
          where: {
            clientId: client.id,
            appointmentId: (
              await this.prisma.groupClassSession.findUnique({
                where: { id: sessionId },
                select: { appointmentId: true },
              })
            )?.appointmentId,
          },
        });
        if (booking) {
          const sess = await this.prisma.groupClassSession.findUnique({
            where: { id: sessionId },
          });
          if (sess) {
            await this.serviceUsage
              .markPresenceFromVisit(client.id, sess.startAt)
              .catch(() => undefined);
          }
        }
      }
    }
  }

  private async resolveTrainer(
    clubId: string,
    employeeExternalId: string | null,
    employeeName: string | null,
    fallbackId?: string,
  ) {
    if (employeeExternalId) {
      const code = employeeExternalId.trim();
      const stripped = code.replace(/^0+/, '');
      const byExt = await this.prisma.user.findFirst({
        where: {
          clubId,
          roles: { some: { role: { in: [Role.TRAINER, Role.MANAGER] } } },
          OR: [
            { externalId: code },
            { employeeCode: code },
            ...(stripped && stripped !== code
              ? [{ externalId: stripped }, { employeeCode: stripped }]
              : []),
          ],
        },
      });
      if (byExt) return byExt;
    }
    if (employeeName?.trim()) {
      const name = employeeName.trim().toLowerCase();
      const staff = await this.prisma.user.findMany({
        where: {
          clubId,
          roles: { some: { role: { in: [Role.TRAINER, Role.MANAGER] } } },
        },
        take: 200,
      });
      const hit = staff.find((u) => {
        const full = `${u.lastName} ${u.firstName}`.trim().toLowerCase();
        const rev = `${u.firstName} ${u.lastName}`.trim().toLowerCase();
        return (
          full === name ||
          rev === name ||
          full.includes(name) ||
          name.includes(full)
        );
      });
      if (hit) return hit;
    }
    if (fallbackId) {
      return this.prisma.user.findFirst({
        where: { id: fallbackId, clubId },
      });
    }
    return null;
  }

  /** Mark onex sessions under a locked payroll period so auto-sync skips them. */
  async markPayrollLocked(
    clubId: string,
    trainerId: string,
    from: string,
    to: string,
  ) {
    const trainer = await this.prisma.user.findFirst({
      where: { id: trainerId, clubId },
    });
    if (!trainer) return;
    const fromD = new Date(`${from}T00:00:00.000Z`);
    const toD = new Date(`${to}T23:59:59.999Z`);
    const or: Array<{ employeeExternalId?: string; employeeName?: string }> =
      [];
    for (const raw of [trainer.externalId, trainer.employeeCode]) {
      const code = raw?.trim();
      if (!code) continue;
      or.push({ employeeExternalId: code });
      const stripped = code.replace(/^0+/, '');
      if (stripped && stripped !== code) {
        or.push({ employeeExternalId: stripped });
      }
    }
    const name = `${trainer.lastName} ${trainer.firstName}`.trim();
    if (name) or.push({ employeeName: name });
    if (or.length === 0) return;
    await this.prisma.onexClassSession.updateMany({
      where: {
        clubId,
        startAt: { gte: fromD, lte: toD },
        OR: or,
      },
      data: { payrollLocked: true },
    });
  }
}

function parseDateTime(raw: string): Date | null {
  if (!raw?.trim()) return null;
  const d = new Date(raw.includes('T') ? raw : `${raw}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapKind(k: string): OnexClassKind {
  const u = (k || '').toUpperCase();
  if (u === 'PT') return OnexClassKind.PT;
  if (u === 'SPA') return OnexClassKind.SPA;
  if (u === 'SOLARIUM') return OnexClassKind.SOLARIUM;
  return OnexClassKind.GROUP;
}

function mapPaySource(raw: string | undefined): string | null {
  const u = (raw || '').toUpperCase();
  if (u === 'PACKAGE' || u === 'SALE' || u === 'UNKNOWN') return u;
  return null;
}

function majorToMinorOrNull(amount: number | undefined): number | null {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100);
}

function mapStatus(s: string): OnexClassStatus {
  const u = (s || '').toUpperCase();
  if (u === 'COMPLETED') return OnexClassStatus.COMPLETED;
  if (u === 'CANCELLED') return OnexClassStatus.CANCELLED;
  if (u === 'IN_PROGRESS') return OnexClassStatus.IN_PROGRESS;
  return OnexClassStatus.SCHEDULED;
}

function mapMemberAttendance(a: string): OnexClassMemberAttendance {
  const u = (a || '').toUpperCase();
  if (u === 'ATTENDED') return OnexClassMemberAttendance.ATTENDED;
  if (u === 'NO_SHOW') return OnexClassMemberAttendance.NO_SHOW;
  if (u === 'CANCELLED') return OnexClassMemberAttendance.CANCELLED;
  return OnexClassMemberAttendance.EXPECTED;
}

function mapGroupAttendance(a: string): GroupSessionMemberAttendance {
  const u = (a || '').toUpperCase();
  if (u === 'ATTENDED') return GroupSessionMemberAttendance.ATTENDED;
  if (u === 'NO_SHOW') return GroupSessionMemberAttendance.NO_SHOW;
  if (u === 'CANCELLED') return GroupSessionMemberAttendance.REMOVED;
  return GroupSessionMemberAttendance.EXPECTED;
}
