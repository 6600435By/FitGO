import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ClubCrmLinkStatus,
  PersonalBookingOrigin,
  PersonalBookingStatus,
  PtClientIssue,
  PtSessionPayKind,
  ServicePaymentStatus,
  TrainerClientLinkStatus,
  TrainerClientSource,
  TrainerDaySheetStatus,
  TrainerShiftStatus,
  TrustBand,
} from '@prisma/client';
import {
  resolvePtPercent,
  type StaffPayProfile,
  type TrainerDaySheetDto,
  type TrainerDaySheetLineDto,
  type TrainerShiftDto,
  type PtClientIssueQueueItem,
} from '@fitgo/shared-types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { normalizePhone } from '../common/phone.util';
import { FitnessService } from '../fitness/fitness.service';
import { PrismaService } from '../prisma/prisma.service';
import { ServiceUsageService } from '../service-usage/service-usage.service';
import { TrainerRosterService } from '../trainer/trainer-roster.service';

const SESSION_DURATION_MIN = 60;

function dateOnly(isoOrDate: string | Date): Date {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function dayBounds(dateStr: string) {
  const d = dateOnly(dateStr);
  const from = new Date(d);
  from.setHours(0, 0, 0, 0);
  const to = new Date(d);
  to.setHours(23, 59, 59, 999);
  return { from, to, date: d };
}

function asPayProfile(raw: unknown): StaffPayProfile | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  return raw as StaffPayProfile;
}

