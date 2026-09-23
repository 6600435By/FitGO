import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GroupClassBookingStatus,
  GroupClassSessionStatus,
  GroupSessionBaselineQuality,
  GroupSessionMemberAttendance,
  GroupSessionMemberSource,
  Role,
  TrustBand,
  TrustResolution,
} from '@prisma/client';
import {
  computeGroupMemberTrust,
  computeGroupSessionTrust,
  isPayrollTrusted,
  TRUST_REASON_LABELS,
  type TrustExceptionItem,
} from '@fitgo/shared-types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GroupSessionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Open or create journal: freeze baseline from FitGO bookings (PARTIAL until 1C roster).
   */
  async openJournal(
    user: JwtPayload,
    input: {
      appointmentId: string;
      title: string;
      startAt: string;
      endAt: string;
      trainerId?: string;
      roomTitle?: string;
    },
  ) {
    const clubId = requireClubId(user);
    const trainerId = input.trainerId ?? user.sub;
    const startAt = new Date(input.startAt);
    const endAt = new Date(input.endAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new BadRequestException('Некорректные даты занятия');
    }

    let session = await this.prisma.groupClassSession.findUnique({
      where: {
        clubId_appointmentId: { clubId, appointmentId: input.appointmentId },
      },
      include: { members: true, trainer: true },
    });

    if (!session) {
      const bookings = await this.prisma.groupClassBooking.findMany({
        where: {
          appointmentId: input.appointmentId,
          status: { not: GroupClassBookingStatus.CANCELLED },
          client: { clubId },
        },
        include: { client: true },
      });

      session = await this.prisma.groupClassSession.create({
        data: {
          clubId,
          appointmentId: input.appointmentId,
          trainerId,
          title: input.title,
          startAt,
          endAt,
          roomTitle: input.roomTitle?.trim() || null,
          status: GroupClassSessionStatus.OPEN,
          baselineQuality: GroupSessionBaselineQuality.PARTIAL,
          baselineCount: bookings.length,
          baselineFrozenAt: new Date(),
          members: {
            create: bookings.map((b) => {
              const trust = computeGroupMemberTrust({
                source: 'BASELINE_1C',
                attendance: 'EXPECTED',
                visitMatched: b.presenceStatus === 'VERIFIED_1C',
                hasCrmId: Boolean(b.client.externalId || b.clientId),
              });
              return {
                clientId: b.clientId,
                externalId: b.client.externalId,
                displayName: `${b.client.lastName} ${b.client.firstName}`.trim(),
                source: GroupSessionMemberSource.BASELINE_1C,
                attendance: GroupSessionMemberAttendance.EXPECTED,
                visitMatched: b.presenceStatus === 'VERIFIED_1C',
                trustBand: trust.trustBand as TrustBand,
                trustReasons: trust.trustReasons,
                bookingId: b.id,
              };
            }),
          },
        },
        include: { members: true, trainer: true },
      });
      await this.recomputeSessionTrust(session.id);
      session = await this.prisma.groupClassSession.findUniqueOrThrow({
        where: { id: session.id },
        include: { members: true, trainer: true },
      });
    } else if (input.roomTitle?.trim() && !session.roomTitle) {
      session = await this.prisma.groupClassSession.update({
        where: { id: session.id },
        data: { roomTitle: input.roomTitle.trim() },
        include: { members: true, trainer: true },
      });
    }

    return this.mapSession(session);
  }

  async getSession(user: JwtPayload, sessionId: string) {
    const session = await this.findSessionForClub(user, sessionId);
    return this.mapSession(session);
  }

  async listTrainerSessions(user: JwtPayload, from: string, to: string) {
    const clubId = requireClubId(user);
    const fromD = new Date(`${from}T00:00:00`);
    const toD = new Date(`${to}T23:59:59`);
    const sessions = await this.prisma.groupClassSession.findMany({
      where: {
        clubId,
        trainerId: user.sub,
        startAt: { gte: fromD, lte: toD },
      },
      include: { members: true, trainer: true },
      orderBy: { startAt: 'asc' },
    });
    return sessions.map((s) => this.mapSession(s));
  }

  async setMemberAttendance(
    user: JwtPayload,
    sessionId: string,
    memberId: string,
    attendance: 'ATTENDED' | 'NO_SHOW' | 'REMOVED' | 'EXPECTED',
  ) {
    const session = await this.findSessionForClub(user, sessionId);
    this.assertEditable(session);
    const member = session.members.find((m) => m.id === memberId);
    if (!member) throw new NotFoundException('Участник не найден');

    const trust = computeGroupMemberTrust({
      source: member.source,
      attendance,
      visitMatched: member.visitMatched,
      hasCrmId: Boolean(member.clientId || member.externalId),
    });

    await this.prisma.groupClassSessionMember.update({
      where: { id: memberId },
      data: {
        attendance: attendance as GroupSessionMemberAttendance,
        trustBand: trust.trustBand as TrustBand,
        trustReasons: trust.trustReasons,
      },
    });
    await this.recomputeSessionTrust(sessionId);
    return this.getSession(user, sessionId);
  }

  async addMember(
    user: JwtPayload,
    sessionId: string,
    input: { clientId?: string; displayName: string; externalId?: string },
  ) {
    const session = await this.findSessionForClub(user, sessionId);
    this.assertEditable(session);
    const roles = await this.prisma.userRole.findMany({
      where: { userId: user.sub },
    });
    const isAdmin = roles.some(
      (r) => r.role === Role.ADMIN || r.role === Role.SUPER_ADMIN,
    );
    const source = isAdmin
      ? GroupSessionMemberSource.ADMIN_ADDED
      : GroupSessionMemberSource.TRAINER_ADDED;

    let clientId = input.clientId ?? null;
    let externalId = input.externalId ?? null;
    let displayName = input.displayName.trim();
    let visitMatched = false;

    if (clientId) {
      const client = await this.prisma.user.findUnique({ where: { id: clientId } });
      if (!client) throw new NotFoundException('Клиент не найден');
      displayName =
        displayName || `${client.lastName} ${client.firstName}`.trim();
      externalId = client.externalId;
      const booking = await this.prisma.groupClassBooking.findFirst({
        where: {
          appointmentId: session.appointmentId,
          clientId,
          status: { not: GroupClassBookingStatus.CANCELLED },
        },
      });
      visitMatched = booking?.presenceStatus === 'VERIFIED_1C';
    }

    const trust = computeGroupMemberTrust({
      source,
      attendance: 'ATTENDED',
      visitMatched,
      hasCrmId: Boolean(clientId || externalId),
    });

    await this.prisma.groupClassSessionMember.create({
      data: {
        sessionId,
        clientId,
        externalId,
        displayName,
        source,
        attendance: GroupSessionMemberAttendance.ATTENDED,
        visitMatched,
        trustBand: trust.trustBand as TrustBand,
        trustReasons: trust.trustReasons,
      },
    });
    await this.recomputeSessionTrust(sessionId);
    return this.getSession(user, sessionId);
  }

  async submitJournal(user: JwtPayload, sessionId: string) {
    const session = await this.findSessionForClub(user, sessionId);
    if (
      session.status !== GroupClassSessionStatus.OPEN &&
      session.status !== GroupClassSessionStatus.SUBMITTED
    ) {
      throw new BadRequestException('Журнал уже закрыт для правок тренера');
    }
    if (session.endAt > new Date()) {
      throw new BadRequestException('Занятие ещё не закончилось');
    }

    await this.refreshVisitMatches(sessionId);
    await this.recomputeSessionTrust(sessionId);

    const fresh = await this.prisma.groupClassSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: { members: true },
    });

    const attended = fresh.members.filter(
      (m) => m.attendance === GroupSessionMemberAttendance.ATTENDED,
    ).length;

    const needsAdmin =
      fresh.trustBand !== TrustBand.GREEN ||
      fresh.baselineQuality === GroupSessionBaselineQuality.PARTIAL;

    await this.prisma.groupClassSession.update({
      where: { id: sessionId },
      data: {
        submittedCount: attended,
        trainerSubmittedAt: new Date(),
        status: needsAdmin
          ? GroupClassSessionStatus.NEEDS_ADMIN
          : GroupClassSessionStatus.AUTO_READY,
      },
    });

    return this.getSession(user, sessionId);
  }

  async listAdminExceptions(clubId: string): Promise<TrustExceptionItem[]> {
    const sessions = await this.prisma.groupClassSession.findMany({
      where: {
        clubId,
        status: GroupClassSessionStatus.NEEDS_ADMIN,
      },
      include: { members: true, trainer: true },
      orderBy: { startAt: 'desc' },
      take: 100,
    });
    return sessions.map((s) => ({
      id: s.id,
      kind: 'GROUP_SESSION' as const,
      title: s.title,
      performerName: `${s.trainer.lastName} ${s.trainer.firstName}`.trim(),
      startAt: s.startAt.toISOString(),
      trustBand: s.trustBand as TrustExceptionItem['trustBand'],
      trustReasons: Array.isArray(s.trustReasons)
        ? (s.trustReasons as string[])
        : [],
      baselineCount: s.baselineCount,
      attendedCount: s.members.filter(
        (m) => m.attendance === GroupSessionMemberAttendance.ATTENDED,
      ).length,
    }));
  }

  async resolveSessionException(
    user: JwtPayload,
    sessionId: string,
    note: string,
  ) {
    if (!note?.trim()) {
      throw new BadRequestException('Укажите причину');
    }
    const session = await this.findSessionForClub(user, sessionId);
    if (session.status !== GroupClassSessionStatus.NEEDS_ADMIN) {
      throw new BadRequestException('Сессия не в очереди админа');
    }

    for (const m of session.members) {
      if (
        m.attendance === GroupSessionMemberAttendance.ATTENDED &&
        m.trustResolution === TrustResolution.NONE &&
        m.trustBand !== TrustBand.GREEN
      ) {
        await this.prisma.groupClassSessionMember.update({
          where: { id: m.id },
          data: {
            trustResolution: TrustResolution.RESOLVED,
            trustResolveNote: note.trim(),
          },
        });
      }
    }

    const refreshed = await this.prisma.groupClassSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: { members: true },
    });
    const count = refreshed.members.filter(
      (m) =>
        m.attendance === GroupSessionMemberAttendance.ATTENDED &&
        isPayrollTrusted({
          trustBand: m.trustBand as 'GREEN' | 'AMBER' | 'RED',
          trustResolution: m.trustResolution,
        }),
    ).length;

    await this.prisma.groupClassSession.update({
      where: { id: sessionId },
      data: {
        status: GroupClassSessionStatus.APPROVED,
        approvedAttendedCount: count,
        adminApprovedAt: new Date(),
        adminApprovedById: user.sub,
        trustBand: TrustBand.GREEN,
        trustReasons: ['RESOLVED_EXCEPTION'],
      },
    });

    await this.prisma.staffAuditLog.create({
      data: {
        clubId: session.clubId,
        actorId: user.sub,
        action: 'GROUP_SESSION_RESOLVED',
        targetId: sessionId,
        meta: { note: note.trim(), approvedAttendedCount: count },
      },
    });

    return this.getSession(user, sessionId);
  }

  async returnToTrainer(user: JwtPayload, sessionId: string) {
    await this.findSessionForClub(user, sessionId);
    await this.prisma.groupClassSession.update({
      where: { id: sessionId },
      data: { status: GroupClassSessionStatus.OPEN },
    });
    return this.getSession(user, sessionId);
  }

  async promoteAutoReady(clubId: string, from: Date, to: Date) {
    const ready = await this.prisma.groupClassSession.findMany({
      where: {
        clubId,
        status: GroupClassSessionStatus.AUTO_READY,
        startAt: { gte: from, lte: to },
      },
      include: { members: true },
    });
    for (const s of ready) {
      const count = s.members.filter(
        (m) =>
          m.attendance === GroupSessionMemberAttendance.ATTENDED &&
          isPayrollTrusted({
            trustBand: m.trustBand as 'GREEN' | 'AMBER' | 'RED',
            trustResolution: m.trustResolution,
          }),
      ).length;
      await this.prisma.groupClassSession.update({
        where: { id: s.id },
        data: {
          status: GroupClassSessionStatus.APPROVED,
          approvedAttendedCount: count,
        },
      });
    }
  }

  private assertEditable(session: { status: GroupClassSessionStatus }) {
    if (
      session.status !== GroupClassSessionStatus.OPEN &&
      session.status !== GroupClassSessionStatus.SUBMITTED &&
      session.status !== GroupClassSessionStatus.NEEDS_ADMIN
    ) {
      throw new BadRequestException('Журнал нельзя менять в этом статусе');
    }
  }

  private async findSessionForClub(user: JwtPayload, sessionId: string) {
    const clubId = requireClubId(user);
    const session = await this.prisma.groupClassSession.findFirst({
      where: { id: sessionId, clubId },
      include: { members: true, trainer: true },
    });
    if (!session) throw new NotFoundException('Журнал не найден');
    return session;
  }

  private async refreshVisitMatches(sessionId: string) {
    const session = await this.prisma.groupClassSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: { members: true },
    });
    for (const m of session.members) {
      if (!m.clientId) continue;
      const booking = await this.prisma.groupClassBooking.findFirst({
        where: {
          appointmentId: session.appointmentId,
          clientId: m.clientId,
          status: { not: GroupClassBookingStatus.CANCELLED },
        },
      });
      const visitMatched = booking?.presenceStatus === 'VERIFIED_1C';
      if (visitMatched !== m.visitMatched) {
        const trust = computeGroupMemberTrust({
          source: m.source,
          attendance: m.attendance,
          visitMatched,
          hasCrmId: Boolean(m.clientId || m.externalId),
        });
        await this.prisma.groupClassSessionMember.update({
          where: { id: m.id },
          data: {
            visitMatched,
            trustBand: trust.trustBand as TrustBand,
            trustReasons: trust.trustReasons,
          },
        });
      }
    }
  }

  private async recomputeSessionTrust(sessionId: string) {
    const session = await this.prisma.groupClassSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: { members: true },
    });
    const attended = session.members.filter(
      (m) => m.attendance === GroupSessionMemberAttendance.ATTENDED,
    );
    const memberBands = attended.map(
      (m) => m.trustBand as 'GREEN' | 'AMBER' | 'RED',
    );
    const t = computeGroupSessionTrust({
      memberBands,
      baselineQuality: session.baselineQuality,
      baselineCount: session.baselineCount,
      attendedCount: attended.length,
    });
    const approvedCount = attended.filter((m) =>
      isPayrollTrusted({
        trustBand: m.trustBand as 'GREEN' | 'AMBER' | 'RED',
        trustResolution: m.trustResolution,
      }),
    ).length;

    await this.prisma.groupClassSession.update({
      where: { id: sessionId },
      data: {
        trustBand: t.trustBand as TrustBand,
        trustReasons: t.trustReasons,
        approvedAttendedCount:
          session.status === GroupClassSessionStatus.APPROVED ||
          session.status === GroupClassSessionStatus.AUTO_READY
            ? approvedCount
            : session.approvedAttendedCount,
      },
    });
  }

  private mapSession(
    session: Awaited<ReturnType<GroupSessionService['findSessionForClub']>>,
  ) {
    return {
      id: session.id,
      appointmentId: session.appointmentId,
      title: session.title,
      startAt: session.startAt.toISOString(),
      endAt: session.endAt.toISOString(),
      status: session.status,
      baselineQuality: session.baselineQuality,
      baselineCount: session.baselineCount,
      submittedCount: session.submittedCount ?? undefined,
      approvedAttendedCount: session.approvedAttendedCount ?? undefined,
      trustBand: session.trustBand,
      trustReasons: (Array.isArray(session.trustReasons)
        ? session.trustReasons
        : []) as string[],
      trustReasonLabels: (
        (Array.isArray(session.trustReasons)
          ? session.trustReasons
          : []) as string[]
      ).map(
        (c) =>
          TRUST_REASON_LABELS[c as keyof typeof TRUST_REASON_LABELS] ?? c,
      ),
      trainerId: session.trainerId,
      trainerName: `${session.trainer.lastName} ${session.trainer.firstName}`.trim(),
      members: session.members.map((m) => ({
        id: m.id,
        clientId: m.clientId ?? undefined,
        externalId: m.externalId ?? undefined,
        displayName: m.displayName,
        source: m.source,
        attendance: m.attendance,
        visitMatched: m.visitMatched,
        trustBand: m.trustBand,
        trustReasons: (Array.isArray(m.trustReasons)
          ? m.trustReasons
          : []) as string[],
        trustResolution: m.trustResolution,
      })),
    };
  }
}
