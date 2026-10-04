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
  ServicePaymentStatus,
  SessionApprovalKind,
  SessionRemarkKind,
  SessionRemarkStatus,
  SpaBookingStatus,
  SpaPaymentType,
} from '@prisma/client';
import { requireClubId } from '../auth/require-club-id';
import { ClassSessionsSyncService } from '../class-sync/class-sessions-sync.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  fitgoSessionKey,
  groupApprovalLabelRu,
  groupApprovalPayrollEligible,
  groupApprovalPhase,
  inferPaymentFromBasis,
  inferPayTag,
  mapOnexStatusToControl,
  onexSessionKey,
  parseSessionKey,
  saleSessionKey,
  sessionApprovalLabelRu,
  spaSettlementLabelRu,
  type BookingControlDetail,
  type BookingControlKind,
  type BookingControlListItem,
  type BookingControlMember,
  type BookingControlPayTag,
  type BookingControlPayment,
  type BookingControlRemark,
  type BookingControlStatus,
  type GroupApprovalPendingTask,
  type GroupApprovalPhase,
  type GroupClassApprovalInfo,
  type SessionApprovalPhase,
  type SpaSettlementInfo,
  type SpecialistServiceDebt,
  UserRole,
} from '@fitgo/shared-types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { FitnessService } from '../fitness/fitness.service';
import { SessionApprovalService } from './session-approval.service';

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
    private readonly sessionApproval: SessionApprovalService,
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

    const wantPtSales = !kindFilter || kindFilter === OnexClassKind.PT;

    const items: BookingControlListItem[] = [];
    const matchedPtIds = new Set<string>();
    const matchedSpaIds = new Set<string>();

    // Parallel DB + optional 1C sales (was sequential; sales alone can take seconds).
    const [onex, openRemarks, staffByExt, allPt, allSpa, ptSales] =
      await Promise.all([
        this.prisma.onexClassSession.findMany({
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
        }),
        this.prisma.sessionRemark.findMany({
          where: {
            clubId,
            status: SessionRemarkStatus.OPEN,
          },
          select: { sessionKey: true },
        }),
        this.loadStaffMap(clubId),
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
        wantPtSales
          ? this.fetchTrainerPtSales(filters.from, filters.to)
          : Promise.resolve([] as SpecialistServiceDebt[]),
      ]);
    const openKeys = new Set(openRemarks.map((r) => r.sessionKey));

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
    if (wantPtSales) {
      this.indexTrainerPtSales(ptSales);
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
            b.client?.externalId ?? b.clientExternalId,
            b.crmDocRef,
            b.id,
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
          clientName: this.spaClientLabel(b),
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

    // Attach GROUP approval phase / waiting labels
    const groupKeys = out
      .filter((i) => i.kind === 'GROUP' && i.source === '1C')
      .map((i) => i.sessionKey);
    if (groupKeys.length) {
      const approvals = await this.prisma.groupClassApproval.findMany({
        where: { clubId, sessionKey: { in: groupKeys } },
      });
      const byKey = new Map(approvals.map((a) => [a.sessionKey, a]));
      out = out.map((item) => {
        if (item.kind !== 'GROUP' || item.source !== '1C') return item;
        if (item.status === 'CANCELLED') return item;
        const endMs = item.endAt
          ? new Date(item.endAt).getTime()
          : new Date(item.startAt).getTime();
        // Future scheduled sessions: no approval badge yet
        if (item.status === 'SCHEDULED' && endMs > Date.now()) return item;
        const row = byKey.get(item.sessionKey);
        const phase = groupApprovalPhase({
          trainerApprovedAt: row?.trainerApprovedAt?.toISOString() ?? null,
          adminApprovedAt: row?.adminApprovedAt?.toISOString() ?? null,
          overrideApprovedAt: row?.overrideApprovedAt?.toISOString() ?? null,
        });
        return {
          ...item,
          approvalPhase: phase,
          approvalLabel: groupApprovalLabelRu(phase),
        };
      });
    }

    const ptBookingIds = out
      .filter((i) => i.kind === 'PT' && i.fitgoBookingId)
      .map((i) => i.fitgoBookingId!);
    const spaBookingIds = out
      .filter((i) => i.kind === 'SPA' && i.fitgoBookingId)
      .map((i) => i.fitgoBookingId!);
    // Read-only on list (no upserts) — create approval rows on confirm/detail.
    if (ptBookingIds.length || out.some((i) => i.kind === 'SPA')) {
      const sessionApprovals = await this.prisma.sessionApproval.findMany({
        where: {
          clubId,
          OR: [
            ...(ptBookingIds.length
              ? [{ kind: 'PT' as const, bookingId: { in: ptBookingIds } }]
              : []),
            ...(spaBookingIds.length ||
            out.some((i) => i.kind === 'SPA' && i.source === '1C')
              ? [
                  {
                    kind: 'SPA' as const,
                    bookingId: {
                      in: [
                        ...spaBookingIds,
                        ...out
                          .filter((i) => i.kind === 'SPA' && i.source === '1C')
                          .map((i) => i.sessionKey),
                      ],
                    },
                  },
                ]
              : []),
          ],
        },
      });
      const approvalByKey = new Map(
        sessionApprovals.map((a) => [`${a.kind}:${a.bookingId}`, a]),
      );
      out = out.map((item) => {
        if (item.kind !== 'PT' && item.kind !== 'SPA') return item;
        if (item.kind === 'PT' && !item.fitgoBookingId) return item;
        if (item.status === 'CANCELLED') return item;
        const endMs = item.endAt
          ? new Date(item.endAt).getTime()
          : new Date(item.startAt).getTime();
        if (item.status === 'SCHEDULED' && endMs > Date.now()) return item;
        const row =
          approvalByKey.get(`${item.kind}:${item.fitgoBookingId}`) ??
          (item.kind === 'SPA'
            ? approvalByKey.get(`SPA:${item.sessionKey}`)
            : undefined);
        if (!row && item.kind !== 'SPA') return item;
        const phase = row
          ? this.sessionApproval.phase(row)
          : 'PENDING_PERFORMER';
        return {
          ...item,
          approvalPhase: phase,
          approvalLabel:
            item.kind === 'SPA' && phase === 'PENDING_PERFORMER'
              ? 'Ждёт специалиста'
              : sessionApprovalLabelRu(phase),
        };
      });
    }

    if (filters.status && filters.status !== 'ALL') {
      out = out.filter((i) => i.status === filters.status);
    }
    if (filters.needsReview) {
      out = out.filter(
        (i) =>
          i.needsReview ||
          i.approvalPhase === 'PENDING_TRAINER' ||
          i.approvalPhase === 'PENDING_ADMIN' ||
          i.approvalPhase === 'PENDING_PERFORMER',
      );
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
      let s = await this.prisma.onexClassSession.findFirst({
        where: { clubId, externalId: parsed.id, isActive: true },
        include: { members: true },
      });
      if (!s) {
        // Future / freshly published class may not be in Onex yet — pull ± window once.
        try {
          await this.classSessions.syncRange(
            clubId,
            this.ymdDaysAgo(7),
            this.ymdDaysAhead(31),
          );
        } catch {
          /* ignore */
        }
        s = await this.prisma.onexClassSession.findFirst({
          where: { clubId, externalId: parsed.id, isActive: true },
          include: { members: true },
        });
      }
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
        attendance: (m.cancelled
          ? 'CANCELLED'
          : m.attendance) as BookingControlMember['attendance'],
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

      const groupApproval =
        kind === 'GROUP'
          ? await this.loadGroupApprovalInfo(
              clubId,
              sessionKey,
              members,
              counts.arrivedCount,
              s.payrollLocked,
            )
          : null;
      if (groupApproval) {
        const seen = new Set(groupApproval.trainerSeenClientIds);
        for (const m of members) {
          m.trainerSeen = seen.has(m.externalId);
        }
      }

      let approvalPhase:
        | GroupApprovalPhase
        | SessionApprovalPhase
        | undefined = groupApproval?.phase;
      let approvalLabel = groupApprovalLabelRu(groupApproval?.phase);
      if (kind === 'SPA') {
        const approvalId = matched?.id ?? sessionKey;
        const row = await this.prisma.sessionApproval.findUnique({
          where: {
            kind_bookingId: {
              kind: SessionApprovalKind.SPA,
              bookingId: approvalId,
            },
          },
        });
        const end = s.endAt ?? s.startAt;
        const controlStatus = mapOnexStatusToControl(s.status);
        const ended = end.getTime() <= Date.now();
        if (
          controlStatus !== 'CANCELLED' &&
          (controlStatus !== 'SCHEDULED' || ended)
        ) {
          const spaPhase: SessionApprovalPhase = row
            ? this.sessionApproval.phase(row)
            : 'PENDING_PERFORMER';
          approvalPhase = spaPhase;
          approvalLabel =
            spaPhase === 'PENDING_PERFORMER'
              ? 'Ждёт специалиста'
              : sessionApprovalLabelRu(spaPhase);
        }
      }

      let spaPayment = payment;
      let spaPayTag = payTag;
      let spaSettlement: SpaSettlementInfo | undefined;
      if (kind === 'SPA') {
        const spaBooking =
          matched?.id
            ? await this.prisma.spaBooking.findFirst({
                where: { id: matched.id, clubId },
                include: {
                  client: { select: { externalId: true } },
                  specialist: {
                    select: { externalId: true, employeeCode: true },
                  },
                },
              })
            : null;
        const settled = await this.resolveSpaSettlement({
          booking: spaBooking,
          onex: s,
          paySource: primary?.paySource,
          paymentBasis: primary?.paymentBasis,
        });
        spaSettlement = settled.settlement;
        spaPayment = settled.payment;
        spaPayTag = settled.payTag;
      }

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
        payment: spaPayment,
        payTag: spaPayTag,
        needsReview: Boolean(open),
        approvalPhase,
        approvalLabel,
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
        groupApproval,
        spaSettlement,
      };
    }

    if (parsed.source === 'SALE') {
      // Prefer list cache (no 1C round-trip). Fallback: one ≤30d fetch, never multi-window loops.
      const sale = await this.findTrainerPtSale(parsed.id);
      if (!sale) throw new NotFoundException('Продажа не найдена');
      if (viewer?.ownOnly) {
        await this.assertOwnSale(clubId, viewer.userId, sale);
      }
      return this.mapSaleDetail(sessionKey, sale, open, mappedRemarks);
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
      const approval = await this.loadSessionApprovalInfo(clubId, 'PT', b.id);
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
        approvalPhase: approval?.phase,
        approvalLabel: sessionApprovalLabelRu(approval?.phase),
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
      const approval = await this.loadSessionApprovalInfo(clubId, 'SPA', b.id);
      const settled = await this.resolveSpaSettlement({
        booking: {
          id: b.id,
          paymentType: b.paymentType,
          paymentStatus: b.paymentStatus,
          consumedInCrmAt: b.consumedInCrmAt,
          crmDocRef: b.crmDocRef,
          startAt: b.startAt,
          partnerSource: b.partnerSource,
          client: b.client,
          clientExternalId: b.clientExternalId,
          specialist: b.specialist,
        },
      });
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
        clientName: this.spaClientLabel(b),
        attendeeCount: counts.arrivedCount,
        bookedCount: counts.bookedCount,
        arrivedCount: counts.arrivedCount,
        noShowCount: counts.noShowCount,
        payment: settled.payment,
        payTag: settled.payTag,
        needsReview: Boolean(open),
        fitgoBookingId: b.id,
        approvalPhase: approval?.phase,
        approvalLabel:
          approval?.phase === 'PENDING_PERFORMER'
            ? 'Ждёт специалиста'
            : sessionApprovalLabelRu(approval?.phase),
        members: [],
        remark: open,
        remarksHistory: mappedRemarks,
        fitgoBookedAt: b.createdAt.toISOString(),
        crmDocRef: b.crmDocRef ?? undefined,
        priceMinor: b.priceMinor ?? b.service.priceMinor,
        spaSettlement: settled.settlement,
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
    if (session.payrollLocked) {
      throw new BadRequestException(
        'Период ЗП закрыт — явку менять нельзя',
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

  /** Trainer checkmarks (FitGO-only). Changing after admin confirm clears admin approval. */
  async saveTrainerSeen(
    actor: JwtPayload,
    sessionKey: string,
    seenClientIds: string[],
  ): Promise<BookingControlDetail> {
    const clubId = requireClubId(actor);
    const session = await this.requireGroupOnex(clubId, sessionKey);
    await this.assertOwnOnex(clubId, actor.sub, session);
    this.assertGroupEditable(session);

    const allowed = new Set(
      session.members.filter((m) => !m.cancelled).map((m) => m.externalId),
    );
    const clean = [
      ...new Set(
        (seenClientIds ?? [])
          .map((id) => String(id).trim())
          .filter((id) => id && allowed.has(id)),
      ),
    ];

    const existing = await this.prisma.groupClassApproval.findUnique({
      where: {
        clubId_sessionKey: { clubId, sessionKey },
      },
    });

    const clearAdmin = Boolean(
      existing?.adminApprovedAt || existing?.overrideApprovedAt,
    );

    await this.prisma.groupClassApproval.upsert({
      where: { clubId_sessionKey: { clubId, sessionKey } },
      create: {
        clubId,
        sessionKey,
        trainerSeenClientIds: clean,
      },
      update: {
        trainerSeenClientIds: clean,
        ...(clearAdmin
          ? {
              adminUserId: null,
              adminName: null,
              adminApprovedAt: null,
              adminComment: null,
              overrideUserId: null,
              overrideName: null,
              overrideApprovedAt: null,
              overrideComment: null,
            }
          : {}),
      },
    });

    return this.detail(clubId, sessionKey, {
      userId: actor.sub,
      ownOnly: true,
    });
  }

  /**
   * Confirm GROUP session.
   * Trainer → PENDING_ADMIN; Admin → APPROVED; SA/Manager → override APPROVED.
   */
  async approveGroup(
    actor: JwtPayload,
    sessionKey: string,
    comment?: string,
  ): Promise<BookingControlDetail> {
    const parsed = parseSessionKey(sessionKey);
    if (
      parsed?.source === 'FITGO' &&
      (parsed.kind === 'PT' || parsed.kind === 'SPA')
    ) {
      return this.approveFitgoBooking(
        actor,
        parsed.kind,
        parsed.id,
        comment,
      );
    }

    const clubId = requireClubId(actor);
    if (parsed?.source === '1C') {
      const onexSpa = await this.prisma.onexClassSession.findFirst({
        where: { clubId, externalId: parsed.id, isActive: true },
      });
      if (onexSpa?.kind === OnexClassKind.SPA) {
        return this.approveSpaFromOnex(actor, onexSpa, comment);
      }
    }
    const session = await this.requireGroupOnex(clubId, sessionKey);
    this.assertGroupEditable(session);
    this.assertSessionEnded(session);

    const roles = actor.roles ?? [];
    const isOverride =
      roles.includes(UserRole.SUPER_ADMIN) ||
      roles.includes(UserRole.MANAGER);
    const isAdmin = roles.includes(UserRole.ADMIN);
    const isTrainer = roles.includes(UserRole.TRAINER);

    if (!isOverride && !isAdmin && !isTrainer) {
      throw new ForbiddenException('Нет прав на подтверждение');
    }

    if (!isOverride && !isAdmin) {
      await this.assertOwnOnex(clubId, actor.sub, session);
    }

    const actorName = await this.actorDisplayName(clubId, actor.sub);
    const note = comment?.trim() || null;
    const now = new Date();

    const existing = await this.prisma.groupClassApproval.findUnique({
      where: { clubId_sessionKey: { clubId, sessionKey } },
    });

    if (isOverride) {
      await this.prisma.groupClassApproval.upsert({
        where: { clubId_sessionKey: { clubId, sessionKey } },
        create: {
          clubId,
          sessionKey,
          overrideUserId: actor.sub,
          overrideName: actorName,
          overrideApprovedAt: now,
          overrideComment: note,
          returnedByUserId: null,
          returnedByName: null,
          returnedAt: null,
          returnComment: null,
        },
        update: {
          overrideUserId: actor.sub,
          overrideName: actorName,
          overrideApprovedAt: now,
          overrideComment: note,
          returnedByUserId: null,
          returnedByName: null,
          returnedAt: null,
          returnComment: null,
        },
      });
    } else if (isAdmin) {
      if (!existing?.trainerApprovedAt) {
        throw new BadRequestException(
          'Сначала тренер должен подтвердить занятие',
        );
      }
      await this.prisma.groupClassApproval.update({
        where: { clubId_sessionKey: { clubId, sessionKey } },
        data: {
          adminUserId: actor.sub,
          adminName: actorName,
          adminApprovedAt: now,
          adminComment: note,
          returnedByUserId: null,
          returnedByName: null,
          returnedAt: null,
          returnComment: null,
        },
      });
    } else {
      // Trainer
      await this.prisma.groupClassApproval.upsert({
        where: { clubId_sessionKey: { clubId, sessionKey } },
        create: {
          clubId,
          sessionKey,
          trainerUserId: actor.sub,
          trainerName: actorName,
          trainerApprovedAt: now,
          trainerComment: note,
          trainerSeenClientIds: existing?.trainerSeenClientIds ?? [],
        },
        update: {
          trainerUserId: actor.sub,
          trainerName: actorName,
          trainerApprovedAt: now,
          trainerComment: note,
          // Re-confirm after rework clears prior admin/override
          adminUserId: null,
          adminName: null,
          adminApprovedAt: null,
          adminComment: null,
          overrideUserId: null,
          overrideName: null,
          overrideApprovedAt: null,
          overrideComment: null,
          returnedByUserId: null,
          returnedByName: null,
          returnedAt: null,
          returnComment: null,
        },
      });
    }

    return this.detail(clubId, sessionKey, {
      userId: actor.sub,
      ownOnly: !isOverride && !isAdmin,
    });
  }

  /** Confirm FitGO PT/SPA booking via SessionApproval (performer → admin → payroll). */
  private async approveFitgoBooking(
    actor: JwtPayload,
    kind: 'PT' | 'SPA',
    bookingId: string,
    _comment?: string,
  ): Promise<BookingControlDetail> {
    const clubId = requireClubId(actor);
    const roles = actor.roles ?? [];
    const isOverride =
      roles.includes(UserRole.SUPER_ADMIN) ||
      roles.includes(UserRole.MANAGER);
    const isAdmin = roles.includes(UserRole.ADMIN);
    const isPerformer =
      (kind === 'PT' && roles.includes(UserRole.TRAINER)) ||
      (kind === 'SPA' && roles.includes(UserRole.SPECIALIST));

    if (!isOverride && !isAdmin && !isPerformer) {
      throw new ForbiddenException('Нет прав на подтверждение');
    }

    const prismaKind =
      kind === 'PT' ? SessionApprovalKind.PT : SessionApprovalKind.SPA;

    if (kind === 'SPA') {
      const booking = await this.prisma.spaBooking.findFirst({
        where: { id: bookingId, clubId },
      });
      if (!booking) throw new NotFoundException('Запись не найдена');
      if (booking.status === SpaBookingStatus.CANCELLED) {
        throw new BadRequestException('Запись отменена');
      }
      this.assertSessionEnded(booking);
    }

    if (isOverride) {
      await this.sessionApproval.ensureApproval(prismaKind, bookingId, clubId);
      await this.prisma.sessionApproval.update({
        where: {
          kind_bookingId: { kind: prismaKind, bookingId },
        },
        data: {
          overrideApprovedAt: new Date(),
          overrideApprovedById: actor.sub,
          returnedAt: null,
          returnReason: null,
        },
      });
    } else if (isAdmin) {
      const row = await this.sessionApproval.ensureApproval(
        prismaKind,
        bookingId,
        clubId,
      );
      if (!row.performerConfirmedAt) {
        throw new BadRequestException(
          'Сначала исполнитель должен подтвердить запись',
        );
      }
      await this.sessionApproval.adminApprove(actor, prismaKind, bookingId);
    } else {
      await this.sessionApproval.confirmPerformer(actor, prismaKind, bookingId);
    }

    return this.detail(clubId, fitgoSessionKey(kind, bookingId), {
      userId: actor.sub,
      ownOnly: !isOverride && !isAdmin,
    });
  }

  /** 1C SPA session with no FitGO booking: same two-step approval, keyed by 1c:{id}. */
  private async approveSpaFromOnex(
    actor: JwtPayload,
    session: {
      externalId: string;
      number: string | null;
      startAt: Date;
      endAt: Date | null;
      employeeExternalId: string | null;
      title: string;
      payrollLocked: boolean;
    },
    _comment?: string,
  ): Promise<BookingControlDetail> {
    const clubId = requireClubId(actor);
    this.assertGroupEditable(session);
    this.assertSessionEnded(session);

    const matched = await this.findMatchingFitgoBooking(
      clubId,
      'SPA',
      session,
      undefined,
    );
    if (matched) {
      return this.approveFitgoBooking(actor, 'SPA', matched.id, _comment);
    }

    const roles = actor.roles ?? [];
    const isOverride =
      roles.includes(UserRole.SUPER_ADMIN) ||
      roles.includes(UserRole.MANAGER);
    const isAdmin = roles.includes(UserRole.ADMIN);
    const isPerformer = roles.includes(UserRole.SPECIALIST);
    if (!isOverride && !isAdmin && !isPerformer) {
      throw new ForbiddenException('Нет прав на подтверждение');
    }
    if (!isOverride && !isAdmin && session.employeeExternalId) {
      const user = await this.prisma.user.findFirst({
        where: { id: actor.sub, clubId },
        select: { externalId: true },
      });
      if (
        user?.externalId &&
        user.externalId !== session.employeeExternalId
      ) {
        throw new ForbiddenException('Чужое занятие');
      }
    }

    const bookingId = onexSessionKey(session.externalId);
    const now = new Date();
    if (isOverride) {
      await this.prisma.sessionApproval.upsert({
        where: { kind_bookingId: { kind: SessionApprovalKind.SPA, bookingId } },
        create: {
          clubId,
          kind: SessionApprovalKind.SPA,
          bookingId,
          overrideApprovedAt: now,
          overrideApprovedById: actor.sub,
        },
        update: {
          overrideApprovedAt: now,
          overrideApprovedById: actor.sub,
          returnedAt: null,
          returnReason: null,
        },
      });
    } else if (isAdmin) {
      const row = await this.sessionApproval.ensureApproval(
        SessionApprovalKind.SPA,
        bookingId,
        clubId,
      );
      if (!row.performerConfirmedAt) {
        throw new BadRequestException(
          'Сначала специалист должен подтвердить запись',
        );
      }
      await this.sessionApproval.adminApprove(
        actor,
        SessionApprovalKind.SPA,
        bookingId,
      );
    } else {
      await this.prisma.sessionApproval.upsert({
        where: { kind_bookingId: { kind: SessionApprovalKind.SPA, bookingId } },
        create: {
          clubId,
          kind: SessionApprovalKind.SPA,
          bookingId,
          performerConfirmedAt: now,
        },
        update: {
          performerConfirmedAt: now,
          adminApprovedAt: null,
          adminApprovedById: null,
          overrideApprovedAt: null,
          overrideApprovedById: null,
          returnedAt: null,
          returnReason: null,
        },
      });
    }

    return this.detail(clubId, bookingId, {
      userId: actor.sub,
      ownOnly: !isOverride && !isAdmin,
    });
  }

  /**
   * Manager / super-admin: stamp many ended GROUP sessions as trainer or admin.
   * Either stamp makes the session payroll-eligible.
   */
  async bulkApproveGroups(
    actor: JwtPayload,
    input: {
      from: string;
      to: string;
      role: 'trainer' | 'admin';
      sessionKeys: string[];
    },
  ): Promise<{ confirmed: number; skipped: number }> {
    const roles = actor.roles ?? [];
    if (
      !roles.includes(UserRole.SUPER_ADMIN) &&
      !roles.includes(UserRole.MANAGER)
    ) {
      throw new ForbiddenException(
        'Массовое подтверждение доступно управляющему и супер-админу',
      );
    }
    if (input.role !== 'trainer' && input.role !== 'admin') {
      throw new BadRequestException('Укажите подтверждение: тренер или админ');
    }
    const keys = [
      ...new Set(
        (input.sessionKeys ?? []).map((k) => k.trim()).filter(Boolean),
      ),
    ];
    if (!keys.length) {
      throw new BadRequestException('Не выбраны занятия');
    }
    const fromD = new Date(`${input.from.trim()}T00:00:00`);
    const toD = new Date(`${input.to.trim()}T23:59:59.999`);
    if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime())) {
      throw new BadRequestException('Некорректные даты from/to');
    }

    const clubId = requireClubId(actor);
    const actorName = await this.actorDisplayName(clubId, actor.sub);
    const now = new Date();
    const externalIds = keys
      .map((k) => parseSessionKey(k))
      .filter((p): p is NonNullable<typeof p> => p?.source === '1C')
      .map((p) => p.id);

    const sessions = await this.prisma.onexClassSession.findMany({
      where: {
        clubId,
        kind: OnexClassKind.GROUP,
        isActive: true,
        externalId: { in: externalIds },
        startAt: { gte: fromD, lte: toD },
      },
    });
    const approvals = await this.prisma.groupClassApproval.findMany({
      where: { clubId, sessionKey: { in: keys } },
    });
    const byExt = new Map(sessions.map((s) => [s.externalId, s]));
    const byKey = new Map(approvals.map((a) => [a.sessionKey, a]));

    let confirmed = 0;
    let skipped = 0;
    for (const key of keys) {
      const parsed = parseSessionKey(key);
      const session =
        parsed?.source === '1C' ? byExt.get(parsed.id) : undefined;
      if (!session) {
        skipped += 1;
        continue;
      }
      const endedAt = session.endAt ?? session.startAt;
      if (
        session.payrollLocked ||
        session.status === OnexClassStatus.CANCELLED ||
        endedAt > now
      ) {
        skipped += 1;
        continue;
      }
      const row = byKey.get(key);
      if (row?.adminApprovedAt || row?.overrideApprovedAt) {
        skipped += 1;
        continue;
      }

      const clearReturn = {
        returnedByUserId: null,
        returnedByName: null,
        returnedAt: null,
        returnComment: null,
      };

      if (input.role === 'admin') {
        await this.prisma.groupClassApproval.upsert({
          where: { clubId_sessionKey: { clubId, sessionKey: key } },
          create: {
            clubId,
            sessionKey: key,
            adminUserId: actor.sub,
            adminName: actorName,
            adminApprovedAt: now,
            adminComment: 'Массовое подтверждение админом',
          },
          update: {
            adminUserId: actor.sub,
            adminName: actorName,
            adminApprovedAt: now,
            adminComment: 'Массовое подтверждение админом',
            ...clearReturn,
          },
        });
      } else {
        await this.prisma.groupClassApproval.upsert({
          where: { clubId_sessionKey: { clubId, sessionKey: key } },
          create: {
            clubId,
            sessionKey: key,
            trainerUserId: actor.sub,
            trainerName: actorName,
            trainerApprovedAt: now,
            trainerComment: 'Массовое подтверждение тренером',
            overrideUserId: actor.sub,
            overrideName: actorName,
            overrideApprovedAt: now,
            overrideComment: 'Массовое подтверждение тренером',
          },
          update: {
            ...(row?.trainerApprovedAt
              ? {}
              : {
                  trainerUserId: actor.sub,
                  trainerName: actorName,
                  trainerApprovedAt: now,
                  trainerComment: 'Массовое подтверждение тренером',
                }),
            overrideUserId: actor.sub,
            overrideName: actorName,
            overrideApprovedAt: now,
            overrideComment: 'Массовое подтверждение тренером',
            ...clearReturn,
          },
        });
      }
      confirmed += 1;
    }

    return { confirmed, skipped };
  }

  /** Admin / SA / Manager: return GROUP to trainer for rework. */
  async returnGroupApproval(
    actor: JwtPayload,
    sessionKey: string,
    comment?: string,
  ): Promise<BookingControlDetail> {
    const clubId = requireClubId(actor);
    if (!this.isAdminLike(actor)) {
      throw new ForbiddenException('Только администратор');
    }
    const session = await this.requireGroupOnex(clubId, sessionKey);
    this.assertGroupEditable(session);

    const actorName = await this.actorDisplayName(clubId, actor.sub);
    const note = comment?.trim() || null;
    const now = new Date();

    await this.prisma.groupClassApproval.upsert({
      where: { clubId_sessionKey: { clubId, sessionKey } },
      create: {
        clubId,
        sessionKey,
        returnedByUserId: actor.sub,
        returnedByName: actorName,
        returnedAt: now,
        returnComment: note,
      },
      update: {
        trainerUserId: null,
        trainerName: null,
        trainerApprovedAt: null,
        trainerComment: null,
        adminUserId: null,
        adminName: null,
        adminApprovedAt: null,
        adminComment: null,
        overrideUserId: null,
        overrideName: null,
        overrideApprovedAt: null,
        overrideComment: null,
        returnedByUserId: actor.sub,
        returnedByName: actorName,
        returnedAt: now,
        returnComment: note,
      },
    });

    return this.detail(clubId, sessionKey);
  }

  /** Shared admin inbox: GROUP sessions waiting for admin confirm. */
  async listPendingAdminApprovals(
    clubId: string,
    from?: string,
    to?: string,
  ): Promise<GroupApprovalPendingTask[]> {
    const fromD = new Date(
      `${from?.trim() || this.ymdDaysAgo(30)}T00:00:00`,
    );
    const toD = new Date(
      `${to?.trim() || this.ymdToday()}T23:59:59.999`,
    );

    const now = new Date();
    const sessions = await this.prisma.onexClassSession.findMany({
      where: {
        clubId,
        kind: OnexClassKind.GROUP,
        isActive: true,
        status: { not: OnexClassStatus.CANCELLED },
        startAt: { gte: fromD, lte: toD },
        payrollLocked: false,
      },
      include: { members: true },
      orderBy: { startAt: 'desc' },
      take: 200,
    });

    const keys = sessions.map((s) => onexSessionKey(s.externalId));
    const approvals = await this.prisma.groupClassApproval.findMany({
      where: { clubId, sessionKey: { in: keys } },
    });
    const byKey = new Map(approvals.map((a) => [a.sessionKey, a]));

    const out: GroupApprovalPendingTask[] = [];
    for (const s of sessions) {
      const endedAt = s.endAt ?? s.startAt;
      if (endedAt > now) continue;
      if (s.status === OnexClassStatus.SCHEDULED && endedAt > now) continue;
      const sessionKey = onexSessionKey(s.externalId);
      const row = byKey.get(sessionKey);
      const phase = groupApprovalPhase({
        trainerApprovedAt: row?.trainerApprovedAt?.toISOString() ?? null,
        adminApprovedAt: row?.adminApprovedAt?.toISOString() ?? null,
        overrideApprovedAt: row?.overrideApprovedAt?.toISOString() ?? null,
      });
      if (phase !== 'PENDING_ADMIN') continue;

      const members: BookingControlMember[] = s.members.map((m) => ({
        externalId: m.externalId,
        clientName: m.clientName,
        attendance: (m.cancelled
          ? 'CANCELLED'
          : m.attendance) as BookingControlMember['attendance'],
      }));
      this.promoteGroupAttendanceFromHeader(
        members,
        s.headerAttendedCount ?? 0,
        s.status,
      );
      const counts = this.attendanceCounts(
        members,
        Math.max(s.attendedCount ?? 0, s.headerAttendedCount ?? 0),
      );
      const seenIds = this.parseSeenIds(row?.trainerSeenClientIds);

      out.push({
        sessionKey,
        title: s.title,
        startAt: s.startAt.toISOString(),
        endAt: s.endAt?.toISOString(),
        performerName: s.employeeName?.trim() || '—',
        trainerName: row?.trainerName ?? undefined,
        trainerApprovedAt: row?.trainerApprovedAt?.toISOString(),
        roomTitle: s.roomTitle ?? undefined,
        number: s.number ?? undefined,
        bookedCount: counts.bookedCount,
        arrivedCount: counts.arrivedCount,
        trainerSeenCount: seenIds.length,
      });
    }
    return out;
  }

  /** Session keys with payroll-eligible GROUP approval. */
  async approvedGroupSessionKeys(
    clubId: string,
    keys: string[],
  ): Promise<Set<string>> {
    if (!keys.length) return new Set();
    const rows = await this.prisma.groupClassApproval.findMany({
      where: {
        clubId,
        sessionKey: { in: keys },
        OR: [
          { adminApprovedAt: { not: null } },
          { overrideApprovedAt: { not: null } },
        ],
      },
      select: { sessionKey: true },
    });
    return new Set(rows.map((r) => r.sessionKey));
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

  private parseSeenIds(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((x) => String(x)).filter(Boolean);
  }

  private async actorDisplayName(
    clubId: string,
    userId: string,
  ): Promise<string> {
    const u = await this.prisma.user.findFirst({
      where: { id: userId, clubId },
      select: { firstName: true, lastName: true },
    });
    if (!u) return '—';
    return `${u.lastName} ${u.firstName}`.trim();
  }

  private async requireGroupOnex(clubId: string, sessionKey: string) {
    const parsed = parseSessionKey(sessionKey);
    if (!parsed || parsed.source !== '1C') {
      throw new BadRequestException(
        'Подтверждение доступно только для группового занятия из 1С',
      );
    }
    const session = await this.prisma.onexClassSession.findFirst({
      where: { clubId, externalId: parsed.id, isActive: true },
      include: { members: true },
    });
    if (!session) throw new NotFoundException('Занятие не найдено');
    if (session.kind !== OnexClassKind.GROUP) {
      throw new BadRequestException(
        'Подтверждение доступно только для групповых занятий',
      );
    }
    return session;
  }

  private assertGroupEditable(session: { payrollLocked: boolean }) {
    if (session.payrollLocked) {
      throw new BadRequestException(
        'Период ЗП закрыт — занятие только для просмотра',
      );
    }
  }

  private assertSessionEnded(session: {
    endAt: Date | null;
    startAt: Date;
  }) {
    const end = session.endAt ?? session.startAt;
    if (end > new Date()) {
      throw new BadRequestException('Занятие ещё не закончилось');
    }
  }

  private async loadSessionApprovalInfo(
    clubId: string,
    kind: 'PT' | 'SPA',
    bookingId: string,
  ) {
    const row = await this.sessionApproval.ensureApproval(kind, bookingId, clubId);
    const phase = this.sessionApproval.phase(row);
    return {
      phase,
      payrollEligible: this.sessionApproval.isPayrollEligible(row),
    };
  }

  private async loadGroupApprovalInfo(
    clubId: string,
    sessionKey: string,
    _members: BookingControlMember[],
    _arrivedCount: number,
    payrollLocked: boolean,
  ): Promise<GroupClassApprovalInfo> {
    const row = await this.prisma.groupClassApproval.findUnique({
      where: { clubId_sessionKey: { clubId, sessionKey } },
    });
    const seenIds = this.parseSeenIds(row?.trainerSeenClientIds);
    const phase = groupApprovalPhase({
      trainerApprovedAt: row?.trainerApprovedAt?.toISOString() ?? null,
      adminApprovedAt: row?.adminApprovedAt?.toISOString() ?? null,
      overrideApprovedAt: row?.overrideApprovedAt?.toISOString() ?? null,
    });
    return {
      trainerSeenClientIds: seenIds,
      trainerName: row?.trainerName ?? undefined,
      trainerApprovedAt: row?.trainerApprovedAt?.toISOString(),
      trainerComment: row?.trainerComment ?? undefined,
      adminName: row?.adminName ?? undefined,
      adminApprovedAt: row?.adminApprovedAt?.toISOString(),
      adminComment: row?.adminComment ?? undefined,
      overrideName: row?.overrideName ?? undefined,
      overrideApprovedAt: row?.overrideApprovedAt?.toISOString(),
      overrideComment: row?.overrideComment ?? undefined,
      returnedByName: row?.returnedByName ?? undefined,
      returnedAt: row?.returnedAt?.toISOString(),
      returnComment: row?.returnComment ?? undefined,
      phase,
      trainerSeenCount: seenIds.length,
      payrollEligible: groupApprovalPayrollEligible({
        adminApprovedAt: row?.adminApprovedAt?.toISOString() ?? null,
        overrideApprovedAt: row?.overrideApprovedAt?.toISOString() ?? null,
      }),
      locked: payrollLocked,
    };
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

  private readonly ptSalesCache = new Map<
    string,
    { at: number; rows: SpecialistServiceDebt[] }
  >();

  /** docRef / externalId → sale (filled on list; used by detail to avoid 1C). */
  private readonly ptSaleByDoc = new Map<
    string,
    { at: number; sale: SpecialistServiceDebt }
  >();

  private indexTrainerPtSales(rows: SpecialistServiceDebt[]) {
    const at = Date.now();
    for (const sale of rows) {
      const key = (sale.docRef || sale.externalId || '').trim();
      if (!key) continue;
      this.ptSaleByDoc.set(key, { at, sale });
    }
  }

  private lookupTrainerPtSale(
    docOrExt: string,
  ): SpecialistServiceDebt | undefined {
    const keyed = this.ptSaleByDoc.get(docOrExt);
    if (keyed && Date.now() - keyed.at < 10 * 60_000) return keyed.sale;
    for (const entry of this.ptSalesCache.values()) {
      if (Date.now() - entry.at > 60_000) continue;
      const hit = entry.rows.find(
        (r) => (r.docRef || r.externalId) === docOrExt,
      );
      if (hit) return hit;
    }
    return undefined;
  }

  private async fetchTrainerPtSales(
    from: string,
    to: string,
  ): Promise<SpecialistServiceDebt[]> {
    const key = `${from}|${to}`;
    const hit = this.ptSalesCache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.rows;

    const provider = this.fitness.getProvider();
    const fn = provider.getTrainerPtSales;
    if (!fn) return [];
    try {
      // Hard cap so a hung / missing 1C template cannot block list/detail.
      const rows = await Promise.race([
        fn.call(provider, { from, to }),
        new Promise<SpecialistServiceDebt[]>((_, reject) =>
          setTimeout(() => reject(new Error('trainer-pt-sales timeout')), 5_000),
        ),
      ]);
      const list = Array.isArray(rows) ? rows : [];
      this.ptSalesCache.set(key, { at: Date.now(), rows: list });
      this.indexTrainerPtSales(list);
      return list;
    } catch {
      this.ptSalesCache.set(key, { at: Date.now(), rows: [] });
      return [];
    }
  }

  /** Prefer in-memory index from list; at most one ≤30d 1C fetch. */
  private async findTrainerPtSale(
    docOrExt: string,
  ): Promise<SpecialistServiceDebt | undefined> {
    const cached = this.lookupTrainerPtSale(docOrExt);
    if (cached) return cached;
    const sales = await this.fetchTrainerPtSales(
      this.ymdDaysAgo(30),
      this.ymdToday(),
    );
    return sales.find((r) => (r.docRef || r.externalId) === docOrExt);
  }

  private mapSaleDetail(
    sessionKey: string,
    sale: SpecialistServiceDebt,
    open: BookingControlRemark | null,
    mappedRemarks: BookingControlRemark[],
  ): BookingControlDetail {
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

  private ymdDaysAhead(n: number): string {
    return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
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

  private spaClientLabel(b: {
    guestName?: string | null;
    client: { firstName: string; lastName: string } | null;
  }) {
    if (b.client) {
      const name = `${b.client.lastName} ${b.client.firstName}`.trim();
      if (name) return name;
    }
    return b.guestName?.trim() || 'Гость';
  }

  /**
   * SPA settlement vs 1C: quota visit posted, or paid sale / open debt by crmDocRef.
   * Debts call is capped (~6s) so the card never hangs.
   */
  private async resolveSpaSettlement(input: {
    booking?: {
      id: string;
      paymentType: SpaPaymentType;
      paymentStatus: ServicePaymentStatus;
      consumedInCrmAt: Date | null;
      crmDocRef: string | null;
      startAt: Date;
      partnerSource?: string | null;
      clientExternalId?: string | null;
      client?: { externalId: string | null } | null;
      specialist?: {
        externalId: string | null;
        employeeCode?: string | null;
      } | null;
    } | null;
    onex?: {
      externalId: string;
      number: string | null;
      status: OnexClassStatus;
      startAt: Date;
      employeeExternalId: string | null;
    } | null;
    paySource?: string | null;
    paymentBasis?: string | null;
  }): Promise<{
    settlement: SpaSettlementInfo;
    payment: BookingControlPayment;
    payTag?: BookingControlPayTag;
  }> {
    const booking = input.booking;
    const onex = input.onex;
    const partner =
      booking?.partnerSource?.toUpperCase() === 'ALLSPORTS';
    if (partner) {
      return {
        settlement: {
          status: 'PAID',
          label: spaSettlementLabelRu('PAID'),
          source: 'local',
        },
        payment: 'PARTNER',
        payTag: 'SALE',
      };
    }

    const isQuota =
      booking?.paymentType === SpaPaymentType.QUOTA ||
      (input.paySource ?? '').toUpperCase() === 'PACKAGE' ||
      /членств|абонемент|пакет|квот/i.test(input.paymentBasis ?? '');

    const clientExt =
      booking?.client?.externalId?.trim() ||
      booking?.clientExternalId?.trim() ||
      undefined;
    const bookingRef = booking?.id;
    const crmRef = booking?.crmDocRef?.trim() || onex?.externalId || undefined;

    let visit: {
      found: boolean;
      cancelled: boolean;
      posted?: boolean;
      num?: string;
    } | null = null;
    if (clientExt && bookingRef) {
      const getStatus = this.fitness.getProvider().getSpaVisitStatus;
      if (getStatus) {
        try {
          visit = await Promise.race([
            getStatus.call(this.fitness.getProvider(), clientExt, {
              bookingRef,
            }),
            new Promise<null>((resolve) =>
              setTimeout(() => resolve(null), 5_000),
            ),
          ]);
        } catch {
          visit = null;
        }
      }
    }

    if (visit?.cancelled) {
      return {
        settlement: {
          status: 'CANCELLED_IN_1C',
          label: spaSettlementLabelRu('CANCELLED_IN_1C'),
          source: 'visit',
          visitPosted: visit.posted,
          visitNum: visit.num,
        },
        payment: isQuota ? 'QUOTA' : 'UNKNOWN',
        payTag: isQuota ? 'PACKAGE' : 'SALE',
      };
    }

    if (isQuota) {
      const posted =
        visit?.posted === true ||
        Boolean(booking?.consumedInCrmAt) ||
        onex?.status === OnexClassStatus.COMPLETED;
      const foundIn1c =
        visit?.found === true ||
        Boolean(onex) ||
        Boolean(booking?.consumedInCrmAt);
      if (posted && foundIn1c) {
        return {
          settlement: {
            status: 'QUOTA_CONSUMED',
            label: spaSettlementLabelRu('QUOTA_CONSUMED'),
            source: visit?.found ? 'visit' : onex ? 'onex' : 'local',
            visitPosted: true,
            visitNum: visit?.num ?? onex?.number ?? undefined,
          },
          payment: 'QUOTA',
          payTag: 'PACKAGE',
        };
      }
      if (!foundIn1c && !booking?.consumedInCrmAt) {
        return {
          settlement: {
            status: 'NOT_IN_1C',
            label: spaSettlementLabelRu('NOT_IN_1C'),
            source: 'local',
          },
          payment: 'QUOTA',
          payTag: 'PACKAGE',
        };
      }
      return {
        settlement: {
          status: 'UNKNOWN',
          label: spaSettlementLabelRu('UNKNOWN'),
          source: 'local',
          visitPosted: visit?.posted,
          visitNum: visit?.num,
        },
        payment: 'QUOTA',
        payTag: 'PACKAGE',
      };
    }

    // Paid path — check specialist debts by crmDocRef / bookingRef (short timeout).
    const employeeCode =
      booking?.specialist?.employeeCode?.trim() ||
      booking?.specialist?.externalId?.trim() ||
      onex?.employeeExternalId?.trim() ||
      '';
    const day = (booking?.startAt ?? onex?.startAt ?? new Date())
      .toISOString()
      .slice(0, 10);
    let debtHit: SpecialistServiceDebt | null = null;
    const debtsFn = this.fitness.getProvider().getSpecialistServiceDebts;
    if (debtsFn && employeeCode) {
      try {
        const debts = await Promise.race([
          debtsFn.call(this.fitness.getProvider(), {
            from: day,
            to: day,
            employeeCode,
          }),
          new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), 6_000),
          ),
        ]);
        if (Array.isArray(debts)) {
          debtHit =
            debts.find((d) => {
              if (bookingRef && d.bookingRef === bookingRef) return true;
              if (crmRef && d.docRef && d.docRef === crmRef) return true;
              if (
                crmRef &&
                d.docRef &&
                (d.docRef.includes(crmRef) || crmRef.includes(d.docRef))
              ) {
                return true;
              }
              if (
                onex?.number &&
                d.docRef &&
                d.docRef.includes(onex.number)
              ) {
                return true;
              }
              return false;
            }) ?? null;
        }
      } catch {
        debtHit = null;
      }
    }

    if (debtHit?.paymentStatus === 'PAID') {
      if (
        booking?.id &&
        booking.paymentStatus !== ServicePaymentStatus.PAID
      ) {
        await this.prisma.spaBooking
          .update({
            where: { id: booking.id },
            data: {
              paymentStatus: ServicePaymentStatus.PAID,
              paidAt: new Date(),
            },
          })
          .catch(() => undefined);
      }
      return {
        settlement: {
          status: 'PAID',
          label: spaSettlementLabelRu('PAID'),
          source: 'debt',
          visitPosted: visit?.posted,
          visitNum: visit?.num ?? debtHit.docRef,
        },
        payment: 'PAID',
        payTag: 'SALE',
      };
    }

    if (
      debtHit?.paymentStatus === 'DEBT' ||
      booking?.paymentStatus === ServicePaymentStatus.DEBT ||
      visit?.posted === true ||
      Boolean(booking?.consumedInCrmAt) ||
      Boolean(onex)
    ) {
      return {
        settlement: {
          status: 'AWAITING_PAYMENT',
          label: spaSettlementLabelRu('AWAITING_PAYMENT'),
          source: debtHit ? 'debt' : visit?.found ? 'visit' : onex ? 'onex' : 'local',
          visitPosted: visit?.posted ?? Boolean(onex),
          visitNum: visit?.num ?? onex?.number ?? debtHit?.docRef,
        },
        payment: 'DEBT',
        payTag: 'SALE',
      };
    }

    if (booking?.paymentStatus === ServicePaymentStatus.PAID) {
      return {
        settlement: {
          status: 'PAID',
          label: spaSettlementLabelRu('PAID'),
          source: 'local',
        },
        payment: 'PAID',
        payTag: 'SALE',
      };
    }

    return {
      settlement: {
        status: 'NOT_IN_1C',
        label: spaSettlementLabelRu('NOT_IN_1C'),
        source: 'local',
      },
      payment: 'UNKNOWN',
      payTag: 'SALE',
    };
  }

  private matchSpaInMemory(
    bookings: Array<{
      id: string;
      startAt: Date;
      crmDocRef: string | null;
      clientExternalId?: string | null;
      specialist: { externalId: string | null };
      client: { externalId: string | null } | null;
    }>,
    session: {
      externalId: string;
      number: string | null;
      startAt: Date;
      employeeExternalId: string | null;
      fitgoBookingRef?: string | null;
    },
    clientExternalId: string | undefined,
  ) {
    if (session.fitgoBookingRef?.trim()) {
      const byFitgo = bookings.find(
        (b) => b.id === session.fitgoBookingRef!.trim(),
      );
      if (byFitgo) return byFitgo;
    }
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
      const bookingClientId = b.client?.externalId ?? b.clientExternalId;
      if (
        clientExternalId &&
        bookingClientId &&
        bookingClientId !== clientExternalId
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
      fitgoBookingRef?: string | null;
      members: Array<{ externalId: string }>;
    }>,
    kind: 'PT' | 'SPA',
    startAt: Date,
    employeeExternalId: string | null | undefined,
    clientExternalId: string | null | undefined,
    crmDocRef: string | null | undefined,
    fitgoBookingId?: string | null,
  ): boolean {
    if (fitgoBookingId?.trim()) {
      const id = fitgoBookingId.trim();
      if (onex.some((o) => o.kind === kind && o.fitgoBookingRef === id)) {
        return true;
      }
    }
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
      fitgoBookingRef?: string | null;
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

    if (session.fitgoBookingRef?.trim()) {
      const byFitgo = await this.prisma.spaBooking.findFirst({
        where: {
          clubId,
          id: session.fitgoBookingRef.trim(),
          status: { not: SpaBookingStatus.CANCELLED },
        },
      });
      if (byFitgo) return byFitgo;
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
          ? {
              OR: [
                { client: { externalId: clientExternalId } },
                { clientExternalId },
              ],
            }
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
