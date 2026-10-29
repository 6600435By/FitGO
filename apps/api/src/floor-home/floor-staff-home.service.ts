import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  OnexClassKind,
  OnexClassMemberAttendance,
  OnexClassStatus,
  PersonalBookingStatus,
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
import { isReformerHallSession } from '@fitgo/shared-types';
import {
  isGymFloorSessionTitle,
  isSolariumSessionTitle,
} from '../admin-sales/trainer-pt-sales-from-revenue';
import { TrainerMonthAnalyticsService } from '../analytics/trainer-month-analytics.service';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { PrismaService } from '../prisma/prisma.service';
import { sameDayPreviousMonthWindow } from '@fitgo/shared-types';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly trainerMonth: TrainerMonthAnalyticsService,
  ) {}

  async getSpecialistHome(user: JwtPayload): Promise<FloorStaffHome> {
    const clubId = requireClubId(user);
    const now = new Date();
    const today = localDateKey(now);
    const { start: dayStart, end: dayEnd } = dayBounds(today);
    const cur = monthBounds(now);
    // Same day-of-month window as trainer home (fair MoM while month is open).
    const sameDayPrev = sameDayPreviousMonthWindow(cur.from, today);
    const prevStart = dayBounds(sameDayPrev.previousFrom).start;
    const prevEnd = dayBounds(sameDayPrev.previousTo).end;

    const me = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { firstName: true, lastName: true },
    });
    const staffName = `${me?.firstName ?? ''} ${me?.lastName ?? ''}`.trim();

    // Month ops stats must match the board: CONFIRMED stays until 1C consume.
    const activeStatuses: SpaBookingStatus[] = [
      SpaBookingStatus.CONFIRMED,
      SpaBookingStatus.COMPLETED,
      SpaBookingStatus.PENDING_1C,
    ];

    const bookingStatSelect = {
      id: true,
      startAt: true,
      endAt: true,
      clientId: true,
      clientExternalId: true,
      guestPhone: true,
      paymentType: true,
      partnerSource: true,
    } as const;

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
            status: { in: activeStatuses },
            startAt: { gte: cur.start, lte: dayEnd },
          },
          select: bookingStatSelect,
        }),
        this.prisma.spaBooking.findMany({
          where: {
            clubId,
            specialistId: user.sub,
            status: { in: activeStatuses },
            startAt: { gte: prevStart, lte: prevEnd },
          },
          select: bookingStatSelect,
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

    const spaMonth = (
      list: typeof monthBookings,
      periodStart: Date,
      periodEnd: Date,
    ) => {
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
      // Scheduled minutes: work slots × calendar days in period matching weekday
      let scheduledMins = 0;
      const cursor = new Date(periodStart);
      while (cursor <= periodEnd) {
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

      return { servicesTotal, avgPerWorkDay, utilPct };
    };

    // First-seen / repeat: any active booking (CONFIRMED stays until 1C consume)
    const historyStart = new Date(prevStart.getTime() - 90 * 86400_000);
    const history = await this.prisma.spaBooking.findMany({
      where: {
        clubId,
        specialistId: user.sub,
        status: { in: activeStatuses },
        startAt: { gte: historyStart, lte: dayEnd },
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
      const base = spaMonth(list, start, end);
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

    const curStats = spaPeriodStats(monthBookings, cur.start, dayEnd);
    const prevStats = spaPeriodStats(prevBookings, prevStart, prevEnd);

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
        to: today,
        previousFrom: sameDayPrev.previousFrom,
        previousTo: sameDayPrev.previousTo,
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
        employeeCode: true,
        groupPrograms: true,
        trainerReformers: true,
        trainerStaff: true,
        trainerClub: true,
      },
    });
    const isReformer = Boolean(me?.trainerReformers);
    const isGp = Boolean(me?.groupPrograms);
    const hasPt = Boolean(me?.trainerStaff || me?.trainerClub);
    if (!isGp && !isReformer && !hasPt) {
      throw new ForbiddenException(
        'Доступно тренерам групповых программ, реформеров и ПТ',
      );
    }
    const staffName = `${me?.firstName ?? ''} ${me?.lastName ?? ''}`.trim();
    const performerCodes = [
      ...new Set(
        [me?.externalId, me?.employeeCode]
          .map((c) => c?.trim())
          .filter((c): c is string => !!c),
      ),
    ];
    // FitGO PT uses trainerId — still load home when 1C codes are missing.
    if (!performerCodes.length && !hasPt) {
      return this.emptyGpHome(staffName, today, cur, prev);
    }

    const kinds: OnexClassKind[] = [];
    if (isGp || isReformer) kinds.push(OnexClassKind.GROUP);
    if (hasPt || isReformer) kinds.push(OnexClassKind.PT);
    if (!kinds.length) kinds.push(OnexClassKind.GROUP);

    const keepSession = (s: {
      kind: OnexClassKind;
      roomTitle: string | null;
      title: string;
    }) => {
      // Wrong 1C performer on solarium must not inflate trainer home / counts.
      if (
        s.kind === OnexClassKind.SOLARIUM ||
        isSolariumSessionTitle(s.title)
      ) {
        return false;
      }
      // Open gym floor — analytics only, no trainer confirm.
      if (
        s.kind === OnexClassKind.GROUP &&
        isGymFloorSessionTitle(s.title)
      ) {
        return false;
      }
      if (s.kind === OnexClassKind.PT) {
        if (hasPt) return true;
        if (isReformer) return isReformerHallSession(s.roomTitle, s.title);
        return false;
      }
      if (!isGp && !isReformer) return false;
      if (!isReformer) return true;
      if (isGp) return true;
      return isReformerHallSession(s.roomTitle, s.title);
    };

    const performerWhere = {
      clubId,
      isActive: true,
      kind: { in: kinds },
      ...(performerCodes.length
        ? { employeeExternalId: { in: performerCodes } }
        : { employeeExternalId: '__none__' }),
    };

    const monthThroughToday = { gte: cur.start, lte: dayEnd };

    const [todayRaw, curRaw, slots, todayFitgoPt] = await Promise.all([
      this.prisma.onexClassSession.findMany({
        where: {
          ...performerWhere,
          startAt: { gte: dayStart, lte: dayEnd },
        },
        orderBy: { startAt: 'asc' },
      }),
      this.prisma.onexClassSession.findMany({
        where: {
          ...performerWhere,
          startAt: monthThroughToday,
        },
        select: {
          kind: true,
          externalId: true,
          status: true,
          title: true,
          roomTitle: true,
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
          startAt: { gte: dayStart, lte: dayEnd },
        },
        select: { externalId: true, capacity: true },
      }),
      hasPt
        ? this.prisma.personalTrainingBooking.findMany({
            where: {
              trainerId: user.sub,
              status: { not: PersonalBookingStatus.CANCELLED },
              startAt: { gte: dayStart, lte: dayEnd },
            },
            include: {
              client: { select: { firstName: true, lastName: true } },
            },
            orderBy: { startAt: 'asc' },
          })
        : Promise.resolve([]),
    ]);

    const todaySessions = todayRaw.filter(keepSession);
    const curSessions = curRaw.filter(keepSession);

    const cap = new Map(slots.map((s) => [s.externalId, s.capacity]));

    const onexToday: FloorStaffHomeSession[] = todaySessions.map((s) => ({
      id: s.id,
      sessionKey: `1c:${s.externalId}`,
      title: s.title,
      startAt: s.startAt.toISOString(),
      endAt: s.endAt?.toISOString(),
      subtitle: s.roomTitle ?? undefined,
      booked: s.bookedCount,
      capacity: s.capacity ?? cap.get(s.externalId) ?? undefined,
      kind: s.kind === OnexClassKind.PT ? 'PT' : 'GROUP',
      status: sessionStatus(
        s.startAt,
        s.endAt,
        s.status === OnexClassStatus.CANCELLED,
        now,
      ),
    }));

    const fitgoToday: FloorStaffHomeSession[] = todayFitgoPt.map((b) => {
      const clientName = b.client
        ? `${b.client.firstName} ${b.client.lastName}`.trim()
        : undefined;
      return {
        id: b.id,
        sessionKey: `fitgo:PT:${b.id}`,
        title: b.isComplimentary
          ? 'Подарочная ПТ'
          : 'Персональная тренировка',
        startAt: b.startAt.toISOString(),
        endAt: b.endAt.toISOString(),
        subtitle: clientName,
        kind: 'PT' as const,
        status: sessionStatus(
          b.startAt,
          b.endAt,
          b.status === PersonalBookingStatus.CANCELLED,
          now,
        ),
      };
    });

    // Prefer Onex row when the same PT is also in FitGO (crmDocRef link).
    const onexExtToday = new Set(
      todaySessions
        .filter((s) => s.kind === OnexClassKind.PT)
        .map((s) => s.externalId),
    );
    const fitgoTodayDedup = fitgoToday.filter((s) => {
      const booking = todayFitgoPt.find((b) => b.id === s.id);
      const ref = booking?.crmDocRef?.trim();
      if (!ref) return true;
      const bare = ref.startsWith('1c:') ? ref.slice(3) : ref;
      return !onexExtToday.has(bare) && !onexExtToday.has(ref);
    });

    const sessions = [...onexToday, ...fitgoTodayDedup].sort((a, b) =>
      a.startAt.localeCompare(b.startAt),
    );

    const next =
      sessions.find((s) => s.status === 'IN_PROGRESS' || s.status === 'UPCOMING') ??
      null;

    // Control queue — only GROUP uses groupClassApproval (trainer → admin).
    // 1C PT (incl. gift) must not appear here: no trainer-confirm action, and
    // wrongly counting them made home show «9» while the card had nothing to tap.
    const pendingLookback = new Date(now.getTime() - 45 * 86400_000);
    const pastGroupRaw = await this.prisma.onexClassSession.findMany({
      where: {
        ...performerWhere,
        kind: OnexClassKind.GROUP,
        status: { not: OnexClassStatus.CANCELLED },
        startAt: {
          gte: pendingLookback,
          lte: now,
        },
      },
      orderBy: { startAt: 'asc' },
      take: 200,
    });
    const pastGroups = pastGroupRaw.filter(keepSession);

    const sessionKeys = pastGroups.map((s) => `1c:${s.externalId}`);
    const approvals = sessionKeys.length
      ? await this.prisma.groupClassApproval.findMany({
          where: { clubId, sessionKey: { in: sessionKeys } },
        })
      : [];
    const approvalMap = new Map(approvals.map((a) => [a.sessionKey, a]));

    const pendingMeItems: FloorStaffControlItem[] = [];
    let pendingAdmin = 0;
    for (const s of pastGroups) {
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

    // FitGO PT — SessionApproval (performer → admin). Skip gifts: no trainer
    // mark required (same sticky «Подарочная ПТ» that clogged the old queue).
    if (hasPt) {
      const pastPt = await this.prisma.personalTrainingBooking.findMany({
        where: {
          trainerId: user.sub,
          isComplimentary: false,
          status: { not: PersonalBookingStatus.CANCELLED },
          startAt: { gte: pendingLookback, lte: now },
          endAt: { lte: now },
        },
        include: {
          client: { select: { firstName: true, lastName: true } },
        },
        orderBy: { startAt: 'asc' },
        take: 200,
      });
      const ptIds = pastPt.map((b) => b.id);
      const ptApprovals = ptIds.length
        ? await this.prisma.sessionApproval.findMany({
            where: {
              clubId,
              kind: SessionApprovalKind.PT,
              bookingId: { in: ptIds },
            },
          })
        : [];
      const ptApprovalById = new Map(ptApprovals.map((a) => [a.bookingId, a]));
      for (const b of pastPt) {
        const row = ptApprovalById.get(b.id);
        if (row?.overrideApprovedAt || row?.adminApprovedAt) continue;
        if (row?.performerConfirmedAt) {
          pendingAdmin++;
          continue;
        }
        const clientName = b.client
          ? `${b.client.firstName} ${b.client.lastName}`.trim()
          : undefined;
        pendingMeItems.push({
          sessionKey: `fitgo:PT:${b.id}`,
          title: 'Персональная тренировка',
          startAt: b.startAt.toISOString(),
          subtitle: clientName,
        });
      }
      pendingMeItems.sort((a, b) => a.startAt.localeCompare(b.startAt));
    }

    const gpOnly = <T extends { kind: OnexClassKind }>(list: T[]) =>
      list.filter((s) => s.kind === OnexClassKind.GROUP);

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

    const curGpStats = gpStats(gpOnly(curSessions));
    const monthAnalytics = await this.trainerMonth.forTrainer(
      clubId,
      user.sub,
      cur.from,
      today,
      { showReformer: isReformer },
    );
    const sameDayPrev = sameDayPreviousMonthWindow(cur.from, today);

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
      conducted: {
        from: monthAnalytics.from,
        to: monthAnalytics.to,
        group: monthAnalytics.group.count,
        pt: monthAnalytics.pt.count,
      },
      monthAnalytics,
      month: {
        from: monthAnalytics.from,
        to: monthAnalytics.to,
        previousFrom: sameDayPrev.previousFrom,
        previousTo: sameDayPrev.previousTo,
        metrics: isGp
          ? [
              metric(
                'Средняя явка',
                monthAnalytics.group.avgAttendees,
                monthAnalytics.group.previousAvgAttendees,
                'чел.',
              ),
              metric(
                'Заполняемость',
                monthAnalytics.group.avgFillPct,
                monthAnalytics.group.previousAvgFillPct,
                '%',
              ),
            ]
          : [],
        footnote: isGp
          ? [
              curGpStats.cancelledSessions > 0
                ? `Отмен ${curGpStats.cancelledSessions}`
                : null,
              curGpStats.noShowPct != null
                ? `Неявки ${curGpStats.noShowPct}%`
                : null,
              curGpStats.topTitle ? `Чаще всего: ${curGpStats.topTitle}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || undefined
          : undefined,
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
      conducted: { from: cur.from, to: today, group: 0, pt: 0 },
      month: {
        from: cur.from,
        to: cur.to,
        previousFrom: prev.from,
        previousTo: prev.to,
        metrics: [
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
