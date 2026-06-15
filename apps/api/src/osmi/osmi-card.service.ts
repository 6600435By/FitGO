import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createOsmiProvider,
  type IOsmiCardsProvider,
  type OsmiCardData,
} from '@fitgo/osmi-adapter';
import type { ClubCardView } from '@fitgo/shared-types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

const OSMI_PROVIDER = 'OSMI_CARDS_PROVIDER';

@Injectable()
export class OsmiCardService {
  private readonly logger = new Logger(OsmiCardService.name);
  private readonly provider: IOsmiCardsProvider;
  private readonly programId: string;
  private readonly anketaUrl: string;
  private readonly cacheMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const enabled = this.config.get('OSMI_ENABLED', 'false') === 'true';
    const providerType = enabled
      ? this.config.get<'mock' | 'http'>('OSMI_PROVIDER', 'mock')
      : 'mock';

    this.provider = createOsmiProvider(providerType, {
      baseUrl: this.config.get('OSMI_API_BASE_URL', ''),
      apiId: this.config.get('OSMI_API_ID', ''),
      apiKey: this.config.get('OSMI_API_KEY', ''),
      programId: this.config.get('OSMI_PROGRAM_ID', '36006XCR7EE4TR'),
      auth: this.config.get<'token' | 'digest'>('OSMI_AUTH'),
      templateName: this.config.get('OSMI_TEMPLATE_NAME'),
      regGroup: this.config.get('OSMI_REG_GROUP'),
      campaignName: this.config.get('OSMI_CAMPAIGN_NAME'),
    });

    this.programId = this.config.get('OSMI_PROGRAM_ID', '36006XCR7EE4TR');
    this.anketaUrl = this.config.get(
      'OSMI_ANKETA_URL',
      'https://get.osmicards.com/anketa/36006XCR7EE4TR/get',
    );
    const cacheHours = Number(this.config.get('OSMI_CACHE_HOURS', '6'));
    this.cacheMs = cacheHours * 60 * 60 * 1000;
  }

  isEnabled(): boolean {
    return this.config.get('OSMI_ENABLED', 'false') === 'true';
  }

  async syncCardForUser(userId: string): Promise<ClubCardView | null> {
    if (!this.isEnabled()) return null;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { club: true },
    });
    if (!user?.phone?.trim()) {
      throw new BadRequestException('Укажите телефон в профиле для выпуска клубной карты');
    }

    const card = await this.fetchOrCreateCard(user);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        osmiCardId: card.cardId,
        osmiBarcode: card.barcode,
        osmiSyncedAt: new Date(),
      },
    });

    return this.toClubCardView({ ...user, osmiSyncedAt: new Date() }, card);
  }

  async getClubCard(user: JwtPayload, options?: { forceRefresh?: boolean }) {
    if (!this.isEnabled()) {
      return {
        enabled: false as const,
        card: null,
        needsPhone: false,
        anketaUrl: this.anketaUrl,
      };
    }

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
      include: { club: true },
    });
    if (!dbUser) throw new NotFoundException();

    if (!dbUser.phone?.trim()) {
      return {
        enabled: true as const,
        card: null,
        needsPhone: true,
        anketaUrl: this.anketaUrl,
      };
    }

    const stale =
      !dbUser.osmiSyncedAt ||
      Date.now() - dbUser.osmiSyncedAt.getTime() > this.cacheMs;

    if (!dbUser.osmiCardId || stale || options?.forceRefresh) {
      try {
        const card = await this.syncCardForUser(user.sub);
        return {
          enabled: true as const,
          card,
          needsPhone: false,
          anketaUrl: this.anketaUrl,
        };
      } catch (err) {
        this.logger.warn(
          `OSMI sync failed for user ${user.sub}: ${err instanceof Error ? err.message : err}`,
        );
        if (dbUser.osmiBarcode && dbUser.osmiCardId) {
          return {
            enabled: true as const,
            card: this.toClubCardView(dbUser, {
              cardId: dbUser.osmiCardId,
              barcode: dbUser.osmiBarcode,
              membership: null,
            }),
            needsPhone: false,
            anketaUrl: this.anketaUrl,
            syncError: err instanceof Error ? err.message : 'Ошибка синхронизации',
          };
        }
        return {
          enabled: true as const,
          card: null,
          needsPhone: false,
          anketaUrl: this.anketaUrl,
          syncError: err instanceof Error ? err.message : 'Ошибка синхронизации',
        };
      }
    }

    let membership = null as OsmiCardData['membership'];
    let barcode = dbUser.osmiBarcode!;
    let barcodeFormat: OsmiCardData['barcodeFormat'];
    let walletUrl: string | undefined;
    try {
      const remote = await this.provider.getCard(dbUser.osmiCardId);
      if (remote) {
        membership = remote.membership;
        barcode = remote.barcode;
        barcodeFormat = remote.barcodeFormat;
        walletUrl = remote.walletUrl;
        if (remote.barcode !== dbUser.osmiBarcode) {
          await this.prisma.user.update({
            where: { id: user.sub },
            data: { osmiBarcode: remote.barcode },
          });
        }
      }
    } catch {
      // use cached barcode only
    }

    return {
      enabled: true as const,
      card: this.toClubCardView(dbUser, {
        cardId: dbUser.osmiCardId,
        barcode,
        barcodeFormat,
        walletUrl,
        membership,
      }),
      needsPhone: false,
      anketaUrl: this.anketaUrl,
    };
  }

  getAccessCardFromCache(user: {
    id: string;
    firstName: string;
    lastName: string;
    osmiCardId: string | null;
    osmiBarcode: string | null;
    club: { name: string };
  }) {
    if (!user.osmiCardId || !user.osmiBarcode) return null;
    return {
      id: user.osmiCardId,
      barcode: user.osmiBarcode,
      clientName: `${user.firstName} ${user.lastName}`.trim(),
      clubName: user.club.name,
    };
  }

  private async fetchOrCreateCard(user: {
    id: string;
    phone: string | null;
    firstName: string;
    lastName: string;
    email: string;
    osmiCardId: string | null;
    osmiBarcode: string | null;
  }): Promise<OsmiCardData> {
    const phone = user.phone!.trim();

    const existing = await this.provider.findCardByPhone(phone, this.programId, {
      firstName: user.firstName,
      lastName: user.lastName,
    });
    if (existing) return existing;

    if (user.osmiCardId) {
      const byId = await this.provider.getCard(user.osmiCardId);
      if (byId) return byId;
    }

    if (user.osmiBarcode) {
      const byBarcode = await this.provider.findCardByBarcode(user.osmiBarcode);
      if (byBarcode) return byBarcode;
    }

    throw new BadRequestException(
      'Карта OSMI не найдена по телефону в базе клуба. Установите карту в Wallet и дождитесь синхронизации с 1С, либо обратитесь на ресепшен.',
    );
  }

  private toClubCardView(
    user: {
      firstName: string;
      lastName: string;
      osmiSyncedAt?: Date | null;
      club: { name: string };
    },
    card: OsmiCardData,
  ): ClubCardView {
    return {
      id: card.cardId,
      barcode: card.barcode,
      barcodeFormat: card.barcodeFormat,
      clientName: card.ownerName ?? `${user.firstName} ${user.lastName}`.trim(),
      clubName: user.club.name,
      membership: card.membership,
      walletUrl: card.walletUrl,
      stripImageId: card.stripImageId,
      syncedAt: (user.osmiSyncedAt ?? new Date()).toISOString(),
      source: 'osmi',
      anketaUrl: this.anketaUrl,
    };
  }
}
