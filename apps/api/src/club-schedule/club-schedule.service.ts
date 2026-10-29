import { BadRequestException, Injectable } from '@nestjs/common';
import {
  PersonalBookingStatus,
  SpaBookingStatus,
} from '@prisma/client';
import {
  SessionType,
  groupApprovalLabelRu,
  groupApprovalPhase,
  isReformerHallSession,
  onexSessionKey,
  sessionApprovalLabelRu,
  sessionApprovalPhase,
  type ClubScheduleEvent,
  type ClubScheduleEventType,
  type ClubScheduleQuery,
  type ClubScheduleStatus,
  type GroupApprovalPhase,
  type ScheduleSlot,
  type SessionApprovalPhase,
} from '@fitgo/shared-types';
import { isSolariumSessionTitle } from '../admin-sales/trainer-pt-sales-from-revenue';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { SessionApprovalService } from '../booking-control/session-approval.service';
import { ClassSessionsSyncService } from '../class-sync/class-sessions-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import { FormaScheduleCacheService } from './forma-schedule-cache.service';
import {
  clampScheduleRange,
  inferSlotStatus,
  localDayKey,
  mapOnexToClubStatus,
  matchOnexToScheduleSlots,
  slotOverlapsDayRange,
  staffOwnsScheduleSlot,
} from './trainer-schedule.helpers';

