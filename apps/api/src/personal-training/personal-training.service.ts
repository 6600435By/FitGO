import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PersonalBookingStatus,
  Prisma,
  Role,
  AvailabilityBlockStatus,
  AvailabilityBlockKind,
  PersonalBookingOrigin,
  AccountStatus,
  StaffShiftTrack,
  SessionApprovalKind,
  ServiceUsageStatus,
  TrainerOwnPackageStatus,
} from '@prisma/client';
import {
  PERSONAL_TRAINING_GOAL_TEMPLATES,
  SessionType,
  normalizeWorkoutSheet,
  summarizeCircuitSession,
  workoutSheetForClient,
  sliceForTrack,
  type PersonalSessionStatus,
  type PersonalTrainingSessionDetail,
  type StaffPayProfile,
  type WorkoutSheet,
  type CircuitHistoryPoint,
  type TrainerCalendarResponse,
  type TrainerCalendarEvent,
  type ScheduleSlot,
  type SchedulePublishSummary,
  type PersonalBookingSeriesView,
  type SeriesGenerateResult,
  toUsageControl,
} from '@fitgo/shared-types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import {
  canonicalPtDocId,
  expandTakenPtDocIds,
  matchPtDocument,
  PT_DOC_LOOKAHEAD_DAYS,
  PT_DOC_LOOKBACK_DAYS,
  type PtSaleCandidate,
} from '../booking-control/pt-document-match';
import { SessionApprovalService } from '../booking-control/session-approval.service';
import { FormaScheduleCacheService } from '../club-schedule/forma-schedule-cache.service';
import { staffOwnsScheduleSlot } from '../club-schedule/trainer-schedule.helpers';
import { moscowDayKey } from '../club-sync/moscow-time';
import { VisitSyncService } from '../engagement/visit-sync.service';
import { FeaturesService } from '../features/features.service';
import { FitnessService } from '../fitness/fitness.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ServiceUsageService } from '../service-usage/service-usage.service';
import {
  isPersonalPtBooking,
  resolvePtFlow,
  type PtBookingFlowValue,
} from '../trainer/pt-flow.util';
import { shouldDebitPackageOnCancel } from '../trainer/personal-package-debit.rules';
import { TrainerLedgerService } from '../trainer/trainer-ledger.service';
import { TrainerRosterService } from '../trainer/trainer-roster.service';

const SESSION_DURATION_MIN = 60;
const LATE_CANCEL_HOURS = 24;
const DEFAULT_HOLD_HOURS = 12;

type DutyWindow = { startAt: Date; endAt: Date };

function occupiedRange(b: {
  startAt: Date;
  endAt: Date;
  bufferBeforeMin?: number | null;
  bufferAfterMin?: number | null;
}) {
  const before = (b.bufferBeforeMin ?? 0) * 60_000;
  const after = (b.bufferAfterMin ?? 0) * 60_000;
  return {
    start: new Date(b.startAt.getTime() - before),
    end: new Date(b.endAt.getTime() + after),
  };
}

function rangesOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/** Extra booking time must sit flush against a duty edge and not cover the duty itself. */
function extraBesideDuty(
  start: Date,
  end: Date,
  duties: DutyWindow[],
): 'ok' | 'overlap' | 'detached' {
  const overlap = duties.some((d) => start < d.endAt && end > d.startAt);
  if (overlap) return 'overlap';
  const touch = duties.some(
    (d) =>
      end.getTime() === d.startAt.getTime() ||
      start.getTime() === d.endAt.getTime(),
  );
  return touch ? 'ok' : 'detached';
}

export interface WorkSlotInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

