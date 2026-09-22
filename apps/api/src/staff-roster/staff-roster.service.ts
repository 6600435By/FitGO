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
  dayKeyFromDate,
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
  return new Date(y!, m! - 1, d!);
}

function monthRange(year: number, month: number) {
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 0);
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
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

  async listStaffForTrack(clubId: string, track: Track) {
    const roleMap: Record<Track, Role[]> = {
      ADMIN: [Role.ADMIN],
      TRAINER: [Role.TRAINER],
      TECH: [Role.SPECIALIST],
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
      const key = r.date.toISOString().slice(0, 10);
      // Local date key from date field
      const local = `${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, '0')}-${String(r.date.getDate()).padStart(2, '0')}`;
      const list = byDate.get(local) ?? byDate.get(key);
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
    const clubId = requireClubId(actor);
    const start = new Date(input.startAt);
    const end = new Date(input.endAt);
    if (!(start < end)) {
      throw new BadRequestException('Конец смены должен быть после начала');
    }
    const date = dateOnly(input.date);
    await this.assertWithinClubHours(clubId, date, start, end);

    const user = await this.prisma.user.findFirst({
      where: { id: input.userId, clubId, isActive: true },
    });
    if (!user) throw new NotFoundException('Сотрудник не найден');

    if (input.id) {
      const existing = await this.prisma.staffShift.findFirst({
        where: { id: input.id, clubId },
        include: { user: true },
      });
      if (!existing) throw new NotFoundException('Смена не найдена');
      const row = await this.prisma.staffShift.update({
        where: { id: input.id },
        data: {
          userId: input.userId,
          track: input.track as StaffShiftTrack,
          date,
          startAt: start,
          endAt: end,
          note: input.note,
        },
        include: { user: true },
      });
      await this.syncTrainerShiftMirror(row);
      return this.mapShift(row);
    }

    const row = await this.prisma.staffShift.create({
      data: {
        clubId,
        userId: input.userId,
        track: input.track as StaffShiftTrack,
        date,
        startAt: start,
        endAt: end,
        note: input.note,
        status: TrainerShiftStatus.PLANNED,
      },
      include: { user: true },
    });
    await this.syncTrainerShiftMirror(row);
    return this.mapShift(row);
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
    const totalMinutes = shifts.reduce((s, x) => s + x.minutes, 0);
    const compensation = await this.prisma.staffCompensation.findFirst({
      where: { clubId, userId },
      orderBy: { effectiveFrom: 'desc' },
    });
    const profile = asPayProfile(compensation?.payProfile);
    const hourlyRateMinor = profile?.hourlyRateMinor ?? 0;
    const track =
      (rows[0]?.track as Track) ??
      (user.roles.some((r) => r.role === Role.TRAINER)
        ? 'TRAINER'
        : user.roles.some((r) => r.role === Role.ADMIN)
          ? 'ADMIN'
          : 'TECH');
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
    const key = dayKeyFromDate(date);
    const day = hours[key];
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
    user: { firstName: string; lastName: string };
  }): StaffShiftDto {
    const minutes = Math.max(
      0,
      Math.round((r.endAt.getTime() - r.startAt.getTime()) / 60_000),
    );
    return {
      id: r.id,
      userId: r.userId,
      userName: `${r.user.lastName} ${r.user.firstName}`.trim(),
      track: r.track as Track,
      date: `${r.date.getFullYear()}-${String(r.date.getMonth() + 1).padStart(2, '0')}-${String(r.date.getDate()).padStart(2, '0')}`,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
      status: r.status,
      minutes,
      note: r.note ?? undefined,
    };
  }
}
