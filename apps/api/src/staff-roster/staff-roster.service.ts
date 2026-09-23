import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Role,
  StaffShiftTrack,
  TrainerShiftStatus,
} from '@prisma/client';
import {
  DEFAULT_CLUB_WORKING_HOURS,
  clubHoursForDate,
  sliceForTrack,
  trackDayCapMinutes,
  type ClubWorkingHours,
  type StaffHourlySummary,
  type StaffShiftDto,
  type StaffShiftMonthCell,
  type StaffShiftTrack as Track,
  type StaffPayProfile,
} from '@fitgo/shared-types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { PrismaService } from '../prisma/prisma.service';

function dateOnly(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
}

function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthRange(year: number, month: number) {
  const from = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const to = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { from, to };
}

function asPayProfile(raw: unknown): StaffPayProfile | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  return raw as StaffPayProfile;
}

function asWorkingHours(raw: unknown): ClubWorkingHours {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CLUB_WORKING_HOURS };
  return { ...DEFAULT_CLUB_WORKING_HOURS, ...(raw as ClubWorkingHours) };
}

@Injectable()
export class StaffRosterService {
  constructor(private readonly prisma: PrismaService) {}

  async getWorkingHours(clubId: string): Promise<ClubWorkingHours> {
    const club = await this.prisma.club.findUnique({ where: { id: clubId } });
    if (!club) throw new NotFoundException('Клуб не найден');
    return asWorkingHours(club.workingHours);
  }

  async setWorkingHours(clubId: string, hours: ClubWorkingHours) {
    await this.prisma.club.update({
      where: { id: clubId },
      data: { workingHours: hours as object },
    });
    return this.getWorkingHours(clubId);
  }

