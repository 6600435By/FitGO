import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  OnexClassKind,
  OnexClassMemberAttendance,
  OnexClassStatus,
  SessionApprovalKind,
  SpaBookingStatus,
  SpaPaymentType,
  SpaWaitlistStatus,
} from '@prisma/client';
import type {
  FloorStaffControlItem,
  FloorStaffFreeWindow,
  FloorStaffHome,
  FloorStaffHomeSession,
  FloorStaffMonthMetric,
} from '@fitgo/shared-types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { PrismaService } from '../prisma/prisma.service';

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function localDateKey(d = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function monthBounds(ref: Date): { from: string; to: string; start: Date; end: Date } {
  const y = ref.getFullYear();
  const m = ref.getMonth();
  const start = new Date(y, m, 1, 0, 0, 0, 0);
  const end = new Date(y, m + 1, 0, 23, 59, 59, 999);
  return {
    from: localDateKey(start),
    to: localDateKey(end),
    start,
    end,
  };
}

function previousMonth(ref: Date): Date {
  return new Date(ref.getFullYear(), ref.getMonth() - 1, 15);
}

function dayBounds(day: string): { start: Date; end: Date } {
  const [y, m, d] = day.split('-').map(Number);
  return {
    start: new Date(y, m - 1, d, 0, 0, 0, 0),
    end: new Date(y, m - 1, d, 23, 59, 59, 999),
  };
}

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return h * 60 + m;
}

function sessionStatus(
  startAt: Date,
  endAt: Date | null | undefined,
  cancelled: boolean,
  now: Date,
): FloorStaffHomeSession['status'] {
  if (cancelled) return 'CANCELLED';
  const end = endAt ?? new Date(startAt.getTime() + 60 * 60_000);
  if (now < startAt) return 'UPCOMING';
  if (now <= end) return 'IN_PROGRESS';
  return 'DONE';
}

function metric(
  label: string,
  value: number | null,
  previous: number | null,
  unit?: string,
): FloorStaffMonthMetric {
  return { label, value, previous, unit };
}

@Injectable()
export class FloorStaffHomeService {
  constructor(private readonly prisma: PrismaService) {}

