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

export type PhoneLookupOptions = {
  /**
   * Only spaPhoneLookupCache + local User — never call 1C.
   * Use on booking-control GET so the card stays snappy.
   */
  cacheOnly?: boolean;
  /** Live 1C timeout (ms). Default 5000; refresh uses ~2000. */
  timeoutMs?: number;
  /**
   * Write User.externalId when empty (create / explicit «Сохранить и привязать»).
   * Control soft-match must leave User CRM links alone.
   */
  allowUserExternalIdWrite?: boolean;
  /**
   * After 1C hit, overwrite User.firstName/lastName so specialist client
   * base matches 1C and stops offering the mistyped name.
   */
  allowUserFioWrite?: boolean;
};

/**
 * Shared phone → client resolution for SPA and trainer CRM.
 *
 * Phone is the source of truth. Prefer 1C card (externalId + FIO) over the
 * local User row when a live/cached 1C hit exists.
 *
 * Order: spaPhoneLookupCache (fresh) → 1C findClientByPhone → local User.
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
    options?: PhoneLookupOptions,
  ): Promise<PhoneLookupResult> {
    const clubId = requireClubId(actor);
    return this.lookupByPhoneInClub(clubId, rawPhone, {
      allowUserExternalIdWrite: true,
      allowUserFioWrite: true,
      ...options,
    });
  }

  /**
   * Same as lookupByPhone but without JWT (booking-control refresh / soft-match).
   */
  async lookupByPhoneInClub(
    clubId: string,
    rawPhone: string,
    options?: PhoneLookupOptions,
  ): Promise<PhoneLookupResult> {
    const phone = normalizePhone(rawPhone);
    if (phone.length < 9) {
      throw new BadRequestException('Введите номер полностью');
    }
    const cacheOnly = Boolean(options?.cacheOnly);
    const timeoutMs = Math.max(500, options?.timeoutMs ?? 5_000);
    const allowExtWrite = Boolean(options?.allowUserExternalIdWrite);
    const allowFioWrite = Boolean(options?.allowUserFioWrite);

    const local = await this.prisma.user.findFirst({
      where: { phoneNormalized: phone },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        externalId: true,
      },
    });

    const now = new Date();
    const cached = await this.prisma.spaPhoneLookupCache.findUnique({
      where: { clubId_phoneNormalized: { clubId, phoneNormalized: phone } },
    });
    if (cached && cached.expiresAt > now && cached.found && cached.externalId) {
      if (allowFioWrite && local && (cached.firstName || cached.lastName)) {
        await this.applyUserFioFromOneC(local.id, {
          firstName: cached.firstName,
          lastName: cached.lastName,
        });
      }
      return {
        found: true,
        pending: false,
        source: '1c',
        phone,
        clientId: cached.localUserId ?? local?.id,
        externalId: cached.externalId,
        firstName: cached.firstName ?? local?.firstName,
        lastName: cached.lastName ?? local?.lastName,
      };
    }

    if (cacheOnly) {
      if (cached?.externalId) {
        return {
          found: true,
          pending: false,
          source: '1c',
          phone,
          clientId: cached.localUserId ?? local?.id,
          externalId: cached.externalId,
          firstName: cached.firstName ?? local?.firstName,
          lastName: cached.lastName ?? local?.lastName,
        };
      }
      return {
        found: Boolean(local),
        pending: false,
        source: local ? 'local' : 'none',
        phone,
        clientId: local?.id,
        externalId: local?.externalId ?? undefined,
        firstName: local?.firstName,
        lastName: local?.lastName,
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
          setTimeout(() => resolve('timeout'), timeoutMs),
        ),
      ]);
    }

    if (remote === 'timeout') {
      if (cached?.externalId) {
        return {
          found: true,
          pending: true,
          source: '1c',
          phone,
          clientId: cached.localUserId ?? local?.id,
          externalId: cached.externalId,
          firstName: cached.firstName ?? local?.firstName,
          lastName: cached.lastName ?? local?.lastName,
        };
      }
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
    if (hit && local) {
      const patch: {
        externalId?: string;
        firstName?: string;
        lastName?: string;
      } = {};
      if (allowExtWrite && !local.externalId?.trim()) {
        patch.externalId = hit.externalId;
      }
      if (allowFioWrite) {
        if (hit.firstName?.trim()) patch.firstName = hit.firstName.trim();
        if (hit.lastName?.trim()) patch.lastName = hit.lastName.trim();
      }
      if (Object.keys(patch).length) {
        await this.prisma.user
          .update({ where: { id: local.id }, data: patch })
          .catch(() => undefined);
      }
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
        externalId: hit?.externalId ?? cached?.externalId,
        firstName: hit?.firstName ?? local?.firstName,
        lastName: hit?.lastName ?? local?.lastName,
        localUserId: local?.id,
        found: Boolean(hit || local),
        expiresAt,
      },
    });

    if (hit) {
      return {
        found: true,
        pending: false,
        source: '1c',
        phone,
        clientId: local?.id,
        externalId: hit.externalId,
        firstName: hit.firstName || local?.firstName,
        lastName: hit.lastName || local?.lastName,
      };
    }
    if (local) {
      return {
        found: true,
        pending: false,
        source: 'local',
        phone,
        clientId: local.id,
        externalId: local.externalId ?? undefined,
        firstName: local.firstName,
        lastName: local.lastName,
      };
    }
    return {
      found: false,
      pending: false,
      source: 'none',
      phone,
    };
  }

  private async applyUserFioFromOneC(
    userId: string,
    fio: { firstName?: string | null; lastName?: string | null },
  ) {
    const firstName = fio.firstName?.trim();
    const lastName = fio.lastName?.trim();
    if (!firstName && !lastName) return;
    await this.prisma.user
      .update({
        where: { id: userId },
        data: {
          ...(firstName ? { firstName } : {}),
          ...(lastName ? { lastName } : {}),
        },
      })
      .catch(() => undefined);
  }
}
