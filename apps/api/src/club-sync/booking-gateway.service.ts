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
import {
  GROUP_SCHEDULE_HORIZON_DAYS,
  isGeneralGroupMembershipService,
  isGroupReformerMembershipService,
  isReformerHallSession,
  normalizeMembershipServiceName,
  type ClientMembershipPackage,
} from '@fitgo/shared-types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { FitnessService } from '../fitness/fitness.service';
import { PrismaService } from '../prisma/prisma.service';
import { addMoscowDays, moscowDayKey } from './moscow-time';
import { ScheduleSlotsSyncService } from './schedule-slots-sync.service';
import { resolveFormaClubId } from './forma-club-id';

export type BookGroupResult = {
  success: boolean;
  message?: string;
  bookingId?: string;
  status?: GroupClassBookingStatus;
};

type SlotRow = {
  id: string;
  capacity: number;
  bookedIn1c: number;
  title: string;
  trainerName: string | null;
  roomTitle: string | null;
  startAt: Date;
  endAt: Date;
};

@Injectable()
export class BookingGateway {
  private readonly logger = new Logger(BookingGateway.name);
  /** Throttle live 1C roster check per client (Записи / главная). */
  private readonly clientReconcileAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
    private readonly scheduleSlots: ScheduleSlotsSyncService,
  ) {}

  /**
   * Reserve seat in DB (FOR UPDATE on ClubScheduleSlot) → live Forma book →
   * attach membership basis in 1C → confirm.
   * Idempotent via optional idempotencyKey.
   */
  async bookGroupSession(
    user: JwtPayload,
    appointmentId: string,
    opts?: {
      idempotencyKey?: string;
      origin?: GroupBookingOrigin;
      bookedByUserId?: string;
      membershipServiceName?: string;
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

    await this.ensureSlotCached(clubId, appointmentId);

    // 1) DB reserve under row lock
    const reserved = await this.prisma.$transaction(async (tx) => {
      const slots = await tx.$queryRaw<SlotRow[]>`
        SELECT id, capacity, "bookedIn1c", title, "trainerName", "roomTitle", "startAt", "endAt"
        FROM "ClubScheduleSlot"
        WHERE "clubId" = ${clubId} AND "externalId" = ${appointmentId}
        FOR UPDATE
      `;
      const slot = slots[0];
      if (!slot) {
        throw new NotFoundSlotError(
          'Занятие не найдено в кэше расписания. Обновите экран или дождитесь синхронизации.',
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
        return { booking: prior, already: true as const, slot };
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

      return { booking, already: false as const, slot };
    });

    const membershipId = await this.resolveGroupMembershipId(externalId, {
      membershipServiceName: opts?.membershipServiceName,
      roomTitle: reserved.slot.roomTitle,
      title: reserved.slot.title,
      sessionAt: reserved.slot.startAt,
    });

    if (reserved.already) {
      if (membershipId) {
        const basis = await this.trySetBasis(
          appointmentId,
          externalId,
          membershipId,
        );
        if (!basis.ok) {
          return {
            success: false,
            bookingId: reserved.booking.id,
            status: reserved.booking.status,
            message: basis.message,
          };
        }
      }
      return {
        success: true,
        bookingId: reserved.booking.id,
        status: reserved.booking.status,
        message: 'Вы уже записаны',
      };
    }

    // 2) Live Forma write (website online window) — may fail outside WP horizon
    let formaEnrolled = false;
    let formaAlready = false;
    let formaMessage: string | undefined;
    try {
      const result = await this.fitness
        .getProvider()
        .bookSession(externalId, appointmentId, bookingContext);

      const alreadyMsg =
        typeof result.message === 'string' &&
        /уже|already|exists/i.test(result.message);

      if (result.success || alreadyMsg) {
        formaEnrolled = true;
        formaAlready = alreadyMsg;
        formaMessage = result.message;
      } else {
        formaMessage = result.message || 'Не удалось записаться в 1С';
        this.logger.warn(
          `bookGroupSession forma fail club=${clubId} appt=${appointmentId}: ${formaMessage}`,
        );
      }
    } catch (err) {
      // Timeout / network — leave PENDING_1C for reconcile unless set-basis recovers
      this.logger.warn(
        `bookGroupSession forma error club=${clubId} appt=${appointmentId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      formaMessage =
        err instanceof Error ? err.message : 'Ошибка связи с 1С при записи';
    }

    // 3) Attach membership basis (and enroll via FitGO if Forma window blocked)
    if (membershipId) {
      const basis = await this.trySetBasis(
        appointmentId,
        externalId,
        membershipId,
      );
      if (basis.ok) {
        const bump =
          (formaEnrolled && !formaAlready) || (!formaEnrolled && basis.added);
        await this.confirmBooking(
          clubId,
          appointmentId,
          reserved.booking.id,
          bump,
        );
        return {
          success: true,
          bookingId: reserved.booking.id,
          status: GroupClassBookingStatus.CONFIRMED,
          message: formaMessage,
        };
      }
      if (formaEnrolled) {
        // Client is on roster without basis — surface 1C text
        await this.confirmBooking(
          clubId,
          appointmentId,
          reserved.booking.id,
          !formaAlready,
        );
        return {
          success: false,
          bookingId: reserved.booking.id,
          status: GroupClassBookingStatus.CONFIRMED,
          message: basis.message,
        };
      }
      await this.failBooking(reserved.booking.id);
      return {
        success: false,
        bookingId: reserved.booking.id,
        status: GroupClassBookingStatus.FAILED,
        message: basis.message || formaMessage || 'Не удалось записаться в 1С',
      };
    }

    if (formaEnrolled) {
      await this.confirmBooking(
        clubId,
        appointmentId,
        reserved.booking.id,
        !formaAlready,
      );
      return {
        success: true,
        bookingId: reserved.booking.id,
        status: GroupClassBookingStatus.CONFIRMED,
        message: formaMessage,
      };
    }

    // No membership + Forma failed: keep PENDING if it looked like a transport error
    if (/связ|timeout|network|ECONN|fetch/i.test(formaMessage ?? '')) {
      return {
        success: true,
        bookingId: reserved.booking.id,
        status: GroupClassBookingStatus.PENDING_1C,
        message:
          'Запись принята, подтверждение из 1С ещё не получено. Статус обновится автоматически.',
      };
    }

    await this.failBooking(reserved.booking.id);
    return {
      success: false,
      bookingId: reserved.booking.id,
      status: GroupClassBookingStatus.FAILED,
      message: formaMessage || 'Не удалось записаться в 1С',
    };
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

  /**
   * Drop stale CONFIRMED group bookings when 1C already removed the client
   * (admin cancel / «Не прибыл» on a future class). Called on client bookings
   * load — LIGHT sync still does club-wide cleanup; this covers the UX gap
   * before the next hourly run (only this client's open days, throttle 45s).
   */
  async reconcileClientUpcomingGroupBookings(clientId: string): Promise<number> {
    const last = this.clientReconcileAt.get(clientId) ?? 0;
    if (Date.now() - last < 45_000) return 0;
    this.clientReconcileAt.set(clientId, Date.now());

    const provider = this.fitness.getProvider();
    if (!provider.getClassSessions) return 0;

    const client = await this.prisma.user.findUnique({
      where: { id: clientId },
      select: { externalId: true },
    });
    const clientExt = client?.externalId?.trim().toLowerCase();
    if (!clientExt) return 0;

    const now = new Date();
    const bookings = await this.prisma.groupClassBooking.findMany({
      where: {
        clientId,
        status: GroupClassBookingStatus.CONFIRMED,
        endAt: { gte: now },
      },
      select: { id: true, appointmentId: true, startAt: true },
      take: 20,
      orderBy: { startAt: 'asc' },
    });
    if (!bookings.length) return 0;

    const byDay = new Map<string, typeof bookings>();
    for (const b of bookings) {
      const day = moscowDayKey(b.startAt);
      const list = byDay.get(day) ?? [];
      list.push(b);
      byDay.set(day, list);
    }

    let cancelled = 0;
    const cancelledAt = new Date();
    for (const [day, dayBookings] of byDay) {
      try {
        const batch = await provider.getClassSessions({
          from: day,
          to: day,
          page: 1,
          pageSize: 100,
        });
        if (!batch?.data?.length) continue;

        const byAppt = new Map(
          batch.data
            .filter((s) => s.id?.trim())
            .map((s) => [s.id.trim().toLowerCase(), s]),
        );

        for (const booking of dayBookings) {
          const session = byAppt.get(
            booking.appointmentId.trim().toLowerCase(),
          );
          if (!session) continue; // unknown appointment — don't guess

          const member = (session.members ?? []).find(
            (m) => m.externalId?.trim().toLowerCase() === clientExt,
          );
          const drop =
            !member ||
            Boolean(member.cancelled) ||
            member.attendance === 'CANCELLED' ||
            member.attendance === 'NO_SHOW';
          if (!drop) continue;

          await this.prisma.groupClassBooking.update({
            where: { id: booking.id },
            data: {
              status: GroupClassBookingStatus.CANCELLED,
              cancelledAt,
              usageStatus: 'CANCELLED',
            },
          });
          cancelled += 1;
        }
      } catch (err) {
        this.logger.warn(
          `client group reconcile day=${day}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    if (cancelled > 0) {
      this.logger.log(
        `Cancelled ${cancelled} stale group booking(s) for client=${clientId}`,
      );
    }
    return cancelled;
  }

  isExclusionViolation(err: unknown): boolean {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      (err.code === 'P2010' ||
        String(err.message).includes('23P01') ||
        String(err.meta?.code) === '23P01')
    );
  }

  /** Sync horizon into ClubScheduleSlot when booking a day outside last night sync. */
  private async ensureSlotCached(
    clubId: string,
    appointmentId: string,
  ): Promise<void> {
    const existing = await this.prisma.clubScheduleSlot.findUnique({
      where: { clubId_externalId: { clubId, externalId: appointmentId } },
      select: { id: true },
    });
    if (existing) return;

    const today = moscowDayKey();
    const to = addMoscowDays(today, GROUP_SCHEDULE_HORIZON_DAYS);
    try {
      await this.scheduleSlots.syncClub(clubId, { from: today, to });
    } catch (err) {
      this.logger.warn(
        `ensureSlotCached sync club=${clubId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const after = await this.prisma.clubScheduleSlot.findUnique({
      where: { clubId_externalId: { clubId, externalId: appointmentId } },
      select: { id: true },
    });
    if (after) return;

    // Live Forma lookup for this appointment within horizon (upsert one row)
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { externalId: true },
    });
    const formaClub = resolveFormaClubId(club?.externalId).clubId;
    if (!formaClub) return;

    try {
      const slots = await this.fitness.getProvider().getSchedule(formaClub, {
        from: `${today}T00:00:00`,
        to: `${to}T23:59:59`,
      });
      const hit = slots.find((s) => s.id === appointmentId);
      if (!hit?.id) return;
      const startAt = new Date(hit.startAt);
      const endAt = new Date(hit.endAt);
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
        return;
      }
      const now = new Date();
      await this.prisma.clubScheduleSlot.upsert({
        where: { clubId_externalId: { clubId, externalId: hit.id } },
        create: {
          clubId,
          externalId: hit.id,
          title: hit.title,
          trainerName: hit.trainerName ?? null,
          roomTitle: hit.roomTitle ?? null,
          startAt,
          endAt,
          capacity: hit.capacity ?? 0,
          bookedIn1c: hit.booked ?? 0,
          sessionType: hit.type ?? null,
          syncedAt: now,
        },
        update: {
          title: hit.title,
          trainerName: hit.trainerName ?? null,
          roomTitle: hit.roomTitle ?? null,
          startAt,
          endAt,
          capacity: hit.capacity ?? 0,
          bookedIn1c: hit.booked ?? 0,
          sessionType: hit.type ?? null,
          syncedAt: now,
        },
      });
    } catch (err) {
      this.logger.warn(
        `ensureSlotCached live club=${clubId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async resolveGroupMembershipId(
    clientExternalId: string,
    opts: {
      membershipServiceName?: string;
      roomTitle?: string | null;
      title?: string;
      sessionAt: Date;
    },
  ): Promise<string | null> {
    const provider = this.fitness.getProvider();
    let packages: ClientMembershipPackage[] = [];
    try {
      if (provider.getClientPackages) {
        packages = await provider.getClientPackages(clientExternalId);
      }
    } catch (err) {
      this.logger.warn(
        `resolveGroupMembershipId packages: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const sessionDay = opts.sessionAt.toISOString().slice(0, 10);
    const covering = packages.filter((p) =>
      packageCoversDay(p, sessionDay),
    );

    const wanted = opts.membershipServiceName?.trim();
    if (wanted) {
      const target = normalizeMembershipServiceName(wanted);
      const hit = covering.find((p) =>
        p.serviceQuotas.some(
          (q) => normalizeMembershipServiceName(q.name) === target,
        ),
      );
      if (hit) return hit.id;
    }

    const reformer = isReformerHallSession(opts.roomTitle, opts.title);
    const byLine = covering.find((p) =>
      p.serviceQuotas.some((q) =>
        reformer
          ? isGroupReformerMembershipService(q.name)
          : isGeneralGroupMembershipService(q.name),
      ),
    );
    if (byLine) return byLine.id;

    try {
      const m = await provider.getMembership(clientExternalId);
      if (m?.id) return m.id;
    } catch {
      /* ignore */
    }
    return covering[0]?.id ?? packages[0]?.id ?? null;
  }

  private async trySetBasis(
    appointmentId: string,
    clientExternalId: string,
    membershipId: string,
  ): Promise<{ ok: boolean; added: boolean; message?: string }> {
    const provider = this.fitness.getProvider();
    if (!provider.setClassSessionBasis) {
      return {
        ok: false,
        added: false,
        message:
          'Привязка абонемента недоступна: опубликуйте FitGO /v1/class-sessions/set-basis',
      };
    }
    try {
      const r = await provider.setClassSessionBasis({
        appointmentId,
        clientExternalId,
        membershipId,
      });
      return { ok: r.ok, added: r.added };
    } catch (err) {
      const raw =
        err instanceof Error ? err.message : 'Не удалось привязать абонемент';
      const message = raw.replace(/^FitGO 1C API error \d+:\s*/i, '').trim() || raw;
      this.logger.warn(
        `setClassSessionBasis appt=${appointmentId}: ${message}`,
      );
      return { ok: false, added: false, message };
    }
  }

  private async confirmBooking(
    clubId: string,
    appointmentId: string,
    bookingId: string,
    incrementBooked: boolean,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.groupClassBooking.update({
        where: { id: bookingId },
        data: { status: GroupClassBookingStatus.CONFIRMED },
      });
      if (incrementBooked) {
        await tx.clubScheduleSlot.updateMany({
          where: { clubId, externalId: appointmentId },
          data: { bookedIn1c: { increment: 1 } },
        });
      }
    });
  }

  private async failBooking(bookingId: string) {
    await this.prisma.groupClassBooking.update({
      where: { id: bookingId },
      data: {
        status: GroupClassBookingStatus.FAILED,
        cancelledAt: new Date(),
        usageStatus: 'CANCELLED',
      },
    });
  }
}

function packageCoversDay(
  pkg: ClientMembershipPackage,
  dayKey: string,
): boolean {
  const from = pkg.validFrom?.slice(0, 10);
  const until = pkg.validUntil?.slice(0, 10);
  if (from && dayKey < from) return false;
  if (until && dayKey > until) return false;
  const st = (pkg.status ?? '').toUpperCase();
  if (st === 'EXPIRED' || st === 'CANCELLED') return false;
  return true;
}

class NotFoundSlotError extends BadRequestException {
  constructor(message: string) {
    super(message);
  }
}
