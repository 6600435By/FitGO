import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  GroupBookingOrigin,
  GroupClassBookingStatus,
  Prisma,
} from '@prisma/client';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { FitnessService } from '../fitness/fitness.service';
import { PrismaService } from '../prisma/prisma.service';

export type BookGroupResult = {
  success: boolean;
  message?: string;
  bookingId?: string;
  status?: GroupClassBookingStatus;
};

@Injectable()
export class BookingGateway {
  private readonly logger = new Logger(BookingGateway.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
  ) {}

  /**
   * Reserve seat in DB (FOR UPDATE on ClubScheduleSlot) → live Forma book → confirm.
   * Idempotent via optional idempotencyKey.
   */
  async bookGroupSession(
    user: JwtPayload,
    appointmentId: string,
    opts?: {
      idempotencyKey?: string;
      origin?: GroupBookingOrigin;
      bookedByUserId?: string;
    },
  ): Promise<BookGroupResult> {
    const clubId = requireClubId(user);
    const origin = opts?.origin ?? GroupBookingOrigin.CLIENT_BOOKED;
    const bookedByUserId = opts?.bookedByUserId ?? user.sub;

    if (opts?.idempotencyKey) {
      const existing = await this.prisma.groupClassBooking.findUnique({
        where: { idempotencyKey: opts.idempotencyKey },
      });
      if (existing) {
        return {
          success:
            existing.status === GroupClassBookingStatus.CONFIRMED ||
            existing.status === GroupClassBookingStatus.PENDING_1C,
          bookingId: existing.id,
          status: existing.status,
          message:
            existing.status === GroupClassBookingStatus.FAILED
              ? 'Предыдущая попытка записи не удалась'
              : undefined,
        };
      }
    }

    const u = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { externalId: true, phone: true, firstName: true, lastName: true },
    });
    if (!u?.externalId) {
      throw new BadRequestException(
        'Запись на групповые доступна после оформления в 1С. Посмотрите расписание или обратитесь на ресепшен.',
      );
    }
    const externalId = u.externalId;
    const bookingContext = {
      phone: u.phone ?? undefined,
      name: `${u.firstName} ${u.lastName}`.trim() || undefined,
    };

    // 1) DB reserve under row lock
    const reserved = await this.prisma.$transaction(async (tx) => {
      const slots = await tx.$queryRaw<
        Array<{
          id: string;
          capacity: number;
          bookedIn1c: number;
          title: string;
          trainerName: string | null;
          startAt: Date;
          endAt: Date;
        }>
      >`
        SELECT id, capacity, "bookedIn1c", title, "trainerName", "startAt", "endAt"
        FROM "ClubScheduleSlot"
        WHERE "clubId" = ${clubId} AND "externalId" = ${appointmentId}
        FOR UPDATE
      `;
      const slot = slots[0];
      if (!slot) {
        throw new NotFoundSlotError(
          'Занятие не найдено в кэше расписания. Нажмите «Обновить из 1С» или дождитесь ночной выгрузки.',
        );
      }

      const pendingCount = await tx.groupClassBooking.count({
        where: {
          appointmentId,
          status: {
            in: [
              GroupClassBookingStatus.PENDING_1C,
              GroupClassBookingStatus.CONFIRMED,
            ],
          },
        },
      });
      // Prefer 1C booked count + pending not yet reflected; capacity 0 = unknown → allow
      const used = Math.max(slot.bookedIn1c, pendingCount);
      if (slot.capacity > 0 && used >= slot.capacity) {
        throw new ConflictException('Нет свободных мест на это занятие');
      }

      const prior = await tx.groupClassBooking.findUnique({
        where: {
          clientId_appointmentId: {
            clientId: user.sub,
            appointmentId,
          },
        },
      });
      if (
        prior &&
        (prior.status === GroupClassBookingStatus.CONFIRMED ||
          prior.status === GroupClassBookingStatus.PENDING_1C)
      ) {
        return { booking: prior, already: true as const };
      }

      const booking = prior
        ? await tx.groupClassBooking.update({
            where: { id: prior.id },
            data: {
              status: GroupClassBookingStatus.PENDING_1C,
              title: slot.title,
              trainerName: slot.trainerName,
              startAt: slot.startAt,
              endAt: slot.endAt,
              origin,
              bookedByUserId,
              cancelledAt: null,
              usageStatus: 'BOOKED',
              idempotencyKey: opts?.idempotencyKey ?? prior.idempotencyKey,
            },
          })
        : await tx.groupClassBooking.create({
            data: {
              clientId: user.sub,
              appointmentId,
              title: slot.title,
              trainerName: slot.trainerName,
              startAt: slot.startAt,
              endAt: slot.endAt,
              status: GroupClassBookingStatus.PENDING_1C,
              origin,
              bookedByUserId,
              controlLevel: 'BASE',
              reviewFlag: false,
              paymentStatus: 'N_A',
              usageStatus: 'BOOKED',
              presenceStatus: 'PENDING',
              performanceStatus: 'PENDING',
              eligibleForMotivation: false,
              idempotencyKey: opts?.idempotencyKey,
            },
          });

      return { booking, already: false as const };
    });

    if (reserved.already) {
      return {
        success: true,
        bookingId: reserved.booking.id,
        status: reserved.booking.status,
        message: 'Вы уже записаны',
      };
    }

    // 2) Live Forma write
    try {
      const result = await this.fitness
        .getProvider()
        .bookSession(externalId, appointmentId, bookingContext);

      const alreadyMsg =
        typeof result.message === 'string' &&
        /уже|already|exists/i.test(result.message);

      if (result.success || alreadyMsg) {
        await this.prisma.$transaction(async (tx) => {
          await tx.groupClassBooking.update({
            where: { id: reserved.booking.id },
            data: { status: GroupClassBookingStatus.CONFIRMED },
          });
          await tx.clubScheduleSlot.updateMany({
            where: { clubId, externalId: appointmentId },
            data: { bookedIn1c: { increment: alreadyMsg ? 0 : 1 } },
          });
        });
        return {
          success: true,
          bookingId: reserved.booking.id,
          status: GroupClassBookingStatus.CONFIRMED,
          message: result.message,
        };
      }

      await this.prisma.groupClassBooking.update({
        where: { id: reserved.booking.id },
        data: {
          status: GroupClassBookingStatus.FAILED,
          cancelledAt: new Date(),
          usageStatus: 'CANCELLED',
        },
      });
      return {
        success: false,
        bookingId: reserved.booking.id,
        status: GroupClassBookingStatus.FAILED,
        message: result.message || 'Не удалось записаться в 1С',
      };
    } catch (err) {
      // Timeout / network — leave PENDING_1C for reconcile job
      this.logger.warn(
        `bookGroupSession PENDING_1C club=${clubId} appt=${appointmentId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return {
        success: true,
        bookingId: reserved.booking.id,
        status: GroupClassBookingStatus.PENDING_1C,
        message:
          'Запись принята, подтверждение из 1С ещё не получено. Статус обновится автоматически.',
      };
    }
  }

  /**
   * Reconcile PENDING_1C older than 1 min via getGroupSessionRoster.
   */
  async reconcilePendingGroupBookings(): Promise<number> {
    const cutoff = new Date(Date.now() - 60_000);
    const pending = await this.prisma.groupClassBooking.findMany({
      where: {
        status: GroupClassBookingStatus.PENDING_1C,
        updatedAt: { lt: cutoff },
      },
      take: 40,
      include: { client: { select: { externalId: true, clubId: true } } },
    });
    if (!pending.length) return 0;

    const provider = this.fitness.getProvider();
    let fixed = 0;
    for (const b of pending) {
      const clientExt = b.client.externalId;
      if (!clientExt || !provider.getGroupSessionRoster) {
        continue;
      }
      try {
        const roster = await provider.getGroupSessionRoster(b.appointmentId);
        const members = roster?.data;
        const onRoster =
          Array.isArray(members) &&
          members.some(
            (m) =>
              m.externalId &&
              m.externalId.toLowerCase() === clientExt.toLowerCase(),
          );
        if (onRoster) {
          await this.prisma.groupClassBooking.update({
            where: { id: b.id },
            data: { status: GroupClassBookingStatus.CONFIRMED },
          });
          fixed += 1;
        } else if (Date.now() - b.updatedAt.getTime() > 10 * 60_000) {
          await this.prisma.groupClassBooking.update({
            where: { id: b.id },
            data: {
              status: GroupClassBookingStatus.FAILED,
              cancelledAt: new Date(),
              usageStatus: 'CANCELLED',
            },
          });
          fixed += 1;
        }
      } catch (err) {
        this.logger.warn(
          `reconcile ${b.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return fixed;
  }

  isExclusionViolation(err: unknown): boolean {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      (err.code === 'P2010' ||
        String(err.message).includes('23P01') ||
        String(err.meta?.code) === '23P01')
    );
  }
}

class NotFoundSlotError extends BadRequestException {
  constructor(message: string) {
    super(message);
  }
}
