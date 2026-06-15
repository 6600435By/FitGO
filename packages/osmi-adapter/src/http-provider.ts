import { mapOsmiPassResponse, mapOsmiSearchResults } from './map-pass';
import { OsmiApiClient } from './osmi-client';
import {
  findSerialsByNameInRegistration,
  findSerialsByPhoneInRegistration,
  phoneSearchVariants,
} from './registration-find';
import {
  findSerialByBarcodeInPasses,
  findSerialsByOwnerPhoneSearch,
  findSerialsByPhoneInPasses,
} from './passes-find';
import { namesMatchOwner, pickBestOsmiCard } from './pick-best-card';
import type {
  IOsmiCardsProvider,
  OsmiCardData,
  OsmiCreateCardInput,
  OsmiFindCardContext,
  OsmiHttpConfig,
} from './types';

const OWNER_FIELDS = ['ВЛАДЕЛЕЦ', 'Владелец', 'ФИО'];

export class HttpOsmiCardsProvider implements IOsmiCardsProvider {
  private readonly client: OsmiApiClient;

  constructor(private readonly config: OsmiHttpConfig) {
    this.client = new OsmiApiClient(config);
  }

  private get template(): string | undefined {
    return this.config.templateName;
  }

  private async resolveCards(serialNos: string[]): Promise<OsmiCardData | null> {
    if (!serialNos.length) return null;
    const cards = await Promise.all(serialNos.map((serial) => this.getCard(serial)));
    return pickBestOsmiCard(cards);
  }

  private async searchSerialsByOwnerName(
    firstName: string,
    lastName: string,
  ): Promise<string[]> {
    const serials = new Set<string>();
    for (const text of [
      `${firstName} ${lastName}`.trim(),
      `${lastName} ${firstName}`.trim(),
    ]) {
      const searchBody = await this.client.request('/search/passes', {
        method: 'POST',
        body: JSON.stringify({
          text,
          front: true,
          back: true,
          fields: OWNER_FIELDS,
        }),
      });
      if (!Array.isArray(searchBody)) continue;
      for (const item of searchBody) {
        if (!item || typeof item !== 'object') continue;
        const serial = (item as { serial?: string }).serial?.trim();
        const content = String((item as { content?: string }).content ?? '');
        if (!serial || !namesMatchOwner(content, firstName, lastName)) continue;
        serials.add(serial);
      }
    }
    return [...serials];
  }

  async findCardByBarcode(barcode: string): Promise<OsmiCardData | null> {
    const serial = await findSerialByBarcodeInPasses(this.client, barcode, this.template);
    if (!serial) return null;
    return this.getCard(serial);
  }

  async findCardByPhone(
    phone: string,
    _programId: string,
    context?: OsmiFindCardContext,
  ): Promise<OsmiCardData | null> {
    // 1. OSMI card database (passes) — актуальные данные после сверки с 1С
    const fromSearch = await this.resolveCards(
      await findSerialsByOwnerPhoneSearch(this.client, phone),
    );
    if (fromSearch) return fromSearch;

    const fromPassesDb = await this.resolveCards(
      await findSerialsByPhoneInPasses(this.client, phone, this.template),
    );
    if (fromPassesDb) return fromPassesDb;

    for (const variant of phoneSearchVariants(phone)) {
      const searchBody = await this.client.request('/search/passes', {
        method: 'POST',
        body: JSON.stringify({
          text: variant,
          front: true,
          back: true,
          fields: [],
        }),
      });
      const serial = mapOsmiSearchResults(searchBody);
      if (serial) {
        const card = await this.getCard(serial);
        if (card) return card;
      }
    }

    if (context?.firstName && context?.lastName) {
      const byOwner = await this.resolveCards(
        await this.searchSerialsByOwnerName(context.firstName, context.lastName),
      );
      if (byOwner) return byOwner;
    }

    // 2. Анкета регистрации — только если карта ещё не обогащена в passes
    const regGroup = this.config.regGroup;
    if (regGroup) {
      const byPhone = await this.resolveCards(
        await findSerialsByPhoneInRegistration(this.client, regGroup, phone),
      );
      if (byPhone) return byPhone;

      if (context?.firstName && context?.lastName) {
        const byName = await this.resolveCards(
          await findSerialsByNameInRegistration(
            this.client,
            regGroup,
            context.firstName,
            context.lastName,
          ),
        );
        if (byName) return byName;
      }
    }

    return null;
  }

  async createCard(input: OsmiCreateCardInput): Promise<OsmiCardData> {
    throw new Error(
      'Создание новой карты OSMI через API отключено: используйте анкету клуба или существующую карту по телефону',
    );
  }

  async getCard(cardId: string): Promise<OsmiCardData | null> {
    const body = await this.client.request(
      `/passes/${encodeURIComponent(cardId)}?stats=true&extendedInfo=true&barcode=true&graphics=true`,
      { method: 'GET' },
    );
    const card = mapOsmiPassResponse(body);
    if (!card) return null;

    if (!card.walletUrl) {
      try {
        const linkBody = await this.client.request(
          `/passes/${encodeURIComponent(cardId)}/link?type=url`,
          { method: 'GET' },
        );
        if (linkBody && typeof linkBody === 'object' && 'link' in linkBody) {
          const link = String((linkBody as { link?: string }).link ?? '');
          if (link.startsWith('http')) {
            card.walletUrl = link;
          }
        }
      } catch {
        // optional
      }
    }

    return card;
  }
}
