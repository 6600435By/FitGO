import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PersonalBookingStatus, Prisma, Role, AvailabilityBlockStatus, PersonalBookingOrigin, AccountStatus } from '@prisma/client';
import {
  PERSONAL_TRAINING_GOAL_TEMPLATES,
  SessionType,
  normalizeWorkoutSheet,
  summarizeCircuitSession,
  workoutSheetForClient,
  type PersonalSessionStatus,
  type PersonalTrainingSessionDetail,
  type WorkoutSheet,
  type CircuitHistoryPoint,
  type TrainerCalendarResponse,
  type TrainerCalendarEvent,
  type ScheduleSlot,
} from '@fitgo/shared-types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { FitnessService } from '../fitness/fitness.service';
import { VisitSyncService } from '../engagement/visit-sync.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { TrainerRosterService } from '../trainer/trainer-roster.service';

const SESSION_DURATION_MIN = 60;

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
    private readonly fitness: FitnessService,
    private readonly roster: TrainerRosterService,
    private readonly visitSync: VisitSyncService,
  ) {}

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

    const [groupSlots, bookings, blocks, lastPublication] = await Promise.all([
      this.fetchTrainerGroupSchedule(user, rangeStart, rangeEnd),
      this.prisma.personalTrainingBooking.findMany({
        where: {
          trainerId: user.sub,
          status: PersonalBookingStatus.CONFIRMED,
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
      this.prisma.trainerSchedulePublication.findFirst({
        where: { trainerId: user.sub },
        orderBy: { publishedAt: 'desc' },
      }),
    ]);

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

    for (const booking of bookings) {
      events.push({
        id: `personal-${booking.id}`,
        kind: 'PERSONAL',
        title: `Персональная · ${booking.client.firstName} ${booking.client.lastName}`.trim(),
        startAt: booking.startAt.toISOString(),
        endAt: booking.endAt.toISOString(),
        clientId: booking.clientId,
        clientName: `${booking.client.firstName} ${booking.client.lastName}`.trim(),
        bookingId: booking.id,
        origin: booking.origin,
      });
    }

    for (const block of blocks) {
      const overlapsBooking = bookings.some(
        (b) => b.startAt < block.endAt && b.endAt > block.startAt,
      );
      if (overlapsBooking) continue;

      events.push({
        id: `avail-${block.id}`,
        kind:
          block.status === AvailabilityBlockStatus.PUBLISHED
            ? 'OPEN_SLOT'
            : 'DRAFT_SLOT',
        title:
          block.status === AvailabilityBlockStatus.PUBLISHED
            ? 'Открыто для записи'
            : 'Черновик · открыто для записи',
        startAt: block.startAt.toISOString(),
        endAt: block.endAt.toISOString(),
      });
    }

    const draftBlockCount = blocks.filter(
      (b) => b.status === AvailabilityBlockStatus.DRAFT,
    ).length;

    return {
      events: events.sort((a, b) => a.startAt.localeCompare(b.startAt)),
      availabilityBlocks: blocks.map((b) => ({
        id: b.id,
        startAt: b.startAt.toISOString(),
        endAt: b.endAt.toISOString(),
        status: b.status,
      })),
      draftBlockCount,
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

    await this.prisma.$transaction(async (tx) => {
      await tx.trainerAvailabilityBlock.deleteMany({
        where: {
          trainerId: user.sub,
          status: AvailabilityBlockStatus.DRAFT,
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
  ) {
    const start = this.startOfDay(new Date(periodStart));
    const end = this.endOfDay(new Date(periodEnd));

    const draftCount = await this.prisma.trainerAvailabilityBlock.count({
      where: {
        trainerId: user.sub,
        status: AvailabilityBlockStatus.DRAFT,
        startAt: { lt: end },
        endAt: { gt: start },
      },
    });

    if (draftCount === 0) {
      throw new BadRequestException('Нет черновых слотов для публикации');
    }

    await this.prisma.$transaction([
      this.prisma.trainerAvailabilityBlock.updateMany({
        where: {
          trainerId: user.sub,
          status: AvailabilityBlockStatus.DRAFT,
          startAt: { lt: end },
          endAt: { gt: start },
        },
        data: { status: AvailabilityBlockStatus.PUBLISHED },
      }),
      this.prisma.trainerSchedulePublication.create({
        data: {
          trainerId: user.sub,
          periodStart: start,
          periodEnd: end,
        },
      }),
    ]);

    return {
      publishedBlocks: draftCount,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
    };
  }

  async assignPersonalBooking(
    user: JwtPayload,
    clientId: string,
    startAt: string,
  ) {
    const start = new Date(startAt);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Некорректная дата');
    }

    const end = new Date(start.getTime() + SESSION_DURATION_MIN * 60_000);

    await this.roster.ensureConfirmedLink(user.sub, clientId);
    await this.ensureNoBookingConflict(user.sub, start, end);

    const client = await this.prisma.user.findFirst({
      where: {
        id: clientId,
        roles: { some: { role: Role.CLIENT } },
      },
    });
    if (!client) {
      throw new NotFoundException('Клиент не найден');
    }

    const link = await this.prisma.trainerClientLink.findUnique({
      where: { trainerId_clientId: { trainerId: user.sub, clientId } },
    });

    const booking = await this.prisma.personalTrainingBooking.create({
      data: {
        trainerId: user.sub,
        clientId,
        startAt: start,
        endAt: end,
        origin: PersonalBookingOrigin.TRAINER_ASSIGNED,
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

    return {
      id: booking.id,
      trainerId: booking.trainerId,
      clientId: booking.clientId,
      clientName: `${booking.client.firstName} ${booking.client.lastName}`.trim(),
      startAt: booking.startAt.toISOString(),
      endAt: booking.endAt.toISOString(),
      status: booking.status,
      origin: booking.origin,
    };
  }

  async updateTrainerPersonalBooking(
    user: JwtPayload,
    bookingId: string,
    data: { startAt?: string; action?: 'cancel' },
  ) {
    const booking = await this.prisma.personalTrainingBooking.findFirst({
      where: {
        id: bookingId,
        trainerId: user.sub,
        status: PersonalBookingStatus.CONFIRMED,
      },
      include: { client: true },
    });

    if (!booking) {
      throw new NotFoundException('Запись не найдена');
    }

    if (data.action === 'cancel') {
      await this.prisma.personalTrainingBooking.update({
        where: { id: bookingId },
        data: { status: PersonalBookingStatus.CANCELLED },
      });
      return { id: bookingId, status: 'CANCELLED' as const };
    }

    if (data.startAt) {
      const start = new Date(data.startAt);
      const end = new Date(start.getTime() + SESSION_DURATION_MIN * 60_000);
      await this.ensureNoBookingConflict(user.sub, start, end, bookingId);

      const updated = await this.prisma.personalTrainingBooking.update({
        where: { id: bookingId },
        data: { startAt: start, endAt: end },
        include: { client: true },
      });

      return {
        id: updated.id,
        clientId: updated.clientId,
        clientName: `${updated.client.firstName} ${updated.client.lastName}`.trim(),
        startAt: updated.startAt.toISOString(),
        endAt: updated.endAt.toISOString(),
        status: updated.status,
        origin: updated.origin,
      };
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
      },
    });

    const results = await Promise.all(
      trainers.map(async (trainer) => {
        const slots = await this.getTrainerAvailableSlots(
          clubId,
          trainer.id,
          new Date().toISOString(),
          new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        );
        return {
          id: trainer.id,
          firstName: trainer.firstName,
          lastName: trainer.lastName,
          hasSchedule: slots.length > 0,
        };
      }),
    );

    return results.filter((t) => t.hasSchedule);
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
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
      },
      orderBy: { startAt: 'asc' },
    });

    if (publishedBlocks.length === 0) {
      return [];
    }

    const bookings = await this.prisma.personalTrainingBooking.findMany({
      where: {
        trainerId,
        status: PersonalBookingStatus.CONFIRMED,
        startAt: { lt: rangeEnd },
        endAt: { gt: rangeStart },
      },
    });

    const slots: Array<{ startAt: string; endAt: string }> = [];

    for (const block of publishedBlocks) {
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
        const overlapsBooking = bookings.some(
          (booking) =>
            booking.startAt < slotEnd && booking.endAt > slotStart,
        );

        if (
          !isPast &&
          !overlapsBooking &&
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

    const booking = await this.prisma.personalTrainingBooking.create({
      data: {
        trainerId,
        clientId: user.sub,
        startAt: start,
        endAt: end,
        origin: PersonalBookingOrigin.CLIENT_BOOKED,
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
    return this.mapSessionDetail(booking, user.sub);
  }

  async getPreviousWorkoutSheet(
    user: JwtPayload,
    bookingId: string,
  ): Promise<{ sheet: WorkoutSheet | null; date?: string }> {
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
    return {
      sheet: normalizeWorkoutSheet(withSheet.workoutSheet),
      date: withSheet.startAt.toISOString(),
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

    if (
      booking.status === PersonalBookingStatus.COMPLETED &&
      ((isClient && booking.clientCompletedAt) ||
        (isTrainer && booking.trainerCompletedAt))
    ) {
      return this.getSessionDetail(user, bookingId);
    }

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

    if (trainerCompletedAt) {
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
    }

    return this.getSessionDetail(user, bookingId);
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

    await this.prisma.personalTrainingBooking.update({
      where: { id: bookingId },
      data: { status: PersonalBookingStatus.CANCELLED },
    });

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
    }

    return { success: true };
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
        title: 'Персональная тренировка',
        type: SessionType.PERSONAL,
        trainerName: booking.trainerName,
        startAt: booking.startAt,
        endAt: booking.endAt,
        source: 'fitgo' as const,
        origin: booking.origin,
        lifecycle,
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

  private combineDateAndTime(date: Date, time: string): Date {
    const [hours, minutes] = time.split(':').map(Number);
    const result = new Date(date);
    result.setHours(hours, minutes, 0, 0);
    return result;
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

  private isFormaEmployeeId(id: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      id,
    );
  }

  private async fetchTrainerGroupSchedule(
    user: JwtPayload,
    rangeStart: Date,
    rangeEnd: Date,
  ): Promise<ScheduleSlot[]> {
    const club = await this.prisma.club.findUnique({
      where: { id: requireClubId(user) },
    });
    if (!club?.externalId) return [];

    const externalId = user.externalId ?? '1c-trainer-001';
    const provider = this.fitness.getProvider();

    try {
      let slots: ScheduleSlot[];
      if (this.isFormaEmployeeId(externalId)) {
        slots = await provider.getSchedule(club.externalId, {
          trainerId: externalId,
        });
      } else {
        const dbTrainer = await this.prisma.user.findUnique({
          where: { id: user.sub },
        });
        const allSlots = await provider.getSchedule(club.externalId);
        if (!dbTrainer) {
          slots = allSlots;
        } else {
          const first = dbTrainer.firstName.trim();
          const last = dbTrainer.lastName.trim();
          slots = allSlots.filter((slot) => {
            if (slot.trainerId === externalId) return true;
            const name = slot.trainerName?.toLowerCase() ?? '';
            return (
              (first && name.includes(first.toLowerCase())) ||
              (last && name.includes(last.toLowerCase()))
            );
          });
        }
      }

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
  ) {
    const conflict = await this.prisma.personalTrainingBooking.findFirst({
      where: {
        trainerId,
        status: PersonalBookingStatus.CONFIRMED,
        id: excludeBookingId ? { not: excludeBookingId } : undefined,
        startAt: { lt: end },
        endAt: { gt: start },
      },
    });

    if (conflict) {
      throw new ConflictException('Время пересекается с другой записью');
    }
  }
}
