import { Injectable, Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import { FitnessService } from '../fitness/fitness.service';
import { PrismaService } from '../prisma/prisma.service';

const RESOURCE_KEY = 'membership_snapshots';
/** Soft rate limit for overnight per-client getMembership until bulk endpoint exists. */
const DELAY_MS = 150;
const MAX_CLIENTS_FULL = 400;
const MAX_CLIENTS_LIGHT = 80;

@Injectable()
export class MembershipSnapshotSyncService {
  private readonly logger = new Logger(MembershipSnapshotSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
  ) {}

  async syncClub(
    clubId: string,
    opts?: { limit?: number },
  ): Promise<{ upserted: number; scanned: number }> {
    const limit = opts?.limit ?? MAX_CLIENTS_FULL;

    await this.prisma.salesSyncState.upsert({
      where: { clubId_resourceKey: { clubId, resourceKey: RESOURCE_KEY } },
      create: {
        clubId,
        resourceKey: RESOURCE_KEY,
        lastStatus: 'running',
        lastRunAt: new Date(),
      },
      update: {
        lastStatus: 'running',
        lastRunAt: new Date(),
        lastError: null,
      },
    });

    // Prefer clients with externalId linked to this club (users + staff client cards).
    const users = await this.prisma.user.findMany({
      where: {
        clubId,
        externalId: { not: null },
        OR: [
          { roles: { some: { role: Role.CLIENT } } },
          { staffClientExternalId: { not: null } },
        ],
      },
      select: {
        externalId: true,
        staffClientExternalId: true,
        firstName: true,
        lastName: true,
      },
      take: limit * 2,
    });

    const ids = new Map<string, string | null>();
    for (const u of users) {
      if (u.externalId) {
        ids.set(u.externalId, `${u.firstName} ${u.lastName}`.trim());
      }
      if (u.staffClientExternalId) {
        ids.set(u.staffClientExternalId, `${u.firstName} ${u.lastName}`.trim());
      }
    }

    const provider = this.fitness.getProvider();
    let upserted = 0;
    let scanned = 0;
    const now = new Date();

    try {
      for (const [clientExternalId, clientName] of ids) {
        if (scanned >= limit) break;
        scanned += 1;
        try {
          const membership = await provider.getMembership(clientExternalId);
          if (!membership) {
            await sleep(DELAY_MS);
            continue;
          }
          const servicesJson =
            (membership as { services?: unknown }).services ??
            (membership as { remainingServices?: unknown }).remainingServices ??
            [];
          await this.prisma.clubMembershipSnapshot.upsert({
            where: {
              clubId_clientExternalId: { clubId, clientExternalId },
            },
            create: {
              clubId,
              clientExternalId,
              clientName,
              status: membership.status ?? null,
              packageName:
                (membership as { packageName?: string }).packageName ??
                (membership as { name?: string }).name ??
                null,
              startDate:
                (membership as { validFrom?: string }).validFrom ??
                (membership as { startDate?: string }).startDate ??
                null,
              endDate:
                (membership as { validUntil?: string }).validUntil ??
                (membership as { endDate?: string }).endDate ??
                null,
              freezeAllowed: Boolean(
                (membership as { freezeAllowed?: boolean }).freezeAllowed,
              ),
              debtAmount: Number(
                (membership as { debtAmount?: number }).debtAmount ?? 0,
              ),
              currency:
                (membership as { currency?: string }).currency ?? null,
              servicesJson: servicesJson as object,
              rawJson: membership as object,
              syncedAt: now,
            },
            update: {
              clientName,
              status: membership.status ?? null,
              packageName:
                (membership as { packageName?: string }).packageName ??
                (membership as { name?: string }).name ??
                null,
              startDate:
                (membership as { validFrom?: string }).validFrom ??
                (membership as { startDate?: string }).startDate ??
                null,
              endDate:
                (membership as { validUntil?: string }).validUntil ??
                (membership as { endDate?: string }).endDate ??
                null,
              freezeAllowed: Boolean(
                (membership as { freezeAllowed?: boolean }).freezeAllowed,
              ),
              debtAmount: Number(
                (membership as { debtAmount?: number }).debtAmount ?? 0,
              ),
              currency:
                (membership as { currency?: string }).currency ?? null,
              servicesJson: servicesJson as object,
              rawJson: membership as object,
              syncedAt: now,
            },
          });
          upserted += 1;
        } catch (err) {
          this.logger.warn(
            `Membership snapshot ${clientExternalId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        await sleep(DELAY_MS);
      }

      await this.prisma.salesSyncState.update({
        where: { clubId_resourceKey: { clubId, resourceKey: RESOURCE_KEY } },
        data: {
          lastStatus: 'ok',
          lastError: null,
          lastSuccessAt: now,
          lastRunAt: now,
        },
      });
      this.logger.log(
        `Membership snapshots ${clubId}: ${upserted}/${scanned}`,
      );
      return { upserted, scanned };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.prisma.salesSyncState.update({
        where: { clubId_resourceKey: { clubId, resourceKey: RESOURCE_KEY } },
        data: { lastStatus: 'error', lastError: msg, lastRunAt: new Date() },
      });
      throw err;
    }
  }
}

export const MEMBERSHIP_LIMITS = {
  FULL: MAX_CLIENTS_FULL,
  LIGHT: MAX_CLIENTS_LIGHT,
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
