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
  matchOnexToScheduleSlots,
  slotOverlapsDayRange,
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

    const slots = trainerSlots.filter((slot) =>
      slotOverlapsDayRange(
        slot.startAt,
        slot.endAt,
        fromDay,
        toDay,
        rangeStart,
        rangeEnd,
      ),
    );
    if (!slots.length) return [];

    const onexSessions = await this.prisma.onexClassSession.findMany({
      where: {
        clubId,
        kind: 'GROUP',
        isActive: true,
        startAt: { gte: rangeStart, lte: rangeEnd },
      },
    });
    const onexById = new Map(onexSessions.map((s) => [s.externalId, s]));
    const link = matchOnexToScheduleSlots(
      slots.map((slot) => ({
        id: slot.id,
        title: slot.title,
        startAt: slot.startAt,
        trainerName: slot.trainerName,
        roomTitle: slot.roomTitle,
      })),
      onexSessions.map((row) => ({
        externalId: row.externalId,
        title: row.title,
        startAt: row.startAt,
        employeeName: row.employeeName,
        roomTitle: row.roomTitle,
      })),
    );

    const sessionKeys = [
      ...new Set(
        [...link.slotOnexId.values()].map((id) => onexSessionKey(id)),
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
      const sessionKey = onex
        ? onexSessionKey(onex.externalId)
        : undefined;
      const approval = sessionKey
        ? approvalByKey.get(sessionKey)
        : undefined;
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
        sessionKey,
        onexExternalId: onex?.externalId,
        approvalPhase: phase,
        approvalLabel: groupApprovalLabelRu(phase),
        payrollLocked: onex?.payrollLocked ?? false,
      };
    });
  }
}
