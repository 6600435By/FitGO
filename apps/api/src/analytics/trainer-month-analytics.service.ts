import { Injectable } from '@nestjs/common';
import {
  OnexClassKind,
  OnexClassMemberAttendance,
  OnexClassStatus,
  StaffEmploymentKind,
  StaffShiftTrack,
} from '@prisma/client';
import {
  allPaySlices,
  computeGiftToPaidConversion,
  controlClientKey,
  DEFAULT_PT_TIERS,
  isConductedControlRow,
  isReformerPersonalTitle,
  resolveLadderProgress,
  sameDayPreviousMonthWindow,
  summarizeConductedItems,
  type BookingControlListItem,
  type GiftConversionEvent,
  type StaffPayProfile,
  type TrainerMonthAnalytics,
} from '@fitgo/shared-types';
import { isLikelyTrainingProductName } from '../admin-sales/admin-sales-segments';
import { isHiddenFromTrainerBookingControl } from '../admin-sales/trainer-pt-sales-from-revenue';
import { BookingControlService } from '../booking-control/booking-control.service';
import { PayrollService } from '../payroll/payroll.service';
import { PrismaService } from '../prisma/prisma.service';

function avgOrNull(sum: number, n: number): number | null {
  if (n <= 0) return null;
  return Math.round((sum / n) * 10) / 10;
}