  async getSpecialistHome(user: JwtPayload): Promise<FloorStaffHome> {
    const clubId = requireClubId(user);
    const now = new Date();
    const today = localDateKey(now);
    const { start: dayStart, end: dayEnd } = dayBounds(today);
    const cur = monthBounds(now);
    const prev = monthBounds(previousMonth(now));

    const me = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { firstName: true, lastName: true },
    });
    const staffName = `${me?.firstName ?? ''} ${me?.lastName ?? ''}`.trim();

    const activeStatuses: SpaBookingStatus[] = [
      SpaBookingStatus.CONFIRMED,
      SpaBookingStatus.COMPLETED,
      SpaBookingStatus.PENDING_1C,
    ];

    const [todayBookings, monthBookings, prevBookings, workSlots, waitlistCount, approvals] =
      await Promise.all([
        this.prisma.spaBooking.findMany({
          where: {
            clubId,
            specialistId: user.sub,
            startAt: { gte: dayStart, lte: dayEnd },
            status: { in: activeStatuses },
          },
          include: {
            service: { select: { name: true } },
            client: { select: { firstName: true, lastName: true } },
          },
          orderBy: { startAt: 'asc' },
        }),
        this.prisma.spaBooking.findMany({
          where: {
            clubId,
            specialistId: user.sub,
            status: SpaBookingStatus.COMPLETED,
            startAt: { gte: cur.start, lte: cur.end },
          },
          select: {
            id: true,
            startAt: true,
            endAt: true,
            clientId: true,
            clientExternalId: true,
            guestPhone: true,
            paymentType: true,
            partnerSource: true,
          },
        }),
        this.prisma.spaBooking.findMany({
          where: {
            clubId,
            specialistId: user.sub,
            status: SpaBookingStatus.COMPLETED,
            startAt: { gte: prev.start, lte: prev.end },
          },
          select: {
            id: true,
            startAt: true,
            endAt: true,
            clientId: true,
            clientExternalId: true,
            guestPhone: true,
            paymentType: true,
            partnerSource: true,
          },
        }),
        this.prisma.specialistWorkSlot.findMany({
          where: { specialistId: user.sub },
          orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        }),
        this.prisma.spaWaitlistEntry.count({
          where: {
            clubId,
            specialistId: user.sub,
            status: SpaWaitlistStatus.WAITING,
            desiredStartAt: { gte: dayStart },
          },
        }),
        this.prisma.sessionApproval.findMany({
          where: {
            clubId,
            kind: SessionApprovalKind.SPA,
          },
          select: {
            bookingId: true,
            performerConfirmedAt: true,
            adminApprovedAt: true,
            overrideApprovedAt: true,
          },
        }),
      ]);

    const sessions: FloorStaffHomeSession[] = todayBookings.map((b) => {
      const clientName = b.client
        ? `${b.client.firstName} ${b.client.lastName}`.trim()
        : b.guestName || 'Гость';
      return {
        id: b.id,
        sessionKey: `fitgo:SPA:${b.id}`,
        title: b.service.name,
        startAt: b.startAt.toISOString(),
        endAt: b.endAt.toISOString(),
        subtitle: clientName,
        status: sessionStatus(b.startAt, b.endAt, false, now),
      };
    });

    const next =
      sessions.find((s) => s.status === 'IN_PROGRESS' || s.status === 'UPCOMING') ??
      null;

    // Control: past bookings without performer confirm
    const pastCutoff = now;
    const pastBookings = await this.prisma.spaBooking.findMany({
      where: {
        clubId,
        specialistId: user.sub,
        endAt: { lte: pastCutoff },
        status: { in: [SpaBookingStatus.CONFIRMED, SpaBookingStatus.COMPLETED] },
        startAt: { gte: new Date(now.getTime() - 45 * 86400_000) },
      },
      include: {
        service: { select: { name: true } },
        client: { select: { firstName: true, lastName: true } },
      },
      orderBy: { startAt: 'asc' },
      take: 200,
    });

    const approvalByBooking = new Map(
      approvals.map((a) => [a.bookingId, a]),
    );

    const pendingMeItems: FloorStaffControlItem[] = [];
    let pendingAdmin = 0;
    for (const b of pastBookings) {
      const row = approvalByBooking.get(b.id);
      if (row?.overrideApprovedAt || row?.adminApprovedAt) continue;
      if (row?.performerConfirmedAt) {
        pendingAdmin++;
        continue;
      }
      const clientName = b.client
        ? `${b.client.firstName} ${b.client.lastName}`.trim()
        : b.guestName || 'Гость';
      pendingMeItems.push({
        sessionKey: `fitgo:SPA:${b.id}`,
        title: b.service.name,
        startAt: b.startAt.toISOString(),
        subtitle: clientName,
      });
    }

    const spaMonth = (list: typeof monthBookings) => {
      const servicesTotal = list.length;
      const days = new Set(list.map((b) => localDateKey(b.startAt)));
      const avgPerWorkDay =
        days.size > 0
          ? Math.round((servicesTotal / days.size) * 10) / 10
          : 0;
      let bookedMins = 0;
      for (const b of list) {
        bookedMins += Math.max(
          0,
          Math.round((b.endAt.getTime() - b.startAt.getTime()) / 60_000),
        );
      }
      // Scheduled minutes: work slots × calendar days in month matching weekday
      let scheduledMins = 0;
      const cursor = new Date(list === monthBookings ? cur.start : prev.start);
      const endBound = list === monthBookings ? cur.end : prev.end;
      while (cursor <= endBound) {
        const dow = cursor.getDay();
        for (const slot of workSlots.filter((s) => s.dayOfWeek === dow)) {
          scheduledMins += Math.max(
            0,
            hmToMinutes(slot.endTime) - hmToMinutes(slot.startTime),
          );
        }
        cursor.setDate(cursor.getDate() + 1);
      }
      const utilPct =
        scheduledMins > 0
          ? Math.round((bookedMins / scheduledMins) * 1000) / 10
          : null;

      const clientKey = (b: (typeof list)[0]) =>
        b.clientId ??
        b.clientExternalId ??
        (b.guestPhone ? `phone:${b.guestPhone}` : null);

      // New clients in this period (first ever completed booking in period)
      // Use all completed history for first-seen — approximate with both months + today
      return { servicesTotal, avgPerWorkDay, utilPct, clientKey };
    };

    // For repeat % need history — load first booking dates for clients in period
    const historyStart = new Date(prev.start.getTime() - 90 * 86400_000);
    const history = await this.prisma.spaBooking.findMany({
      where: {
        clubId,
        specialistId: user.sub,
        status: SpaBookingStatus.COMPLETED,
        startAt: { gte: historyStart, lte: cur.end },
      },
      select: {
        clientId: true,
        clientExternalId: true,
        guestPhone: true,
        startAt: true,
      },
      orderBy: { startAt: 'asc' },
    });

    const firstByClient = new Map<string, Date>();
    const clientKeyH = (b: (typeof history)[0]) =>
      b.clientId ??
      b.clientExternalId ??
      (b.guestPhone ? `phone:${b.guestPhone}` : null);
    for (const b of history) {
      const key = clientKeyH(b);
      if (!key || firstByClient.has(key)) continue;
      firstByClient.set(key, b.startAt);
    }

    const spaPeriodStats = (
      list: typeof monthBookings,
      start: Date,
      end: Date,
    ) => {
      const base = spaMonth(list);
      let quota = 0;
      let paid = 0;
      for (const b of list) {
        if (b.paymentType === SpaPaymentType.QUOTA) quota++;
        else if (b.paymentType === SpaPaymentType.PAID) paid++;
      }
      const newClients: string[] = [];
      for (const [key, first] of firstByClient) {
        if (first >= start && first <= end) newClients.push(key);
      }
      let repeats = 0;
      for (const key of newClients) {
        const first = firstByClient.get(key)!;
        const winEnd = new Date(first.getTime() + 60 * 86400_000);
        const has = history.some((b) => {
          const ck = clientKeyH(b);
          return ck === key && b.startAt > first && b.startAt <= winEnd;
        });
        if (has) repeats++;
      }
      const repeatPct =
        newClients.length > 0
          ? Math.round((repeats / newClients.length) * 1000) / 10
          : null;
      return { ...base, quota, paid, newClients: newClients.length, repeatPct };
    };

    const curStats = spaPeriodStats(monthBookings, cur.start, cur.end);
    const prevStats = spaPeriodStats(prevBookings, prev.start, prev.end);

    // Free windows today
    const dow = now.getDay();
    const todaySlots = workSlots.filter((s) => s.dayOfWeek === dow);
    const freeWindowsToday = this.computeFreeWindows(
      today,
      todaySlots.map((s) => ({
        startTime: s.startTime,
        endTime: s.endTime,
      })),
      todayBookings.map((b) => ({ startAt: b.startAt, endAt: b.endAt })),
    );

    return {
      role: 'SPECIALIST',
      staffName,
      today: {
        date: today,
        count: sessions.length,
        next,
        sessions,
      },
      control: {
        pendingMe: pendingMeItems.length,
        pendingAdmin,
        queue: pendingMeItems.slice(0, 3),
      },
      month: {
        from: cur.from,
        to: cur.to,
        previousFrom: prev.from,
        previousTo: prev.to,
        metrics: [
          metric(
            'Услуг',
            curStats.servicesTotal,
            prevStats.servicesTotal,
            'шт.',
          ),
          metric(
            'Среднее / раб. день',
            curStats.avgPerWorkDay,
            prevStats.avgPerWorkDay,
          ),
          metric(
            'Загрузка окон',
            curStats.utilPct,
            prevStats.utilPct,
            '%',
          ),
          metric(
            'Новые → повтор',
            curStats.repeatPct,
            prevStats.repeatPct,
            '%',
          ),
        ],
        footnote:
          curStats.servicesTotal > 0
            ? `Квота ${curStats.quota} · Оплата ${curStats.paid} · Новых ${curStats.newClients}`
            : undefined,
      },
      spa: {
        freeWindowsToday,
        waitlistCount,
      },
    };
  }

  async getGpTrainerHome(user: JwtPayload): Promise<FloorStaffHome> {
    const clubId = requireClubId(user);
    const now = new Date();
    const today = localDateKey(now);
    const { start: dayStart, end: dayEnd } = dayBounds(today);
    const cur = monthBounds(now);
    const prev = monthBounds(previousMonth(now));

    const me = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: {
        firstName: true,
        lastName: true,
        externalId: true,
        groupPrograms: true,
      },
    });
    if (!me?.groupPrograms) {
      throw new ForbiddenException('Доступно только тренерам групповых программ');
    }
    const staffName = `${me.firstName} ${me.lastName}`.trim();
    const externalId = me.externalId;
    if (!externalId) {
      return this.emptyGpHome(staffName, today, cur, prev);
    }

    const [todaySessions, curSessions, prevSessions, slots] = await Promise.all([
      this.prisma.onexClassSession.findMany({
        where: {
          clubId,
          isActive: true,
          kind: OnexClassKind.GROUP,
          employeeExternalId: externalId,
          startAt: { gte: dayStart, lte: dayEnd },
        },
        orderBy: { startAt: 'asc' },
      }),
      this.prisma.onexClassSession.findMany({
        where: {
          clubId,
          isActive: true,
          kind: OnexClassKind.GROUP,
          employeeExternalId: externalId,
          startAt: { gte: cur.start, lte: cur.end },
        },
        select: {
          externalId: true,
          status: true,
          title: true,
          attendedCount: true,
          bookedCount: true,
          capacity: true,
          members: {
            select: { attendance: true, cancelled: true },
          },
        },
      }),
      this.prisma.onexClassSession.findMany({
        where: {
          clubId,
          isActive: true,
          kind: OnexClassKind.GROUP,
          employeeExternalId: externalId,
          startAt: { gte: prev.start, lte: prev.end },
        },
        select: {
          externalId: true,
          status: true,
          title: true,
          attendedCount: true,
          bookedCount: true,
          capacity: true,
          members: {
            select: { attendance: true, cancelled: true },
          },
        },
      }),
      this.prisma.clubScheduleSlot.findMany({
        where: {
          clubId,
          startAt: { gte: prev.start, lte: cur.end },
        },
        select: { externalId: true, capacity: true },
      }),
    ]);

    const cap = new Map(slots.map((s) => [s.externalId, s.capacity]));

    const sessions: FloorStaffHomeSession[] = todaySessions.map((s) => ({
      id: s.id,
      sessionKey: `1c:${s.externalId}`,
      title: s.title,
      startAt: s.startAt.toISOString(),
      endAt: s.endAt?.toISOString(),
      subtitle: s.roomTitle ?? undefined,
      booked: s.bookedCount,
      capacity: s.capacity ?? cap.get(s.externalId) ?? undefined,
      status: sessionStatus(
        s.startAt,
        s.endAt,
        s.status === OnexClassStatus.CANCELLED,
        now,
      ),
    }));

    const next =
      sessions.find((s) => s.status === 'IN_PROGRESS' || s.status === 'UPCOMING') ??
      null;

    // Control queue — past sessions without trainer approval
    const pastSessions = await this.prisma.onexClassSession.findMany({
      where: {
        clubId,
        isActive: true,
        kind: OnexClassKind.GROUP,
        employeeExternalId: externalId,
        status: { not: OnexClassStatus.CANCELLED },
        startAt: {
          gte: new Date(now.getTime() - 45 * 86400_000),
          lte: now,
        },
      },
      orderBy: { startAt: 'asc' },
      take: 200,
    });

    const sessionKeys = pastSessions.map((s) => `1c:${s.externalId}`);
    const approvals = sessionKeys.length
      ? await this.prisma.groupClassApproval.findMany({
          where: { clubId, sessionKey: { in: sessionKeys } },
        })
      : [];
    const approvalMap = new Map(approvals.map((a) => [a.sessionKey, a]));

    const pendingMeItems: FloorStaffControlItem[] = [];
    let pendingAdmin = 0;
    for (const s of pastSessions) {
      if (s.status === OnexClassStatus.SCHEDULED && s.endAt && s.endAt > now) {
        continue;
      }
      const key = `1c:${s.externalId}`;
      const a = approvalMap.get(key);
      if (a?.overrideApprovedAt || a?.adminApprovedAt) continue;
      if (a?.trainerApprovedAt) {
        pendingAdmin++;
        continue;
      }
      pendingMeItems.push({
        sessionKey: key,
        title: s.title,
        startAt: s.startAt.toISOString(),
        subtitle: s.roomTitle ?? undefined,
      });
    }

    const gpStats = (list: typeof curSessions) => {
      const completed = list.filter(
        (s) => s.status === OnexClassStatus.COMPLETED,
      );
      const cancelled = list.filter(
        (s) => s.status === OnexClassStatus.CANCELLED,
      ).length;
      let attendedSum = 0;
      let fillSum = 0;
      let fillN = 0;
      let noShow = 0;
      const byTitle = new Map<string, number>();
      for (const s of completed) {
        attendedSum += s.attendedCount;
        const c = s.capacity ?? cap.get(s.externalId) ?? 0;
        if (c > 0) {
          fillSum += (s.attendedCount / c) * 100;
          fillN++;
        }
        byTitle.set(s.title, (byTitle.get(s.title) ?? 0) + 1);
        for (const m of s.members) {
          if (m.attendance === OnexClassMemberAttendance.NO_SHOW) noShow++;
        }
      }
      const memberTotal = completed.reduce((a, s) => a + s.members.length, 0);
      const top = [...byTitle.entries()].sort((a, b) => b[1] - a[1])[0];
      return {
        sessionsConducted: completed.length,
        avgAttendees:
          completed.length > 0
            ? Math.round((attendedSum / completed.length) * 10) / 10
            : 0,
        avgFillPct: fillN > 0 ? Math.round(fillSum / fillN) : null,
        cancelledSessions: cancelled,
        noShowPct:
          memberTotal > 0
            ? Math.round((noShow / memberTotal) * 1000) / 10
            : null,
        topTitle: top ? `${top[0]} × ${top[1]}` : undefined,
      };
    };

    const curStats = gpStats(curSessions);
    const prevStats = gpStats(prevSessions);

    return {
      role: 'GROUP_TRAINER',
      staffName,
      today: {
        date: today,
        count: sessions.filter((s) => s.status !== 'CANCELLED').length,
        next,
        sessions,
      },
      control: {
        pendingMe: pendingMeItems.length,
        pendingAdmin,
        queue: pendingMeItems.slice(0, 3),
      },
      month: {
        from: cur.from,
        to: cur.to,
        previousFrom: prev.from,
        previousTo: prev.to,
        metrics: [
          metric(
            'Занятий',
            curStats.sessionsConducted,
            prevStats.sessionsConducted,
            'шт.',
          ),
          metric(
            'Средняя явка',
            curStats.avgAttendees,
            prevStats.avgAttendees,
            'чел.',
          ),
          metric(
            'Заполняемость',
            curStats.avgFillPct,
            prevStats.avgFillPct,
            '%',
          ),
        ],
        footnote: [
          curStats.cancelledSessions > 0
            ? `Отмен ${curStats.cancelledSessions}`
            : null,
          curStats.noShowPct != null ? `Неявки ${curStats.noShowPct}%` : null,
          curStats.topTitle ? `Чаще всего: ${curStats.topTitle}` : null,
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
      },
    };
  }

  private emptyGpHome(
    staffName: string,
    today: string,
    cur: ReturnType<typeof monthBounds>,
    prev: ReturnType<typeof monthBounds>,
  ): FloorStaffHome {
    return {
      role: 'GROUP_TRAINER',
      staffName,
      today: { date: today, count: 0, next: null, sessions: [] },
      control: { pendingMe: 0, pendingAdmin: 0, queue: [] },
      month: {
        from: cur.from,
        to: cur.to,
        previousFrom: prev.from,
        previousTo: prev.to,
        metrics: [
          metric('Занятий', 0, 0, 'шт.'),
          metric('Средняя явка', 0, 0, 'чел.'),
          metric('Заполняемость', null, null, '%'),
        ],
      },
    };
  }

  private computeFreeWindows(
    day: string,
    slots: Array<{ startTime: string; endTime: string }>,
    bookings: Array<{ startAt: Date; endAt: Date }>,
  ): FloorStaffFreeWindow[] {
    if (!slots.length) return [];
    const { start: dayStart } = dayBounds(day);
    const busy = bookings
      .map((b) => ({
        start: Math.round((b.startAt.getTime() - dayStart.getTime()) / 60_000),
        end: Math.round((b.endAt.getTime() - dayStart.getTime()) / 60_000),
      }))
      .sort((a, b) => a.start - b.start);

    const windows: FloorStaffFreeWindow[] = [];
    const minGap = 30;

    for (const slot of slots) {
      let cursor = hmToMinutes(slot.startTime);
      const slotEnd = hmToMinutes(slot.endTime);
      const overlapping = busy.filter(
        (b) => b.end > cursor && b.start < slotEnd,
      );
      for (const b of overlapping) {
        if (b.start - cursor >= minGap) {
          const startMin = cursor;
          const endMin = b.start;
          const startAt = new Date(dayStart.getTime() + startMin * 60_000);
          const endAt = new Date(dayStart.getTime() + endMin * 60_000);
          windows.push({
            startAt: startAt.toISOString(),
            endAt: endAt.toISOString(),
            minutes: endMin - startMin,
          });
        }
        cursor = Math.max(cursor, b.end);
      }
      if (slotEnd - cursor >= minGap) {
        const startAt = new Date(dayStart.getTime() + cursor * 60_000);
        const endAt = new Date(dayStart.getTime() + slotEnd * 60_000);
        windows.push({
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          minutes: slotEnd - cursor,
        });
      }
    }

    // Prefer upcoming/current free windows
    const now = Date.now();
    return windows
      .filter((w) => new Date(w.endAt).getTime() > now)
      .slice(0, 4);
  }
}
