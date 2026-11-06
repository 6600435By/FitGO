import { Injectable } from '@nestjs/common';
import { TrainerClientLinkStatus } from '@prisma/client';
import type { TrainerClientLookupResult } from '@fitgo/shared-types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { ClientPhoneLookupService } from '../common/client-phone-lookup.service';
import { normalizePhone } from '../common/phone.util';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TrainerClientLookupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly phoneLookup: ClientPhoneLookupService,
  ) {}

  /**
   * Roster → FitGO user / cache / 1C. Used by add-client and assign-PT sheets.
   */
  async lookupByPhone(
    trainer: JwtPayload,
    rawPhone: string,
  ): Promise<TrainerClientLookupResult> {
    const phone = normalizePhone(rawPhone);
    if (phone.length < 9) {
      return {
        source: 'none',
        phone: phone || rawPhone,
        inRoster: false,
        found: false,
        pending: false,
      };
    }

    const rosterHit = await this.prisma.trainerClientLink.findFirst({
      where: {
        trainerId: trainer.sub,
        status: { not: TrainerClientLinkStatus.REJECTED },
        client: { phoneNormalized: phone },
      },
      include: {
        client: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            externalId: true,
            phone: true,
            phoneNormalized: true,
          },
        },
      },
    });

    if (rosterHit) {
      const c = rosterHit.client;
      return {
        source: 'roster',
        phone: c.phoneNormalized || phone,
        clientId: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        externalId: c.externalId ?? undefined,
        inRoster: true,
        found: true,
        pending: false,
      };
    }

    const found = await this.phoneLookup.lookupByPhone(trainer, rawPhone);
    const inRoster = found.clientId
      ? Boolean(
          await this.prisma.trainerClientLink.findUnique({
            where: {
              trainerId_clientId: {
                trainerId: trainer.sub,
                clientId: found.clientId,
              },
            },
          }),
        )
      : false;

    const source: TrainerClientLookupResult['source'] =
      found.source === 'local'
        ? 'fitgo'
        : found.source === '1c'
          ? '1c'
          : 'none';

    return {
      source,
      phone: found.phone,
      clientId: found.clientId,
      firstName: found.firstName,
      lastName: found.lastName,
      externalId: found.externalId,
      inRoster,
      found: found.found,
      pending: found.pending,
    };
  }

  /** Name search in trainer roster (for PT assign sheet). */
  async searchRosterByName(trainerId: string, query: string) {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];

    const links = await this.prisma.trainerClientLink.findMany({
      where: {
        trainerId,
        status: { not: TrainerClientLinkStatus.REJECTED },
      },
      include: {
        client: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            phoneNormalized: true,
            externalId: true,
          },
        },
      },
      take: 80,
    });

    return links
      .filter((l) => {
        const name =
          `${l.client.firstName} ${l.client.lastName}`.toLowerCase();
        const phone = (l.client.phoneNormalized ?? l.client.phone ?? '').toLowerCase();
        return name.includes(q) || phone.includes(q.replace(/\D/g, ''));
      })
      .slice(0, 20)
      .map((l) => ({
        clientId: l.client.id,
        firstName: l.client.firstName,
        lastName: l.client.lastName,
        phone: l.client.phone ?? undefined,
        externalId: l.client.externalId ?? undefined,
        inRoster: true as const,
      }));
  }
}
