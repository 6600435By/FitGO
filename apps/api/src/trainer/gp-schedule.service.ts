import { Injectable } from '@nestjs/common';
import {
  groupApprovalLabelRu,
  groupApprovalPhase,
  onexSessionKey,
  type GpScheduleEvent,
} from '@fitgo/shared-types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { FormaScheduleCacheService } from '../club-schedule/forma-schedule-cache.service';
import {
  clampScheduleRange,
  filterTrainerScheduleSlots,
  inferSlotStatus,
} from '../club-schedule/trainer-schedule.helpers';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GpScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly formaCache: FormaScheduleCacheService,
  ) {}

  async list(
    user: JwtPayload,
    from?: string,
    to?: string,
  ): Promise<GpScheduleEvent[]> {
    const clubId = requireClubId(user);
    const { fromDay, toDay, rangeStart, rangeEnd } = clampScheduleRange(from, to);

    const allSlots = await this.formaCache.getClubSchedule(clubId, fromDay, toDay);
    const trainerSlots = await filterTrainerScheduleSlots(
      this.prisma,
      allSlots,
      user,
    );

    const slots = trainerSlots.filter(
      (slot) =>
        new Date(slot.startAt) < rangeEnd && new Date(slot.endAt) > rangeStart,
    );
    if (!slots.length) return [];

    const appointmentIds = slots.map((s) => s.id);
    const onexSessions = await this.prisma.onexClassSession.findMany({
      where: {
        clubId,
        externalId: { in: appointmentIds },
        kind: 'GROUP',
        isActive: true,
      },
    });
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

      return {
        id: slot.id,
        title: slot.title,
        startAt: slot.startAt,
        endAt: slot.endAt,
        status: inferSlotStatus(slot, onex),
        booked: onex?.bookedCount ?? slot.booked,
        capacity: slot.capacity,
        attended: onex?.attendedCount ?? 0,
        roomTitle: slot.roomTitle ?? onex?.roomTitle ?? undefined,
        sessionKey: onex ? sessionKey : undefined,
        onexExternalId: onex?.externalId,
        approvalPhase: phase,
        approvalLabel: groupApprovalLabelRu(phase),
        payrollLocked: onex?.payrollLocked ?? false,
      };
    });
  }
}