@Injectable()
export class ClubScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly formaCache: FormaScheduleCacheService,
    private readonly sessionApproval: SessionApprovalService,
    private readonly classSessions: ClassSessionsSyncService,
  ) {}

  async list(clubId: string, query: ClubScheduleQuery): Promise<ClubScheduleEvent[]> {
    const { fromDay, toDay, rangeStart, rangeEnd } = clampScheduleRange(
      query.from,
      query.to,
    );
    const types = this.parseTypes(query.types);
    const staffIds = query.staffIds?.filter(Boolean) ?? [];

    const staffByExt = await this.loadStaffMap(clubId);

    const loaders: Promise<ClubScheduleEvent[]>[] = [];
    if (types.has('GROUP')) {
      loaders.push(
        this.loadGroupEvents(
          clubId,
          fromDay,
          toDay,
          rangeStart,
          rangeEnd,
          staffIds,
          staffByExt,
        ),
      );
    }
    if (types.has('PT')) {
      loaders.push(this.loadPtEvents(clubId, rangeStart, rangeEnd, staffIds));
      loaders.push(
        this.loadOnexPtEvents(clubId, rangeStart, rangeEnd, staffIds, staffByExt),
      );
    }
    if (types.has('SPA')) {
      loaders.push(this.loadSpaEvents(clubId, rangeStart, rangeEnd, staffIds));
    }
    if (types.has('DUTY')) {
      loaders.push(this.loadDutyEvents(clubId, rangeStart, rangeEnd, staffIds));
    }

    const chunks = await Promise.all(loaders);
    let out = chunks.flat();
    if (query.status && query.status !== 'ALL') {
      out = out.filter((e) => e.status === query.status);
    }
    if (query.approval && query.approval !== 'ALL') {
      if (query.approval === 'PENDING') {
        out = out.filter(
          (e) =>
            e.approvalPhase === 'PENDING_ADMIN' ||
            e.approvalPhase === 'PENDING_TRAINER' ||
            e.approvalPhase === 'PENDING_PERFORMER',
        );
      } else {
        out = out.filter((e) => e.approvalPhase === query.approval);
      }
    }

    return out.sort(
      (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    );
  }

  private parseTypes(types?: ClubScheduleEventType[]): Set<ClubScheduleEventType> {
    if (!types?.length) {
      return new Set(['GROUP', 'PT', 'SPA', 'DUTY']);
    }
    return new Set(types);
  }

  private async loadGroupEvents(
    clubId: string,
    fromDay: string,
    toDay: string,
    rangeStart: Date,
    rangeEnd: Date,
    staffIds: string[],
    staffByExt: Map<
      string,
      {
        id: string;
        firstName: string;
        lastName: string;
        externalId: string | null;
        employeeCode?: string | null;
      }
    >,
  ): Promise<ClubScheduleEvent[]> {
    const today = localDayKey();
    const allSlots = await this.formaCache.getClubSchedule(clubId, fromDay, toDay);
    let slots = allSlots.filter((slot) =>
      slotOverlapsDayRange(
        slot.startAt,
        slot.endAt,
        fromDay,
        toDay,
        rangeStart,
        rangeEnd,
      ),
    );

    // Enrich + fill gaps from synced 1C Onex sessions (past / if Forma empty).
    let onexInRange = await this.prisma.onexClassSession.findMany({
      where: {
        clubId,
        kind: 'GROUP',
        isActive: true,
        startAt: { gte: rangeStart, lt: rangeEnd },
      },
    });

    // Future days: if nothing in Forma cache and Onex yet — pull 1C once for the day.
    if (
      slots.length === 0 &&
      onexInRange.length === 0 &&
      toDay >= today
    ) {
      const syncFrom = fromDay < today ? today : fromDay;
      try {
        await this.classSessions.syncRange(clubId, syncFrom, toDay);
        onexInRange = await this.prisma.onexClassSession.findMany({
          where: {
            clubId,
            kind: 'GROUP',
            isActive: true,
            startAt: { gte: rangeStart, lt: rangeEnd },
          },
        });
      } catch {
        // leave empty — UI shows «Нет событий»
      }
    }

    const link = matchOnexToScheduleSlots(
      slots.map((slot) => ({
        id: slot.id,
        title: slot.title,
        startAt: slot.startAt,
        trainerName: slot.trainerName,
        roomTitle: slot.roomTitle,
      })),
      onexInRange.map((row) => ({
        externalId: row.externalId,
        title: row.title,
        startAt: row.startAt,
        employeeName: row.employeeName,
        roomTitle: row.roomTitle,
      })),
    );
    for (const slot of slots) {
      const onexId = link.slotOnexId.get(slot.id);
      if (!onexId || onexId === slot.id) continue;
      const onex = onexInRange.find((row) => row.externalId === onexId);
      if (!onex) continue;
      if (!slot.trainerName && onex.employeeName) {
        slot.trainerName = onex.employeeName;
      }
      if (!slot.trainerId && onex.employeeExternalId) {
        slot.trainerId = onex.employeeExternalId;
      }
      if (!slot.roomTitle && onex.roomTitle) slot.roomTitle = onex.roomTitle;
    }

    const slotIds = new Set(slots.map((s) => s.id));
    for (const onex of onexInRange) {
      if (
        slotIds.has(onex.externalId) ||
        link.consumedOnexIds.has(onex.externalId)
      ) {
        continue;
      }
      const startAt = onex.startAt.toISOString();
      const endAt = (onex.endAt ?? onex.startAt).toISOString();
      if (
        !slotOverlapsDayRange(
          startAt,
          endAt,
          fromDay,
          toDay,
          rangeStart,
          rangeEnd,
        )
      ) {
        continue;
      }
      const synthetic: ScheduleSlot = {
        id: onex.externalId,
        title: onex.title,
        type: SessionType.GROUP,
        startAt,
        endAt,
        capacity: Math.max(onex.bookedCount, 1),
        booked: onex.bookedCount,
        available: onex.status !== 'CANCELLED',
        trainerId: onex.employeeExternalId ?? undefined,
        trainerName: onex.employeeName ?? undefined,
        roomTitle: onex.roomTitle ?? undefined,
      };
      slots.push(synthetic);
      slotIds.add(onex.externalId);
    }

    if (staffIds.length) {
      const staffSet = new Set(staffIds);
      const staffUsers = await this.prisma.user.findMany({
        where: { id: { in: staffIds }, clubId },
        select: {
          id: true,
          externalId: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
        },
      });
      slots = slots.filter((slot) =>
        this.slotMatchesStaff(slot, staffSet, staffUsers),
      );
    }

    const onexById = new Map(onexInRange.map((s) => [s.externalId, s]));

    const sessionKeys = [
      ...new Set(
        slots
          .map((slot) => {
            const linkedId = link.slotOnexId.get(slot.id);
            const onexId =
              linkedId ??
              (onexById.has(slot.id) ? slot.id : undefined);
            return onexId ? onexSessionKey(onexId) : null;
          })
          .filter((k): k is string => Boolean(k)),
      ),
    ];
    const approvals = sessionKeys.length
      ? await this.prisma.groupClassApproval.findMany({
          where: { clubId, sessionKey: { in: sessionKeys } },
        })
      : [];
    const approvalByKey = new Map(approvals.map((a) => [a.sessionKey, a]));

    return slots.map((slot) => {
      const linkedId = link.slotOnexId.get(slot.id);
      const onex =
        (linkedId ? onexById.get(linkedId) : undefined) ??
        onexById.get(slot.id);
      // Never expose Forma-only ids — detail looks up Onex and 404s.
      const sessionKey = onex
        ? onexSessionKey(onex.externalId)
        : undefined;
      const approval = sessionKey
        ? approvalByKey.get(sessionKey)
        : undefined;
      const status = inferSlotStatus(slot, onex);
      const endMs = Date.parse(
        slot.endAt.includes('T') ? slot.endAt : slot.endAt.replace(' ', 'T'),
      );
      const ended = !Number.isNaN(endMs) && endMs <= Date.now();
      // Past/done GROUP without a row still waits for trainer (same as booking-control).
      const phase = approval
        ? groupApprovalPhase({
            trainerApprovedAt: approval.trainerApprovedAt?.toISOString() ?? null,
            adminApprovedAt: approval.adminApprovedAt?.toISOString() ?? null,
            overrideApprovedAt:
              approval.overrideApprovedAt?.toISOString() ?? null,
          })
        : ended && status !== 'cancelled'
          ? groupApprovalPhase({})
          : undefined;
      const staffId =
        (slot.trainerId && staffByExt.get(slot.trainerId)?.id) ||
        (onex?.employeeExternalId &&
          staffByExt.get(onex.employeeExternalId)?.id) ||
        undefined;

      return {
        id: `group-${slot.id}`,
        type: 'GROUP' as const,
        title: slot.title,
        startAt: slot.startAt,
        endAt: slot.endAt,
        status,
        staffId,
        staffName: slot.trainerName ?? onex?.employeeName ?? undefined,
        roomTitle: slot.roomTitle ?? onex?.roomTitle ?? undefined,
        sessionKey,
        bookingId: undefined,
        booked: onex?.bookedCount ?? slot.booked,
        capacity:
          slot.capacity > 0
            ? slot.capacity
            : Math.max(onex?.bookedCount ?? 0, 1),
        attended: onex?.attendedCount ?? 0,
        approvalPhase: phase,
        approvalLabel: groupApprovalLabelRu(phase),
        payrollLocked: onex?.payrollLocked ?? false,
      };
    });
  }

  private slotMatchesStaff(
    slot: { trainerId?: string; trainerName?: string },
    staffSet: Set<string>,
    staffUsers: Array<{
      id: string;
      externalId: string | null;
      employeeCode?: string | null;
      firstName: string;
      lastName: string;
    }>,
  ): boolean {
    for (const u of staffUsers) {
      if (!staffSet.has(u.id)) continue;
      if (staffOwnsScheduleSlot(slot, u)) return true;
    }
    return false;
  }

  /**
   * Trainer schedule: own GROUP (all rooms if GP / reformer hall if reformer-only)
   * plus own PT when trainerStaff / trainerClub or Reformers is on.
   */
  async listForTrainer(
    user: JwtPayload,
    query: {
      from?: string;
      to?: string;
      types?: string;
      status?: string;
      approval?: string;
    },
  ): Promise<ClubScheduleEvent[]> {
    const clubId = requireClubId(user);
    const me = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: {
        groupPrograms: true,
        trainerReformers: true,
        trainerStaff: true,
        trainerClub: true,
      },
    });
    const isReformer = Boolean(me?.trainerReformers);
    const isGp = Boolean(me?.groupPrograms);
    const hasPt = Boolean(me?.trainerStaff || me?.trainerClub);
    const allowPt = hasPt || isReformer;

    const requested = (query.types ?? '')
      .split(',')
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean);
    let types: string;
    if (!allowPt) {
      types = 'GROUP';
    } else if (requested.length === 0 || requested.includes('GROUP,PT')) {
      types = 'GROUP,PT';
    } else if (requested.length === 1 && requested[0] === 'GROUP') {
      types = 'GROUP';
    } else if (requested.length === 1 && requested[0] === 'PT') {
      types = 'PT';
    } else if (
      requested.includes('GROUP') &&
      requested.includes('PT') &&
      requested.length === 2
    ) {
      types = 'GROUP,PT';
    } else {
      types = 'GROUP,PT';
    }

    let events = await this.list(
      clubId,
      this.parseListQuery({
        from: query.from,
        to: query.to,
        status: query.status,
        approval: query.approval,
        types,
        staffIds: user.sub,
      }),
    );

    if (isReformer && hasPt) {
      events = events.filter(
        (e) =>
          e.type === 'PT' ||
          (e.type === 'GROUP' && (isGp || isReformerHallSession(e.roomTitle, e.title))),
      );
    } else if (isReformer && !isGp) {
      events = events.filter((e) =>
        isReformerHallSession(e.roomTitle, e.title),
      );
    } else if (isReformer && isGp) {
      events = events.filter(
        (e) =>
          e.type === 'GROUP' || isReformerHallSession(e.roomTitle, e.title),
      );
    }

    // Drop rows attributed to another staff user (wrong Forma↔1C link).
    return events.filter((e) => !e.staffId || e.staffId === user.sub);
  }

  /** 1C personal sessions (incl. individual reformer) as schedule PT rows. */
  private async loadOnexPtEvents(
    clubId: string,
    rangeStart: Date,
    rangeEnd: Date,
    staffIds: string[],
    staffByExt: Map<
      string,
      {
        id: string;
        firstName: string;
        lastName: string;
        externalId: string | null;
        employeeCode?: string | null;
      }
    >,
  ): Promise<ClubScheduleEvent[]> {
    const staffUsers = staffIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: staffIds }, clubId },
          select: {
            id: true,
            externalId: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
          },
        })
      : [];
    const extCodes = new Set<string>();
    for (const u of staffUsers) {
      for (const raw of [u.externalId, u.employeeCode]) {
        const t = raw?.trim();
        if (t) extCodes.add(t);
      }
    }

    const rowsRaw = await this.prisma.onexClassSession.findMany({
      where: {
        clubId,
        kind: 'PT',
        isActive: true,
        startAt: { gte: rangeStart, lt: rangeEnd },
        ...(extCodes.size
          ? { employeeExternalId: { in: [...extCodes] } }
          : staffIds.length
            ? { employeeExternalId: '__none__' }
            : {}),
      },
      orderBy: { startAt: 'asc' },
    });
    // Solarium mistagged as PT in 1C must not appear on trainer schedule.
    const rows = rowsRaw.filter((r) => !isSolariumSessionTitle(r.title));

    if (!rows.length) return [];

    const sessionKeys = rows.map((r) => onexSessionKey(r.externalId));
    const approvals = await this.prisma.sessionApproval.findMany({
      where: {
        clubId,
        kind: 'PT',
        OR: [
          { bookingId: { in: rows.map((r) => r.externalId) } },
          { bookingId: { in: sessionKeys } },
        ],
      },
    });
    const approvalByBooking = new Map(
      approvals.map((a) => [a.bookingId, a]),
    );

    return rows.map((r) => {
      const status = mapOnexToClubStatus(r.status, r.endAt);
      const approval =
        approvalByBooking.get(r.externalId) ??
        approvalByBooking.get(onexSessionKey(r.externalId));
      const phase = approval
        ? sessionApprovalPhase({
            performerConfirmedAt:
              approval.performerConfirmedAt?.toISOString() ?? null,
            adminApprovedAt: approval.adminApprovedAt?.toISOString() ?? null,
            overrideApprovedAt:
              approval.overrideApprovedAt?.toISOString() ?? null,
          })
        : undefined;
      const staffId =
        (r.employeeExternalId &&
          staffByExt.get(r.employeeExternalId)?.id) ||
        staffUsers.find(
          (u) =>
            u.externalId === r.employeeExternalId ||
            u.employeeCode === r.employeeExternalId,
        )?.id;
      return {
        id: `onex-pt-${r.externalId}`,
        type: 'PT' as const,
        title: r.title || 'Персональная тренировка',
        startAt: r.startAt.toISOString(),
        endAt: (r.endAt ?? r.startAt).toISOString(),
        status,
        staffId,
        staffName: r.employeeName ?? undefined,
        roomTitle: r.roomTitle ?? undefined,
        sessionKey: onexSessionKey(r.externalId),
        booked: Math.max(r.bookedCount, 1),
        capacity: Math.max(r.capacity ?? 0, r.bookedCount, 1),
        attended: r.attendedCount ?? 0,
        approvalPhase: phase,
        approvalLabel: sessionApprovalLabelRu(phase),
        payrollLocked: r.payrollLocked ?? false,
      };
    });
  }

  private async loadPtEvents(
    clubId: string,
    rangeStart: Date,
    rangeEnd: Date,
    staffIds: string[],
  ): Promise<ClubScheduleEvent[]> {
    const bookings = await this.prisma.personalTrainingBooking.findMany({
      where: {
        trainer: { clubId },
        status: { not: PersonalBookingStatus.CANCELLED },
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
        ...(staffIds.length ? { trainerId: { in: staffIds } } : {}),
      },
      include: { client: true, trainer: true },
    });

    const bookingIds = bookings.map((b) => b.id);
    await this.sessionApproval.ensureApprovals('PT', bookingIds, clubId);
    const approvals = bookingIds.length
      ? await this.prisma.sessionApproval.findMany({
          where: { clubId, kind: 'PT', bookingId: { in: bookingIds } },
        })
      : [];
    const approvalByBooking = new Map(approvals.map((a) => [a.bookingId, a]));

    return bookings.map((b) => {
      const approval = approvalByBooking.get(b.id);
      const phase = approval
        ? this.sessionApproval.phase(approval)
        : undefined;
      const status = this.mapBookingStatus(b.status, b.endAt);
      return {
        id: `pt-${b.id}`,
        type: 'PT' as const,
        title: b.isComplimentary
          ? 'Подарочная ПТ'
          : 'Персональная тренировка',
        startAt: b.startAt.toISOString(),
        endAt: b.endAt.toISOString(),
        status,
        staffId: b.trainerId,
        staffName: `${b.trainer.lastName} ${b.trainer.firstName}`.trim(),
        clientId: b.clientId,
        clientName: `${b.client.lastName} ${b.client.firstName}`.trim(),
        bookingId: b.id,
        sessionKey: `fitgo:PT:${b.id}`,
        booked: 1,
        capacity: 1,
        attended: status === 'done' ? 1 : 0,
        approvalPhase: phase,
        approvalLabel: sessionApprovalLabelRu(phase),
        payrollLocked: false,
      };
    });
  }

  private async loadSpaEvents(
    clubId: string,
    rangeStart: Date,
    rangeEnd: Date,
    staffIds: string[],
  ): Promise<ClubScheduleEvent[]> {
    const bookings = await this.prisma.spaBooking.findMany({
      where: {
        clubId,
        status: { not: SpaBookingStatus.CANCELLED },
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
        ...(staffIds.length ? { specialistId: { in: staffIds } } : {}),
      },
      include: { client: true, specialist: true, service: true },
    });

    const bookingIds = bookings.map((b) => b.id);
    await this.sessionApproval.ensureApprovals('SPA', bookingIds, clubId);
    const approvals = bookingIds.length
      ? await this.prisma.sessionApproval.findMany({
          where: { clubId, kind: 'SPA', bookingId: { in: bookingIds } },
        })
      : [];
    const approvalByBooking = new Map(approvals.map((a) => [a.bookingId, a]));

    return bookings.map((b) => {
      const approval = approvalByBooking.get(b.id);
      const phase = approval
        ? this.sessionApproval.phase(approval)
        : undefined;
      const status = this.mapSpaStatus(b.status, b.endAt);
      return {
        id: `spa-${b.id}`,
        type: 'SPA' as const,
        title: b.service.name,
        startAt: b.startAt.toISOString(),
        endAt: b.endAt.toISOString(),
        status,
        staffId: b.specialistId,
        staffName: `${b.specialist.lastName} ${b.specialist.firstName}`.trim(),
        clientId: b.clientId ?? undefined,
        clientName: b.client
          ? `${b.client.lastName} ${b.client.firstName}`.trim() || 'Гость'
          : b.guestName?.trim() || 'Гость',
        bookingId: b.id,
        sessionKey: `fitgo:SPA:${b.id}`,
        booked: 1,
        capacity: 1,
        attended: status === 'done' ? 1 : 0,
        approvalPhase: phase,
        approvalLabel: sessionApprovalLabelRu(phase),
        payrollLocked: false,
      };
    });
  }

  private async loadDutyEvents(
    clubId: string,
    rangeStart: Date,
    rangeEnd: Date,
    staffIds: string[],
  ): Promise<ClubScheduleEvent[]> {
    const shifts = await this.prisma.staffShift.findMany({
      where: {
        clubId,
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
        ...(staffIds.length ? { userId: { in: staffIds } } : {}),
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { startAt: 'asc' },
    });

    return shifts.map((s) => ({
      id: `duty-${s.id}`,
      type: 'DUTY' as const,
      title: 'Дежурство',
      startAt: s.startAt.toISOString(),
      endAt: s.endAt.toISOString(),
      status: mapOnexToClubStatus(
        s.endAt.getTime() < Date.now() ? 'COMPLETED' : 'SCHEDULED',
        s.endAt,
      ),
      staffId: s.userId,
      staffName: `${s.user.lastName} ${s.user.firstName}`.trim(),
    }));
  }

  private mapBookingStatus(
    status: PersonalBookingStatus,
    endAt: Date,
  ): ClubScheduleStatus {
    if (status === PersonalBookingStatus.CANCELLED) return 'cancelled';
    if (status === PersonalBookingStatus.COMPLETED) return 'done';
    return mapOnexToClubStatus('SCHEDULED', endAt);
  }

  private mapSpaStatus(status: SpaBookingStatus, endAt: Date): ClubScheduleStatus {
    if (status === SpaBookingStatus.CANCELLED) return 'cancelled';
    if (status === SpaBookingStatus.COMPLETED) return 'done';
    return mapOnexToClubStatus('SCHEDULED', endAt);
  }

  private async loadStaffMap(clubId: string) {
    const staff = await this.prisma.user.findMany({
      where: {
        clubId,
        roles: {
          some: {
            role: { in: ['TRAINER', 'SPECIALIST', 'MANAGER', 'ADMIN'] },
          },
        },
      },
      select: {
        id: true,
        externalId: true,
        employeeCode: true,
        firstName: true,
        lastName: true,
      },
    });
    const map = new Map<string, (typeof staff)[0]>();
    for (const u of staff) {
      for (const raw of [u.externalId, u.employeeCode]) {
        const t = raw?.trim();
        if (!t) continue;
        map.set(t, u);
        const stripped = t.replace(/^0+/, '');
        if (stripped && stripped !== t) map.set(stripped, u);
      }
    }
    return map;
  }

  parseListQuery(input: {
    from?: string;
    to?: string;
    types?: string;
    staffIds?: string;
    status?: string;
    approval?: string;
  }): ClubScheduleQuery {
    const from = input.from?.trim();
    const to = input.to?.trim();
    if (!from || !to) {
      throw new BadRequestException('Укажите from и to');
    }

    const types = input.types
      ?.split(',')
      .map((t) => t.trim().toUpperCase())
      .filter(Boolean) as ClubScheduleEventType[] | undefined;

    const staffIds = input.staffIds
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const statusRaw = input.status?.trim().toLowerCase();
    const status =
      statusRaw === 'planned' ||
      statusRaw === 'done' ||
      statusRaw === 'cancelled'
        ? (statusRaw as ClubScheduleStatus)
        : statusRaw?.toUpperCase() === 'ALL'
          ? ('ALL' as const)
          : undefined;

    const approvalRaw = input.approval?.trim().toUpperCase();
    const approval =
      approvalRaw === 'ALL' || approvalRaw === 'PENDING'
        ? (approvalRaw as 'ALL' | 'PENDING')
        : (approvalRaw as GroupApprovalPhase | SessionApprovalPhase | undefined);

    return { from, to, types, staffIds, status, approval };
  }
}