@Injectable()
export class PersonalTrainingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly roster: TrainerRosterService,
    private readonly visitSync: VisitSyncService,
    private readonly serviceUsage: ServiceUsageService,
    private readonly formaCache: FormaScheduleCacheService,
    private readonly sessionApproval: SessionApprovalService,
    private readonly features: FeaturesService,
    private readonly fitness: FitnessService,
    private readonly ledger: TrainerLedgerService,
  ) {}

  private async shouldApplyPtControl(
    trainerId: string,
    ptFlow?: PtBookingFlowValue | string | null,
  ): Promise<boolean> {
    if (!(await this.features.isEnabled('trainer_pt_control'))) return false;
    if (ptFlow === 'PERSONAL') return false;
    if (ptFlow === 'CLUB') return true;
    const trainer = await this.prisma.user.findUnique({
      where: { id: trainerId },
      select: {
        trainerClub: true,
        trainerStaff: true,
      },
    });
    if (!trainer) return false;
    if (isPersonalPtBooking({ ptFlow: null }, trainer)) return false;
    return true;
  }

  /**
   * Auto-link a free 1C PT sale / payment probe when exactly one candidate.
   * No-op when flag off, complimentary, already linked, or blocked.
   */
  async tryAutoLinkPtDocument(bookingId: string, clubId: string) {
    const booking = await this.prisma.personalTrainingBooking.findFirst({
      where: { id: bookingId },
      include: {
        client: true,
        trainer: true,
      },
    });
    if (!booking) return null;
    if (booking.isComplimentary) return null;
    if (booking.linkedDocExternalId || booking.docAutoLinkBlocked) return null;
    if (!(await this.shouldApplyPtControl(booking.trainerId, booking.ptFlow)))
      return null;

    const from = new Date(booking.startAt);
    from.setUTCDate(from.getUTCDate() - PT_DOC_LOOKBACK_DAYS);
    const to = new Date(booking.startAt);
    to.setUTCDate(to.getUTCDate() + PT_DOC_LOOKAHEAD_DAYS);

    const [sales, taken] = await Promise.all([
      this.prisma.trainerPtSale.findMany({
        where: {
          clubId,
          isActive: true,
          occurredAt: { gte: from, lte: to },
        },
      }),
      this.prisma.personalTrainingBooking.findMany({
        where: { linkedDocExternalId: { not: null } },
        select: { linkedDocExternalId: true },
      }),
    ]);
    const candidates: PtSaleCandidate[] = sales.map((s) => ({
      externalId: s.externalId,
      occurredAt: s.occurredAt,
      clientName: s.clientName,
      employeeCode: s.employeeCode,
      employeeName: s.employeeName,
      docRef: s.docRef,
      paymentStatus: s.paymentStatus,
      amount: s.amount,
      serviceName: s.serviceName,
    }));

    const takenIds = expandTakenPtDocIds(
      taken
        .map((t) => t.linkedDocExternalId)
        .filter((id): id is string => Boolean(id)),
      candidates,
    );

    const match = matchPtDocument(
      {
        id: booking.id,
        startAt: booking.startAt,
        clientExternalId: booking.client.externalId,
        clientName:
          `${booking.client.lastName} ${booking.client.firstName}`.trim(),
        trainerEmployeeCode: booking.trainer.employeeCode,
        trainerExternalId: booking.trainer.externalId,
        trainerName:
          `${booking.trainer.lastName} ${booking.trainer.firstName}`.trim(),
        linkedDocExternalId: booking.linkedDocExternalId,
        crmDocRef: booking.crmDocRef,
        isComplimentary: booking.isComplimentary,
      },
      candidates,
      takenIds,
    );

    if (match.kind === 'auto') {
      const docId = canonicalPtDocId(match.sale);
      if (!docId) return null;
      try {
        return await this.prisma.personalTrainingBooking.update({
          where: { id: bookingId },
          data: {
            linkedDocExternalId: docId,
            crmDocRef: match.sale.docRef ?? docId,
            paymentStatus:
              match.sale.paymentStatus === 'DEBT' ? 'DEBT' : 'PAID',
            ...(match.sale.paymentStatus !== 'DEBT'
              ? { paidAt: new Date() }
              : {}),
          },
        });
      } catch {
        // Unique conflict — another booking grabbed the doc.
        return null;
      }
    }

    // Several sales → leave for admin (ptLinkHint on detail). Do not auto-pick.
    if (match.kind === 'ambiguous') return null;

    if (match.kind === 'none') {
      const provider = this.fitness.getProvider();
      const live = await provider.getPtSessionPayment?.({
        clientExternalId: booking.client.externalId ?? undefined,
        clientPhone: booking.client.phone ?? undefined,
        trainerExternalId:
          booking.trainer.externalId ??
          booking.trainer.employeeCode ??
          undefined,
        occurredAt: booking.startAt.toISOString(),
      });
      // Ambiguous live probe — admin chooses; never store a guess.
      if (live?.candidates && live.candidates.length > 1) return null;

      // Prefer UUID#line; resolve docRef → TrainerPtSale.externalId when possible.
      let docId =
        canonicalPtDocId({
          externalId: live?.externalId,
          docRef: live?.docRef,
        }) ?? null;
      if (docId && live?.docRef && docId === live.docRef.trim()) {
        const byRef = candidates.find(
          (c) => c.docRef?.trim() === live.docRef?.trim(),
        );
        if (byRef) docId = canonicalPtDocId(byRef) ?? docId;
        else {
          const saleRow = await this.prisma.trainerPtSale.findFirst({
            where: {
              clubId,
              isActive: true,
              OR: [{ docRef: live.docRef }, { externalId: live.docRef }],
            },
          });
          if (saleRow) docId = canonicalPtDocId(saleRow) ?? docId;
        }
      }
      if (docId && !takenIds.has(docId)) {
        try {
          return await this.prisma.personalTrainingBooking.update({
            where: { id: bookingId },
            data: {
              linkedDocExternalId: docId,
              crmDocRef: live?.docRef?.trim() || docId,
              paymentStatus: (live?.paymentStatus as never) ?? undefined,
              ...(live?.payKind ? { payKind: live.payKind as never } : {}),
              ...(live?.priceMinor != null
                ? { priceMinor: live.priceMinor }
                : {}),
              ...(live?.paymentStatus === 'PAID' ? { paidAt: new Date() } : {}),
            },
          });
        } catch {
          return null;
        }
      }
    }

    return null;
  }

  async getTrainerWorkSchedule(user: JwtPayload) {
    const slots = await this.prisma.trainerWorkSlot.findMany({
      where: { trainerId: user.sub },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });

    return slots.map((slot) => ({
      dayOfWeek: slot.dayOfWeek,
      startTime: slot.startTime,
      endTime: slot.endTime,
    }));
  }

  async setTrainerWorkSchedule(user: JwtPayload, slots: WorkSlotInput[]) {
    this.validateWorkSlots(slots);

    await this.prisma.$transaction([
      this.prisma.trainerWorkSlot.deleteMany({ where: { trainerId: user.sub } }),
      this.prisma.trainerWorkSlot.createMany({
        data: slots.map((slot) => ({
          trainerId: user.sub,
          dayOfWeek: slot.dayOfWeek,
          startTime: slot.startTime,
          endTime: slot.endTime,
        })),
      }),
    ]);

    return this.getTrainerWorkSchedule(user);
  }

  async getTrainerPersonalBookings(user: JwtPayload) {
    const bookings = await this.prisma.personalTrainingBooking.findMany({
      where: {
        trainerId: user.sub,
        status: PersonalBookingStatus.CONFIRMED,
        startAt: { gte: new Date() },
      },
      include: {
        client: true,
      },
      orderBy: { startAt: 'asc' },
    });

    return bookings.map((booking) => ({
      id: booking.id,
      trainerId: booking.trainerId,
      clientId: booking.clientId,
      clientName: `${booking.client.firstName} ${booking.client.lastName}`.trim(),
      startAt: booking.startAt.toISOString(),
      endAt: booking.endAt.toISOString(),
      status: booking.status,
      origin: booking.origin,
    }));
  }

  async getTrainerCalendar(
    user: JwtPayload,
    from: string,
    to: string,
  ): Promise<TrainerCalendarResponse> {
    const rangeStart = new Date(from);
    const rangeEnd = new Date(to);
    if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
      throw new BadRequestException('Некорректный период');
    }

    const ptControlOn = await this.shouldApplyPtControl(user.sub);

    const [groupSlots, bookings, blocks, duties, lastPublication] = await Promise.all([
      this.fetchTrainerGroupSchedule(user, rangeStart, rangeEnd),
      this.prisma.personalTrainingBooking.findMany({
        where: {
          trainerId: user.sub,
          status: {
            in: [
              PersonalBookingStatus.CONFIRMED,
              PersonalBookingStatus.COMPLETED,
              PersonalBookingStatus.CANCELLED,
            ],
          },
          startAt: { lt: rangeEnd },
          endAt: { gt: rangeStart },
        },
        include: { client: true },
        orderBy: { startAt: 'asc' },
      }),
      this.prisma.trainerAvailabilityBlock.findMany({
        where: {
          trainerId: user.sub,
          startAt: { lt: rangeEnd },
          endAt: { gt: rangeStart },
        },
        orderBy: { startAt: 'asc' },
      }),
      this.dutyWindows(user.sub, rangeStart, rangeEnd),
      this.prisma.trainerSchedulePublication.findFirst({
        where: { trainerId: user.sub },
        orderBy: { publishedAt: 'desc' },
      }),
    ]);

    /** Live rows occupy windows; cancelled stay visible but free the slot. */
    const liveBookings = bookings.filter(
      (b) => b.status !== PersonalBookingStatus.CANCELLED,
    );

    const approvalByBooking = new Map<
      string,
      {
        performerConfirmedAt: Date | null;
        adminApprovedAt: Date | null;
        overrideApprovedAt: Date | null;
      }
    >();
    if (ptControlOn && liveBookings.length) {
      const approvals = await this.prisma.sessionApproval.findMany({
        where: {
          kind: SessionApprovalKind.PT,
          bookingId: { in: liveBookings.map((b) => b.id) },
        },
      });
      for (const a of approvals) {
        approvalByBooking.set(a.bookingId, a);
      }
    }

    const events: TrainerCalendarEvent[] = [];

    for (const slot of groupSlots) {
      events.push({
        id: `group-${slot.id}`,
        kind: 'GROUP',
        title: slot.title,
        startAt: slot.startAt,
        endAt: slot.endAt,
        available: slot.available,
        capacity: slot.capacity,
        booked: slot.booked,
      });
    }

    for (const duty of duties) {
      events.push({
        id: `duty-${duty.id}`,
        kind: 'DUTY',
        title: 'Дежурство',
        startAt: duty.startAt.toISOString(),
        endAt: duty.endAt.toISOString(),
      });
    }

    const dayHasAdminShift = (dayStart: Date, dayEnd: Date) => {
      const hasDuty = duties.some((d) => d.startAt < dayEnd && d.endAt > dayStart);
      if (hasDuty) return true;
      return blocks.some(
        (b) =>
          b.kind === AvailabilityBlockKind.OPEN &&
          b.status === AvailabilityBlockStatus.PUBLISHED &&
          b.startAt < dayEnd &&
          b.endAt > dayStart,
      );
    };

    for (const booking of bookings) {
      let ptControlStatus: TrainerCalendarEvent['ptControlStatus'];
      let ptControlLabel: string | undefined;
      const isCancelled = booking.status === PersonalBookingStatus.CANCELLED;
      if (ptControlOn && !isCancelled) {
        if (booking.docAutoLinkBlocked) {
          ptControlStatus = 'NO_BASIS';
          ptControlLabel = 'Нет основания в 1С';
        } else if (booking.linkedDocExternalId) {
          const appr = approvalByBooking.get(booking.id);
          if (appr?.adminApprovedAt || appr?.overrideApprovedAt) {
            ptControlStatus = 'APPROVED';
            ptControlLabel = 'Подтверждена';
          } else {
            ptControlStatus = 'LINKED';
            ptControlLabel = 'Документ привязан';
          }
        } else {
          const appr = approvalByBooking.get(booking.id);
          const phase = appr
            ? this.sessionApproval.phase(appr)
            : 'PENDING_PERFORMER';
          if (phase === 'APPROVED') {
            ptControlStatus = 'APPROVED';
            ptControlLabel = 'Подтверждена';
          } else if (phase === 'PENDING_ADMIN') {
            ptControlStatus = 'PENDING_ADMIN';
            ptControlLabel = 'На проверке';
          } else {
            ptControlStatus = 'PENDING_PERFORMER';
            ptControlLabel = 'Ждёт подтверждения';
          }
        }
      }
      const dayStart = this.startOfDay(booking.startAt);
      const dayEnd = this.endOfDay(booking.startAt);
      const outsideShift = !dayHasAdminShift(dayStart, dayEnd);
      const clientLabel =
        `${booking.client.firstName} ${booking.client.lastName}`.trim();
      events.push({
        id: `personal-${booking.id}`,
        kind: 'PERSONAL',
        title: isCancelled
          ? `Отмена · ${clientLabel}`
          : `Персональная · ${clientLabel}`,
        startAt: booking.startAt.toISOString(),
        endAt: booking.endAt.toISOString(),
        clientId: booking.clientId,
        clientName: clientLabel,
        bookingId: booking.id,
        seriesId: booking.seriesId ?? undefined,
        origin: booking.origin,
        ptFlow:
          booking.ptFlow === 'PERSONAL' || booking.ptFlow === 'CLUB'
            ? booking.ptFlow
            : undefined,
        isComplimentary: booking.isComplimentary || undefined,
        linkedDocExternalId: booking.linkedDocExternalId ?? undefined,
        bookingStatus: booking.status,
        cancelReason: booking.cancelReason?.trim() || undefined,
        outsideShift: outsideShift || undefined,
        bufferBeforeMin: booking.bufferBeforeMin || undefined,
        bufferAfterMin: booking.bufferAfterMin || undefined,
        clientIssue:
          booking.clientIssue === 'NONE'
            ? undefined
            : (booking.clientIssue as TrainerCalendarEvent['clientIssue']),
        ptControlStatus,
        ptControlLabel,
      });
    }

    const freeAvailability = await this.allowsFreeAvailability(user.sub);
    const openBlocks = blocks.filter(
      (block) =>
        block.kind === AvailabilityBlockKind.OPEN &&
        (block.status === AvailabilityBlockStatus.DRAFT ||
          freeAvailability ||
          extraBesideDuty(block.startAt, block.endAt, duties) === 'ok'),
    );

    for (const block of openBlocks) {
      const overlapsBooking = liveBookings.some((b) => {
        const occ = occupiedRange(b);
        return rangesOverlap(occ.start, occ.end, block.startAt, block.endAt);
      });
      if (overlapsBooking) continue;

      events.push({
        id: `avail-${block.id}`,
        kind:
          block.status === AvailabilityBlockStatus.PUBLISHED
            ? 'OPEN_SLOT'
            : 'DRAFT_SLOT',
        title:
          block.status === AvailabilityBlockStatus.PUBLISHED
            ? 'Свободно'
            : 'Черновик',
        startAt: block.startAt.toISOString(),
        endAt: block.endAt.toISOString(),
        blockId: block.id,
      });
    }

    for (const block of blocks) {
      if (block.kind === AvailabilityBlockKind.HOLD_CLIENT) {
        events.push({
          id: `hold-${block.id}`,
          kind: 'HOLD_SLOT',
          title: block.note?.trim()
            ? `Резерв · ${block.note.trim()}`
            : 'Резерв под клиента',
          startAt: block.startAt.toISOString(),
          endAt: block.endAt.toISOString(),
          blockId: block.id,
          clientId: block.holdClientId ?? undefined,
          holdExpiresAt: block.holdExpiresAt?.toISOString(),
          note: block.note ?? undefined,
        });
      } else if (block.kind === AvailabilityBlockKind.PERSONAL_BLOCK) {
        events.push({
          id: `block-${block.id}`,
          kind: 'PERSONAL_BLOCK',
          title: block.note?.trim() || 'Личная блокировка',
          startAt: block.startAt.toISOString(),
          endAt: block.endAt.toISOString(),
          blockId: block.id,
          note: block.note ?? undefined,
        });
      }
    }

    const draftBlockCount = openBlocks.filter(
      (b) => b.status === AvailabilityBlockStatus.DRAFT,
    ).length;

    const publishSummary = await this.buildPublishSummary(
      user.sub,
      rangeStart,
      rangeEnd,
      openBlocks,
      liveBookings,
      blocks,
    );

    return {
      events: events.sort((a, b) => a.startAt.localeCompare(b.startAt)),
      availabilityBlocks: blocks.map((b) => ({
        id: b.id,
        startAt: b.startAt.toISOString(),
        endAt: b.endAt.toISOString(),
        status: b.status,
        kind: b.kind,
        holdClientId: b.holdClientId ?? undefined,
        holdExpiresAt: b.holdExpiresAt?.toISOString(),
        note: b.note ?? undefined,
      })),
      draftBlockCount,
      publishSummary,
      lastPublication: lastPublication
        ? {
            periodStart: lastPublication.periodStart.toISOString(),
            periodEnd: lastPublication.periodEnd.toISOString(),
            publishedAt: lastPublication.publishedAt.toISOString(),
          }
        : undefined,
    };
  }

  async getAvailabilityBlocks(user: JwtPayload, from: string, to: string) {
    const rangeStart = new Date(from);
    const rangeEnd = new Date(to);

    const blocks = await this.prisma.trainerAvailabilityBlock.findMany({
      where: {
        trainerId: user.sub,
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
      },
      orderBy: { startAt: 'asc' },
    });

    return blocks.map((b) => ({
      id: b.id,
      startAt: b.startAt.toISOString(),
      endAt: b.endAt.toISOString(),
      status: b.status,
      kind: b.kind,
      holdClientId: b.holdClientId ?? undefined,
      holdExpiresAt: b.holdExpiresAt?.toISOString(),
      note: b.note ?? undefined,
    }));
  }

  async setAvailabilityBlocks(
    user: JwtPayload,
    periodStart: string,
    periodEnd: string,
    blocks: Array<{ id?: string; startAt: string; endAt: string }>,
  ) {
    const start = this.startOfDay(new Date(periodStart));
    const end = this.endOfDay(new Date(periodEnd));

    for (const block of blocks) {
      const blockStart = new Date(block.startAt);
      const blockEnd = new Date(block.endAt);
      if (Number.isNaN(blockStart.getTime()) || Number.isNaN(blockEnd.getTime())) {
        throw new BadRequestException('Некорректное время блока');
      }
      if (blockStart >= blockEnd) {
        throw new BadRequestException('Время начала должно быть раньше окончания');
      }
    }

    await this.assertExtraBesideDuty(
      user.sub,
      blocks.map((block) => ({
        startAt: new Date(block.startAt),
        endAt: new Date(block.endAt),
      })),
    );

    await this.prisma.$transaction(async (tx) => {
      // Only wipe OPEN draft windows — holds/blocks stay.
      await tx.trainerAvailabilityBlock.deleteMany({
        where: {
          trainerId: user.sub,
          status: AvailabilityBlockStatus.DRAFT,
          kind: AvailabilityBlockKind.OPEN,
          startAt: { lt: end },
          endAt: { gt: start },
        },
      });

      if (blocks.length > 0) {
        await tx.trainerAvailabilityBlock.createMany({
          data: blocks.map((block) => ({
            trainerId: user.sub,
            startAt: new Date(block.startAt),
            endAt: new Date(block.endAt),
            status: AvailabilityBlockStatus.DRAFT,
            kind: AvailabilityBlockKind.OPEN,
          })),
        });
      }
    });

    return this.getAvailabilityBlocks(
      user,
      start.toISOString(),
      end.toISOString(),
    );
  }

  async fillFromTemplate(
    user: JwtPayload,
    periodStart: string,
    periodEnd: string,
  ) {
    const template = await this.prisma.trainerWorkSlot.findMany({
      where: { trainerId: user.sub },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });

    if (template.length === 0) {
      throw new BadRequestException(
        'Сначала настройте шаблон недели в мастере расписания',
      );
    }

    const start = this.startOfDay(new Date(periodStart));
    const end = this.endOfDay(new Date(periodEnd));
    const blocks: Array<{ startAt: string; endAt: string }> = [];

    const cursor = new Date(start);
    while (cursor <= end) {
      const daySlots = template.filter(
        (slot) => slot.dayOfWeek === cursor.getDay(),
      );
      for (const workSlot of daySlots) {
        blocks.push({
          startAt: this.combineDateAndTime(cursor, workSlot.startTime).toISOString(),
          endAt: this.combineDateAndTime(cursor, workSlot.endTime).toISOString(),
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    return this.setAvailabilityBlocks(
      user,
      start.toISOString(),
      end.toISOString(),
      blocks,
    );
  }

  async publishSchedule(
    user: JwtPayload,
    periodStart: string,
    periodEnd: string,
    blockIds?: string[] | null,
  ) {
    const start = this.startOfDay(new Date(periodStart));
    const end = this.endOfDay(new Date(periodEnd));
    const ids = (blockIds ?? []).map((id) => id.trim()).filter(Boolean);

    const draftWhere =
      ids.length > 0
        ? {
            id: { in: ids },
            trainerId: user.sub,
            status: AvailabilityBlockStatus.DRAFT,
            kind: AvailabilityBlockKind.OPEN,
          }
        : {
            trainerId: user.sub,
            status: AvailabilityBlockStatus.DRAFT,
            kind: AvailabilityBlockKind.OPEN,
            startAt: { lt: end },
            endAt: { gt: start },
          };

    const drafts = await this.prisma.trainerAvailabilityBlock.findMany({
      where: draftWhere,
    });

    if (drafts.length === 0) {
      throw new BadRequestException('Нет черновых слотов для публикации');
    }
    if (ids.length > 0 && drafts.length !== ids.length) {
      throw new BadRequestException(
        'Часть слотов не найдена или уже опубликована',
      );
    }

    await this.assertExtraBesideDuty(user.sub, drafts);

    const rangeStart =
      ids.length > 0
        ? drafts.reduce(
            (min, d) => (d.startAt < min ? d.startAt : min),
            drafts[0].startAt,
          )
        : start;
    const rangeEnd =
      ids.length > 0
        ? drafts.reduce(
            (max, d) => (d.endAt > max ? d.endAt : max),
            drafts[0].endAt,
          )
        : end;

    const bookings = await this.prisma.personalTrainingBooking.findMany({
      where: {
        trainerId: user.sub,
        status: PersonalBookingStatus.CONFIRMED,
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
      },
    });
    const allBlocks = await this.prisma.trainerAvailabilityBlock.findMany({
      where: {
        trainerId: user.sub,
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
      },
    });
    const summary = await this.buildPublishSummary(
      user.sub,
      rangeStart,
      rangeEnd,
      [...drafts, ...allBlocks.filter((b) => b.kind === AvailabilityBlockKind.OPEN)],
      bookings,
      allBlocks,
    );

    await this.prisma.$transaction([
      this.prisma.trainerAvailabilityBlock.updateMany({
        where: draftWhere,
        data: { status: AvailabilityBlockStatus.PUBLISHED },
      }),
      this.prisma.trainerSchedulePublication.create({
        data: {
          trainerId: user.sub,
          periodStart: this.startOfDay(rangeStart),
          periodEnd: this.endOfDay(rangeEnd),
        },
      }),
    ]);

    const pubStart = this.startOfDay(rangeStart);
    const pubEnd = this.endOfDay(rangeEnd);

    // After publish: materialize active series into the published range.
    const seriesResult = await this.generateSeriesForPeriod(
      user,
      pubStart,
      pubEnd,
    );
    // Refresh summary so «занято» includes just-created series rows.
    const summaryAfter =
      seriesResult.created > 0
        ? await this.getPublishSummary(
            user,
            pubStart.toISOString(),
            pubEnd.toISOString(),
          )
        : summary;

    return {
      publishedBlocks: drafts.length,
      periodStart: pubStart.toISOString(),
      periodEnd: pubEnd.toISOString(),
      summary: summaryAfter,
      seriesCreated: seriesResult.created,
      seriesConflicts: seriesResult.conflicts,
    };
  }

  async getPublishSummary(
    user: JwtPayload,
    periodStart: string,
    periodEnd: string,
  ): Promise<SchedulePublishSummary> {
    const start = this.startOfDay(new Date(periodStart));
    const end = this.endOfDay(new Date(periodEnd));
    const [blocks, bookings] = await Promise.all([
      this.prisma.trainerAvailabilityBlock.findMany({
        where: {
          trainerId: user.sub,
          startAt: { lt: end },
          endAt: { gt: start },
        },
      }),
      this.prisma.personalTrainingBooking.findMany({
        where: {
          trainerId: user.sub,
          status: PersonalBookingStatus.CONFIRMED,
          startAt: { lt: end },
          endAt: { gt: start },
        },
      }),
    ]);
    const openBlocks = blocks.filter(
      (b) => b.kind === AvailabilityBlockKind.OPEN,
    );
    return this.buildPublishSummary(
      user.sub,
      start,
      end,
      openBlocks,
      bookings,
      blocks,
    );
  }

  async assignPersonalBooking(
    user: JwtPayload,
    input: {
      clientId?: string | null;
      phone?: string | null;
      firstName?: string | null;
      lastName?: string | null;
      clientExternalId?: string | null;
      startAt: string;
      isComplimentary?: boolean;
      ptFlow?: PtBookingFlowValue | null;
    },
  ) {
    const start = new Date(input.startAt);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Некорректная дата');
    }

    const end = new Date(start.getTime() + SESSION_DURATION_MIN * 60_000);

    const clientId = await this.roster.resolveClientForAssign(user.sub, user, {
      clientId: input.clientId,
      phone: input.phone,
      firstName: input.firstName,
      lastName: input.lastName,
      clientExternalId: input.clientExternalId,
    });
    const isComplimentary = input.isComplimentary ?? false;
    const ptFlowRequest = input.ptFlow;

    await this.ensureNoBookingConflict(user.sub, start, end);

    const trainerFlags = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { trainerClub: true, trainerStaff: true },
    });
    const ptFlow = resolvePtFlow(trainerFlags ?? {}, ptFlowRequest);
    const personal = ptFlow === 'PERSONAL';

    const client = await this.prisma.user.findFirst({
      where: {
        id: clientId,
        roles: { some: { role: Role.CLIENT } },
      },
      include: {
        clubMemberships: user.clubId
          ? { where: { clubId: user.clubId }, take: 1 }
          : false,
      },
    });
    if (!client) {
      throw new NotFoundException('Клиент не найден');
    }
    if (!client.phoneNormalized && !client.phone) {
      throw new BadRequestException(
        'У клиента нет телефона — укажите номер перед записью',
      );
    }

    const link = await this.prisma.trainerClientLink.findUnique({
      where: { trainerId_clientId: { trainerId: user.sub, clientId } },
    });

    const control = this.serviceUsage.controlFieldsForCreate({
      origin: PersonalBookingOrigin.TRAINER_ASSIGNED,
      bookedByUserId: user.sub,
      isComplimentary,
    });

    const membership = Array.isArray(client.clubMemberships)
      ? client.clubMemberships[0]
      : undefined;
    const ext = client.externalId ?? membership?.externalId;
    const clientIssue =
      !client.phoneNormalized && !client.phone
        ? 'WRONG_PHONE'
        : !ext || membership?.crmStatus === 'PENDING_CRM'
          ? 'CRM_UNMATCHED'
          : 'NONE';

    let priceMinor: number | undefined;
    if (personal && !isComplimentary) {
      const [bal, profile] = await Promise.all([
        this.prisma.trainerClientBalance.findUnique({
          where: {
            trainerId_clientId: { trainerId: user.sub, clientId },
          },
          select: { sessionPriceMinor: true },
        }),
        this.prisma.staffProfile.findUnique({
          where: { userId: user.sub },
          select: { defaultSessionPriceMinor: true },
        }),
      ]);
      const resolved =
        bal?.sessionPriceMinor ?? profile?.defaultSessionPriceMinor ?? null;
      if (resolved != null && resolved > 0) priceMinor = resolved;
    }

    const booking = await this.prisma.personalTrainingBooking.create({
      data: {
        trainerId: user.sub,
        clientId,
        startAt: start,
        endAt: end,
        origin: PersonalBookingOrigin.TRAINER_ASSIGNED,
        isComplimentary,
        ptFlow,
        controlLevel: control.controlLevel,
        reviewFlag: personal
          ? false
          : control.reviewFlag || clientIssue !== 'NONE',
        paymentStatus: control.paymentStatus,
        usageStatus: control.usageStatus,
        presenceStatus: control.presenceStatus,
        performanceStatus: control.performanceStatus,
        eligibleForMotivation: personal ? false : control.eligibleForMotivation,
        bookedByUserId: control.bookedByUserId,
        clientIssue: clientIssue as never,
        payKind: isComplimentary ? 'GIFT' : 'UNKNOWN',
        ...(priceMinor != null ? { priceMinor } : {}),
        ...(clientIssue !== 'NONE' && !personal
          ? { trustBand: 'AMBER' as never }
          : {}),
      },
      include: { client: true, trainer: true },
    });

    const trainerName =
      `${booking.trainer.firstName} ${booking.trainer.lastName}`.trim();

    if (
      client.accountStatus === AccountStatus.ACTIVE &&
      link?.clientAcceptedAt
    ) {
      await this.notifications.notifySessionAssigned({
        clientId,
        trainerId: user.sub,
        trainerName,
        startAt: start,
      });
    }

    // Gift / membership complimentary always goes to admin control.
    if (
      isComplimentary ||
      (await this.shouldApplyPtControl(user.sub, ptFlow))
    ) {
      const clubId = requireClubId(user);
      await this.sessionApproval.ensureApproval(
        SessionApprovalKind.PT,
        booking.id,
        clubId,
      );
    }

    return {
      id: booking.id,
      trainerId: booking.trainerId,
      clientId: booking.clientId,
      clientName: `${booking.client.firstName} ${booking.client.lastName}`.trim(),
      startAt: booking.startAt.toISOString(),
      endAt: booking.endAt.toISOString(),
      status: booking.status,
      origin: booking.origin,
      ptFlow,
    };
  }

  async updateTrainerPersonalBooking(
    user: JwtPayload,
    bookingId: string,
    data: {
      startAt?: string;
      clientId?: string;
      status?: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
      action?: 'cancel' | 'no_show';
      cancelReason?: string;
      debitPackage?: boolean;
      seriesScope?: 'one' | 'future';
      bufferBeforeMin?: number;
      bufferAfterMin?: number;
    },
  ) {
    const booking = await this.prisma.personalTrainingBooking.findFirst({
      where: {
        id: bookingId,
        trainerId: user.sub,
      },
      include: {
        client: true,
        trainer: { select: { firstName: true, lastName: true } },
      },
    });

    if (!booking) {
      throw new NotFoundException('Запись не найдена');
    }

    if (data.clientId && data.clientId !== booking.clientId) {
      await this.roster.ensureConfirmedLink(user.sub, data.clientId);
      const updated = await this.prisma.personalTrainingBooking.update({
        where: { id: bookingId },
        data: { clientId: data.clientId },
        include: { client: true },
      });
      return {
        id: updated.id,
        clientId: updated.clientId,
        clientName: `${updated.client.firstName} ${updated.client.lastName}`.trim(),
        startAt: updated.startAt.toISOString(),
        endAt: updated.endAt.toISOString(),
        status: updated.status,
      };
    }

    if (data.status && data.status !== booking.status) {
      if (
        data.status === 'CANCELLED' &&
        booking.status === PersonalBookingStatus.CONFIRMED
      ) {
        return this.cancelTrainerBooking(user, booking, {
          action: 'cancel',
          cancelReason: data.cancelReason,
          debitPackage: data.debitPackage,
          seriesScope: data.seriesScope ?? 'one',
        });
      }
      if (
        data.status === 'COMPLETED' ||
        data.status === 'CONFIRMED'
      ) {
        const updated = await this.prisma.personalTrainingBooking.update({
          where: { id: bookingId },
          data: {
            status:
              data.status === 'COMPLETED'
                ? PersonalBookingStatus.COMPLETED
                : PersonalBookingStatus.CONFIRMED,
            ...(data.status === 'COMPLETED'
              ? { trainerCompletedAt: new Date() }
              : {
                  trainerCompletedAt: null,
                  cancelledAt: null,
                  cancelReason: null,
                }),
          },
          include: { client: true },
        });
        return {
          id: updated.id,
          clientId: updated.clientId,
          clientName: `${updated.client.firstName} ${updated.client.lastName}`.trim(),
          startAt: updated.startAt.toISOString(),
          endAt: updated.endAt.toISOString(),
          status: updated.status,
        };
      }
    }

    if (booking.status !== PersonalBookingStatus.CONFIRMED) {
      throw new BadRequestException(
        'Перенос и буфер доступны только для запланированных записей',
      );
    }

    if (
      data.bufferBeforeMin !== undefined ||
      data.bufferAfterMin !== undefined
    ) {
      const before = data.bufferBeforeMin ?? booking.bufferBeforeMin;
      const after = data.bufferAfterMin ?? booking.bufferAfterMin;
      if (![0, 15, 30, 60].includes(before) || ![0, 15, 30, 60].includes(after)) {
        throw new BadRequestException('Буфер: 0, 15, 30 или 60 минут');
      }
      await this.ensureNoBookingConflict(
        user.sub,
        booking.startAt,
        booking.endAt,
        bookingId,
        before,
        after,
      );
      const updated = await this.prisma.personalTrainingBooking.update({
        where: { id: bookingId },
        data: { bufferBeforeMin: before, bufferAfterMin: after },
        include: { client: true },
      });
      return {
        id: updated.id,
        clientId: updated.clientId,
        clientName: `${updated.client.firstName} ${updated.client.lastName}`.trim(),
        startAt: updated.startAt.toISOString(),
        endAt: updated.endAt.toISOString(),
        status: updated.status,
        bufferBeforeMin: updated.bufferBeforeMin,
        bufferAfterMin: updated.bufferAfterMin,
      };
    }

    if (data.action === 'cancel' || data.action === 'no_show') {
      return this.cancelTrainerBooking(user, booking, {
        action: data.action,
        cancelReason: data.cancelReason,
        debitPackage: data.debitPackage,
        seriesScope: data.seriesScope ?? 'one',
      });
    }

    if (data.startAt) {
      return this.rescheduleTrainerBooking(user, booking, data.startAt, data.seriesScope ?? 'one');
    }

    throw new BadRequestException('Укажите действие или новое время');
  }

  checkGroupConflicts(
    groupSlots: ScheduleSlot[],
    startAt: Date,
    endAt: Date,
  ): ScheduleSlot[] {
    return groupSlots.filter(
      (slot) =>
        new Date(slot.startAt) < endAt && new Date(slot.endAt) > startAt,
    );
  }

  async listAvailableTrainers(clubId: string) {
    const trainers = await this.prisma.user.findMany({
      where: {
        clubId,
        roles: { some: { role: Role.TRAINER } },
      },
      include: {
        trainerSchedulePublications: {
          where: { periodEnd: { gte: new Date() } },
          orderBy: { publishedAt: 'desc' },
          take: 1,
        },
        staffProfile: true,
      },
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const compensations = await this.prisma.staffCompensation.findMany({
      where: {
        clubId,
        userId: { in: trainers.map((t) => t.id) },
        effectiveFrom: { lte: today },
      },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    const priceByTrainer = new Map<string, { minor: number; currency: string }>();
    for (const row of compensations) {
      if (priceByTrainer.has(row.userId)) continue;
      const profile =
        row.payProfile &&
        typeof row.payProfile === 'object' &&
        !Array.isArray(row.payProfile)
          ? (row.payProfile as unknown as StaffPayProfile)
          : undefined;
      const minor =
        sliceForTrack(profile, 'PT').ptSessionPriceMinor ||
        profile?.ptSessionPriceMinor ||
        0;
      if (minor > 0) {
        priceByTrainer.set(row.userId, {
          minor,
          currency: row.currency || 'BYN',
        });
      }
    }

    const results = await Promise.all(
      trainers.map(async (trainer) => {
        const slots = await this.getTrainerAvailableSlots(
          clubId,
          trainer.id,
          new Date().toISOString(),
          new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        );
        const profile = trainer.staffProfile;
        const showPublic = !profile?.hiddenByAdminAt;
        const acceptsBookings = Boolean(profile?.acceptsClientBookings);
        const photoV = profile?.photoUpdatedAt?.getTime();
        const price = priceByTrainer.get(trainer.id);
        return {
          id: trainer.id,
          firstName: trainer.firstName,
          lastName: trainer.lastName,
          hasSchedule: slots.length > 0,
          acceptsClientBookings: acceptsBookings,
          sessionPriceMinor: price?.minor ?? null,
          currency: price?.currency ?? 'BYN',
          bio: showPublic ? (profile?.bio ?? '') : '',
          photoUrl:
            showPublic && profile?.photoPath
              ? `/api/media/staff/${trainer.id}/full.webp${photoV ? `?v=${photoV}` : ''}`
              : null,
          photoThumbUrl:
            showPublic && profile?.photoThumbPath
              ? `/api/media/staff/${trainer.id}/thumb.webp${photoV ? `?v=${photoV}` : ''}`
              : null,
        };
      }),
    );

    return results.filter((t) => t.hasSchedule && t.acceptsClientBookings);
  }

  async getTrainerAvailableSlots(
    clubId: string,
    trainerId: string,
    from?: string,
    to?: string,
  ) {
    const trainer = await this.prisma.user.findFirst({
      where: {
        id: trainerId,
        clubId,
        roles: { some: { role: Role.TRAINER } },
      },
    });

    if (!trainer) {
      throw new NotFoundException('Тренер не найден');
    }

    const rangeStart = from ? new Date(from) : new Date();
    const rangeEnd = to
      ? new Date(to)
      : new Date(rangeStart.getTime() + 14 * 24 * 60 * 60 * 1000);

    const publishedBlocks = await this.prisma.trainerAvailabilityBlock.findMany({
      where: {
        trainerId,
        status: AvailabilityBlockStatus.PUBLISHED,
        kind: AvailabilityBlockKind.OPEN,
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
      },
      orderBy: { startAt: 'asc' },
    });
    const duties = await this.dutyWindows(trainerId, rangeStart, rangeEnd);
    const freeAvailability = await this.allowsFreeAvailability(trainerId);
    const bookable = [
      ...duties.map((d) => ({ startAt: d.startAt, endAt: d.endAt })),
      ...publishedBlocks.filter(
        (block) =>
          freeAvailability ||
          extraBesideDuty(block.startAt, block.endAt, duties) === 'ok',
      ),
    ];

    if (bookable.length === 0) {
      return [];
    }

    const [bookings, blockers] = await Promise.all([
      this.prisma.personalTrainingBooking.findMany({
        where: {
          trainerId,
          status: PersonalBookingStatus.CONFIRMED,
          startAt: { lt: rangeEnd },
          endAt: { gt: rangeStart },
        },
      }),
      this.prisma.trainerAvailabilityBlock.findMany({
        where: {
          trainerId,
          kind: {
            in: [
              AvailabilityBlockKind.HOLD_CLIENT,
              AvailabilityBlockKind.PERSONAL_BLOCK,
            ],
          },
          startAt: { lt: rangeEnd },
          endAt: { gt: rangeStart },
        },
      }),
    ]);

    const slots: Array<{ startAt: string; endAt: string }> = [];

    for (const block of bookable) {
      let slotStart = new Date(block.startAt);
      const blockEnd = new Date(block.endAt);

      while (
        slotStart.getTime() + SESSION_DURATION_MIN * 60_000 <=
        blockEnd.getTime()
      ) {
        const slotEnd = new Date(
          slotStart.getTime() + SESSION_DURATION_MIN * 60_000,
        );

        const isPast = slotStart <= new Date();
        const overlapsBooking = bookings.some((booking) => {
          const occ = occupiedRange(booking);
          return rangesOverlap(occ.start, occ.end, slotStart, slotEnd);
        });
        const overlapsBlocker = blockers.some((b) =>
          rangesOverlap(b.startAt, b.endAt, slotStart, slotEnd),
        );

        if (
          !isPast &&
          !overlapsBooking &&
          !overlapsBlocker &&
          slotStart >= rangeStart &&
          slotStart < rangeEnd
        ) {
          slots.push({
            startAt: slotStart.toISOString(),
            endAt: slotEnd.toISOString(),
          });
        }

        slotStart = new Date(slotEnd);
      }
    }

    return slots.sort((a, b) => a.startAt.localeCompare(b.startAt));
  }

  async bookPersonalSession(
    user: JwtPayload,
    trainerId: string,
    startAt: string,
  ) {
    const start = new Date(startAt);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Некорректная дата');
    }

    const end = new Date(start.getTime() + SESSION_DURATION_MIN * 60_000);
    const clubId = requireClubId(user);
    const available = await this.getTrainerAvailableSlots(
      clubId,
      trainerId,
      start.toISOString(),
      end.toISOString(),
    );

    const isAvailable = available.some(
      (slot) =>
        new Date(slot.startAt).getTime() === start.getTime() &&
        new Date(slot.endAt).getTime() === end.getTime(),
    );

    if (!isAvailable) {
      throw new ConflictException('Выбранный слот недоступен');
    }

    const trainer = await this.prisma.user.findFirst({
      where: {
        id: trainerId,
        clubId,
        roles: { some: { role: Role.TRAINER } },
      },
    });

    if (!trainer) {
      throw new NotFoundException('Тренер не найден');
    }

    const control = this.serviceUsage.controlFieldsForCreate({
      origin: PersonalBookingOrigin.CLIENT_BOOKED,
      bookedByUserId: user.sub,
    });

    const booking = await this.prisma.personalTrainingBooking.create({
      data: {
        trainerId,
        clientId: user.sub,
        startAt: start,
        endAt: end,
        origin: PersonalBookingOrigin.CLIENT_BOOKED,
        controlLevel: control.controlLevel,
        reviewFlag: control.reviewFlag,
        paymentStatus: control.paymentStatus,
        usageStatus: control.usageStatus,
        presenceStatus: control.presenceStatus,
        performanceStatus: control.performanceStatus,
        eligibleForMotivation: control.eligibleForMotivation,
        bookedByUserId: control.bookedByUserId,
      },
      include: { trainer: true },
    });

    return {
      id: booking.id,
      trainerId: booking.trainerId,
      trainerName: `${booking.trainer.firstName} ${booking.trainer.lastName}`.trim(),
      startAt: booking.startAt.toISOString(),
      endAt: booking.endAt.toISOString(),
      status: booking.status,
    };
  }

  async getClientPersonalBookings(
    user: JwtPayload,
    options?: { upcomingOnly?: boolean; includeAll?: boolean },
  ) {
    const acceptedTrainerIds =
      await this.roster.getClientAcceptedTrainerIds(user.sub);

    if (acceptedTrainerIds.length === 0) {
      return [];
    }

    const where: {
      clientId: string;
      trainerId: { in: string[] };
      status?: PersonalBookingStatus | { in: PersonalBookingStatus[] };
      endAt?: { gte: Date };
    } = {
      clientId: user.sub,
      trainerId: { in: acceptedTrainerIds },
    };

    if (options?.upcomingOnly) {
      where.status = PersonalBookingStatus.CONFIRMED;
      where.endAt = { gte: new Date() };
    }

    const bookings = await this.prisma.personalTrainingBooking.findMany({
      where,
      include: { trainer: true },
      orderBy: { startAt: options?.includeAll ? 'desc' : 'asc' },
    });

    return bookings.map((booking) => ({
      id: booking.id,
      trainerId: booking.trainerId,
      trainerName: `${booking.trainer.firstName} ${booking.trainer.lastName}`.trim(),
      startAt: booking.startAt.toISOString(),
      endAt: booking.endAt.toISOString(),
      status: booking.status,
      origin: booking.origin,
      clientCompletedAt: booking.clientCompletedAt?.toISOString(),
      trainerCompletedAt: booking.trainerCompletedAt?.toISOString(),
      isComplimentary: booking.isComplimentary,
      usage: toUsageControl({
        controlLevel: booking.controlLevel,
        presenceStatus: booking.presenceStatus,
        performanceStatus: booking.performanceStatus,
        usageStatus: booking.usageStatus,
        paymentStatus: booking.paymentStatus,
        reviewFlag: booking.reviewFlag,
        eligibleForMotivation: booking.eligibleForMotivation,
        isComplimentary: booking.isComplimentary,
      }),
    }));
  }

  getGoalTemplates() {
    return PERSONAL_TRAINING_GOAL_TEMPLATES;
  }

  async getSessionDetail(
    user: JwtPayload,
    bookingId: string,
  ): Promise<PersonalTrainingSessionDetail> {
    const booking = await this.getAccessibleBooking(user, bookingId);
    const ptControlApplies = await this.shouldApplyPtControl(
      booking.trainerId,
      booking.ptFlow,
    );
    const approval = ptControlApplies
      ? await this.prisma.sessionApproval.findUnique({
          where: {
            kind_bookingId: {
              kind: SessionApprovalKind.PT,
              bookingId: booking.id,
            },
          },
        })
      : null;
    return this.mapSessionDetail(booking, user.sub, {
      ptControlApplies,
      approval,
    });
  }

  async getPreviousWorkoutSheet(
    user: JwtPayload,
    bookingId: string,
  ): Promise<{
    sheet: WorkoutSheet | null;
    date?: string;
    bookingId?: string;
    summary?: string;
  }> {
    const booking = await this.getAccessibleBooking(user, bookingId);
    const previous = await this.prisma.personalTrainingBooking.findMany({
      where: {
        trainerId: booking.trainerId,
        clientId: booking.clientId,
        startAt: { lt: booking.startAt },
      },
      orderBy: { startAt: 'desc' },
      take: 15,
    });
    const withSheet = previous.find((row) => row.workoutSheet != null);
    if (!withSheet?.workoutSheet) {
      return { sheet: null };
    }
    const normalized = normalizeWorkoutSheet(withSheet.workoutSheet);
    const isClient = booking.clientId === user.sub;
    const sheet = isClient
      ? workoutSheetForClient(normalized)
      : normalized;
    return {
      sheet,
      date: withSheet.startAt.toISOString(),
      bookingId: withSheet.id,
      summary: sheet.sessionSummaryNote?.trim() || undefined,
    };
  }

  async getCircuitHistory(
    user: JwtPayload,
    bookingId: string,
    limit = 10,
  ): Promise<CircuitHistoryPoint[]> {
    const booking = await this.getAccessibleBooking(user, bookingId);
    const sessions = await this.prisma.personalTrainingBooking.findMany({
      where: {
        trainerId: booking.trainerId,
        clientId: booking.clientId,
        id: { not: bookingId },
      },
      orderBy: { startAt: 'desc' },
      take: limit * 3,
    });

    const points: CircuitHistoryPoint[] = [];
    for (const session of sessions) {
      if (session.workoutSheet == null) continue;
      const sheet = normalizeWorkoutSheet(session.workoutSheet);
      const point = summarizeCircuitSession(
        session.id,
        session.startAt.toISOString(),
        sheet,
      );
      if (point) points.push(point);
      if (points.length >= limit) break;
    }
    return points.reverse();
  }

  async updateSessionPlan(
    user: JwtPayload,
    bookingId: string,
    goals: Array<{
      id?: string;
      title: string;
      notes?: string;
      sortOrder?: number;
      tasks?: Array<{ id?: string; title: string; sortOrder?: number }>;
    }>,
    workoutSheet?: WorkoutSheet,
  ) {
    const booking = await this.getAccessibleBooking(user, bookingId);
    this.ensureSessionEditable(booking);

    const existingGoals = booking.sessionGoals ?? [];
    const keptGoalIds = new Set<string>();

    await this.prisma.$transaction(async (tx) => {
      for (const [goalIndex, goal] of goals.entries()) {
        if (!goal.title.trim()) continue;

        const sortOrder = goal.sortOrder ?? goalIndex;
        const taskInputs = (goal.tasks ?? []).filter((t) => t.title.trim());

        let goalId: string;
        if (goal.id && existingGoals.some((g) => g.id === goal.id)) {
          goalId = goal.id;
          keptGoalIds.add(goalId);
          await tx.personalTrainingSessionGoal.update({
            where: { id: goalId },
            data: {
              title: goal.title.trim(),
              notes: goal.notes?.trim() || null,
              sortOrder,
            },
          });
        } else {
          const created = await tx.personalTrainingSessionGoal.create({
            data: {
              bookingId,
              title: goal.title.trim(),
              notes: goal.notes?.trim() || null,
              sortOrder,
              createdById: user.sub,
            },
          });
          goalId = created.id;
          keptGoalIds.add(goalId);
        }

        const existingTasks =
          existingGoals.find((g) => g.id === goalId)?.tasks ?? [];
        const keptTaskIds = new Set<string>();

        for (const [taskIndex, task] of taskInputs.entries()) {
          const taskSortOrder = task.sortOrder ?? taskIndex;
          if (task.id && existingTasks.some((t) => t.id === task.id)) {
            keptTaskIds.add(task.id);
            await tx.personalTrainingSessionTask.update({
              where: { id: task.id },
              data: {
                title: task.title.trim(),
                sortOrder: taskSortOrder,
              },
            });
          } else {
            const createdTask = await tx.personalTrainingSessionTask.create({
              data: {
                goalId,
                title: task.title.trim(),
                sortOrder: taskSortOrder,
              },
            });
            keptTaskIds.add(createdTask.id);
          }
        }

        const tasksToRemove = existingTasks.filter((t) => !keptTaskIds.has(t.id));
        if (tasksToRemove.length > 0) {
          await tx.personalTrainingSessionTask.deleteMany({
            where: { id: { in: tasksToRemove.map((t) => t.id) } },
          });
        }
      }

      const goalsToRemove = existingGoals.filter((g) => !keptGoalIds.has(g.id));
      if (goalsToRemove.length > 0) {
        await tx.personalTrainingSessionGoal.deleteMany({
          where: { id: { in: goalsToRemove.map((g) => g.id) } },
        });
      }

      if (workoutSheet !== undefined) {
        await tx.personalTrainingBooking.update({
          where: { id: bookingId },
          data: {
            workoutSheet: normalizeWorkoutSheet(
              workoutSheet,
            ) as unknown as Prisma.InputJsonValue,
          },
        });
      }
    });

    return this.getSessionDetail(user, bookingId);
  }

  async confirmSessionGoal(
    user: JwtPayload,
    bookingId: string,
    goalId: string,
  ) {
    const booking = await this.getAccessibleBooking(user, bookingId);
    this.ensureCanConfirm(booking);

    const goal = await this.prisma.personalTrainingSessionGoal.findFirst({
      where: { id: goalId, bookingId },
    });
    if (!goal) throw new NotFoundException('Цель не найдена');

    const isClient = booking.clientId === user.sub;
    await this.prisma.personalTrainingSessionGoal.update({
      where: { id: goalId },
      data: isClient
        ? { clientConfirmed: true }
        : { trainerConfirmed: true },
    });

    return this.getSessionDetail(user, bookingId);
  }

  async confirmSessionTask(
    user: JwtPayload,
    bookingId: string,
    taskId: string,
  ) {
    const booking = await this.getAccessibleBooking(user, bookingId);
    this.ensureCanConfirm(booking);

    const task = await this.prisma.personalTrainingSessionTask.findFirst({
      where: {
        id: taskId,
        goal: { bookingId },
      },
    });
    if (!task) throw new NotFoundException('Задача не найдена');

    const isClient = booking.clientId === user.sub;
    await this.prisma.personalTrainingSessionTask.update({
      where: { id: taskId },
      data: isClient
        ? { clientConfirmed: true }
        : { trainerConfirmed: true },
    });

    return this.getSessionDetail(user, bookingId);
  }

  async completeSession(user: JwtPayload, bookingId: string) {
    const booking = await this.getAccessibleBooking(user, bookingId);
    if (booking.status === PersonalBookingStatus.CANCELLED) {
      throw new BadRequestException('Тренировка отменена');
    }

    const now = new Date();
    if (booking.startAt > now) {
      throw new BadRequestException('Тренировка ещё не началась');
    }

    const isClient = booking.clientId === user.sub;
    const isTrainer = booking.trainerId === user.sub;
    const clientCompletedAt =
      booking.clientCompletedAt ?? (isClient ? now : null);
    const trainerCompletedAt =
      booking.trainerCompletedAt ?? (isTrainer ? now : null);

    const alreadyDoneByUser =
      booking.status === PersonalBookingStatus.COMPLETED &&
      ((isClient && Boolean(booking.clientCompletedAt)) ||
        (isTrainer && Boolean(booking.trainerCompletedAt)));

    if (!alreadyDoneByUser) {
      await this.prisma.personalTrainingBooking.update({
        where: { id: bookingId },
        data: {
          ...(clientCompletedAt ? { clientCompletedAt } : {}),
          ...(trainerCompletedAt ? { trainerCompletedAt } : {}),
          status:
            clientCompletedAt || trainerCompletedAt
              ? PersonalBookingStatus.COMPLETED
              : PersonalBookingStatus.CONFIRMED,
        },
      });
    }

    // Idempotent: trainer retry after a partial failure finishes settle/link without a second debit.
    if (isTrainer && trainerCompletedAt) {
      await this.applyTrainerCompletionEffects(user, booking);
    }

    return this.getSessionDetail(user, bookingId);
  }

  /** Side-effects after trainer confirm — safe to call again on retry. */
  private async applyTrainerCompletionEffects(
    user: JwtPayload,
    booking: Awaited<
      ReturnType<PersonalTrainingService['getAccessibleBooking']>
    >,
  ) {
    const bookingId = booking.id;
    await this.serviceUsage.markPerformerConfirmed(bookingId, 'PT');
    const clubId =
      booking.client.clubId ??
      booking.trainer.clubId ??
      requireClubId(user);
    const title =
      `Персональная · ${booking.trainer.firstName} ${booking.trainer.lastName}`.trim();
    await this.visitSync.recordTrainerConfirm({
      userId: booking.clientId,
      clubId,
      bookingId: booking.id,
      kind: 'PT',
      occurredAt: booking.startAt,
      title,
      checkIn: booking.startAt.toISOString().slice(11, 16),
      checkOut: booking.endAt.toISOString().slice(11, 16),
    });

    if (await this.shouldApplyPtControl(booking.trainerId, booking.ptFlow)) {
      await this.sessionApproval.confirmPerformer(
        user,
        SessionApprovalKind.PT,
        bookingId,
      );
      await this.tryAutoLinkPtDocument(bookingId, clubId);
    } else if (
      isPersonalPtBooking(
        { ptFlow: booking.ptFlow },
        {
          trainerClub: booking.trainer.trainerClub,
          trainerStaff: booking.trainer.trainerStaff,
        },
      )
    ) {
      await this.ledger.settlePersonalSession(bookingId);
    }
  }

  mapSessionStatus(booking: {
    status: PersonalBookingStatus;
    endAt: Date;
  }): PersonalSessionStatus {
    if (booking.status === PersonalBookingStatus.CANCELLED) return 'CANCELLED';
    if (booking.status === PersonalBookingStatus.COMPLETED) return 'COMPLETED';
    if (
      booking.status === PersonalBookingStatus.CONFIRMED &&
      booking.endAt.getTime() <= Date.now()
    ) {
      return 'AWAITING_CONFIRMATION';
    }
    return 'SCHEDULED';
  }

  private mapSessionDetail(
    booking: Awaited<
      ReturnType<PersonalTrainingService['getAccessibleBooking']>
    >,
    viewerId: string,
    opts?: {
      ptControlApplies?: boolean;
      approval?: {
        performerConfirmedAt?: Date | null;
        adminApprovedAt?: Date | null;
        overrideApprovedAt?: Date | null;
      } | null;
    },
  ): PersonalTrainingSessionDetail {
    const now = Date.now();
    const status = this.mapSessionStatus(booking);
    const isParticipant =
      booking.clientId === viewerId || booking.trainerId === viewerId;
    const isClient = booking.clientId === viewerId;
    const userAlreadyCompleted = isClient
      ? !!booking.clientCompletedAt
      : !!booking.trainerCompletedAt;

    const normalizedSheet = normalizeWorkoutSheet(booking.workoutSheet);
    const ptFlow =
      booking.ptFlow === 'CLUB' || booking.ptFlow === 'PERSONAL'
        ? booking.ptFlow
        : null;
    const approvalPhase = opts?.approval
      ? this.sessionApproval.phase(opts.approval)
      : undefined;

    return {
      id: booking.id,
      trainerId: booking.trainerId,
      trainerName:
        `${booking.trainer.firstName} ${booking.trainer.lastName}`.trim(),
      clientId: booking.clientId,
      clientName:
        `${booking.client.firstName} ${booking.client.lastName}`.trim(),
      clientDateOfBirth: booking.client.dateOfBirth
        ? booking.client.dateOfBirth.toISOString().slice(0, 10)
        : undefined,
      clientRestingHr: undefined,
      startAt: booking.startAt.toISOString(),
      endAt: booking.endAt.toISOString(),
      status,
      clientCompletedAt: booking.clientCompletedAt?.toISOString(),
      trainerCompletedAt: booking.trainerCompletedAt?.toISOString(),
      canEdit:
        isParticipant &&
        booking.status === PersonalBookingStatus.CONFIRMED,
      canComplete:
        isParticipant &&
        booking.status !== PersonalBookingStatus.CANCELLED &&
        booking.startAt.getTime() <= now &&
        !userAlreadyCompleted,
      ptFlow,
      ptControlApplies: opts?.ptControlApplies ?? false,
      approvalPhase,
      linkedDocExternalId: booking.linkedDocExternalId ?? undefined,
      ledgerSettledAt: booking.ledgerSettledAt?.toISOString(),
      paymentStatus: booking.paymentStatus ?? null,
      goals: (booking.sessionGoals ?? []).map((goal) => ({
        id: goal.id,
        title: goal.title,
        notes: goal.notes ?? undefined,
        sortOrder: goal.sortOrder,
        clientConfirmed: goal.clientConfirmed,
        trainerConfirmed: goal.trainerConfirmed,
        tasks: goal.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          sortOrder: task.sortOrder,
          clientConfirmed: task.clientConfirmed,
          trainerConfirmed: task.trainerConfirmed,
        })),
      })),
      workoutSheet: isClient
        ? workoutSheetForClient(normalizedSheet)
        : normalizedSheet,
    };
  }

  private ensureSessionEditable(booking: {
    status: PersonalBookingStatus;
  }) {
    if (booking.status !== PersonalBookingStatus.CONFIRMED) {
      throw new BadRequestException('План нельзя изменить для этой тренировки');
    }
  }

  private ensureCanConfirm(booking: {
    status: PersonalBookingStatus;
    startAt: Date;
  }) {
    if (booking.status === PersonalBookingStatus.CANCELLED) {
      throw new BadRequestException('Тренировка отменена');
    }
    if (booking.startAt.getTime() > Date.now()) {
      throw new BadRequestException('Подтверждение доступно после начала тренировки');
    }
  }

  private async getAccessibleBooking(
    user: JwtPayload,
    bookingId: string,
  ) {
    const booking = await this.prisma.personalTrainingBooking.findFirst({
      where: {
        id: bookingId,
        OR: [{ clientId: user.sub }, { trainerId: user.sub }],
      },
      include: {
        trainer: true,
        client: true,
        sessionGoals: {
          orderBy: { sortOrder: 'asc' },
          include: {
            tasks: { orderBy: { sortOrder: 'asc' } },
          },
        },
      },
    });

    if (!booking) {
      throw new NotFoundException('Тренировка не найдена');
    }

    return booking;
  }

  /**
   * Hard-delete a personal ledger PT (no 1C / no gift) owned by «Тренер клуб».
   * Restores personal-ledger package / debt when the booking was settled.
   */
  async deleteTrainerPersonalBooking(user: JwtPayload, bookingId: string) {
    const booking = await this.prisma.personalTrainingBooking.findFirst({
      where: { id: bookingId, trainerId: user.sub },
      include: {
        trainer: {
          select: {
            trainerClub: true,
            trainerStaff: true,
          },
        },
      },
    });
    if (!booking) {
      throw new NotFoundException('Запись не найдена');
    }
    if (!booking.trainer.trainerClub) {
      throw new ForbiddenException(
        'Удаление доступно только тренерам клуба',
      );
    }
    if (booking.isComplimentary) {
      throw new ForbiddenException(
        'Подарочную ПТ нельзя удалить — только отменить. Она на контроле у админа',
      );
    }
    if (
      booking.ptFlow === 'CLUB' ||
      Boolean(booking.linkedDocExternalId) ||
      !isPersonalPtBooking(booking, booking.trainer)
    ) {
      throw new ForbiddenException(
        'Запись с оплатой / списанием через 1С удалить нельзя — измените статус',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      if (booking.ledgerSettledAt && booking.ledgerPackageId) {
        const pkg = await tx.trainerClientPackage.findUnique({
          where: { id: booking.ledgerPackageId },
        });
        if (pkg) {
          const remaining = pkg.sessionsRemaining + 1;
          await tx.trainerClientPackage.update({
            where: { id: pkg.id },
            data: {
              sessionsRemaining: remaining,
              status:
                pkg.status === TrainerOwnPackageStatus.EXHAUSTED
                  ? TrainerOwnPackageStatus.ACTIVE
                  : pkg.status,
            },
          });
        }
      } else if (
        booking.ledgerSettledAt &&
        booking.paymentStatus === 'DEBT' &&
        (booking.priceMinor ?? 0) > 0
      ) {
        const bal = await tx.trainerClientBalance.findUnique({
          where: {
            trainerId_clientId: {
              trainerId: booking.trainerId,
              clientId: booking.clientId,
            },
          },
        });
        if (bal) {
          await tx.trainerClientBalance.update({
            where: { id: bal.id },
            data: {
              debtMinor: Math.max(0, bal.debtMinor - (booking.priceMinor ?? 0)),
            },
          });
        }
      }

      await tx.trainerClientPayment.updateMany({
        where: { bookingId },
        data: { bookingId: null },
      });
      await tx.clientHomework.updateMany({
        where: { bookingId },
        data: { bookingId: null },
      });
      await tx.sessionApproval.deleteMany({
        where: { kind: SessionApprovalKind.PT, bookingId },
      });
      // sessionGoals / daySheetLines cascade on booking delete
      await tx.personalTrainingBooking.delete({ where: { id: bookingId } });
    });

    await this.visitSync.clearPendingEventsForBookings([bookingId]);
    return { success: true as const };
  }

  async cancelPersonalBooking(user: JwtPayload, bookingId: string) {
    const booking = await this.prisma.personalTrainingBooking.findFirst({
      where: {
        id: bookingId,
        OR: [{ clientId: user.sub }, { trainerId: user.sub }],
        status: PersonalBookingStatus.CONFIRMED,
      },
      include: {
        client: true,
        trainer: true,
      },
    });

    if (!booking) {
      throw new NotFoundException('Запись не найдена');
    }

    const late =
      booking.startAt.getTime() - Date.now() < LATE_CANCEL_HOURS * 60 * 60 * 1000;

    await this.prisma.personalTrainingBooking.update({
      where: { id: bookingId },
      data: {
        status: PersonalBookingStatus.CANCELLED,
        usageStatus: ServiceUsageStatus.CANCELLED,
        cancelReason: late ? 'Поздняя отмена' : 'Отмена',
        cancelledAt: new Date(),
        cancelledById: user.sub,
        reviewFlag: late ? true : booking.reviewFlag,
      },
    });
    await this.visitSync.clearPendingEventsForBookings([bookingId]);

    if (booking.clientId === user.sub) {
      const clientName =
        `${booking.client.firstName} ${booking.client.lastName}`.trim();
      await this.notifications.notifyBookingCancelled({
        clubId: requireClubId(user),
        clientId: user.sub,
        clientName,
        clientPhone: booking.client.phone ?? undefined,
        sessionTitle: `Персональная · ${booking.trainer.firstName} ${booking.trainer.lastName}`.trim(),
        startAt: booking.startAt,
        sessionType: 'personal',
        trainerId: booking.trainerId,
      });
    } else if (booking.trainerId === user.sub) {
      const trainerName =
        `${booking.trainer.firstName} ${booking.trainer.lastName}`.trim();
      if (booking.client.accountStatus === AccountStatus.ACTIVE) {
        await this.notifications.notifySessionCancelledByTrainer({
          clientId: booking.clientId,
          trainerId: user.sub,
          trainerName,
          startAt: booking.startAt,
        });
      }
    }

    return { success: true, lateCancel: late };
  }

  toBookingItems(
    bookings: Awaited<ReturnType<PersonalTrainingService['getClientPersonalBookings']>>,
  ) {
    const now = Date.now();
    return bookings.map((booking) => {
      let lifecycle: 'UPCOMING' | 'COMPLETED' | 'CANCELLED' | 'AWAITING_CONFIRMATION';
      if (booking.status === PersonalBookingStatus.CANCELLED) {
        lifecycle = 'CANCELLED';
      } else if (booking.status === PersonalBookingStatus.COMPLETED) {
        lifecycle = 'COMPLETED';
      } else if (new Date(booking.endAt).getTime() > now) {
        lifecycle = 'UPCOMING';
      } else {
        lifecycle = 'AWAITING_CONFIRMATION';
      }

      return {
        id: booking.id,
        sessionId: booking.id,
        title: booking.isComplimentary
          ? 'Подарочная тренировка'
          : 'Персональная тренировка',
        type: SessionType.PERSONAL,
        trainerName: booking.trainerName,
        startAt: booking.startAt,
        endAt: booking.endAt,
        source: 'fitgo' as const,
        origin: booking.origin,
        lifecycle,
        usage: booking.usage,
      };
    });
  }

  private validateWorkSlots(slots: WorkSlotInput[]) {
    for (const slot of slots) {
      if (slot.dayOfWeek < 0 || slot.dayOfWeek > 6) {
        throw new BadRequestException('dayOfWeek должен быть от 0 до 6');
      }
      if (!this.isValidTime(slot.startTime) || !this.isValidTime(slot.endTime)) {
        throw new BadRequestException('Время должно быть в формате HH:mm');
      }
      if (slot.startTime >= slot.endTime) {
        throw new BadRequestException('Время начала должно быть раньше окончания');
      }
    }
  }

  private isValidTime(value: string): boolean {
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
  }

  /** Duty windows from the admin roster, padded so an adjacent extra block still sees them. */
  private dutyWindows(trainerId: string, rangeStart: Date, rangeEnd: Date) {
    const from = new Date(rangeStart.getTime() - 24 * 60 * 60 * 1000);
    const to = new Date(rangeEnd.getTime() + 24 * 60 * 60 * 1000);
    return this.prisma.staffShift.findMany({
      where: {
        userId: trainerId,
        track: StaffShiftTrack.TRAINER,
        startAt: { lt: to },
        endAt: { gt: from },
      },
      orderBy: { startAt: 'asc' },
    });
  }

  /** «Тренер клуб» alone sets own hours; staff PT stays tied to admin duty. */
  private async allowsFreeAvailability(trainerId: string): Promise<boolean> {
    const trainer = await this.prisma.user.findUnique({
      where: { id: trainerId },
      select: { trainerClub: true, trainerStaff: true },
    });
    return Boolean(trainer?.trainerClub && !trainer?.trainerStaff);
  }

  private async assertExtraBesideDuty(trainerId: string, blocks: DutyWindow[]) {
    if (blocks.length === 0) return;
    if (await this.allowsFreeAvailability(trainerId)) return;
    const min = new Date(Math.min(...blocks.map((b) => b.startAt.getTime())));
    const max = new Date(Math.max(...blocks.map((b) => b.endAt.getTime())));
    const duties = await this.dutyWindows(trainerId, min, max);
    for (const block of blocks) {
      const fit = extraBesideDuty(block.startAt, block.endAt, duties);
      if (fit === 'overlap') {
        throw new BadRequestException(
          'Это время уже входит в дежурство. Его ставит администратор, отдельно открывать не нужно.',
        );
      }
      if (fit === 'detached') {
        throw new BadRequestException(
          'Своё время можно открыть только сразу до или сразу после дежурства. Дежурство ставит администратор.',
        );
      }
    }
  }

  private combineDateAndTime(date: Date, time: string): Date {
    const [hours, minutes] = time.split(':').map(Number);
    const result = new Date(date);
    result.setHours(hours, minutes, 0, 0);
    return result;
  }

  private formatTimeHm(date: Date): string {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  private startOfDay(date: Date): Date {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
  }

  private endOfDay(date: Date): Date {
    const result = new Date(date);
    result.setHours(23, 59, 59, 999);
    return result;
  }

  /** Group classes from ClubScheduleSlot — no live Forma on calendar load. */
  private async fetchTrainerGroupSchedule(
    user: JwtPayload,
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<ScheduleSlot[]> {
    const clubId = requireClubId(user);
    const from = moscowDayKey(rangeStart);
    const to = moscowDayKey(rangeEnd);
    const externalId = user.externalId ?? '1c-trainer-001';

    try {
      const allSlots = await this.formaCache.getClubSchedule(clubId, from, to);
      const dbTrainer = await this.prisma.user.findUnique({
        where: { id: user.sub },
        select: {
          externalId: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
        },
      });
      const slots = !dbTrainer
        ? allSlots
        : allSlots.filter((slot) =>
            staffOwnsScheduleSlot(slot, {
              externalId: dbTrainer.externalId ?? externalId,
              employeeCode: dbTrainer.employeeCode,
              firstName: dbTrainer.firstName,
              lastName: dbTrainer.lastName,
            }),
          );

      return slots.filter(
        (slot) =>
          new Date(slot.startAt) < rangeEnd &&
          new Date(slot.endAt) > rangeStart,
      );
    } catch {
      return [];
    }
  }

  private async ensureNoBookingConflict(
    trainerId: string,
    start: Date,
    end: Date,
    excludeBookingId?: string,
    bufferBeforeMin = 0,
    bufferAfterMin = 0,
  ) {
    const rangeStart = new Date(start.getTime() - bufferBeforeMin * 60_000);
    const rangeEnd = new Date(end.getTime() + bufferAfterMin * 60_000);

    const bookings = await this.prisma.personalTrainingBooking.findMany({
      where: {
        trainerId,
        status: PersonalBookingStatus.CONFIRMED,
        id: excludeBookingId ? { not: excludeBookingId } : undefined,
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
      },
    });

    for (const other of bookings) {
      const occ = occupiedRange(other);
      if (rangesOverlap(occ.start, occ.end, rangeStart, rangeEnd)) {
        throw new ConflictException('Время пересекается с другой записью');
      }
    }

    const blocker = await this.prisma.trainerAvailabilityBlock.findFirst({
      where: {
        trainerId,
        kind: {
          in: [
            AvailabilityBlockKind.HOLD_CLIENT,
            AvailabilityBlockKind.PERSONAL_BLOCK,
          ],
        },
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
      },
    });
    if (blocker) {
      throw new ConflictException(
        blocker.kind === AvailabilityBlockKind.HOLD_CLIENT
          ? 'Время занято резервом'
          : 'Время заблокировано',
      );
    }
  }

  private async buildPublishSummary(
    trainerId: string,
    rangeStart: Date,
    rangeEnd: Date,
    openBlocks: Array<{ startAt: Date; endAt: Date; status: AvailabilityBlockStatus }>,
    bookings: Array<{
      startAt: Date;
      endAt: Date;
      bufferBeforeMin?: number | null;
      bufferAfterMin?: number | null;
    }>,
    allBlocks: Array<{ kind: AvailabilityBlockKind }>,
  ): Promise<SchedulePublishSummary> {
    // Include series that would materialize on publish (not yet CONFIRMED rows).
    const planned = await this.plannedSeriesOccupations(
      trainerId,
      rangeStart,
      rangeEnd,
    );
    const occupiers = [
      ...bookings,
      ...planned.map((p) => ({
        startAt: p.startAt,
        endAt: p.endAt,
        bufferBeforeMin: 0,
        bufferAfterMin: 0,
      })),
    ];
    const windowCount = openBlocks.length;
    const occupiedByClients = openBlocks.filter((block) =>
      occupiers.some((b) => {
        const occ = occupiedRange(b);
        return rangesOverlap(occ.start, occ.end, block.startAt, block.endAt);
      }),
    ).length;
    const draftBlockCount = openBlocks.filter(
      (b) => b.status === AvailabilityBlockStatus.DRAFT,
    ).length;

    return {
      periodStart: rangeStart.toISOString(),
      periodEnd: rangeEnd.toISOString(),
      windowCount,
      occupiedByClients,
      freeForClients: Math.max(0, windowCount - occupiedByClients),
      holdCount: allBlocks.filter(
        (b) => b.kind === AvailabilityBlockKind.HOLD_CLIENT,
      ).length,
      blockCount: allBlocks.filter(
        (b) => b.kind === AvailabilityBlockKind.PERSONAL_BLOCK,
      ).length,
      draftBlockCount,
      pendingSeriesSlots: planned.map((p) => ({
        startAt: p.startAt.toISOString(),
        endAt: p.endAt.toISOString(),
      })),
    };
  }

  /**
   * Dry-run of series materialization for publish summary.
   * Skips cancelled slots (any status at that start) and conflicted times.
   */
  private async plannedSeriesOccupations(
    trainerId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<Array<{ startAt: Date; endAt: Date }>> {
    const seriesList = await this.prisma.personalBookingSeries.findMany({
      where: {
        trainerId,
        active: true,
        fromDate: { lte: periodEnd },
        OR: [{ toDate: null }, { toDate: { gte: periodStart } }],
      },
    });
    if (seriesList.length === 0) return [];

    const existing = await this.prisma.personalTrainingBooking.findMany({
      where: {
        trainerId,
        seriesId: { in: seriesList.map((s) => s.id) },
        startAt: { gte: periodStart, lt: periodEnd },
      },
      select: {
        seriesId: true,
        startAt: true,
        status: true,
      },
    });
    const existingKeys = new Set(
      existing.map((b) => `${b.seriesId}|${b.startAt.getTime()}`),
    );

    const planned: Array<{ startAt: Date; endAt: Date }> = [];
    for (const series of seriesList) {
      const cursor = new Date(
        Math.max(periodStart.getTime(), series.fromDate.getTime()),
      );
      cursor.setHours(0, 0, 0, 0);
      const liveCount = await this.prisma.personalTrainingBooking.count({
        where: {
          seriesId: series.id,
          status: { not: PersonalBookingStatus.CANCELLED },
        },
      });
      let made = 0;

      while (cursor <= periodEnd) {
        if (series.toDate && cursor > series.toDate) break;
        if (
          series.occurrences != null &&
          liveCount + made >= series.occurrences
        ) {
          break;
        }
        if (cursor.getDay() === series.dayOfWeek) {
          const start = this.combineDateAndTime(cursor, series.startTime);
          const end = new Date(
            start.getTime() + series.durationMin * 60_000,
          );
          if (start >= periodStart && start < periodEnd) {
            const key = `${series.id}|${start.getTime()}`;
            // Any prior row (incl. CANCELLED) → do not plan again.
            if (!existingKeys.has(key)) {
              try {
                await this.ensureNoBookingConflict(trainerId, start, end);
                planned.push({ startAt: start, endAt: end });
                made += 1;
              } catch {
                // Conflict — not an occupied series seat for summary.
              }
            }
          }
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return planned;
  }

  private async cancelTrainerBooking(
    user: JwtPayload,
    booking: {
      id: string;
      trainerId: string;
      clientId: string;
      startAt: Date;
      endAt: Date;
      seriesId: string | null;
      ptFlow: string | null;
      reviewFlag: boolean;
      client: {
        firstName: string;
        lastName: string;
        accountStatus: AccountStatus;
      };
      trainer: { firstName: string; lastName: string };
    },
    opts: {
      action: 'cancel' | 'no_show';
      cancelReason?: string;
      debitPackage?: boolean;
      seriesScope: 'one' | 'future';
    },
  ) {
    const ids = [booking.id];
    if (opts.seriesScope === 'future' && booking.seriesId) {
      const future = await this.prisma.personalTrainingBooking.findMany({
        where: {
          seriesId: booking.seriesId,
          trainerId: user.sub,
          status: PersonalBookingStatus.CONFIRMED,
          startAt: { gt: booking.startAt },
        },
        select: { id: true },
      });
      ids.push(...future.map((f) => f.id));
    }

    const late =
      opts.action === 'no_show' ||
      booking.startAt.getTime() - Date.now() <
        LATE_CANCEL_HOURS * 60 * 60 * 1000;
    const usageStatus =
      opts.action === 'no_show'
        ? ServiceUsageStatus.NO_SHOW
        : ServiceUsageStatus.CANCELLED;

    if (
      shouldDebitPackageOnCancel({
        debitPackage: opts.debitPackage,
        ptFlow: booking.ptFlow,
      })
    ) {
      // Settle while still CONFIRMED — ledger skips CANCELLED rows.
      await this.ledger.settlePersonalSession(booking.id);
    }

    await this.prisma.personalTrainingBooking.updateMany({
      where: { id: { in: ids } },
      data: {
        status: PersonalBookingStatus.CANCELLED,
        usageStatus,
        cancelReason:
          opts.cancelReason?.trim() ||
          (opts.action === 'no_show'
            ? 'Неявка'
            : late
              ? 'Поздняя отмена'
              : 'Отмена тренером'),
        cancelledAt: new Date(),
        cancelledById: user.sub,
        ...(late ? { reviewFlag: true } : {}),
      },
    });
    await this.visitSync.clearPendingEventsForBookings(ids);

    // «Все будущие» stops the series so the next publish does not recreate them.
    if (opts.seriesScope === 'future' && booking.seriesId) {
      await this.prisma.personalBookingSeries.update({
        where: { id: booking.seriesId },
        data: { active: false },
      });
    }

    const trainerName =
      `${booking.trainer.firstName} ${booking.trainer.lastName}`.trim();
    if (booking.client.accountStatus === AccountStatus.ACTIVE) {
      await this.notifications.notifySessionCancelledByTrainer({
        clientId: booking.clientId,
        trainerId: user.sub,
        trainerName,
        startAt: booking.startAt,
        reason: opts.cancelReason,
      });
    }

    return {
      id: booking.id,
      status: 'CANCELLED' as const,
      cancelledCount: ids.length,
      lateCancel: late,
    };
  }

  private async rescheduleTrainerBooking(
    user: JwtPayload,
    booking: {
      id: string;
      trainerId: string;
      clientId: string;
      startAt: Date;
      endAt: Date;
      seriesId: string | null;
      bufferBeforeMin: number;
      bufferAfterMin: number;
      linkedDocExternalId: string | null;
      client: {
        firstName: string;
        lastName: string;
        accountStatus: AccountStatus;
      };
      trainer: { firstName: string; lastName: string };
    },
    startAtIso: string,
    seriesScope: 'one' | 'future',
  ) {
    const start = new Date(startAtIso);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Некорректная дата');
    }
    const durationMs = booking.endAt.getTime() - booking.startAt.getTime();
    const end = new Date(start.getTime() + durationMs);

    const withinBuffer = (() => {
      const buf = occupiedRange(booking);
      return start >= buf.start && end <= buf.end;
    })();

    await this.ensureNoBookingConflict(
      user.sub,
      start,
      end,
      booking.id,
      withinBuffer ? 0 : booking.bufferBeforeMin,
      withinBuffer ? 0 : booking.bufferAfterMin,
    );

    const targets =
      seriesScope === 'future' && booking.seriesId
        ? await this.prisma.personalTrainingBooking.findMany({
            where: {
              seriesId: booking.seriesId,
              trainerId: user.sub,
              status: PersonalBookingStatus.CONFIRMED,
              startAt: { gte: booking.startAt },
            },
            orderBy: { startAt: 'asc' },
          })
        : [booking];

    const deltaMs = start.getTime() - booking.startAt.getTime();
    const updatedIds: string[] = [];
    const clubId = requireClubId(user);

    for (const target of targets) {
      const newStart =
        target.id === booking.id
          ? start
          : new Date(target.startAt.getTime() + deltaMs);
      const newEnd =
        target.id === booking.id
          ? end
          : new Date(target.endAt.getTime() + deltaMs);

      if (target.id !== booking.id) {
        await this.ensureNoBookingConflict(
          user.sub,
          newStart,
          newEnd,
          target.id,
        );
      }

      await this.prisma.personalTrainingBooking.update({
        where: { id: target.id },
        data: { startAt: newStart, endAt: newEnd },
      });
      updatedIds.push(target.id);

      if (!withinBuffer) {
        const { cleared } =
          await this.sessionApproval.clearAdminAfterMaterialEdit(
            SessionApprovalKind.PT,
            target.id,
            clubId,
            'Перенос записи',
          );
        // Outside buffer: drop link and re-match on the new date.
        await this.prisma.personalTrainingBooking.update({
          where: { id: target.id },
          data: { linkedDocExternalId: null },
        });
        await this.tryAutoLinkPtDocument(target.id, clubId);
        if (cleared) {
          const trainerName =
            `${booking.trainer.lastName} ${booking.trainer.firstName}`.trim() ||
            'Тренер';
          await this.prisma.groupApprovalNote.create({
            data: {
              clubId,
              sessionKey: `fitgo:PT:${target.id}`,
              authorId: user.sub,
              authorName: trainerName,
              authorRole: 'TRAINER',
              action: 'RETURN',
              text: 'Перенос записи',
            },
          });
        }
      }
    }

    // Series template must follow «change time of all future» or the next
    // publish recreates old-time slots.
    if (
      seriesScope === 'future' &&
      booking.seriesId &&
      start.getTime() !== booking.startAt.getTime()
    ) {
      await this.prisma.personalBookingSeries.update({
        where: { id: booking.seriesId },
        data: {
          startTime: this.formatTimeHm(start),
          dayOfWeek: start.getDay(),
        },
      });
    }

    if (
      booking.client.accountStatus === AccountStatus.ACTIVE &&
      start.getTime() !== booking.startAt.getTime()
    ) {
      const trainerName =
        `${booking.trainer.firstName} ${booking.trainer.lastName}`.trim();
      await this.notifications.notifySessionRescheduled({
        clientId: booking.clientId,
        trainerId: user.sub,
        trainerName,
        oldStartAt: booking.startAt,
        newStartAt: start,
      });
    }

    return {
      id: booking.id,
      clientId: booking.clientId,
      clientName: `${booking.client.firstName} ${booking.client.lastName}`.trim(),
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      status: PersonalBookingStatus.CONFIRMED,
      movedCount: updatedIds.length,
      withinBuffer,
    };
  }

  async createAvailabilityHold(
    user: JwtPayload,
    data: {
      startAt: string;
      endAt: string;
      kind: 'HOLD_CLIENT' | 'PERSONAL_BLOCK';
      holdClientId?: string;
      holdHours?: number;
      note?: string;
    },
  ) {
    const start = new Date(data.startAt);
    const end = new Date(data.endAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
      throw new BadRequestException('Некорректный интервал');
    }

    if (data.kind === 'HOLD_CLIENT' && !data.holdClientId) {
      throw new BadRequestException('Укажите клиента для резерва');
    }
    if (data.holdClientId) {
      await this.roster.ensureConfirmedLink(user.sub, data.holdClientId);
    }

    await this.ensureNoBookingConflict(user.sub, start, end);

    const holdHours = data.holdHours ?? DEFAULT_HOLD_HOURS;
    const block = await this.prisma.trainerAvailabilityBlock.create({
      data: {
        trainerId: user.sub,
        startAt: start,
        endAt: end,
        status: AvailabilityBlockStatus.PUBLISHED,
        kind:
          data.kind === 'HOLD_CLIENT'
            ? AvailabilityBlockKind.HOLD_CLIENT
            : AvailabilityBlockKind.PERSONAL_BLOCK,
        holdClientId: data.holdClientId ?? null,
        holdExpiresAt:
          data.kind === 'HOLD_CLIENT'
            ? new Date(Date.now() + holdHours * 60 * 60 * 1000)
            : null,
        note: data.note?.trim() || null,
      },
    });

    return {
      id: block.id,
      startAt: block.startAt.toISOString(),
      endAt: block.endAt.toISOString(),
      status: block.status,
      kind: block.kind,
      holdClientId: block.holdClientId ?? undefined,
      holdExpiresAt: block.holdExpiresAt?.toISOString(),
      note: block.note ?? undefined,
    };
  }

  async deleteAvailabilityHold(user: JwtPayload, blockId: string) {
    const block = await this.prisma.trainerAvailabilityBlock.findFirst({
      where: {
        id: blockId,
        trainerId: user.sub,
        kind: {
          in: [
            AvailabilityBlockKind.HOLD_CLIENT,
            AvailabilityBlockKind.PERSONAL_BLOCK,
          ],
        },
      },
    });
    if (!block) throw new NotFoundException('Резерв не найден');
    await this.prisma.trainerAvailabilityBlock.delete({ where: { id: blockId } });
    return { success: true };
  }

  async listBookingSeries(user: JwtPayload): Promise<PersonalBookingSeriesView[]> {
    const rows = await this.prisma.personalBookingSeries.findMany({
      where: { trainerId: user.sub, active: true },
      include: { client: { select: { firstName: true, lastName: true } } },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      clientName: `${r.client.firstName} ${r.client.lastName}`.trim(),
      dayOfWeek: r.dayOfWeek,
      startTime: r.startTime,
      durationMin: r.durationMin,
      fromDate: r.fromDate.toISOString(),
      toDate: r.toDate?.toISOString(),
      occurrences: r.occurrences ?? undefined,
      ptFlow: (r.ptFlow as 'CLUB' | 'PERSONAL' | null) ?? undefined,
      isComplimentary: r.isComplimentary,
      active: r.active,
    }));
  }

  async createBookingSeries(
    user: JwtPayload,
    data: {
      clientId: string;
      dayOfWeek: number;
      startTime: string;
      durationMin?: number;
      fromDate: string;
      toDate?: string;
      occurrences?: number;
      ptFlow?: PtBookingFlowValue | null;
      isComplimentary?: boolean;
    },
  ): Promise<PersonalBookingSeriesView> {
    await this.roster.ensureConfirmedLink(user.sub, data.clientId);
    const trainerFlags = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { trainerClub: true, trainerStaff: true },
    });
    const ptFlow = resolvePtFlow(trainerFlags ?? {}, data.ptFlow);

    const series = await this.prisma.personalBookingSeries.create({
      data: {
        trainerId: user.sub,
        clientId: data.clientId,
        dayOfWeek: data.dayOfWeek,
        startTime: data.startTime,
        durationMin: data.durationMin ?? SESSION_DURATION_MIN,
        fromDate: this.startOfDay(new Date(data.fromDate)),
        toDate: data.toDate ? this.endOfDay(new Date(data.toDate)) : null,
        occurrences: data.occurrences ?? null,
        ptFlow,
        isComplimentary: data.isComplimentary ?? false,
      },
      include: { client: { select: { firstName: true, lastName: true } } },
    });

    return {
      id: series.id,
      clientId: series.clientId,
      clientName: `${series.client.firstName} ${series.client.lastName}`.trim(),
      dayOfWeek: series.dayOfWeek,
      startTime: series.startTime,
      durationMin: series.durationMin,
      fromDate: series.fromDate.toISOString(),
      toDate: series.toDate?.toISOString(),
      occurrences: series.occurrences ?? undefined,
      ptFlow: (series.ptFlow as 'CLUB' | 'PERSONAL' | null) ?? undefined,
      isComplimentary: series.isComplimentary,
      active: series.active,
    };
  }

  async deactivateBookingSeries(user: JwtPayload, seriesId: string) {
    const series = await this.prisma.personalBookingSeries.findFirst({
      where: { id: seriesId, trainerId: user.sub },
    });
    if (!series) throw new NotFoundException('Серия не найдена');
    await this.prisma.personalBookingSeries.update({
      where: { id: seriesId },
      data: { active: false },
    });
    return { success: true };
  }

  async generateSeriesForPeriod(
    user: JwtPayload,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<SeriesGenerateResult> {
    const seriesList = await this.prisma.personalBookingSeries.findMany({
      where: {
        trainerId: user.sub,
        active: true,
        fromDate: { lte: periodEnd },
        OR: [{ toDate: null }, { toDate: { gte: periodStart } }],
      },
    });

    let created = 0;
    const conflicts: Array<{ date: string; reason: string }> = [];

    for (const series of seriesList) {
      const cursor = new Date(
        Math.max(periodStart.getTime(), series.fromDate.getTime()),
      );
      cursor.setHours(0, 0, 0, 0);
      let made = 0;
      const existingCount = await this.prisma.personalTrainingBooking.count({
        where: { seriesId: series.id, status: { not: PersonalBookingStatus.CANCELLED } },
      });

      while (cursor <= periodEnd) {
        if (series.toDate && cursor > series.toDate) break;
        if (
          series.occurrences != null &&
          existingCount + made >= series.occurrences
        ) {
          break;
        }
        if (cursor.getDay() === series.dayOfWeek) {
          const start = this.combineDateAndTime(cursor, series.startTime);
          const end = new Date(
            start.getTime() + series.durationMin * 60_000,
          );
          if (start >= periodStart && start < periodEnd) {
            // Any prior row at this series start (incl. CANCELLED) — do not recreate.
            const already = await this.prisma.personalTrainingBooking.findFirst({
              where: {
                seriesId: series.id,
                startAt: start,
              },
              select: { id: true, status: true },
            });
            if (!already) {
              try {
                await this.ensureNoBookingConflict(user.sub, start, end);
                const createdBooking = await this.assignPersonalBooking(
                  user,
                  {
                    clientId: series.clientId,
                    startAt: start.toISOString(),
                    isComplimentary: series.isComplimentary,
                    ptFlow: series.ptFlow as PtBookingFlowValue | null,
                  },
                );
                await this.prisma.personalTrainingBooking.update({
                  where: { id: createdBooking.id },
                  data: { seriesId: series.id },
                });
                created += 1;
                made += 1;
              } catch (err) {
                conflicts.push({
                  date: start.toISOString(),
                  reason:
                    err instanceof Error ? err.message : 'Конфликт расписания',
                });
              }
            }
          }
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    return { created, conflicts };
  }
}
