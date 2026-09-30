import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  OnexClassKind,
  OnexClassMemberAttendance,
  OnexClassStatus,
  PersonalBookingStatus,
  SessionRemarkKind,
  SessionRemarkStatus,
  SpaBookingStatus,
} from '@prisma/client';
import { requireClubId } from '../auth/require-club-id';
import { ClassSessionsSyncService } from '../class-sync/class-sessions-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  fitgoSessionKey,
  inferPaymentFromBasis,
  inferPayTag,
  mapOnexStatusToControl,
  onexSessionKey,
  parseSessionKey,
  saleSessionKey,
  type BookingControlDetail,
  type BookingControlKind,
  type BookingControlListItem,
  type BookingControlMember,
  type BookingControlPayment,
  type BookingControlRemark,
  type BookingControlStatus,
  type SpecialistServiceDebt,
  UserRole,
} from '@fitgo/shared-types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { FitnessService } from '../fitness/fitness.service';

type ListFilters = {
  from: string;
  to: string;
  kind?: BookingControlKind | 'ALL';
  performerId?: string;
  /** When set, only sessions for this performer (own view). */
  restrictPerformerId?: string;
  status?: BookingControlStatus | 'ALL';
  needsReview?: boolean;
  payment?: 'PAID' | 'DEBT' | 'ALL';
};

