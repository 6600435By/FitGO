import { BadRequestException, Injectable } from '@nestjs/common';
import {
  PersonalBookingStatus,
  SpaBookingStatus,
} from '@prisma/client';
import {
  groupApprovalLabelRu,
  groupApprovalPhase,
  onexSessionKey,
  sessionApprovalLabelRu,
  type ClubScheduleEvent,
  type ClubScheduleEventType,
  type ClubScheduleQuery,
  type ClubScheduleStatus,
  type GroupApprovalPhase,
  type SessionApprovalPhase,
} from '@fitgo/shared-types';
import { SessionApprovalService } from '../booking-control/session-approval.service';
import { PrismaService } from '../prisma/prisma.service';
import { FormaScheduleCacheService } from './forma-schedule-cache.service';
import {
  clampScheduleRange,
  inferSlotStatus,
  isFormaEmployeeId,
  mapOnexToClubStatus,
} from './trainer-schedule.helpers';

@Injectable()
export class ClubScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly formaCache: FormaScheduleCacheService,
    private readonly sessionApproval: SessionApprovalService,
  ) {}

  async list(clubId: string, query: ClubScheduleQuery): Promise<ClubScheduleEvent[]> {
    const { fromDay, toDay, rangeStart, rangeEnd } = clampScheduleRange(
      query.from,
      query.to,
    );
    const types = this.parseTypes(query.types);
    const staffIds = query.staffIds?.filter(Boolean) ?? [];
    const events: ClubScheduleEvent[] = [];

    const staffByExt = await this.loadStaffMap(clubId);

    if (types.has('GROUP')) {
      events.push(
        ...(await this.loadGroupEvents(
          clubId,
          fromDay,
          toDay,
          rangeStart,
          rangeEnd,
          staffIds,
          staffByExt,
        )),
      );
    }

    if (types.has('PT')) {
      events.push(
        ...(await this.loadPtEvents(
          clubId,
          rangeStart,
          rangeEnd,
          staffIds,
        )),
      );
    }

    if (types.has('SPA')) {
      events.push(
        ...(await this.loadSpaEvents(
          clubId,
          rangeStart,
          rangeEnd,
          staffIds,
        )),
      );
    }

    if (types.has('DUTY')) {
      events.push(
        ...(await this.loadDutyEvents(
          clubId,
          rangeStart,
          rangeEnd,
          staffIds,
        )),
      );
    }

    let out = events;
    if (query.status && query.status !== 'ALL') {
      out = out.filter((e) => e.status === query.status);
    }
    if (query.approval && query.approval !== 'ALL') {
      out = out.filter((e) => e.approvalPhase === query.approval);
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
      { id: string; firstName: string; lastName: string; externalId: string | null }
    >,
  ): Promise<ClubScheduleEvent[]> {
    const allSlots = await this.formaCache.getClubSchedule(clubId, fromDay, toDay);
    let slots = allSlots.filter(
      (slot) =>
        new Date(slot.startAt) < rangeEnd && new Date(slot.endAt) > rangeStart,
    );

    if (staffIds.length) {
      const staffSet = new Set(staffIds);
      const staffUsers = await this.prisma.user.findMany({
        where: { id: { in: staffIds }, clubId },
        select: { id: true, externalId: true, firstName: true, lastName: true },
      });
      slots = slots.filter((slot) =>
        this.slotMatchesStaff(slot, staffSet, staffUsers),
      );
    }

    const appointmentIds = slots.map((s) => s.id);
    const onexSessions = appointmentIds.length
      ? await this.prisma.onexClassSession.findMany({
          where: {
            clubId,
            externalId: { in: appointmentIds },
            kind: 'GROUP',
            isActive: true,
          },
        })
      : [];
    const onexById = new Map(onexSessions.map((s) => [s.externalId, s]));

    const sessionKeys = onexSessions.map((s) => onexSessionKey(s.externalId));
    const approvals = sessionKeys.length
      ? await this.prisma.groupClassApproval.findMany({
          where: { clubId, sessionKey: { in: sessionKeys } },
        })
      : [];
    const approvalByKey = new Map(approvals.map((a) => [a.sessionKey, a]));

    return slots.map((slot) => {
      const onex = onexById.get(slot.id);
      const sessionKey = onexSessionKey(slot.id);
      const approval = approvalByKey.get(sessionKey);
      const phase = approval
        ? groupApprovalPhase({
            trainerApprovedAt: approval.trainerApprovedAt?.toISOString() ?? null,
            adminApprovedAt: approval.adminApprovedAt?.toISOString() ?? null,
            overrideApprovedAt:
              approval.overrideApprovedAt?.toISOString() ?? null,
          })
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
        status: inferSlotStatus(slot, onex),
        staffId,
        staffName: slot.trainerName ?? onex?.employeeName ?? undefined,
        roomTitle: slot.roomTitle ?? onex?.roomTitle ?? undefined,
        sessionKey: onex ? sessionKey : undefined,
        bookingId: undefined,
        booked: onex?.bookedCount ?? slot.booked,
        capacity: slot.capacity,
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
      firstName: string;
      lastName: string;
    }>,
  ): boolean {
    for (const u of staffUsers) {
      if (!staffSet.has(u.id)) continue;
      if (slot.trainerId && u.externalId && slot.trainerId === u.externalId) {
        return true;
      }
      if (slot.trainerId && isFormaEmployeeId(slot.trainerId) && u.externalId === slot.trainerId) {
        return true;
      }
      const name = slot.trainerName?.toLowerCase() ?? '';
      const first = u.firstName.trim().toLowerCase();
      const last = u.lastName.trim().toLowerCase();
      if ((first && name.includes(first)) || (last && name.includes(last))) {
        return true;
      }
    }
    return false;
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
    for (const id of bookingIds) {
      await this.sessionApproval.ensureApproval('PT', id, clubId);
    }
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
    for (const id of bookingIds) {
      await this.sessionApproval.ensureApproval('SPA', id, clubId);
    }
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
        clientId: b.clientId,
        clientName: `${b.client.lastName} ${b.client.firstName}`.trim(),
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
        firstName: true,
        lastName: true,
      },
    });
    const map = new Map<string, (typeof staff)[0]>();
    for (const u of staff) {
      if (u.externalId) map.set(u.externalId, u);
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
      approvalRaw === 'ALL'
        ? ('ALL' as const)
        : (approvalRaw as GroupApprovalPhase | SessionApprovalPhase | undefined);

    return { from, to, types, staffIds, status, approval };
  }
}
