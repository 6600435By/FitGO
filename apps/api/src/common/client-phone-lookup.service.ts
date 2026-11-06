import { BadRequestException, Injectable } from '@nestjs/common';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { FitnessService } from '../fitness/fitness.service';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePhone } from './phone.util';

export type PhoneLookupSource = 'local' | '1c' | 'none';

export type PhoneLookupResult = {
  found: boolean;
  pending: boolean;
  source: PhoneLookupSource;
  phone: string;
  clientId?: string;
  externalId?: string;
  firstName?: string;
  lastName?: string;
};

/**
 * Shared phone → client resolution for SPA and trainer CRM.
 * Order: FitGO User by phoneNormalized → spaPhoneLookupCache → 1C findClientByPhone (5s).
 */
@Injectable()
export class ClientPhoneLookupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fitness: FitnessService,
  ) {}

  async lookupByPhone(
    actor: JwtPayload,
    rawPhone: string,
  ): Promise<PhoneLookupResult> {
    const clubId = requireClubId(actor);
    const phone = normalizePhone(rawPhone);
    if (phone.length < 9) {
      throw new BadRequestException('Введите номер полностью');
    }

    const local = await this.prisma.user.findFirst({
      where: { phoneNormalized: phone },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        externalId: true,
      },
    });
    if (local?.externalId) {
      return {
        found: true,
        pending: false,
        source: 'local',
        phone,
        clientId: local.id,
        externalId: local.externalId,
        firstName: local.firstName,
        lastName: local.lastName,
      };
    }

    const now = new Date();
    const cached = await this.prisma.spaPhoneLookupCache.findUnique({
      where: { clubId_phoneNormalized: { clubId, phoneNormalized: phone } },
    });
    if (cached && cached.expiresAt > now) {
      return {
        found: cached.found,
        pending: false,
        source: cached.found ? '1c' : 'none',
        phone,
        clientId: cached.localUserId ?? local?.id,
        externalId: cached.externalId ?? undefined,
        firstName: cached.firstName ?? local?.firstName,
        lastName: cached.lastName ?? local?.lastName,
      };
    }

    const provider = this.fitness.getProvider();
    let remote: Awaited<
      ReturnType<NonNullable<typeof provider.findClientByPhone>>
    > | 'timeout' | null = null;
    if (provider.findClientByPhone) {
      remote = await Promise.race([
        provider.findClientByPhone(phone).catch(() => null),
        new Promise<'timeout'>((resolve) =>
          setTimeout(() => resolve('timeout'), 5_000),
        ),
      ]);
    }

    if (remote === 'timeout') {
      return {
        found: Boolean(local),
        pending: true,
        source: local ? 'local' : 'none',
        phone,
        clientId: local?.id,
        externalId: local?.externalId ?? undefined,
        firstName: local?.firstName,
        lastName: local?.lastName,
      };
    }

    const hit = remote && remote.externalId ? remote : null;
    if (hit && local && !local.externalId) {
      await this.prisma.user.update({
        where: { id: local.id },
        data: { externalId: hit.externalId },
      });
    }

    const expiresAt = new Date(
      now.getTime() + (hit ? 24 : 1) * 60 * 60 * 1000,
    );
    await this.prisma.spaPhoneLookupCache.upsert({
      where: { clubId_phoneNormalized: { clubId, phoneNormalized: phone } },
      create: {
        clubId,
        phoneNormalized: phone,
        externalId: hit?.externalId,
        firstName: hit?.firstName ?? local?.firstName,
        lastName: hit?.lastName ?? local?.lastName,
        localUserId: local?.id,
        found: Boolean(hit || local),
        expiresAt,
      },
      update: {
        externalId: hit?.externalId,
        firstName: hit?.firstName ?? local?.firstName,
        lastName: hit?.lastName ?? local?.lastName,
        localUserId: local?.id,
        found: Boolean(hit || local),
        expiresAt,
      },
    });

    if (local) {
      return {
        found: true,
        pending: false,
        source: hit ? '1c' : 'local',
        phone,
        clientId: local.id,
        externalId: hit?.externalId ?? local.externalId ?? undefined,
        firstName: hit?.firstName || local.firstName,
        lastName: hit?.lastName || local.lastName,
      };
    }
    if (hit) {
      return {
        found: true,
        pending: false,
        source: '1c',
        phone,
        externalId: hit.externalId,
        firstName: hit.firstName,
        lastName: hit.lastName,
      };
    }
    return {
      found: false,
      pending: false,
      source: 'none',
      phone,
    };
  }
}