@Injectable()
export class BookingControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
    private readonly classSessions: ClassSessionsSyncService,
  ) {}

  async list(
    clubId: string,
    filters: ListFilters,
  ): Promise<BookingControlListItem[]> {
    const fromD = new Date(`${filters.from}T00:00:00`);
    const toD = new Date(`${filters.to}T23:59:59.999`);
    if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) {
      throw new BadRequestException('Некорректные даты from/to');
    }

    const kindFilter =
      filters.kind && filters.kind !== 'ALL'
        ? (filters.kind as OnexClassKind)
        : undefined;

    const performerFilterId =
      filters.restrictPerformerId ?? filters.performerId;

    let performerExt: string | undefined;
    let performerName: string | undefined;
    if (performerFilterId) {
      const u = await this.prisma.user.findFirst({
        where: { id: performerFilterId, clubId },
      });
      if (!u) return [];
      performerExt = u.externalId ?? undefined;
      performerName = `${u.lastName} ${u.firstName}`.trim();
    }

    const onex = await this.prisma.onexClassSession.findMany({
      where: {
        clubId,
        isActive: true,
        startAt: { gte: fromD, lte: toD },
        ...(kindFilter ? { kind: kindFilter } : {}),
        ...(performerFilterId
          ? performerExt || performerName
            ? {
                OR: [
                  ...(performerExt
                    ? [{ employeeExternalId: performerExt }]
                    : []),
                  ...(performerName
                    ? [{ employeeName: performerName }]
                    : []),
                ],
              }
            : { employeeExternalId: '__none__' }
          : {}),
      },
      include: { members: true },
      orderBy: { startAt: 'desc' },
    });

    const openRemarks = await this.prisma.sessionRemark.findMany({
      where: {
        clubId,
        status: SessionRemarkStatus.OPEN,
      },
      select: { sessionKey: true },
    });
    const openKeys = new Set(openRemarks.map((r) => r.sessionKey));

    const staffByExt = await this.loadStaffMap(clubId);

    const items: BookingControlListItem[] = [];
    const matchedPtIds = new Set<string>();
    const matchedSpaIds = new Set<string>();

    // Preload FitGO PT/SPA for in-memory match (avoid N+1)
    const [allPt, allSpa] = await Promise.all([
      this.prisma.personalTrainingBooking.findMany({
        where: {
          trainer: { clubId },
          status: { not: PersonalBookingStatus.CANCELLED },
          startAt: { gte: fromD, lte: toD },
          ...(performerFilterId ? { trainerId: performerFilterId } : {}),
        },
        include: { client: true, trainer: true },
      }),
      this.prisma.spaBooking.findMany({
        where: {
          clubId,
          status: { not: SpaBookingStatus.CANCELLED },
          startAt: { gte: fromD, lte: toD },
          ...(performerFilterId ? { specialistId: performerFilterId } : {}),
        },
        include: { client: true, specialist: true, service: true },
      }),
    ]);

    for (const s of onex) {
      const kind = s.kind as BookingControlKind;
      const sessionKey = onexSessionKey(s.externalId);
      const status = mapOnexStatusToControl(s.status);
      const performerId =
        (s.employeeExternalId && staffByExt.get(s.employeeExternalId)?.id) ||
        undefined;

      const primaryMember = s.members.find((m) => !m.cancelled) ?? s.members[0];
      const payment =
        kind === 'GROUP'
          ? ('N_A' as BookingControlPayment)
          : inferPaymentFromBasis(primaryMember?.paymentBasis);
      const payTag =
        kind === 'PT' || kind === 'SPA'
          ? inferPayTag({
              paySource: primaryMember?.paySource,
              payment,
              source: '1C',
            })
          : undefined;

      let fitgoBookingId: string | undefined;
      if (kind === 'PT') {
        const hit = this.matchPtInMemory(allPt, s, primaryMember?.externalId);
        if (hit) {
          fitgoBookingId = hit.id;
          matchedPtIds.add(hit.id);
        }
      } else if (kind === 'SPA') {
        const hit = this.matchSpaInMemory(allSpa, s, primaryMember?.externalId);
        if (hit) {
          fitgoBookingId = hit.id;
          matchedSpaIds.add(hit.id);
        }
      }

      const memberSnapshot: BookingControlMember[] = s.members.map((m) => ({
        externalId: m.externalId,
        clientName: m.clientName,
        attendance: (m.cancelled
          ? 'CANCELLED'
          : m.attendance) as BookingControlMember['attendance'],
        paymentBasis: m.paymentBasis ?? undefined,
      }));
      if (kind === 'GROUP') {
        this.promoteGroupAttendanceFromHeader(
          memberSnapshot,
          s.headerAttendedCount ?? 0,
          s.status,
        );
      }
      const counts =
        kind === 'GROUP'
          ? this.attendanceCounts(
              memberSnapshot,
              Math.max(s.attendedCount ?? 0, s.headerAttendedCount ?? 0),
            )
          : memberSnapshot.length
            ? this.attendanceCounts(memberSnapshot)
            : this.singleClientCounts(status, {
                arrived:
                  memberSnapshot.some((m) => m.attendance === 'ATTENDED') ||
                  undefined,
              });

      items.push({
        sessionKey,
        kind,
        source: '1C',
        title: s.title,
        startAt: s.startAt.toISOString(),
        endAt: s.endAt?.toISOString(),
        status,
        performerName: s.employeeName?.trim() || '—',
        performerId,
        clientName:
          kind === 'GROUP'
            ? undefined
            : primaryMember?.clientName ?? '—',
        roomTitle: s.roomTitle ?? undefined,
        number: s.number ?? undefined,
        attendeeCount: counts.arrivedCount,
        bookedCount: counts.bookedCount,
        arrivedCount: counts.arrivedCount,
        noShowCount: counts.noShowCount,
        payment: kind === 'GROUP' ? 'N_A' : payment,
        payTag,
        needsReview: openKeys.has(sessionKey),
        fitgoBookingId,
        priceMinor: primaryMember?.unitPriceMinor ?? undefined,
      });
    }

    // One-time PT from 1C sale lines (Исполнитель + сумма), no class doc required
    if (!kindFilter || kindFilter === OnexClassKind.PT) {
      const ptSales = await this.fetchTrainerPtSales(
        filters.from,
        filters.to,
      );
      for (const sale of ptSales) {
        if (
          !this.saleMatchesPerformerFilter(
            sale,
            performerFilterId,
            performerExt,
            performerName,
            staffByExt,
          )
        ) {
          continue;
        }
        const sessionKey = saleSessionKey('PT', sale.docRef || sale.externalId);
        const payment: BookingControlPayment =
          sale.paymentStatus === 'PAID' ? 'PAID' : 'DEBT';
        const performerId =
          (sale.employeeCode && staffByExt.get(sale.employeeCode)?.id) ||
          this.findStaffIdByName(staffByExt, sale.employeeName);
        const saleCounts = this.singleClientCounts('COMPLETED', {
          arrived: payment === 'PAID',
        });
        items.push({
          sessionKey,
          kind: 'PT',
          source: 'SALE',
          title: sale.serviceName || 'Разовая ПТ (продажа)',
          startAt: this.normalizeOccurredAt(sale.occurredAt),
          status: 'COMPLETED',
          performerName: sale.employeeName?.trim() || '—',
          performerId,
          clientName: sale.clientName || '—',
          number: sale.docRef || undefined,
          attendeeCount: saleCounts.arrivedCount,
          bookedCount: saleCounts.bookedCount,
          arrivedCount: saleCounts.arrivedCount,
          noShowCount: saleCounts.noShowCount,
          payment,
          payTag: 'SALE',
          needsReview: openKeys.has(sessionKey),
          priceMinor: Math.round((Number(sale.amount) || 0) * 100),
        });
      }
    }

    // FitGO-only PT/SPA
    if (!kindFilter || kindFilter === OnexClassKind.PT) {
      for (const b of allPt) {
        if (matchedPtIds.has(b.id)) continue;
        if (
          this.onexExistsInMemory(
            onex,
            'PT',
            b.startAt,
            b.trainer.externalId,
            b.client.externalId,
            b.crmDocRef,
          )
        ) {
          continue;
        }
        const sessionKey = fitgoSessionKey('PT', b.id);
        const status: BookingControlStatus =
          b.status === PersonalBookingStatus.CANCELLED
            ? 'CANCELLED'
            : b.status === PersonalBookingStatus.COMPLETED
              ? 'COMPLETED'
              : 'SCHEDULED';
        const counts = this.singleClientCounts(status);
        items.push({
          sessionKey,
          kind: 'PT',
          source: 'FITGO',
          title: b.isComplimentary
            ? 'Подарочная ПТ'
            : 'Персональная тренировка',
          startAt: b.startAt.toISOString(),
          endAt: b.endAt.toISOString(),
          status,
          performerName: `${b.trainer.lastName} ${b.trainer.firstName}`.trim(),
          performerId: b.trainerId,
          clientName: `${b.client.lastName} ${b.client.firstName}`.trim(),
          attendeeCount: counts.arrivedCount,
          bookedCount: counts.bookedCount,
          arrivedCount: counts.arrivedCount,
          noShowCount: counts.noShowCount,
          payment: b.isComplimentary
            ? 'GIFT'
            : b.paymentStatus === 'PAID'
              ? 'PAID'
              : b.paymentStatus === 'DEBT'
                ? 'DEBT'
                : 'UNKNOWN',
          needsReview: openKeys.has(sessionKey),
          fitgoBookingId: b.id,
        });
      }
    }

    if (!kindFilter || kindFilter === OnexClassKind.SPA) {
      for (const b of allSpa) {
        if (matchedSpaIds.has(b.id)) continue;
        if (
          this.onexExistsInMemory(
            onex,
            'SPA',
            b.startAt,
            b.specialist.externalId,
            b.client.externalId,
            b.crmDocRef,
          )
        ) {
          continue;
        }
        const sessionKey = fitgoSessionKey('SPA', b.id);
        const status: BookingControlStatus =
          b.status === SpaBookingStatus.CANCELLED
            ? 'CANCELLED'
            : b.status === SpaBookingStatus.COMPLETED
              ? 'COMPLETED'
              : 'SCHEDULED';
        const counts = this.singleClientCounts(status);
        items.push({
          sessionKey,
          kind: 'SPA',
          source: 'FITGO',
          title: b.service.name,
          startAt: b.startAt.toISOString(),
          endAt: b.endAt.toISOString(),
          status,
          performerName:
            `${b.specialist.lastName} ${b.specialist.firstName}`.trim(),
          performerId: b.specialistId,
          clientName: `${b.client.lastName} ${b.client.firstName}`.trim(),
          attendeeCount: counts.arrivedCount,
          bookedCount: counts.bookedCount,
          arrivedCount: counts.arrivedCount,
          noShowCount: counts.noShowCount,
          payment:
            b.partnerSource?.toUpperCase() === 'ALLSPORTS'
              ? 'PARTNER'
              : b.paymentType === 'QUOTA'
                ? 'QUOTA'
                : b.paymentStatus === 'PAID'
                  ? 'PAID'
                  : b.paymentStatus === 'DEBT'
                    ? 'DEBT'
                    : 'UNKNOWN',
          needsReview: openKeys.has(sessionKey),
          fitgoBookingId: b.id,
        });
      }
    }

    let out = items;

    if (filters.status && filters.status !== 'ALL') {
      out = out.filter((i) => i.status === filters.status);
    }
    if (filters.needsReview) {
      out = out.filter((i) => i.needsReview);
    }
    if (filters.payment && filters.payment !== 'ALL') {
      out = out.filter((i) => {
        if (i.kind === 'GROUP') return false;
        if (filters.payment === 'PAID') {
          return (
            i.payment === 'PAID' ||
            i.payment === 'QUOTA' ||
            i.payment === 'PARTNER' ||
            i.payment === 'GIFT'
          );
        }
        return i.payment === 'DEBT' || i.payment === 'UNKNOWN';
      });
    }

    return out.sort(
      (a, b) =>
        new Date(b.startAt).getTime() - new Date(a.startAt).getTime(),
    );
  }

  async detail(
    clubId: string,
    sessionKey: string,
    viewer?: { userId: string; ownOnly: boolean },
  ): Promise<BookingControlDetail> {
    const parsed = parseSessionKey(sessionKey);
    if (!parsed) throw new BadRequestException('Некорректный sessionKey');

    const remarks = await this.prisma.sessionRemark.findMany({
      where: { clubId, sessionKey },
      include: {
        staff: { select: { firstName: true, lastName: true } },
        admin: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const mappedRemarks = remarks.map((r) => this.mapRemark(r));
    const open = mappedRemarks.find((r) => r.status === 'OPEN') ?? null;

    if (parsed.source === '1C') {
      const s = await this.prisma.onexClassSession.findFirst({
        where: { clubId, externalId: parsed.id, isActive: true },
        include: { members: true },
      });
      if (!s) throw new NotFoundException('Занятие не найдено');

      if (viewer?.ownOnly) {
        await this.assertOwnOnex(clubId, viewer.userId, s);
      }

      const kind = s.kind as BookingControlKind;
      const primary = s.members.find((m) => !m.cancelled) ?? s.members[0];
      const matched =
        kind === 'PT' || kind === 'SPA'
          ? await this.findMatchingFitgoBooking(
              clubId,
              kind,
              s,
              primary?.externalId,
            )
          : null;

      const members: BookingControlMember[] = s.members.map((m) => ({
        externalId: m.externalId,
        clientName: m.clientName,
        attendance: m.attendance as BookingControlMember['attendance'],
        paymentBasis: m.paymentBasis ?? undefined,
        payment:
          kind === 'GROUP'
            ? undefined
            : inferPaymentFromBasis(m.paymentBasis),
      }));

      let groupHeadcount: number | undefined;
      let counts = {
        bookedCount: 0,
        arrivedCount: 0,
        noShowCount: 0,
      };
      if (kind === 'GROUP') {
        this.promoteGroupAttendanceFromHeader(
          members,
          s.headerAttendedCount,
          s.status,
        );
        counts = this.attendanceCounts(
          members,
          Math.max(s.attendedCount ?? 0, s.headerAttendedCount ?? 0),
        );
        groupHeadcount = counts.arrivedCount;
      } else {
        counts = members.length
          ? this.attendanceCounts(members)
          : this.singleClientCounts(mapOnexStatusToControl(s.status));
      }

      const payment: BookingControlPayment =
        kind === 'GROUP'
          ? 'N_A'
          : inferPaymentFromBasis(primary?.paymentBasis);
      const payTag =
        kind === 'PT' || kind === 'SPA'
          ? inferPayTag({
              paySource: primary?.paySource,
              payment,
              source: '1C',
            })
          : undefined;
      const unitPrice = primary?.unitPriceMinor ?? undefined;
      const matchedPrice = matched
        ? (matched as { priceMinor?: number | null }).priceMinor ?? undefined
        : undefined;

      return {
        sessionKey,
        kind,
        source: '1C',
        title: s.title,
        startAt: s.startAt.toISOString(),
        endAt: s.endAt?.toISOString(),
        status: mapOnexStatusToControl(s.status),
        performerName: s.employeeName?.trim() || '—',
        clientName:
          kind === 'GROUP' ? undefined : primary?.clientName ?? '—',
        roomTitle: s.roomTitle ?? undefined,
        number: s.number ?? undefined,
        attendeeCount: groupHeadcount ?? counts.arrivedCount,
        bookedCount: counts.bookedCount,
        arrivedCount: counts.arrivedCount,
        noShowCount: counts.noShowCount,
        payment,
        payTag,
        needsReview: Boolean(open),
        fitgoBookingId: matched?.id,
        durationMin: s.durationMin ?? undefined,
        members,
        remark: open,
        remarksHistory: mappedRemarks,
        fitgoBookedAt: matched
          ? (matched as { createdAt: Date }).createdAt?.toISOString?.()
          : undefined,
        crmDocRef: matched
          ? (matched as { crmDocRef?: string | null }).crmDocRef ??
            s.externalId
          : s.externalId,
        priceMinor: unitPrice ?? matchedPrice,
      };
    }

    if (parsed.source === 'SALE') {
      // Re-fetch recent sales window (endpoint max 31d) to resolve detail by docRef
      const sales = await this.fetchTrainerPtSales(
        this.ymdDaysAgo(31),
        this.ymdToday(),
      );
      const sale = sales.find(
        (r) => (r.docRef || r.externalId) === parsed.id,
      );
      if (!sale) throw new NotFoundException('Продажа не найдена');
      if (viewer?.ownOnly) {
        await this.assertOwnSale(clubId, viewer.userId, sale);
      }
      const payment: BookingControlPayment =
        sale.paymentStatus === 'PAID' ? 'PAID' : 'DEBT';
      const saleCounts = this.singleClientCounts('COMPLETED', {
        arrived: payment === 'PAID',
      });
      return {
        sessionKey,
        kind: 'PT',
        source: 'SALE',
        title: sale.serviceName || 'Разовая ПТ (продажа)',
        startAt: this.normalizeOccurredAt(sale.occurredAt),
        status: 'COMPLETED',
        performerName: sale.employeeName?.trim() || '—',
        clientName: sale.clientName || '—',
        number: sale.docRef || undefined,
        attendeeCount: saleCounts.arrivedCount,
        bookedCount: saleCounts.bookedCount,
        arrivedCount: saleCounts.arrivedCount,
        noShowCount: saleCounts.noShowCount,
        payment,
        payTag: 'SALE',
        needsReview: Boolean(open),
        members: [
          {
            externalId: sale.externalId || sale.docRef || 'sale',
            clientName: sale.clientName || '—',
            attendance: payment === 'PAID' ? 'ATTENDED' : 'EXPECTED',
            payment,
          },
        ],
        remark: open,
        remarksHistory: mappedRemarks,
        crmDocRef: sale.docRef || undefined,
        priceMinor: Math.round((Number(sale.amount) || 0) * 100),
      };
    }

    // FitGO-only
    const kind = parsed.kind!;
    if (kind === 'PT') {
      const b = await this.prisma.personalTrainingBooking.findFirst({
        where: { id: parsed.id, trainer: { clubId } },
        include: { client: true, trainer: true },
      });
      if (!b) throw new NotFoundException('Запись не найдена');
      if (viewer?.ownOnly && b.trainerId !== viewer.userId) {
        throw new ForbiddenException('Чужое занятие');
      }
      const status: BookingControlStatus =
        b.status === PersonalBookingStatus.COMPLETED
          ? 'COMPLETED'
          : b.status === PersonalBookingStatus.CANCELLED
            ? 'CANCELLED'
            : 'SCHEDULED';
      const counts = this.singleClientCounts(status);
      return {
        sessionKey,
        kind: 'PT',
        source: 'FITGO',
        title: b.isComplimentary
          ? 'Подарочная ПТ'
          : 'Персональная тренировка',
        startAt: b.startAt.toISOString(),
        endAt: b.endAt.toISOString(),
        status,
        performerName: `${b.trainer.lastName} ${b.trainer.firstName}`.trim(),
        performerId: b.trainerId,
        clientName: `${b.client.lastName} ${b.client.firstName}`.trim(),
        attendeeCount: counts.arrivedCount,
        bookedCount: counts.bookedCount,
        arrivedCount: counts.arrivedCount,
        noShowCount: counts.noShowCount,
        payment: b.isComplimentary
          ? 'GIFT'
          : b.paymentStatus === 'PAID'
            ? 'PAID'
            : b.paymentStatus === 'DEBT'
              ? 'DEBT'
              : 'UNKNOWN',
        needsReview: Boolean(open),
        fitgoBookingId: b.id,
        members: [],
        remark: open,
        remarksHistory: mappedRemarks,
        fitgoBookedAt: b.createdAt.toISOString(),
        crmDocRef: b.crmDocRef ?? undefined,
        priceMinor: b.priceMinor ?? undefined,
      };
    }

    if (kind === 'SPA') {
      const b = await this.prisma.spaBooking.findFirst({
        where: { id: parsed.id, clubId },
        include: { client: true, specialist: true, service: true },
      });
      if (!b) throw new NotFoundException('Запись не найдена');
      if (viewer?.ownOnly && b.specialistId !== viewer.userId) {
        throw new ForbiddenException('Чужое занятие');
      }
      const status: BookingControlStatus =
        b.status === SpaBookingStatus.COMPLETED
          ? 'COMPLETED'
          : b.status === SpaBookingStatus.CANCELLED
            ? 'CANCELLED'
            : 'SCHEDULED';
      const counts = this.singleClientCounts(status);
      return {
        sessionKey,
        kind: 'SPA',
        source: 'FITGO',
        title: b.service.name,
        startAt: b.startAt.toISOString(),
        endAt: b.endAt.toISOString(),
        status,
        performerName:
          `${b.specialist.lastName} ${b.specialist.firstName}`.trim(),
        performerId: b.specialistId,
        clientName: `${b.client.lastName} ${b.client.firstName}`.trim(),
        attendeeCount: counts.arrivedCount,
        bookedCount: counts.bookedCount,
        arrivedCount: counts.arrivedCount,
        noShowCount: counts.noShowCount,
        payment:
          b.partnerSource?.toUpperCase() === 'ALLSPORTS'
            ? 'PARTNER'
            : b.paymentType === 'QUOTA'
              ? 'QUOTA'
              : b.paymentStatus === 'PAID'
                ? 'PAID'
                : b.paymentStatus === 'DEBT'
                  ? 'DEBT'
                  : 'UNKNOWN',
        needsReview: Boolean(open),
        fitgoBookingId: b.id,
        members: [],
        remark: open,
        remarksHistory: mappedRemarks,
        fitgoBookedAt: b.createdAt.toISOString(),
        crmDocRef: b.crmDocRef ?? undefined,
        priceMinor: b.priceMinor ?? b.service.priceMinor,
      };
    }

    throw new BadRequestException('Групповые FitGO-only строки не поддерживаются');
  }

  /** Re-pull Документ.Занятие from 1C for the selected period. */
  async refreshFrom1c(clubId: string, from: string, to: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw new BadRequestException('Некорректные даты from/to');
    }
    if (from > to) {
      throw new BadRequestException('from must be ≤ to');
    }
    const sync = await this.classSessions.syncClub(clubId, { from, to });
    return {
      ...sync,
      message: sync.endpointMissing
        ? 'Шаблон GET /v1/class-sessions ещё не опубликован в 1С.'
        : `Обновлено занятий: ${sync.sessionsUpserted}.`,
    };
  }

  /**
   * Mark GROUP roster member arrived / no-show in 1C and mirror locally.
   * Admin / manager / super-admin only (enforced by controller roles).
   */
  async setGroupAttendance(
    clubId: string,
    sessionKey: string,
    clientExternalId: string,
    attendance: 'ATTENDED' | 'NO_SHOW',
  ): Promise<BookingControlDetail> {
    const clientId = clientExternalId?.trim();
    if (!clientId) {
      throw new BadRequestException('Не указан клиент');
    }
    if (attendance !== 'ATTENDED' && attendance !== 'NO_SHOW') {
      throw new BadRequestException('attendance: ATTENDED или NO_SHOW');
    }

    const parsed = parseSessionKey(sessionKey);
    if (!parsed || parsed.source !== '1C') {
      throw new BadRequestException(
        'Явку можно ставить только по занятию из 1С',
      );
    }

    const session = await this.prisma.onexClassSession.findFirst({
      where: { clubId, externalId: parsed.id, isActive: true },
      include: { members: true },
    });
    if (!session) throw new NotFoundException('Занятие не найдено');
    if (session.kind !== OnexClassKind.GROUP) {
      throw new BadRequestException(
        'Отметки Прибыл/Не прибыл доступны только для групповых занятий',
      );
    }

    const member = session.members.find((m) => m.externalId === clientId);
    if (!member) {
      throw new NotFoundException('Клиент не в составе занятия');
    }
    if (member.cancelled) {
      throw new BadRequestException('Строка отменена — явку менять нельзя');
    }

    const provider = this.fitness.getProvider();
    if (!provider.setClassSessionAttendance) {
      throw new BadRequestException(
        'Провайдер 1С не поддерживает запись явки (нужен FitGO HTTP)',
      );
    }

    try {
      await provider.setClassSessionAttendance({
        appointmentId: session.externalId,
        clientExternalId: clientId,
        attendance,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(
        msg.includes('FitGO 1C API')
          ? msg
          : `Не удалось записать явку в 1С: ${msg}`,
      );
    }

    const dbAttendance =
      attendance === 'ATTENDED'
        ? OnexClassMemberAttendance.ATTENDED
        : OnexClassMemberAttendance.NO_SHOW;

    await this.prisma.onexClassSessionMember.update({
      where: { id: member.id },
      data: { attendance: dbAttendance },
    });

    const members = await this.prisma.onexClassSessionMember.findMany({
      where: { sessionId: session.id },
    });
    const arrivedCount = members.filter(
      (m) =>
        !m.cancelled &&
        m.attendance === OnexClassMemberAttendance.ATTENDED,
    ).length;
    await this.prisma.onexClassSession.update({
      where: { id: session.id },
      data: { attendedCount: arrivedCount },
    });

    return this.detail(clubId, sessionKey);
  }

  async openRemark(
    actor: JwtPayload,
    sessionKey: string,
    comment: string,
  ): Promise<BookingControlRemark> {
    const clubId = requireClubId(actor);
    const text = comment?.trim();
    if (!text) throw new BadRequestException('Укажите комментарий');
    if (!sessionKey?.trim()) {
      throw new BadRequestException('Не указано занятие');
    }

    const parsed = parseSessionKey(sessionKey);
    if (!parsed) throw new BadRequestException('Некорректный sessionKey');

    // Ensure session exists and actor may comment (own for trainer/specialist)
    await this.detail(clubId, sessionKey, {
      userId: actor.sub,
      ownOnly: !this.isAdminLike(actor),
    });

    const existing = await this.prisma.sessionRemark.findFirst({
      where: { clubId, sessionKey, status: SessionRemarkStatus.OPEN },
    });
    if (existing) {
      throw new BadRequestException(
        'По занятию уже есть открытое замечание — дождитесь ответа администратора',
      );
    }

    const kind =
      parsed.source === '1C'
        ? await this.kindFromOnex(clubId, parsed.id)
        : parsed.source === 'SALE'
          ? SessionRemarkKind.PT
          : (parsed.kind as SessionRemarkKind);

    const row = await this.prisma.sessionRemark.create({
      data: {
        clubId,
        kind,
        sessionKey,
        status: SessionRemarkStatus.OPEN,
        staffComment: text,
        staffId: actor.sub,
      },
      include: {
        staff: { select: { firstName: true, lastName: true } },
        admin: { select: { firstName: true, lastName: true } },
      },
    });
    return this.mapRemark(row);
  }

  async resolveRemark(
    actor: JwtPayload,
    sessionKey: string,
    adminComment: string,
  ): Promise<BookingControlRemark> {
    const clubId = requireClubId(actor);
    if (!this.isAdminLike(actor)) {
      throw new ForbiddenException('Только администратор');
    }
    const text = adminComment?.trim();
    if (!text) throw new BadRequestException('Укажите ответ');
    if (!sessionKey?.trim()) {
      throw new BadRequestException('Не указано занятие');
    }

    const open = await this.prisma.sessionRemark.findFirst({
      where: { clubId, sessionKey, status: SessionRemarkStatus.OPEN },
    });
    if (!open) throw new NotFoundException('Открытое замечание не найдено');

    const row = await this.prisma.sessionRemark.update({
      where: { id: open.id },
      data: {
        status: SessionRemarkStatus.CLOSED,
        adminComment: text,
        adminId: actor.sub,
        closedAt: new Date(),
      },
      include: {
        staff: { select: { firstName: true, lastName: true } },
        admin: { select: { firstName: true, lastName: true } },
      },
    });
    return this.mapRemark(row);
  }

  /** Open remark sessionKeys for payroll gating. */
  async openRemarkKeys(
    clubId: string,
    keys: string[],
  ): Promise<Set<string>> {
    if (!keys.length) return new Set();
    const rows = await this.prisma.sessionRemark.findMany({
      where: {
        clubId,
        status: SessionRemarkStatus.OPEN,
        sessionKey: { in: keys },
      },
      select: { sessionKey: true },
    });
    return new Set(rows.map((r) => r.sessionKey));
  }

  async hasOpenRemark(clubId: string, sessionKey: string): Promise<boolean> {
    const n = await this.prisma.sessionRemark.count({
      where: { clubId, sessionKey, status: SessionRemarkStatus.OPEN },
    });
    return n > 0;
  }

  private isAdminLike(actor: JwtPayload): boolean {
    const roles = actor.roles ?? [];
    return (
      roles.includes(UserRole.SUPER_ADMIN) ||
      roles.includes(UserRole.MANAGER) ||
      roles.includes(UserRole.ADMIN)
    );
  }

  private mapRemark(r: {
    id: string;
    status: SessionRemarkStatus;
    staffComment: string;
    adminComment: string | null;
    createdAt: Date;
    closedAt: Date | null;
    staff: { firstName: string; lastName: string };
    admin: { firstName: string; lastName: string } | null;
  }): BookingControlRemark {
    return {
      id: r.id,
      status: r.status === SessionRemarkStatus.OPEN ? 'OPEN' : 'CLOSED',
      staffComment: r.staffComment,
      staffName: `${r.staff.lastName} ${r.staff.firstName}`.trim(),
      adminComment: r.adminComment ?? undefined,
      adminName: r.admin
        ? `${r.admin.lastName} ${r.admin.firstName}`.trim()
        : undefined,
      createdAt: r.createdAt.toISOString(),
      closedAt: r.closedAt?.toISOString(),
    };
  }

  private async loadStaffMap(clubId: string) {
    const staff = await this.prisma.user.findMany({
      where: {
        clubId,
        roles: {
          some: {
            role: { in: ['TRAINER', 'SPECIALIST', 'MANAGER', 'ADMIN'] },
          },
        },
      },
      select: {
        id: true,
        externalId: true,
        firstName: true,
        lastName: true,
      },
    });
    const map = new Map<string, (typeof staff)[0]>();
    for (const u of staff) {
      if (u.externalId) map.set(u.externalId, u);
    }
    return map;
  }

  private async fetchTrainerPtSales(
    from: string,
    to: string,
  ): Promise<SpecialistServiceDebt[]> {
    const provider = this.fitness.getProvider();
    const fn = provider.getTrainerPtSales;
    if (!fn) return [];
    try {
      return await fn.call(provider, { from, to });
    } catch {
      return [];
    }
  }

  private saleMatchesPerformerFilter(
    sale: SpecialistServiceDebt,
    performerFilterId: string | undefined,
    performerExt: string | undefined,
    performerName: string | undefined,
    staffByExt: Map<
      string,
      { id: string; externalId: string | null; firstName: string; lastName: string }
    >,
  ): boolean {
    if (!performerFilterId) return true;
    if (performerExt && sale.employeeCode) {
      const a = performerExt.replace(/^0+/, '');
      const b = sale.employeeCode.replace(/^0+/, '');
      if (a && b && a === b) return true;
      if (sale.employeeCode === performerExt) return true;
    }
    if (performerName && sale.employeeName) {
      if (
        sale.employeeName.trim().toLowerCase() ===
        performerName.trim().toLowerCase()
      ) {
        return true;
      }
    }
    const byCode = sale.employeeCode
      ? staffByExt.get(sale.employeeCode)
      : undefined;
    if (byCode?.id === performerFilterId) return true;
    return false;
  }

  private findStaffIdByName(
    staffByExt: Map<
      string,
      { id: string; firstName: string; lastName: string }
    >,
    employeeName: string | undefined,
  ): string | undefined {
    const n = (employeeName ?? '').trim().toLowerCase();
    if (!n) return undefined;
    for (const u of staffByExt.values()) {
      const full = `${u.lastName} ${u.firstName}`.trim().toLowerCase();
      if (full === n) return u.id;
    }
    return undefined;
  }

  private normalizeOccurredAt(raw: string): string {
    if (!raw?.trim()) return new Date().toISOString();
    const d = new Date(raw.includes('T') ? raw : `${raw}T12:00:00`);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }

  private ymdToday(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private ymdDaysAgo(n: number): string {
    return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  }

  private async assertOwnSale(
    clubId: string,
    userId: string,
    sale: SpecialistServiceDebt,
  ) {
    const u = await this.prisma.user.findFirst({
      where: { id: userId, clubId },
    });
    if (!u) throw new ForbiddenException('Чужая продажа');
    const name = `${u.lastName} ${u.firstName}`.trim().toLowerCase();
    const codeOk =
      u.externalId &&
      sale.employeeCode &&
      (u.externalId === sale.employeeCode ||
        u.externalId.replace(/^0+/, '') ===
          sale.employeeCode.replace(/^0+/, ''));
    const nameOk =
      sale.employeeName &&
      sale.employeeName.trim().toLowerCase() === name;
    if (!codeOk && !nameOk) throw new ForbiddenException('Чужая продажа');
  }

  private async kindFromOnex(
    clubId: string,
    externalId: string,
  ): Promise<SessionRemarkKind> {
    const s = await this.prisma.onexClassSession.findFirst({
      where: { clubId, externalId },
      select: { kind: true },
    });
    if (!s) throw new NotFoundException('Занятие не найдено');
    return s.kind as SessionRemarkKind;
  }

  private async assertOwnOnex(
    clubId: string,
    userId: string,
    s: {
      employeeExternalId: string | null;
      employeeName: string | null;
    },
  ) {
    const u = await this.prisma.user.findFirst({
      where: { id: userId, clubId },
    });
    if (!u) throw new ForbiddenException('Чужое занятие');
    const name = `${u.lastName} ${u.firstName}`.trim();
    const ok =
      (u.externalId && u.externalId === s.employeeExternalId) ||
      (s.employeeName &&
        s.employeeName.trim().toLowerCase() === name.toLowerCase());
    if (!ok) throw new ForbiddenException('Чужое занятие');
  }

  private promoteGroupAttendanceFromHeader(
    members: BookingControlMember[],
    headerAttendedCount: number,
    status: string,
  ) {
    if (String(status).toUpperCase() !== 'COMPLETED') return;
    const active = members.filter(
      (m) => m.attendance !== 'CANCELLED',
    );
    const attended = active.filter((m) => m.attendance === 'ATTENDED');
    if (attended.length > 0) return;
    if (headerAttendedCount <= 0) return;
    if (headerAttendedCount < active.length) return;
    for (const m of active) {
      if (m.attendance === 'EXPECTED' || m.attendance === 'NO_SHOW') {
        m.attendance = 'ATTENDED';
      }
    }
  }

  /** Booked / arrived / no-show from roster (CANCELLED excluded from booked). */
  private attendanceCounts(
    members: BookingControlMember[],
    fallbackArrived = 0,
  ): {
    bookedCount: number;
    arrivedCount: number;
    noShowCount: number;
  } {
    const active = members.filter((m) => m.attendance !== 'CANCELLED');
    const arrivedFromMembers = active.filter(
      (m) => m.attendance === 'ATTENDED',
    ).length;
    const arrivedCount = Math.max(arrivedFromMembers, fallbackArrived);
    const bookedCount = Math.max(active.length, arrivedCount);
    return {
      bookedCount,
      arrivedCount,
      noShowCount: Math.max(0, bookedCount - arrivedCount),
    };
  }

  private singleClientCounts(
    status: BookingControlStatus,
    opts?: { arrived?: boolean },
  ): {
    bookedCount: number;
    arrivedCount: number;
    noShowCount: number;
  } {
    if (status === 'CANCELLED') {
      return { bookedCount: 0, arrivedCount: 0, noShowCount: 0 };
    }
    const arrived =
      opts?.arrived === true ||
      (opts?.arrived !== false && status === 'COMPLETED');
    if (status === 'SCHEDULED') {
      return { bookedCount: 1, arrivedCount: 0, noShowCount: 0 };
    }
    return {
      bookedCount: 1,
      arrivedCount: arrived ? 1 : 0,
      noShowCount: arrived ? 0 : 1,
    };
  }

  private matchPtInMemory(
    bookings: Array<{
      id: string;
      startAt: Date;
      crmDocRef: string | null;
      trainer: { externalId: string | null };
      client: { externalId: string | null };
    }>,
    session: {
      externalId: string;
      number: string | null;
      startAt: Date;
      employeeExternalId: string | null;
    },
    clientExternalId: string | undefined,
  ) {
    const byRef = bookings.find(
      (b) =>
        b.crmDocRef &&
        (b.crmDocRef === session.externalId ||
          b.crmDocRef === session.number),
    );
    if (byRef) return byRef;
    const windowMs = 3 * 60 * 1000;
    return bookings.find((b) => {
      const dt = Math.abs(b.startAt.getTime() - session.startAt.getTime());
      if (dt > windowMs) return false;
      if (
        session.employeeExternalId &&
        b.trainer.externalId &&
        b.trainer.externalId !== session.employeeExternalId
      ) {
        return false;
      }
      if (
        clientExternalId &&
        b.client.externalId &&
        b.client.externalId !== clientExternalId
      ) {
        return false;
      }
      return true;
    });
  }

  private matchSpaInMemory(
    bookings: Array<{
      id: string;
      startAt: Date;
      crmDocRef: string | null;
      specialist: { externalId: string | null };
      client: { externalId: string | null };
    }>,
    session: {
      externalId: string;
      number: string | null;
      startAt: Date;
      employeeExternalId: string | null;
    },
    clientExternalId: string | undefined,
  ) {
    const byRef = bookings.find(
      (b) =>
        b.crmDocRef &&
        (b.crmDocRef === session.externalId ||
          b.crmDocRef === session.number),
    );
    if (byRef) return byRef;
    const windowMs = 3 * 60 * 1000;
    return bookings.find((b) => {
      const dt = Math.abs(b.startAt.getTime() - session.startAt.getTime());
      if (dt > windowMs) return false;
      if (
        session.employeeExternalId &&
        b.specialist.externalId &&
        b.specialist.externalId !== session.employeeExternalId
      ) {
        return false;
      }
      if (
        clientExternalId &&
        b.client.externalId &&
        b.client.externalId !== clientExternalId
      ) {
        return false;
      }
      return true;
    });
  }

  private onexExistsInMemory(
    onex: Array<{
      kind: OnexClassKind;
      externalId: string;
      number: string | null;
      startAt: Date;
      employeeExternalId: string | null;
      members: Array<{ externalId: string }>;
    }>,
    kind: 'PT' | 'SPA',
    startAt: Date,
    employeeExternalId: string | null | undefined,
    clientExternalId: string | null | undefined,
    crmDocRef: string | null | undefined,
  ): boolean {
    if (crmDocRef?.trim()) {
      const ref = crmDocRef.trim();
      if (
        onex.some(
          (o) =>
            o.kind === kind &&
            (o.externalId === ref || o.number === ref),
        )
      ) {
        return true;
      }
    }
    const windowMs = 3 * 60 * 1000;
    return onex.some((o) => {
      if (o.kind !== kind) return false;
      if (Math.abs(o.startAt.getTime() - startAt.getTime()) > windowMs) {
        return false;
      }
      if (
        employeeExternalId &&
        o.employeeExternalId &&
        o.employeeExternalId !== employeeExternalId
      ) {
        return false;
      }
      if (
        clientExternalId &&
        !o.members.some((m) => m.externalId === clientExternalId)
      ) {
        return false;
      }
      return true;
    });
  }

  private async findMatchingFitgoBooking(
    clubId: string,
    kind: 'PT' | 'SPA',
    session: {
      externalId: string;
      number: string | null;
      startAt: Date;
      employeeExternalId: string | null;
      title: string;
    },
    clientExternalId: string | undefined,
  ) {
    const windowMs = 3 * 60 * 1000;
    const from = new Date(session.startAt.getTime() - windowMs);
    const to = new Date(session.startAt.getTime() + windowMs);

    if (kind === 'PT') {
      if (session.number || session.externalId) {
        const byRef = await this.prisma.personalTrainingBooking.findFirst({
          where: {
            trainer: { clubId },
            OR: [
              { crmDocRef: session.externalId },
              ...(session.number ? [{ crmDocRef: session.number }] : []),
            ],
          },
        });
        if (byRef) return byRef;
      }
      return this.prisma.personalTrainingBooking.findFirst({
        where: {
          trainer: {
            clubId,
            ...(session.employeeExternalId
              ? { externalId: session.employeeExternalId }
              : {}),
          },
          startAt: { gte: from, lte: to },
          status: { not: PersonalBookingStatus.CANCELLED },
          ...(clientExternalId
            ? { client: { externalId: clientExternalId } }
            : {}),
        },
      });
    }

    if (session.number || session.externalId) {
      const byRef = await this.prisma.spaBooking.findFirst({
        where: {
          clubId,
          OR: [
            { crmDocRef: session.externalId },
            ...(session.number ? [{ crmDocRef: session.number }] : []),
          ],
        },
      });
      if (byRef) return byRef;
    }
    return this.prisma.spaBooking.findFirst({
      where: {
        clubId,
        startAt: { gte: from, lte: to },
        status: { not: SpaBookingStatus.CANCELLED },
        ...(clientExternalId
          ? { client: { externalId: clientExternalId } }
          : {}),
        ...(session.employeeExternalId
          ? {
              specialist: {
                clubId,
                externalId: session.employeeExternalId,
              },
            }
          : {}),
      },
    });
  }
}