  /** Holiday flag and/or one-day club hours. hours=null clears the day override. */
  async patchDaySchedule(
    clubId: string,
    input: {
      date: string;
      holiday?: boolean;
      hours?: { open: string; close: string; closed?: boolean } | null;
    },
  ) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
      throw new BadRequestException('Дата должна быть в формате ГГГГ-ММ-ДД');
    }
    if (
      input.hours &&
      !input.hours.closed &&
      !(input.hours.open < input.hours.close)
    ) {
      throw new BadRequestException('Закрытие клуба должно быть позже открытия');
    }
    const current = await this.getWorkingHours(clubId);
    const holidayDates = new Set(current.holidayDates ?? []);
    if (input.holiday === true) holidayDates.add(input.date);
    if (input.holiday === false) holidayDates.delete(input.date);
    const dayOverrides = { ...(current.dayOverrides ?? {}) };
    if (input.hours === null) delete dayOverrides[input.date];
    else if (input.hours) {
      dayOverrides[input.date] = {
        open: input.hours.open,
        close: input.hours.close,
        closed: !!input.hours.closed,
      };
    }
    return this.setWorkingHours(clubId, {
      ...current,
      holidayDates: [...holidayDates].sort(),
      dayOverrides,
    });
  }

  async listStaffForTrack(clubId: string, track: Track) {
    const roleMap: Record<Track, Role[]> = {
      ADMIN: [Role.ADMIN],
      TRAINER: [Role.TRAINER],
      TECH: [Role.TECH],
    };
    const users = await this.prisma.user.findMany({
      where: {
        clubId,
        isActive: true,
        roles: { some: { role: { in: roleMap[track] } } },
      },
      include: { roles: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    return users
      .filter((u) => !u.roles.some((r) => r.role === Role.SUPER_ADMIN))
      .map((u) => ({
        id: u.id,
        name: `${u.lastName} ${u.firstName}`.trim(),
        roles: u.roles.map((r) => r.role),
      }));
  }

  async listMonth(
    clubId: string,
    year: number,
    month: number,
    track?: Track,
  ): Promise<StaffShiftMonthCell[]> {
    const { from, to } = monthRange(year, month);
    const rows = await this.prisma.staffShift.findMany({
      where: {
        clubId,
        date: { gte: from, lte: to },
        ...(track ? { track: track as StaffShiftTrack } : {}),
      },
      include: { user: true },
      orderBy: { startAt: 'asc' },
    });
    const byDate = new Map<string, StaffShiftDto[]>();
    const daysInMonth = new Date(year, month, 0).getDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      byDate.set(key, []);
    }
    for (const r of rows) {
      const key = utcDateKey(r.date);
      const list = byDate.get(key);
      if (list) list.push(this.mapShift(r));
    }
    return [...byDate.entries()].map(([date, shifts]) => ({ date, shifts }));
  }

  async upsertShift(
    actor: JwtPayload,
    input: {
      id?: string;
      userId: string;
      track: Track;
      date: string;
      startAt: string;
      endAt: string;
      note?: string;
    },
  ): Promise<StaffShiftDto> {
    const created = await this.createShifts(actor, {
      ...input,
      userIds: [input.userId],
    });
    return created[0]!;
  }

  /** Create one shift per user; overlapping times across people are allowed. */
  async createShifts(
    actor: JwtPayload,
    input: {
      id?: string;
      userId?: string;
      userIds?: string[];
      track: Track;
      date: string;
      startAt: string;
      endAt: string;
      note?: string;
      overtimeMinutes?: number;
    },
  ): Promise<StaffShiftDto[]> {
    const clubId = requireClubId(actor);
    const start = new Date(input.startAt);
    const end = new Date(input.endAt);
    if (!(start < end)) {
      throw new BadRequestException('Конец смены должен быть после начала');
    }
    const date = dateOnly(input.date);
    await this.assertWithinClubHours(clubId, date, start, end);

    const newMinutes = Math.round((end.getTime() - start.getTime()) / 60_000);

    // Update single existing shift
    if (input.id) {
      const userId = input.userId ?? input.userIds?.[0];
      if (!userId) throw new BadRequestException('Укажите сотрудника');
      const user = await this.prisma.user.findFirst({
        where: { id: userId, clubId, isActive: true },
      });
      if (!user) throw new NotFoundException('Сотрудник не найден');
      const existing = await this.prisma.staffShift.findFirst({
        where: { id: input.id, clubId },
        include: { user: true },
      });
      if (!existing) throw new NotFoundException('Смена не найдена');
      const overtime = this.lateCloseMinutes(
        input.track,
        input.overtimeMinutes ?? existing.overtimeMinutes,
      );
      await this.assertTrackDayBudget(
        clubId,
        input.track,
        date,
        newMinutes,
        existing.id,
      );
      const row = await this.prisma.staffShift.update({
        where: { id: input.id },
        data: {
          userId,
          track: input.track as StaffShiftTrack,
          date,
          startAt: start,
          endAt: end,
          note: input.note,
          overtimeMinutes: overtime,
        },
        include: { user: true },
      });
      await this.syncTrainerShiftMirror(row);
      return [this.mapShift(row)];
    }

    const userIds = [
      ...new Set(
        (input.userIds?.length ? input.userIds : input.userId ? [input.userId] : []).filter(
          Boolean,
        ),
      ),
    ] as string[];
    if (userIds.length === 0) {
      throw new BadRequestException('Выберите хотя бы одного сотрудника');
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, clubId, isActive: true },
    });
    if (users.length !== userIds.length) {
      throw new NotFoundException('Один или несколько сотрудников не найдены');
    }

    const overtime = this.lateCloseMinutes(input.track, input.overtimeMinutes);
    await this.assertTrackDayBudget(
      clubId,
      input.track,
      date,
      newMinutes * userIds.length,
    );

    const out: StaffShiftDto[] = [];
    for (const uid of userIds) {
      const row = await this.prisma.staffShift.create({
        data: {
          clubId,
          userId: uid,
          track: input.track as StaffShiftTrack,
          date,
          startAt: start,
          endAt: end,
          note: input.note,
          overtimeMinutes: overtime,
          status: TrainerShiftStatus.PLANNED,
        },
        include: { user: true },
      });
      await this.syncTrainerShiftMirror(row);
      out.push(this.mapShift(row));
    }
    return out;
  }

  async deleteShift(clubId: string, id: string) {
    const row = await this.prisma.staffShift.findFirst({
      where: { id, clubId },
    });
    if (!row) throw new NotFoundException('Смена не найдена');
    await this.prisma.staffShift.delete({ where: { id } });
    if (row.track === StaffShiftTrack.TRAINER) {
      await this.prisma.trainerShift.deleteMany({
        where: {
          clubId,
          trainerId: row.userId,
          startAt: row.startAt,
          endAt: row.endAt,
        },
      });
    }
    return { success: true };
  }

  /**
   * Copy the same person + time window onto many dates.
   * Skips closed days, days where the person already works, or days over the track cap.
   */
  async fillShifts(
    actor: JwtPayload,
    input: {
      userId: string;
      track: Track;
      /** HH:mm */
      startTime: string;
      /** HH:mm */
      endTime: string;
      dates: string[];
      overtimeMinutes?: number;
      /** Default true: skip if this user already has a shift that day. */
      skipIfExists?: boolean;
    },
  ): Promise<{
    created: number;
    skipped: Array<{ date: string; reason: string }>;
  }> {
    const clubId = requireClubId(actor);
    const dates = [
      ...new Set(
        (input.dates ?? []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)),
      ),
    ].sort();
    if (dates.length === 0) {
      throw new BadRequestException('Укажите хотя бы одну дату');
    }
    if (dates.length > 62) {
      throw new BadRequestException('Не больше 62 дней за раз');
    }
    if (!/^\d{2}:\d{2}$/.test(input.startTime) || !/^\d{2}:\d{2}$/.test(input.endTime)) {
      throw new BadRequestException('Время в формате ЧЧ:ММ');
    }
    if (!(input.startTime < input.endTime)) {
      throw new BadRequestException('Конец смены должен быть после начала');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: input.userId, clubId, isActive: true },
    });
    if (!user) throw new NotFoundException('Сотрудник не найден');

    const skipIfExists = input.skipIfExists !== false;
    const overtime = this.lateCloseMinutes(input.track, input.overtimeMinutes);
    const created: StaffShiftDto[] = [];
    const skipped: Array<{ date: string; reason: string }> = [];

    for (const dateStr of dates) {
      const date = dateOnly(dateStr);
      const start = new Date(`${dateStr}T${input.startTime}:00`);
      const end = new Date(`${dateStr}T${input.endTime}:00`);
      const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);

      try {
        await this.assertWithinClubHours(clubId, date, start, end);
      } catch (e) {
        skipped.push({
          date: dateStr,
          reason: e instanceof BadRequestException ? String(e.message) : 'Клуб закрыт',
        });
        continue;
      }

      if (skipIfExists) {
        const existing = await this.prisma.staffShift.findFirst({
          where: {
            clubId,
            userId: input.userId,
            track: input.track as StaffShiftTrack,
            date,
          },
        });
        if (existing) {
          skipped.push({ date: dateStr, reason: 'Уже есть смена' });
          continue;
        }
      }

      try {
        await this.assertTrackDayBudget(clubId, input.track, date, minutes);
      } catch (e) {
        skipped.push({
          date: dateStr,
          reason:
            e instanceof BadRequestException
              ? String(e.message)
              : 'Лимит часов дня',
        });
        continue;
      }

      const row = await this.prisma.staffShift.create({
        data: {
          clubId,
          userId: input.userId,
          track: input.track as StaffShiftTrack,
          date,
          startAt: start,
          endAt: end,
          overtimeMinutes: overtime,
          status: TrainerShiftStatus.PLANNED,
        },
        include: { user: true },
      });
      await this.syncTrainerShiftMirror(row);
      created.push(this.mapShift(row));
    }

    return { created: created.length, skipped };
  }

  async hourlySummary(
    clubId: string,
    userId: string,
    from: string,
    to: string,
  ): Promise<StaffHourlySummary> {
    const fromD = dateOnly(from);
    const toD = dateOnly(to);
    toD.setHours(23, 59, 59, 999);
    const user = await this.prisma.user.findFirst({
      where: { id: userId, clubId },
      include: { roles: true },
    });
    if (!user) throw new NotFoundException('Сотрудник не найден');

    const rows = await this.prisma.staffShift.findMany({
      where: {
        clubId,
        userId,
        date: { gte: fromD, lte: toD },
      },
      include: { user: true },
      orderBy: { startAt: 'asc' },
    });
    const shifts = rows.map((r) => this.mapShift(r));
    const totalMinutes = shifts.reduce(
      (s, x) => s + x.minutes + x.overtimeMinutes,
      0,
    );
    const compensation = await this.prisma.staffCompensation.findFirst({
      where: { clubId, userId },
      orderBy: { effectiveFrom: 'desc' },
    });
    const profile = asPayProfile(compensation?.payProfile);
    const track =
      (rows[0]?.track as Track) ??
      (user.roles.some((r) => r.role === Role.TRAINER)
        ? 'TRAINER'
        : user.roles.some((r) => r.role === Role.ADMIN)
          ? 'ADMIN'
          : 'TECH');
    const payTrack =
      track === 'ADMIN' ? 'ADMIN' : track === 'TRAINER' ? 'PT' : 'TECH';
    const hourlyRateMinor =
      (profile
        ? sliceForTrack(profile, payTrack).hourlyRateMinor
        : undefined) ??
      profile?.hourlyRateMinor ??
      0;
    return {
      userId,
      userName: `${user.lastName} ${user.firstName}`.trim(),
      track,
      shiftCount: shifts.length,
      totalMinutes,
      hourlyRateMinor,
      payMinor: Math.round((totalMinutes / 60) * hourlyRateMinor),
      currency: compensation?.currency ?? 'BYN',
      shifts,
    };
  }

  async listHourlySummaries(
    clubId: string,
    from: string,
    to: string,
    track?: Track,
  ): Promise<StaffHourlySummary[]> {
    const fromD = dateOnly(from);
    const toD = dateOnly(to);
    toD.setHours(23, 59, 59, 999);
    const rows = await this.prisma.staffShift.findMany({
      where: {
        clubId,
        date: { gte: fromD, lte: toD },
        ...(track ? { track: track as StaffShiftTrack } : {}),
      },
      select: { userId: true },
      distinct: ['userId'],
    });
    const out: StaffHourlySummary[] = [];
    for (const r of rows) {
      out.push(await this.hourlySummary(clubId, r.userId, from, to));
    }
    return out.sort((a, b) => a.userName.localeCompare(b.userName, 'ru'));
  }

  private async assertWithinClubHours(
    clubId: string,
    date: Date,
    start: Date,
    end: Date,
  ) {
    const hours = await this.getWorkingHours(clubId);
    const day = clubHoursForDate(hours, date);
    if (!day || day.closed) {
      throw new BadRequestException('В этот день клуб закрыт по настройкам');
    }
    const [oH, oM] = day.open.split(':').map(Number);
    const [cH, cM] = day.close.split(':').map(Number);
    const open = new Date(date);
    open.setHours(oH!, oM!, 0, 0);
    const close = new Date(date);
    close.setHours(cH!, cM!, 0, 0);
    if (start < open || end > close) {
      throw new BadRequestException(
        `Смена должна быть в часах клуба ${day.open}–${day.close}`,
      );
    }
  }

  /** Late close is paid, but it does not consume the department day template. */
  private lateCloseMinutes(track: Track, value: number | undefined): number {
    if (track !== 'ADMIN') return 0;
    const n = Math.round(Number(value ?? 0));
    if (!Number.isFinite(n) || n <= 0) return 0;
    if (n > 30) {
      throw new BadRequestException('К смене можно добавить не больше 30 минут');
    }
    return n;
  }

  /** Sum of planned minutes for a track on a date must stay within the department cap. */
  private async assertTrackDayBudget(
    clubId: string,
    track: Track,
    date: Date,
    addMinutes: number,
    excludeShiftId?: string,
  ) {
    const hours = await this.getWorkingHours(clubId);
    const cap = trackDayCapMinutes(track, date, hours.holidayDates ?? []);
    const rows = await this.prisma.staffShift.findMany({
      where: { clubId, track: track as StaffShiftTrack, date },
    });
    const used = rows.reduce((sum, row) => {
      if (excludeShiftId && row.id === excludeShiftId) return sum;
      return (
        sum +
        Math.max(
          0,
          Math.round((row.endAt.getTime() - row.startAt.getTime()) / 60_000),
        )
      );
    }, 0);
    if (used + addMinutes > cap) {
      const fmt = (m: number) => (m / 60).toFixed(1);
      const label =
        track === 'ADMIN'
          ? 'администраторов'
          : track === 'TRAINER'
            ? 'тренеров'
            : 'техперсонала';
      throw new BadRequestException(
        `Лимит часов ${label} на этот день — ${fmt(cap)} ч (уже ${fmt(used)} ч). Добавление ${fmt(addMinutes)} ч даст переплату.`,
      );
    }
  }

  /** Keep TrainerShift in sync for PT timesheet consumers. */
  private async syncTrainerShiftMirror(row: {
    id: string;
    clubId: string;
    userId: string;
    track: StaffShiftTrack;
    date: Date;
    startAt: Date;
    endAt: Date;
    status: TrainerShiftStatus;
  }) {
    if (row.track !== StaffShiftTrack.TRAINER) return;
    const existing = await this.prisma.trainerShift.findFirst({
      where: {
        clubId: row.clubId,
        trainerId: row.userId,
        startAt: row.startAt,
      },
    });
    if (existing) {
      await this.prisma.trainerShift.update({
        where: { id: existing.id },
        data: {
          date: row.date,
          endAt: row.endAt,
          status: row.status,
        },
      });
    } else {
      await this.prisma.trainerShift.create({
        data: {
          clubId: row.clubId,
          trainerId: row.userId,
          date: row.date,
          startAt: row.startAt,
          endAt: row.endAt,
          status: row.status,
        },
      });
    }
  }

  private mapShift(r: {
    id: string;
    userId: string;
    track: StaffShiftTrack;
    date: Date;
    startAt: Date;
    endAt: Date;
    status: TrainerShiftStatus;
    note?: string | null;
    overtimeMinutes?: number;
    user: { firstName: string; lastName: string };
  }): StaffShiftDto {
    const minutes = Math.max(
      0,
      Math.round((r.endAt.getTime() - r.startAt.getTime()) / 60_000),
    );
    const overtimeMinutes = Math.min(30, Math.max(0, r.overtimeMinutes ?? 0));
    return {
      id: r.id,
      userId: r.userId,
      userName: `${r.user.lastName} ${r.user.firstName}`.trim(),
      track: r.track as Track,
      date: utcDateKey(r.date),
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
      status: r.status,
      minutes,
      overtimeMinutes,
      note: r.note ?? undefined,
    };
  }
}
