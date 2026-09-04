import { Injectable, Logger } from '@nestjs/common';
import { ClubCrmLinkStatus, NotificationType, Role } from '@prisma/client';
import { FitnessService } from '../fitness/fitness.service';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePhone } from './phone.util';

const CRM_SYNC_THROTTLE_MS = 3 * 60 * 1000;

@Injectable()
export class ClubCrmLinkService {
  private readonly logger = new Logger(ClubCrmLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
  ) {}

  /**
   * Lookup 1C client by phone and persist externalId on UserClubMembership.
   * Throttled unless force=true. Sets PENDING_CRM when not found and notifies club admins once.
   */
  async syncMembershipCrmLink(
    userId: string,
    options: { force?: boolean } = {},
  ): Promise<{
    externalId?: string;
    crmStatus: ClubCrmLinkStatus | null;
  }> {
    const membership = await this.prisma.userClubMembership.findFirst({
      where: { userId, leftAt: null },
      include: { club: true, user: true },
      orderBy: { joinedAt: 'desc' },
    });

    if (!membership) {
      return { crmStatus: null };
    }

    if (
      !options.force &&
      membership.lastCrmSyncAt &&
      Date.now() - membership.lastCrmSyncAt.getTime() < CRM_SYNC_THROTTLE_MS
    ) {
      return {
        externalId: membership.externalId ?? undefined,
        crmStatus:
          membership.crmStatus ??
          (membership.externalId
            ? ClubCrmLinkStatus.LINKED
            : ClubCrmLinkStatus.PENDING_CRM),
      };
    }

    if (membership.externalId) {
      await this.prisma.userClubMembership.update({
        where: { id: membership.id },
        data: {
          crmStatus: ClubCrmLinkStatus.LINKED,
          lastCrmSyncAt: new Date(),
        },
      });
      return {
        externalId: membership.externalId,
        crmStatus: ClubCrmLinkStatus.LINKED,
      };
    }

    const phone =
      membership.user.phoneNormalized ??
      (membership.user.phone ? normalizePhone(membership.user.phone) : '');
    if (!phone || phone.length < 9) {
      const updated = await this.prisma.userClubMembership.update({
        where: { id: membership.id },
        data: {
          crmStatus: ClubCrmLinkStatus.PENDING_CRM,
          lastCrmSyncAt: new Date(),
        },
      });
      return { crmStatus: updated.crmStatus };
    }

    const provider = this.fitness.getProvider();
    if (!provider.findClientByPhone) {
      if (membership.externalId) {
        return {
          externalId: membership.externalId,
          crmStatus: ClubCrmLinkStatus.LINKED,
        };
      }
      const updated = await this.prisma.userClubMembership.update({
        where: { id: membership.id },
        data: {
          crmStatus: ClubCrmLinkStatus.PENDING_CRM,
          lastCrmSyncAt: new Date(),
        },
      });
      if (membership.crmStatus !== ClubCrmLinkStatus.PENDING_CRM) {
        await this.notifyAdminsPendingCrm(membership.clubId, membership.user);
      }
      return { crmStatus: updated.crmStatus };
    }

    try {
      const client = await provider.findClientByPhone(phone);
      if (client?.externalId) {
        await this.prisma.userClubMembership.update({
          where: { id: membership.id },
          data: {
            externalId: client.externalId,
            crmStatus: ClubCrmLinkStatus.LINKED,
            lastCrmSyncAt: new Date(),
          },
        });
        if (!membership.user.externalId) {
          await this.prisma.user.update({
            where: { id: userId },
            data: { externalId: client.externalId },
          });
        }
        return {
          externalId: client.externalId,
          crmStatus: ClubCrmLinkStatus.LINKED,
        };
      }
    } catch (err) {
      this.logger.warn(
        `1C phone lookup failed for user ${userId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      if (membership.externalId) {
        return {
          externalId: membership.externalId,
          crmStatus: ClubCrmLinkStatus.LINKED,
        };
      }
    }

    const wasPending = membership.crmStatus === ClubCrmLinkStatus.PENDING_CRM;
    const updated = await this.prisma.userClubMembership.update({
      where: { id: membership.id },
      data: {
        crmStatus: ClubCrmLinkStatus.PENDING_CRM,
        lastCrmSyncAt: new Date(),
      },
    });

    if (!wasPending) {
      await this.notifyAdminsPendingCrm(membership.clubId, membership.user);
    }

    return { crmStatus: updated.crmStatus };
  }

  private async notifyAdminsPendingCrm(
    clubId: string,
    client: { id: string; firstName: string; lastName: string; phone: string | null },
  ) {
    const admins = await this.prisma.user.findMany({
      where: {
        clubId,
        isActive: true,
        roles: { some: { role: Role.ADMIN } },
      },
      select: { id: true },
    });

    const name = `${client.firstName} ${client.lastName}`.trim();
    const phone = client.phone ?? 'без телефона';
    const title = 'Новый клиент без карточки 1С';
    const body = `${name} (${phone}) зарегистрировался в FitGO. Нужно завести клиента и штрихкод в 1С.`;

    await Promise.all(
      admins.map((admin) =>
        this.prisma.notification.create({
          data: {
            userId: admin.id,
            type: NotificationType.GENERAL,
            title,
            body,
            senderId: client.id,
          },
        }),
      ),
    );
  }
}