function fillOrNull(sum: number, n: number): number | null {
  if (n <= 0) return null;
  return Math.round(sum / n);
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

@Injectable()
export class TrainerMonthAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookingControl: BookingControlService,
    private readonly payroll: PayrollService,
  ) {}

  /**
   * Month-to-date analytics for one trainer. Uses booking-control list
   * (no live 1C) so card counts match deep-links.
   */
  async forTrainer(
    clubId: string,
    trainerId: string,
    from: string,
    to: string,
    opts?: { showReformer?: boolean },
  ): Promise<TrainerMonthAnalytics> {
    const { previousFrom, previousTo } = sameDayPreviousMonthWindow(from, to);

    const [curItems, prevItems, syncState, trainer] = await Promise.all([
      this.loadConducted(clubId, trainerId, from, to),
      this.loadConducted(clubId, trainerId, previousFrom, previousTo),
      this.prisma.salesSyncState.findUnique({
        where: {
          clubId_resourceKey: { clubId, resourceKey: 'class_sessions' },
        },
        select: { lastSuccessAt: true },
      }),
      this.prisma.user.findFirst({
        where: { id: trainerId, clubId },
        select: {
          employmentKind: true,
          trainerReformers: true,
          trainerStaff: true,
          trainerClub: true,
        },
      }),
    ]);

    const cur = summarizeConductedItems(curItems);
    const prev = summarizeConductedItems(prevItems);

    const [curUniqueGp, prevUniqueGp, curFill, prevFill] = await Promise.all([
      this.uniqueGroupClients(clubId, trainerId, from, to),
      this.uniqueGroupClients(clubId, trainerId, previousFrom, previousTo),
      this.groupFillFromOnex(clubId, trainerId, from, to),
      this.groupFillFromOnex(clubId, trainerId, previousFrom, previousTo),
    ]);

    const uniquePt = cur.uniquePt.size;
    const uniqueGp = curUniqueGp.size;
    const uniqueTotal = new Set([...cur.uniquePt, ...curUniqueGp]).size;
    const prevUniqueTotal = new Set([
      ...prev.uniquePt,
      ...prevUniqueGp,
    ]).size;

    const showReformer =
      opts?.showReformer ||
      Boolean(trainer?.trainerReformers) ||
      cur.reformerGroup > 0 ||
      cur.reformerPersonal > 0 ||
      prev.reformerGroup > 0 ||
      prev.reformerPersonal > 0;

    const hasPtTrack = Boolean(trainer?.trainerStaff || trainer?.trainerClub);

    const [shiftHours, previousShiftHours, giftConversion, ladder] =
      await Promise.all([
        this.shiftHoursIfStaff(
          clubId,
          trainerId,
          from,
          to,
          trainer?.employmentKind,
        ),
        this.shiftHoursIfStaff(
          clubId,
          trainerId,
          previousFrom,
          previousTo,
          trainer?.employmentKind,
        ),
        this.giftConversion(
          clubId,
          from,
          to,
          previousFrom,
          previousTo,
          curItems,
          prevItems,
        ),
        hasPtTrack
          ? this.ladderForTrainer(clubId, trainerId, to)
          : Promise.resolve(null),
      ]);

    return {
      from,
      to,
      previousFrom,
      previousTo,
      pt: {
        count: cur.pt,
        previous: prev.pt,
        gift: cur.gift,
        previousGift: prev.gift,
        reformerPersonal: cur.reformerPersonal,
      },
      group: {
        count: cur.group,
        previous: prev.group,
        avgAttendees: avgOrNull(cur.groupAttendedSum, cur.group),
        previousAvgAttendees: avgOrNull(prev.groupAttendedSum, prev.group),
        avgFillPct: curFill ?? fillOrNull(cur.groupFillSum, cur.groupFillN),
        previousAvgFillPct:
          prevFill ?? fillOrNull(prev.groupFillSum, prev.groupFillN),
      },
      gift: { count: cur.gift, previous: prev.gift },
      reformer: showReformer
        ? {
            group: cur.reformerGroup,
            previousGroup: prev.reformerGroup,
            personal: cur.reformerPersonal,
            previousPersonal: prev.reformerPersonal,
          }
        : null,
      uniqueClients: {
        total: uniqueTotal,
        previous: prevUniqueTotal,
        pt: uniquePt,
        group: uniqueGp,
      },
      shiftHours,
      previousShiftHours,
      giftConversion,
      ladder,
      syncedAt: syncState?.lastSuccessAt?.toISOString() ?? null,
    };
  }

  /** Extras for staff analytics row (selected period, no previous window). */
  async extrasForPeriod(
    clubId: string,
    trainerId: string,
    from: string,
    to: string,
  ): Promise<{
    giftToPaid: {
      giftedClients: number;
      convertedClients: number;
      pct: number | null;
    };
    ladder: {
      volumeCount: number;
      percent: number;
      remaining: number | null;
      isTop: boolean;
    } | null;
    reformerGroupSessions: number;
    reformerPersonalSessions: number;
  }> {
    const items = await this.loadConducted(clubId, trainerId, from, to);
    const slice = summarizeConductedItems(items);
    const giftToPaid = await this.giftConversion(
      clubId,
      from,
      to,
      from,
      to,
      items,
      [],
    );
    const ladder = await this.ladderForTrainer(clubId, trainerId, to);
    return {
      giftToPaid: giftToPaid
        ? {
            giftedClients: giftToPaid.giftedClients,
            convertedClients: giftToPaid.convertedClients,
            pct: giftToPaid.pct,
          }
        : { giftedClients: 0, convertedClients: 0, pct: null },
      ladder,
      reformerGroupSessions: slice.reformerGroup,
      reformerPersonalSessions: slice.reformerPersonal,
    };
  }

  private async loadConducted(
    clubId: string,
    trainerId: string,
    from: string,
    to: string,
  ): Promise<BookingControlListItem[]> {
    const items = await this.bookingControl.list(clubId, {
      from,
      to,
      performerId: trainerId,
      status: 'COMPLETED',
      skipExternal: true,
      excludeKinds: ['SPA', 'SOLARIUM'],
    });
    return items.filter(
      (i) =>
        isConductedControlRow(i) &&
        (i.kind === 'PT' || i.kind === 'GROUP') &&
        !isHiddenFromTrainerBookingControl(i),
    );
  }

  private async performerCodes(
    clubId: string,
    trainerId: string,
  ): Promise<string[]> {
    const trainer = await this.prisma.user.findFirst({
      where: { id: trainerId, clubId },
      select: { externalId: true, employeeCode: true },
    });
    return [
      ...new Set(
        [trainer?.externalId, trainer?.employeeCode]
          .map((c) => c?.trim())
          .filter((c): c is string => !!c),
      ),
    ];
  }

  private async uniqueGroupClients(
    clubId: string,
    trainerId: string,
    from: string,
    to: string,
  ): Promise<Set<string>> {
    const codes = await this.performerCodes(clubId, trainerId);
    if (!codes.length) return new Set();
    const fromD = new Date(`${from}T00:00:00`);
    const toD = new Date(`${to}T23:59:59.999`);
    const sessions = await this.prisma.onexClassSession.findMany({
      where: {
        clubId,
        kind: OnexClassKind.GROUP,
        status: OnexClassStatus.COMPLETED,
        isActive: true,
        employeeExternalId: { in: codes },
        startAt: { gte: fromD, lte: toD },
      },
      select: {
        members: {
          where: {
            cancelled: false,
            attendance: OnexClassMemberAttendance.ATTENDED,
          },
          select: { externalId: true, clientName: true },
        },
      },
    });
    const keys = new Set<string>();
    for (const s of sessions) {
      for (const m of s.members) {
        const ext = m.externalId?.trim();
        if (ext) keys.add(`id:${ext}`);
        else if (m.clientName?.trim()) {
          keys.add(`name:${m.clientName.trim().toLowerCase()}`);
        }
      }
    }
    return keys;
  }

  private async groupFillFromOnex(
    clubId: string,
    trainerId: string,
    from: string,
    to: string,
  ): Promise<number | null> {
    const codes = await this.performerCodes(clubId, trainerId);
    if (!codes.length) return null;
    const fromD = new Date(`${from}T00:00:00`);
    const toD = new Date(`${to}T23:59:59.999`);
    const sessions = await this.prisma.onexClassSession.findMany({
      where: {
        clubId,
        kind: OnexClassKind.GROUP,
        status: OnexClassStatus.COMPLETED,
        isActive: true,
        employeeExternalId: { in: codes },
        startAt: { gte: fromD, lte: toD },
      },
      select: { attendedCount: true, capacity: true },
    });
    let fillSum = 0;
    let fillN = 0;
    for (const s of sessions) {
      if (s.capacity && s.capacity > 0) {
        fillSum += (s.attendedCount / s.capacity) * 100;
        fillN += 1;
      }
    }
    return fillOrNull(fillSum, fillN);
  }

  private async shiftHoursIfStaff(
    clubId: string,
    trainerId: string,
    from: string,
    to: string,
    employmentKind?: StaffEmploymentKind | null,
  ): Promise<number | null> {
    if (employmentKind !== StaffEmploymentKind.STAFF) return null;
    const fromD = new Date(`${from}T00:00:00`);
    const toD = new Date(`${to}T23:59:59.999`);
    const shifts = await this.prisma.staffShift.findMany({
      where: {
        clubId,
        userId: trainerId,
        track: StaffShiftTrack.TRAINER,
        date: { gte: fromD, lte: toD },
      },
      select: { startAt: true, endAt: true, overtimeMinutes: true },
    });
    if (!shifts.length) return null;
    let minutes = 0;
    for (const s of shifts) {
      minutes += Math.max(
        0,
        Math.round((s.endAt.getTime() - s.startAt.getTime()) / 60_000),
      );
      minutes += s.overtimeMinutes ?? 0;
    }
    return Math.round((minutes / 60) * 10) / 10;
  }

  private async giftConversion(
    clubId: string,
    from: string,
    to: string,
    prevFrom: string,
    prevTo: string,
    curItems: BookingControlListItem[],
    prevItems: BookingControlListItem[],
  ): Promise<TrainerMonthAnalytics['giftConversion']> {
    const curEvents = await this.giftEvents(clubId, from, to, curItems);
    const cur = computeGiftToPaidConversion(curEvents);
    const prevEvents =
      prevItems.length > 0
        ? await this.giftEvents(clubId, prevFrom, prevTo, prevItems)
        : [];
    const prev = computeGiftToPaidConversion(prevEvents);
    if (cur.giftedClients === 0 && prev.giftedClients === 0) return null;
    return {
      giftedClients: cur.giftedClients,
      convertedClients: cur.convertedClients,
      pct: cur.pct,
      previousPct: prev.giftedClients > 0 ? prev.pct : null,
    };
  }

  /** Prefer FIO so 1C sales and FitGO/1C sessions share a key. */
  private conversionClientKey(input: {
    clientName?: string | null;
    clientId?: string | null;
    clientExternalId?: string | null;
  }): string | null {
    const name = input.clientName?.trim().toLowerCase();
    if (name) return `name:${name}`;
    const ext = input.clientExternalId?.trim();
    if (ext) return `1c:${ext}`;
    const id = input.clientId?.trim();
    if (id) return `fitgo:${id}`;
    return null;
  }

  private async giftEvents(
    clubId: string,
    from: string,
    to: string,
    items: BookingControlListItem[],
  ): Promise<GiftConversionEvent[]> {
    const events: GiftConversionEvent[] = [];
    const giftClientKeys = new Set<string>();
    for (const i of items) {
      if (i.kind !== 'PT') continue;
      const payment = i.payment;
      if (
        payment !== 'GIFT' &&
        payment !== 'PAID' &&
        payment !== 'QUOTA'
      ) {
        continue;
      }
      const key =
        this.conversionClientKey(i) ?? controlClientKey(i);
      if (payment === 'GIFT') giftClientKeys.add(key);
      events.push({
        clientKey: key,
        at: new Date(i.startAt),
        payment,
      });
    }

    if (giftClientKeys.size === 0) return events;

    const fromD = new Date(`${from}T00:00:00`);
    const toD = new Date(`${to}T23:59:59.999`);
    const sales = await this.prisma.clubRevenueEntry.findMany({
      where: {
        clubId,
        isActive: true,
        occurredAt: { gte: fromD, lte: toD },
        OR: [{ amount: { gt: 0 } }, { saleAmount: { gt: 0 } }],
      },
      select: {
        clientExternalId: true,
        clientName: true,
        productName: true,
        occurredAt: true,
        amount: true,
        saleAmount: true,
      },
    });
    for (const s of sales) {
      const name = s.productName ?? '';
      const isTrain =
        isLikelyTrainingProductName(name) ||
        isReformerPersonalTitle(name);
      if (!isTrain) continue;
      const amt = Number(s.saleAmount) || Number(s.amount) || 0;
      if (amt <= 0) continue;
      const clientKey = this.conversionClientKey(s);
      if (!clientKey || !giftClientKeys.has(clientKey)) continue;
      events.push({
        clientKey,
        at: s.occurredAt,
        payment: 'SALE',
      });
    }
    return events;
  }

  private async ladderForTrainer(
    clubId: string,
    trainerId: string,
    to: string,
  ): Promise<TrainerMonthAnalytics['ladder']> {
    const [y, m] = to.split('-').map(Number);
    const monthFrom = `${y}-${pad2(m)}-01`;
    const monthEnd = new Date(y, m, 0);
    const monthTo = `${monthEnd.getFullYear()}-${pad2(monthEnd.getMonth() + 1)}-${pad2(monthEnd.getDate())}`;
    const rangeTo = to < monthTo ? to : monthTo;

    try {
      const { units, profile } = await this.payroll.listPtUnitsWithMonthLadder(
        clubId,
        trainerId,
        monthFrom,
        rangeTo,
      );
      const payProfile = profile as StaffPayProfile | undefined;
      const slices = allPaySlices(payProfile);
      const ptSlice = slices.find(
        (s) => s.track === 'PT' || s.track === 'CLUB',
      );
      if (!ptSlice && !units.some((u) => u.kind === 'PT')) return null;

      const hasReformerScheme = slices.some((s) => s.track === 'REFORMER');
      const trustedPt = units.filter(
        (x) =>
          x.payrollTrusted &&
          x.kind === 'PT' &&
          !x.isPtAllSports &&
          !(hasReformerScheme && x.isReformerPersonal) &&
          !(hasReformerScheme && x.roomKey === 'REFORMER') &&
          !(x.roomKey === 'REFORMER' && x.isReformerPersonal),
      );
      const tiers = ptSlice?.ptPercentTiers?.length
        ? ptSlice.ptPercentTiers
        : DEFAULT_PT_TIERS;
      return resolveLadderProgress(trustedPt.length, tiers);
    } catch {
      return null;
    }
  }
}
