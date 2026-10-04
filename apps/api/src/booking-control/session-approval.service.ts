import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SessionApprovalKind } from '@prisma/client';
import {
  UserRole,
  isSessionPayrollEligible,
  sessionApprovalPhase,
  type SessionApprovalPhase,
} from '@fitgo/shared-types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SessionApprovalService {
  constructor(private readonly prisma: PrismaService) {}

  isPayrollEligible(approval: {
    adminApprovedAt?: Date | null;
    overrideApprovedAt?: Date | null;
  }): boolean {
    return isSessionPayrollEligible(approval);
  }

  phase(approval: {
    performerConfirmedAt?: Date | null;
    adminApprovedAt?: Date | null;
    overrideApprovedAt?: Date | null;
  }): SessionApprovalPhase {
    return sessionApprovalPhase({
      performerConfirmedAt: approval.performerConfirmedAt?.toISOString() ?? null,
      adminApprovedAt: approval.adminApprovedAt?.toISOString() ?? null,
      overrideApprovedAt: approval.overrideApprovedAt?.toISOString() ?? null,
    });
  }

  async ensureApproval(
    kind: SessionApprovalKind,
    bookingId: string,
    clubId: string,
  ) {
    return this.prisma.sessionApproval.upsert({
      where: { kind_bookingId: { kind, bookingId } },
      create: { clubId, kind, bookingId },
      update: {},
    });
  }

  /** Create missing approval rows in one round-trip (skip existing). */
  async ensureApprovals(
    kind: SessionApprovalKind,
    bookingIds: string[],
    clubId: string,
  ) {
    const ids = [...new Set(bookingIds.filter(Boolean))];
    if (!ids.length) return;
    const existing = await this.prisma.sessionApproval.findMany({
      where: { kind, bookingId: { in: ids } },
      select: { bookingId: true },
    });
    const have = new Set(existing.map((e) => e.bookingId));
    const missing = ids.filter((id) => !have.has(id));
    if (!missing.length) return;
    await this.prisma.sessionApproval.createMany({
      data: missing.map((bookingId) => ({ clubId, kind, bookingId })),
      skipDuplicates: true,
    });
  }

  async confirmPerformer(
    actor: JwtPayload,
    kind: SessionApprovalKind,
    bookingId: string,
  ) {
    const clubId = requireClubId(actor);
    await this.assertBookingAccess(actor, kind, bookingId, clubId);
    await this.ensureApproval(kind, bookingId, clubId);
    return this.prisma.sessionApproval.update({
      where: { kind_bookingId: { kind, bookingId } },
      data: { performerConfirmedAt: new Date() },
    });
  }

  async adminApprove(
    actor: JwtPayload,
    kind: SessionApprovalKind,
    bookingId: string,
  ) {
    const clubId = requireClubId(actor);
    this.assertAdminLike(actor);
    await this.ensureApproval(kind, bookingId, clubId);
    return this.prisma.sessionApproval.update({
      where: { kind_bookingId: { kind, bookingId } },
      data: {
        adminApprovedAt: new Date(),
        adminApprovedById: actor.sub,
      },
    });
  }

  async bulkAdminApprove(
    clubId: string,
    kind: SessionApprovalKind,
    bookingIds: string[],
    adminUserId: string,
  ) {
    if (!bookingIds.length) return { updated: 0 };
    const now = new Date();
    for (const bookingId of bookingIds) {
      await this.ensureApproval(kind, bookingId, clubId);
    }
    const result = await this.prisma.sessionApproval.updateMany({
      where: {
        clubId,
        kind,
        bookingId: { in: bookingIds },
        adminApprovedAt: null,
      },
      data: {
        adminApprovedAt: now,
        adminApprovedById: adminUserId,
      },
    });
    return { updated: result.count };
  }

  async returnApproval(
    actor: JwtPayload,
    kind: SessionApprovalKind,
    bookingId: string,
    reason?: string,
  ) {
    const clubId = requireClubId(actor);
    this.assertAdminLike(actor);
    await this.ensureApproval(kind, bookingId, clubId);
    return this.prisma.sessionApproval.update({
      where: { kind_bookingId: { kind, bookingId } },
      data: {
        performerConfirmedAt: null,
        adminApprovedAt: null,
        adminApprovedById: null,
        overrideApprovedAt: null,
        overrideApprovedById: null,
        returnedAt: new Date(),
        returnReason: reason?.trim() || null,
      },
    });
  }

  async bulkApprove(
    actor: JwtPayload,
    kind: SessionApprovalKind,
    bookingIds: string[],
  ) {
    const clubId = requireClubId(actor);
    this.assertAdminLike(actor);
    return this.bulkAdminApprove(clubId, kind, bookingIds, actor.sub);
  }

  private assertAdminLike(actor: JwtPayload) {
    const ok =
      actor.roles.includes(UserRole.ADMIN) ||
      actor.roles.includes(UserRole.MANAGER) ||
      actor.roles.includes(UserRole.SUPER_ADMIN);
    if (!ok) throw new ForbiddenException('Только администратор');
  }

  private async assertBookingAccess(
    actor: JwtPayload,
    kind: SessionApprovalKind,
    bookingId: string,
    clubId: string,
  ) {
    if (kind === SessionApprovalKind.PT) {
      const booking = await this.prisma.personalTrainingBooking.findFirst({
        where: { id: bookingId, trainer: { clubId } },
      });
      if (!booking) throw new NotFoundException('Запись не найдена');
      if (booking.trainerId !== actor.sub) {
        throw new ForbiddenException('Чужая запись');
      }
      return;
    }

    const booking = await this.prisma.spaBooking.findFirst({
      where: { id: bookingId, clubId },
    });
    if (!booking) throw new NotFoundException('Запись не найдена');
    if (booking.specialistId !== actor.sub) {
      throw new ForbiddenException('Чужая запись');
    }
  }
}
