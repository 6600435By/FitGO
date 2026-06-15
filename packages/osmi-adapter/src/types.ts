import type { Membership } from '@fitgo/shared-types';
import type { OsmiBarcodeFormat } from './map-pass';

export interface OsmiCardData {
  cardId: string;
  barcode: string;
  barcodeFormat?: OsmiBarcodeFormat;
  /** Owner name from OSMI card (after 1C sync) */
  ownerName?: string;
  walletUrl?: string;
  stripImageId?: string;
  membership: Membership | null;
}

export interface OsmiFindCardContext {
  firstName?: string;
  lastName?: string;
}

export interface OsmiCreateCardInput {
  programId: string;
  phone: string;
  firstName: string;
  lastName: string;
  email?: string;
}

export interface OsmiHttpConfig {
  /** e.g. https://api6.osmicards.com/v2 or /v2t */
  baseUrl: string;
  apiId: string;
  apiKey: string;
  programId: string;
  /** token (default for /v2t) or digest (for /v2) */
  auth?: 'token' | 'digest';
  /** OSMI template name filter for owner search */
  templateName?: string;
  /** Registration group from anketa (e.g. fsforma) */
  regGroup?: string;
  /** Campaign name for POST /passesauto/{name} — avoid for existing members */
  campaignName?: string;
}

export interface IOsmiCardsProvider {
  findCardByPhone(
    phone: string,
    programId: string,
    context?: OsmiFindCardContext,
  ): Promise<OsmiCardData | null>;
  findCardByBarcode(barcode: string): Promise<OsmiCardData | null>;
  createCard(input: OsmiCreateCardInput): Promise<OsmiCardData>;
  getCard(cardId: string): Promise<OsmiCardData | null>;
}