@Injectable()
export class PtTimesheetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly serviceUsage: ServiceUsageService,
    private readonly roster: TrainerRosterService,
    private readonly fitness: FitnessService,
  ) {}

  // ── Shifts ──────────────────────────────────────────────────────────

  async listShifts(
    trainerId: string,
    from: string,
    to: string,
  ): Promise<TrainerShiftDto[]> {
    const fromD = dateOnly(from);
    const toD = dateOnly(to);
    const rows = await this.prisma.trainerShift.findMany({
      where: {
        trainerId,
        date: { gte: fromD, lte: toD },
      },
      orderBy: { startAt: 'asc' },
    });
    return rows.map((r) => this.mapShift(r));
  }

  async upsertShift(
    _actor: JwtPayload,
    _input: { date: string; startAt: string; endAt: string; id?: string },
  ): Promise<TrainerShiftDto> {
    throw new BadRequestException(
      'Рабочие смены задаёт админ в графике. Откройте окна записи в Расписании.',
    );
  }

  async deleteShift(_trainerId: string, _id: string) {
    throw new BadRequestException(
      'Рабочие смены задаёт админ в графике. Удаление недоступно тренеру.',
    );
  }

  // ── Day sheet ───────────────────────────────────────────────────────

  async getOrBuildDaySheet(
    actor: JwtPayload,
    date: string,
    trainerId?: string,
  ): Promise<TrainerDaySheetDto> {
    const clubId = requireClubId(actor);
    const tid = trainerId ?? actor.sub;
    if (trainerId && trainerId !== actor.sub) {
      const roles = actor.roles ?? [];
      if (
        !roles.includes('ADMIN' as never) &&
        !roles.includes('SUPER_ADMIN' as never)
      ) {
        // JwtPayload roles check — fall through via club admin endpoints
      }
    }
    return this.buildOrRefreshSheet(clubId, tid, date);
  }

  async trainerGetSheet(actor: JwtPayload, date: string) {
    return this.buildOrRefreshSheet(requireClubId(actor), actor.sub, date);
  }

  async submitSheet(actor: JwtPayload, date: string) {
    const sheet = await this.buildOrRefreshSheet(
      requireClubId(actor),
      actor.sub,
      date,
    );
    if (
      sheet.status !== 'DRAFT' &&
      sheet.status !== 'TRAINER_SUBMITTED'
    ) {
      throw new BadRequestException('Табель уже на проверке или утверждён');
    }
    const openIssues = sheet.lines.filter(
      (l) => l.clientIssue !== 'NONE' && !l.clientIssueEscalated,
    );
    // Allow submit with issues if escalated; warn via counts
    void openIssues;
    const row = await this.prisma.trainerDaySheet.update({
      where: { id: sheet.id },
      data: {
        status: TrainerDaySheetStatus.ADMIN_REVIEW,
        submittedAt: new Date(),
      },
    });
    // Close shifts for the day
    const { date: d } = dayBounds(date);
    await this.prisma.trainerShift.updateMany({
      where: { trainerId: actor.sub, date: d },
      data: { status: TrainerShiftStatus.CLOSED },
    });
    return this.toSheetDto(row.id);
  }

  /** Late-add: create booking with phone, then refresh sheet. */
  async lateAddBooking(
    actor: JwtPayload,
    input: {
      phone: string;
      firstName: string;
      lastName: string;
      startAt: string;
      isComplimentary?: boolean;
      date: string;
    },
  ) {
    const clubId = requireClubId(actor);
    const phoneNormalized = normalizePhone(input.phone);
    if (phoneNormalized.length < 9) {
      throw new BadRequestException('Некорректный номер телефона');
    }
    const start = new Date(input.startAt);
    if (Number.isNaN(start.getTime())) {
      throw new BadRequestException('Некорректная дата');
    }
    const end = new Date(start.getTime() + SESSION_DURATION_MIN * 60_000);

    let client = await this.prisma.user.findFirst({
      where: { phoneNormalized },
      include: {
        clubMemberships: { where: { clubId }, take: 1 },
      },
    });

    if (!client) {
      const created = await this.roster.addOfflineClient(actor.sub, {
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
      });
      if (!('id' in created) || !created.id) {
        client = await this.prisma.user.findFirst({
          where: { phoneNormalized },
          include: {
            clubMemberships: { where: { clubId }, take: 1 },
          },
        });
      } else {
        client = await this.prisma.user.findFirst({
          where: { id: created.id },
          include: {
            clubMemberships: { where: { clubId }, take: 1 },
          },
        });
      }
    } else {
      await this.roster.ensureConfirmedLink(actor.sub, client.id).catch(async () => {
        await this.prisma.trainerClientLink.upsert({
          where: {
            trainerId_clientId: {
              trainerId: actor.sub,
              clientId: client!.id,
            },
          },
          create: {
            trainerId: actor.sub,
            clientId: client!.id,
            status: TrainerClientLinkStatus.CONFIRMED,
            source: TrainerClientSource.MANUAL,
            confirmedAt: new Date(),
          },
          update: {
            status: TrainerClientLinkStatus.CONFIRMED,
            confirmedAt: new Date(),
          },
        });
      });
    }

    if (!client) {
      throw new BadRequestException('Не удалось создать клиента');
    }

    const clientIssue = this.detectClientIssue(client);
    const control = this.serviceUsage.controlFieldsForCreate({
      origin: PersonalBookingOrigin.TRAINER_ASSIGNED,
      bookedByUserId: actor.sub,
      isComplimentary: Boolean(input.isComplimentary),
    });

    const conflict = await this.prisma.personalTrainingBooking.findFirst({
      where: {
        trainerId: actor.sub,
        startAt: start,
        status: { not: PersonalBookingStatus.CANCELLED },
      },
    });
    if (conflict) {
      throw new BadRequestException('На это время уже есть запись');
    }

    await this.prisma.personalTrainingBooking.create({
      data: {
        trainerId: actor.sub,
        clientId: client.id,
        startAt: start,
        endAt: end,
        origin: PersonalBookingOrigin.TRAINER_ASSIGNED,
        isComplimentary: Boolean(input.isComplimentary),
        isLateAdd: true,
        clientIssue,
        payKind: input.isComplimentary
          ? PtSessionPayKind.GIFT
          : PtSessionPayKind.UNKNOWN,
        controlLevel: control.controlLevel,
        reviewFlag: true,
        paymentStatus: control.paymentStatus,
        usageStatus: control.usageStatus,
        presenceStatus: control.presenceStatus,
        performanceStatus: control.performanceStatus,
        eligibleForMotivation: false,
        bookedByUserId: actor.sub,
        trustBand: TrustBand.AMBER,
        trustReasons: ['ADDED_BY_TRAINER', 'LATE_ADD'],
      },
    });

    return this.buildOrRefreshSheet(clubId, actor.sub, input.date);
  }

  async correctBookingPhone(
    actor: JwtPayload,
    bookingId: string,
    phone: string,
  ) {
    const booking = await this.prisma.personalTrainingBooking.findFirst({
      where: { id: bookingId, trainerId: actor.sub },
      include: { client: true },
    });
    if (!booking) throw new NotFoundException('Запись не найдена');

    const phoneNormalized = normalizePhone(phone);
    if (phoneNormalized.length < 9) {
      throw new BadRequestException('Некорректный номер телефона');
    }

    const clubId = requireClubId(actor);
    let target = await this.prisma.user.findFirst({
      where: { phoneNormalized },
      include: { clubMemberships: { where: { clubId }, take: 1 } },
    });

    if (!target) {
      await this.prisma.user.update({
        where: { id: booking.clientId },
        data: {
          phone: phone.trim(),
          phoneNormalized,
        },
      });
      target = await this.prisma.user.findFirst({
        where: { id: booking.clientId },
        include: { clubMemberships: { where: { clubId }, take: 1 } },
      });
    } else if (target.id !== booking.clientId) {
      await this.prisma.personalTrainingBooking.update({
        where: { id: bookingId },
        data: { clientId: target.id },
      });
      await this.roster.ensureConfirmedLink(actor.sub, target.id).catch(async () => {
        await this.prisma.trainerClientLink.upsert({
          where: {
            trainerId_clientId: {
              trainerId: actor.sub,
              clientId: target!.id,
            },
          },
          create: {
            trainerId: actor.sub,
            clientId: target!.id,
            status: TrainerClientLinkStatus.CONFIRMED,
            source: TrainerClientSource.MANUAL,
            confirmedAt: new Date(),
          },
          update: { status: TrainerClientLinkStatus.CONFIRMED },
        });
      });
    }

    const issue = this.detectClientIssue(target!);
    await this.prisma.personalTrainingBooking.update({
      where: { id: bookingId },
      data: {
        clientIssue: issue,
        clientIssueEscalated: false,
        ...(issue === PtClientIssue.NONE
          ? { trustBand: TrustBand.GREEN }
          : {}),
      },
    });

    const date = booking.startAt.toISOString().slice(0, 10);
    return this.buildOrRefreshSheet(clubId, actor.sub, date);
  }

  async escalateClientIssue(actor: JwtPayload, bookingId: string) {
    const booking = await this.prisma.personalTrainingBooking.findFirst({
      where: { id: bookingId, trainerId: actor.sub },
    });
    if (!booking) throw new NotFoundException('Запись не найдена');
    const issue =
      booking.clientIssue === PtClientIssue.NONE
        ? PtClientIssue.WRONG_PHONE
        : booking.clientIssue;
    await this.prisma.personalTrainingBooking.update({
      where: { id: bookingId },
      data: {
        clientIssue: issue,
        clientIssueEscalated: true,
        trustBand: TrustBand.AMBER,
      },
    });
    const date = booking.startAt.toISOString().slice(0, 10);
    return this.buildOrRefreshSheet(requireClubId(actor), actor.sub, date);
  }

  async flagIdentityMismatch(actor: JwtPayload, bookingId: string) {
    const booking = await this.prisma.personalTrainingBooking.findFirst({
      where: { id: bookingId, trainerId: actor.sub },
    });
    if (!booking) throw new NotFoundException('Запись не найдена');
    await this.prisma.personalTrainingBooking.update({
      where: { id: bookingId },
      data: {
        clientIssue: PtClientIssue.IDENTITY_MISMATCH,
        clientIssueEscalated: true,
        trustBand: TrustBand.AMBER,
      },
    });
    const date = booking.startAt.toISOString().slice(0, 10);
    return this.buildOrRefreshSheet(requireClubId(actor), actor.sub, date);
  }

  // ── Admin / SA ──────────────────────────────────────────────────────

  async listClientIssueQueue(clubId: string): Promise<PtClientIssueQueueItem[]> {
    const rows = await this.prisma.personalTrainingBooking.findMany({
      where: {
        status: { not: PersonalBookingStatus.CANCELLED },
        OR: [
          { clientIssue: { not: PtClientIssue.NONE } },
          { isLateAdd: true, trustResolution: 'NONE' },
        ],
        trainer: { clubId },
      },
      include: {
        client: true,
        trainer: true,
        daySheetLines: { take: 1, select: { sheetId: true } },
      },
      orderBy: { startAt: 'desc' },
      take: 100,
    });
    return rows.map((b) => ({
      bookingId: b.id,
      sheetId: b.daySheetLines[0]?.sheetId,
      trainerId: b.trainerId,
      trainerName: `${b.trainer.lastName} ${b.trainer.firstName}`.trim(),
      clientId: b.clientId,
      clientName: `${b.client.lastName} ${b.client.firstName}`.trim(),
      clientPhone: b.client.phone ?? undefined,
      startAt: b.startAt.toISOString(),
      clientIssue: b.clientIssue as PtClientIssueQueueItem['clientIssue'],
      clientIssueEscalated: b.clientIssueEscalated,
      isLateAdd: b.isLateAdd,
    }));
  }

  async adminRebindPhone(
    actor: JwtPayload,
    bookingId: string,
    phone: string,
  ) {
    const clubId = requireClubId(actor);
    const booking = await this.prisma.personalTrainingBooking.findFirst({
      where: { id: bookingId, trainer: { clubId } },
      include: { trainer: true },
    });
    if (!booking) throw new NotFoundException('Запись не найдена');

    const phoneNormalized = normalizePhone(phone);
    if (phoneNormalized.length < 9) {
      throw new BadRequestException('Некорректный номер телефона');
    }

    let target = await this.prisma.user.findFirst({
      where: { phoneNormalized },
      include: { clubMemberships: { where: { clubId }, take: 1 } },
    });

    if (!target) {
      await this.prisma.user.update({
        where: { id: booking.clientId },
        data: { phone: phone.trim(), phoneNormalized },
      });
      target = await this.prisma.user.findFirst({
        where: { id: booking.clientId },
        include: { clubMemberships: { where: { clubId }, take: 1 } },
      });
    } else if (target.id !== booking.clientId) {
      await this.prisma.personalTrainingBooking.update({
        where: { id: bookingId },
        data: { clientId: target.id },
      });
    }

    const issue = this.detectClientIssue(target!);
    await this.prisma.personalTrainingBooking.update({
      where: { id: bookingId },
      data: {
        clientIssue: issue,
        clientIssueEscalated: false,
        ...(issue === PtClientIssue.NONE
          ? {
              trustBand: TrustBand.GREEN,
              reviewFlag: booking.isLateAdd,
            }
          : {}),
      },
    });

    const date = booking.startAt.toISOString().slice(0, 10);
    return this.buildOrRefreshSheet(clubId, booking.trainerId, date);
  }

  async adminResolveClientIssue(actor: JwtPayload, bookingId: string) {
    const clubId = requireClubId(actor);
    const booking = await this.prisma.personalTrainingBooking.findFirst({
      where: { id: bookingId, trainer: { clubId } },
    });
    if (!booking) throw new NotFoundException('Запись не найдена');
    await this.prisma.personalTrainingBooking.update({
      where: { id: bookingId },
      data: {
        clientIssue: PtClientIssue.NONE,
        clientIssueEscalated: false,
        trustResolution: 'RESOLVED',
        trustResolvedAt: new Date(),
        trustResolvedById: actor.sub,
        trustBand: TrustBand.GREEN,
      },
    });
    const date = booking.startAt.toISOString().slice(0, 10);
    return this.buildOrRefreshSheet(clubId, booking.trainerId, date);
  }

  async adminSetPayment(
    actor: JwtPayload,
    bookingId: string,
    input: {
      paymentStatus: 'PAID' | 'DEBT' | 'PENDING_PAYMENT' | 'N_A';
      payKind?: PtSessionPayKind;
      priceMinor?: number;
      verified1c?: boolean;
    },
  ) {
    const clubId = requireClubId(actor);
    const booking = await this.prisma.personalTrainingBooking.findFirst({
      where: { id: bookingId, trainer: { clubId } },
    });
    if (!booking) throw new NotFoundException('Запись не найдена');
    if (booking.clientIssue !== PtClientIssue.NONE) {
      throw new BadRequestException(
        'Сначала исправьте проблему с клиентом/телефоном',
      );
    }
    await this.prisma.personalTrainingBooking.update({
      where: { id: bookingId },
      data: {
        paymentStatus: input.paymentStatus as ServicePaymentStatus,
        ...(input.payKind ? { payKind: input.payKind } : {}),
        ...(input.priceMinor != null ? { priceMinor: input.priceMinor } : {}),
        ...(input.paymentStatus === 'PAID'
          ? { paidAt: new Date() }
          : {}),
        ...(input.verified1c && input.paymentStatus === 'PAID'
          ? { crmDocRef: booking.crmDocRef ?? `manual-${Date.now()}` }
          : {}),
      },
    });
    const date = booking.startAt.toISOString().slice(0, 10);
    return this.buildOrRefreshSheet(clubId, booking.trainerId, date);
  }

  /** Probe 1C (or mock) for PT payment and apply to booking. */
  async verifyBookingPayment1c(actor: JwtPayload, bookingId: string) {
    const clubId = requireClubId(actor);
    const booking = await this.prisma.personalTrainingBooking.findFirst({
      where: { id: bookingId, trainer: { clubId } },
      include: {
        client: true,
        trainer: true,
      },
    });
    if (!booking) throw new NotFoundException('Запись не найдена');
    if (booking.clientIssue !== PtClientIssue.NONE) {
      throw new BadRequestException(
        'Сначала исправьте проблему с клиентом/телефоном',
      );
    }
    if (booking.isComplimentary) {
      await this.prisma.personalTrainingBooking.update({
        where: { id: bookingId },
        data: {
          payKind: PtSessionPayKind.GIFT,
          paymentStatus: ServicePaymentStatus.N_A,
          priceMinor: 0,
        },
      });
      const date = booking.startAt.toISOString().slice(0, 10);
      return this.buildOrRefreshSheet(clubId, booking.trainerId, date);
    }

    const provider = this.fitness.getProvider();
    const result = await provider.getPtSessionPayment?.({
      clientExternalId: booking.client.externalId ?? undefined,
      clientPhone: booking.client.phone ?? undefined,
      trainerExternalId: booking.trainer.externalId ?? undefined,
      occurredAt: booking.startAt.toISOString(),
    });

    if (!result) {
      throw new BadRequestException(
        'Сверка оплаты ПТ в 1С недоступна — отметьте вручную',
      );
    }

    await this.prisma.personalTrainingBooking.update({
      where: { id: bookingId },
      data: {
        paymentStatus: result.paymentStatus as ServicePaymentStatus,
        payKind: (result.payKind as PtSessionPayKind) ?? PtSessionPayKind.UNKNOWN,
        ...(result.priceMinor != null ? { priceMinor: result.priceMinor } : {}),
        ...(result.docRef ? { crmDocRef: result.docRef } : {}),
        ...(result.paymentStatus === 'PAID' ? { paidAt: new Date() } : {}),
      },
    });
    const date = booking.startAt.toISOString().slice(0, 10);
    return this.buildOrRefreshSheet(clubId, booking.trainerId, date);
  }

  async listSheetsForReview(
    clubId: string,
    status?: TrainerDaySheetStatus,
  ): Promise<TrainerDaySheetDto[]> {
    const rows = await this.prisma.trainerDaySheet.findMany({
      where: {
        clubId,
        ...(status ? { status } : { status: { not: TrainerDaySheetStatus.DRAFT } }),
      },
      orderBy: { date: 'desc' },
      take: 50,
    });
    const out: TrainerDaySheetDto[] = [];
    for (const r of rows) {
      out.push(await this.toSheetDto(r.id));
    }
    return out;
  }

  async adminApproveSheet(actor: JwtPayload, sheetId: string) {
    const clubId = requireClubId(actor);
    const sheet = await this.prisma.trainerDaySheet.findFirst({
      where: { id: sheetId, clubId },
      include: { lines: true },
    });
    if (!sheet) throw new NotFoundException('Табель не найден');
    if (
      sheet.status !== TrainerDaySheetStatus.ADMIN_REVIEW &&
      sheet.status !== TrainerDaySheetStatus.TRAINER_SUBMITTED
    ) {
      throw new BadRequestException('Табель не на проверке админа');
    }
    const open = sheet.lines.filter((l) => l.clientIssue !== PtClientIssue.NONE);
    if (open.length) {
      throw new BadRequestException(
        `Открытых проблем с клиентом: ${open.length}`,
      );
    }
    await this.prisma.trainerDaySheet.update({
      where: { id: sheetId },
      data: {
        status: TrainerDaySheetStatus.ADMIN_APPROVED,
        adminApprovedById: actor.sub,
        adminApprovedAt: new Date(),
      },
    });
    return this.toSheetDto(sheetId);
  }

  async saApproveSheet(
    actor: JwtPayload,
    sheetId: string,
    forceBookingIds?: string[],
  ) {
    const clubId = requireClubId(actor);
    const sheet = await this.prisma.trainerDaySheet.findFirst({
      where: { id: sheetId, clubId },
      include: { lines: true },
    });
    if (!sheet) throw new NotFoundException('Табель не найден');
    if (sheet.status !== TrainerDaySheetStatus.ADMIN_APPROVED) {
      throw new BadRequestException('Сначала утверждение админом');
    }
    if (forceBookingIds?.length) {
      await this.prisma.personalTrainingBooking.updateMany({
        where: { id: { in: forceBookingIds }, trainerId: sheet.trainerId },
        data: { forceIncludeInPayroll: true },
      });
      await this.prisma.trainerDaySheetLine.updateMany({
        where: {
          sheetId,
          personalTrainingBookingId: { in: forceBookingIds },
        },
        data: { forceIncludeInPayroll: true, payable: true },
      });
    }
    // Refresh money after force
    await this.buildOrRefreshSheet(
      clubId,
      sheet.trainerId,
      sheet.date.toISOString().slice(0, 10),
      true,
    );
    await this.prisma.trainerDaySheet.update({
      where: { id: sheetId },
      data: {
        status: TrainerDaySheetStatus.SA_APPROVED,
        saApprovedById: actor.sub,
        saApprovedAt: new Date(),
      },
    });
    return this.toSheetDto(sheetId);
  }

  async lockSheet(actor: JwtPayload, sheetId: string) {
    const clubId = requireClubId(actor);
    const sheet = await this.prisma.trainerDaySheet.findFirst({
      where: { id: sheetId, clubId },
    });
    if (!sheet) throw new NotFoundException('Табель не найден');
    if (sheet.status !== TrainerDaySheetStatus.SA_APPROVED) {
      throw new BadRequestException('Нужен статус SA_APPROVED');
    }
    await this.prisma.trainerDaySheet.update({
      where: { id: sheetId },
      data: { status: TrainerDaySheetStatus.LOCKED },
    });
    return this.toSheetDto(sheetId);
  }

  /** Approved/locked payable booking ids for payroll period. */
  async listPayrollEligibleBookingIds(
    clubId: string,
    trainerId: string,
    from: string,
    to: string,
  ): Promise<Set<string>> {
    const fromD = dateOnly(from);
    const toD = dateOnly(to);
    const sheets = await this.prisma.trainerDaySheet.findMany({
      where: {
        clubId,
        trainerId,
        date: { gte: fromD, lte: toD },
        status: {
          in: [
            TrainerDaySheetStatus.SA_APPROVED,
            TrainerDaySheetStatus.LOCKED,
          ],
        },
      },
      include: {
        lines: {
          where: {
            OR: [{ payable: true }, { forceIncludeInPayroll: true }],
            clientIssue: PtClientIssue.NONE,
          },
        },
      },
    });
    const ids = new Set<string>();
    for (const s of sheets) {
      for (const l of s.lines) ids.add(l.personalTrainingBookingId);
    }
    return ids;
  }

  async sumShiftPayMinor(
    clubId: string,
    trainerId: string,
    from: string,
    to: string,
  ): Promise<number> {
    const fromD = dateOnly(from);
    const toD = dateOnly(to);
    const sheets = await this.prisma.trainerDaySheet.findMany({
      where: {
        clubId,
        trainerId,
        date: { gte: fromD, lte: toD },
        status: {
          in: [
            TrainerDaySheetStatus.SA_APPROVED,
            TrainerDaySheetStatus.LOCKED,
          ],
        },
      },
    });
    return sheets.reduce((s, x) => s + x.shiftPayMinor, 0);
  }

  // ── Internals ───────────────────────────────────────────────────────

  private detectClientIssue(client: {
    externalId?: string | null;
    phoneNormalized?: string | null;
    clubMemberships?: Array<{
      crmStatus?: string | null;
      externalId?: string | null;
    }>;
  }): PtClientIssue {
    if (!client.phoneNormalized) return PtClientIssue.WRONG_PHONE;
    const m = client.clubMemberships?.[0];
    const ext = client.externalId ?? m?.externalId;
    if (!ext) return PtClientIssue.CRM_UNMATCHED;
    if (m?.crmStatus === ClubCrmLinkStatus.PENDING_CRM) {
      return PtClientIssue.CRM_UNMATCHED;
    }
    return PtClientIssue.NONE;
  }

  private mapShift(r: {
    id: string;
    trainerId: string;
    date: Date;
    startAt: Date;
    endAt: Date;
    status: TrainerShiftStatus;
  }): TrainerShiftDto {
    const minutes = Math.max(
      0,
      Math.round((r.endAt.getTime() - r.startAt.getTime()) / 60_000),
    );
    return {
      id: r.id,
      trainerId: r.trainerId,
      date: r.date.toISOString().slice(0, 10),
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
      status: r.status,
      minutes,
    };
  }

  private async buildOrRefreshSheet(
    clubId: string,
    trainerId: string,
    dateStr: string,
    forceRefresh = false,
  ): Promise<TrainerDaySheetDto> {
    const { from, to, date } = dayBounds(dateStr);

    let sheet = await this.prisma.trainerDaySheet.findUnique({
      where: { trainerId_date: { trainerId, date } },
    });

    if (
      sheet &&
      (sheet.status === TrainerDaySheetStatus.LOCKED ||
        sheet.status === TrainerDaySheetStatus.SA_APPROVED) &&
      !forceRefresh
    ) {
      return this.toSheetDto(sheet.id);
    }

    const shifts = await this.prisma.trainerShift.findMany({
      where: { trainerId, date },
    });
    const shiftMinutes = shifts.reduce(
      (s, sh) =>
        s +
        Math.max(
          0,
          Math.round((sh.endAt.getTime() - sh.startAt.getTime()) / 60_000),
        ),
      0,
    );

    const bookings = await this.prisma.personalTrainingBooking.findMany({
      where: {
        trainerId,
        status: { not: PersonalBookingStatus.CANCELLED },
        startAt: { gte: from, lte: to },
      },
      include: {
        client: {
          include: {
            clubMemberships: { where: { clubId }, take: 1 },
          },
        },
      },
      orderBy: { startAt: 'asc' },
    });

    const compensation = await this.prisma.staffCompensation.findFirst({
      where: { clubId, userId: trainerId },
      orderBy: { effectiveFrom: 'desc' },
    });
    const profile = asPayProfile(compensation?.payProfile);
    const hourlyMinor = profile?.hourlyRateMinor ?? 0;
    const catalog = profile?.ptSessionPriceMinor ?? 0;
    const monthCount = bookings.length;
    const pct = resolvePtPercent(monthCount, profile?.ptPercentTiers);

    if (!sheet) {
      sheet = await this.prisma.trainerDaySheet.create({
        data: {
          clubId,
          trainerId,
          date,
          status: TrainerDaySheetStatus.DRAFT,
          shiftMinutes,
          workedMinutes: shiftMinutes,
          hourlyMinor,
          currency: compensation?.currency ?? 'BYN',
        },
      });
    } else if (
      sheet.status === TrainerDaySheetStatus.DRAFT ||
      sheet.status === TrainerDaySheetStatus.TRAINER_SUBMITTED ||
      sheet.status === TrainerDaySheetStatus.ADMIN_REVIEW ||
      forceRefresh
    ) {
      // keep status unless force path for SA
    }

    // Sync lines from bookings
    const existingLines = await this.prisma.trainerDaySheetLine.findMany({
      where: { sheetId: sheet.id },
    });
    const byBooking = new Map(
      existingLines.map((l) => [l.personalTrainingBookingId, l]),
    );
    const keepIds = new Set<string>();

    let sessionMotivationMinor = 0;
    for (const b of bookings) {
      let issue = b.clientIssue;
      if (issue === PtClientIssue.NONE) {
        issue = this.detectClientIssue(b.client);
        if (issue !== PtClientIssue.NONE) {
          await this.prisma.personalTrainingBooking.update({
            where: { id: b.id },
            data: { clientIssue: issue, trustBand: TrustBand.AMBER },
          });
        }
      }

      const payKind = b.isComplimentary
        ? PtSessionPayKind.GIFT
        : b.payKind !== PtSessionPayKind.UNKNOWN
          ? b.payKind
          : b.paymentStatus === ServicePaymentStatus.PAID
            ? PtSessionPayKind.PAID
            : PtSessionPayKind.UNKNOWN;

      const price =
        b.priceMinor != null && b.priceMinor > 0
          ? b.priceMinor
          : !b.isComplimentary
            ? catalog
            : 0;

      const verified1c =
        b.paymentStatus === ServicePaymentStatus.PAID &&
        issue === PtClientIssue.NONE;
      const payable =
        issue === PtClientIssue.NONE &&
        !b.isComplimentary &&
        (b.forceIncludeInPayroll ||
          b.paymentStatus === ServicePaymentStatus.PAID);
      const motivationMinor =
        payable && price > 0 ? Math.round((price * pct) / 100) : 0;
      if (payable) sessionMotivationMinor += motivationMinor;

      const source =
        b.origin === PersonalBookingOrigin.CLIENT_BOOKED
          ? 'CLIENT'
          : b.isLateAdd
            ? 'TRAINER_LATE'
            : 'TRAINER';

      const lineData = {
        clientName: `${b.client.lastName} ${b.client.firstName}`.trim(),
        clientPhone: b.client.phone,
        source,
        payKind,
        priceMinor: price || null,
        paymentStatus: b.paymentStatus,
        verified1c,
        payable,
        countsForVolume: true,
        isLateAdd: b.isLateAdd,
        clientIssue: issue,
        clientIssueEscalated: b.clientIssueEscalated,
        forceIncludeInPayroll: b.forceIncludeInPayroll,
        motivationMinor,
      };

      const existing = byBooking.get(b.id);
      if (existing) {
        await this.prisma.trainerDaySheetLine.update({
          where: { id: existing.id },
          data: lineData,
        });
        keepIds.add(existing.id);
      } else {
        const created = await this.prisma.trainerDaySheetLine.create({
          data: {
            sheetId: sheet.id,
            personalTrainingBookingId: b.id,
            ...lineData,
          },
        });
        keepIds.add(created.id);
      }
    }

    for (const l of existingLines) {
      if (!keepIds.has(l.id)) {
        await this.prisma.trainerDaySheetLine.delete({ where: { id: l.id } });
      }
    }

    const shiftPayMinor = Math.round((shiftMinutes / 60) * hourlyMinor);
    await this.prisma.trainerDaySheet.update({
      where: { id: sheet.id },
      data: {
        shiftMinutes,
        workedMinutes: shiftMinutes,
        hourlyMinor,
        shiftPayMinor,
        sessionMotivationMinor,
        totalMinor: shiftPayMinor + sessionMotivationMinor,
        currency: compensation?.currency ?? 'BYN',
      },
    });

    return this.toSheetDto(sheet.id);
  }

  async getSheetById(clubId: string, sheetId: string) {
    const sheet = await this.prisma.trainerDaySheet.findFirst({
      where: { id: sheetId, clubId },
    });
    if (!sheet) throw new NotFoundException('Табель не найден');
    return this.toSheetDto(sheetId);
  }

  private async toSheetDto(sheetId: string): Promise<TrainerDaySheetDto> {
    const sheet = await this.prisma.trainerDaySheet.findUniqueOrThrow({
      where: { id: sheetId },
      include: {
        trainer: true,
        adminApprovedBy: true,
        saApprovedBy: true,
        lines: {
          include: { booking: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    const lines: TrainerDaySheetLineDto[] = sheet.lines.map((l) => ({
      id: l.id,
      bookingId: l.personalTrainingBookingId,
      clientId: l.booking.clientId,
      clientName: l.clientName,
      clientPhone: l.clientPhone ?? undefined,
      startAt: l.booking.startAt.toISOString(),
      endAt: l.booking.endAt.toISOString(),
      source: l.source,
      payKind: l.payKind as TrainerDaySheetLineDto['payKind'],
      priceMinor: l.priceMinor ?? undefined,
      paymentStatus: l.paymentStatus,
      verified1c: l.verified1c,
      payable: l.payable,
      countsForVolume: l.countsForVolume,
      isLateAdd: l.isLateAdd,
      clientIssue: l.clientIssue as TrainerDaySheetLineDto['clientIssue'],
      clientIssueEscalated: l.clientIssueEscalated,
      forceIncludeInPayroll: l.forceIncludeInPayroll,
      isComplimentary: l.booking.isComplimentary,
      motivationMinor: l.motivationMinor,
      trustBand: l.booking.trustBand,
    }));

    return {
      id: sheet.id,
      trainerId: sheet.trainerId,
      trainerName: `${sheet.trainer.lastName} ${sheet.trainer.firstName}`.trim(),
      date: sheet.date.toISOString().slice(0, 10),
      status: sheet.status as TrainerDaySheetDto['status'],
      shiftMinutes: sheet.shiftMinutes,
      workedMinutes: sheet.workedMinutes,
      hourlyMinor: sheet.hourlyMinor,
      shiftPayMinor: sheet.shiftPayMinor,
      sessionMotivationMinor: sheet.sessionMotivationMinor,
      totalMinor: sheet.totalMinor,
      currency: sheet.currency,
      submittedAt: sheet.submittedAt?.toISOString(),
      adminApprovedByName: sheet.adminApprovedBy
        ? `${sheet.adminApprovedBy.lastName} ${sheet.adminApprovedBy.firstName}`.trim()
        : undefined,
      adminApprovedAt: sheet.adminApprovedAt?.toISOString(),
      saApprovedByName: sheet.saApprovedBy
        ? `${sheet.saApprovedBy.lastName} ${sheet.saApprovedBy.firstName}`.trim()
        : undefined,
      saApprovedAt: sheet.saApprovedAt?.toISOString(),
      lines,
      openClientIssues: lines.filter((l) => l.clientIssue !== 'NONE').length,
      openLateAdds: lines.filter((l) => l.isLateAdd).length,
      unpaidCount: lines.filter(
        (l) =>
          !l.isComplimentary &&
          l.paymentStatus !== 'PAID' &&
          !l.forceIncludeInPayroll,
      ).length,
    };
  }
}
