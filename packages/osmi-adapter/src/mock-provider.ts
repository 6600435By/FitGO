import { MembershipStatus } from '@fitgo/shared-types';
import { normalizePhone } from './normalize';
import type { IOsmiCardsProvider, OsmiCardData, OsmiCreateCardInput } from './types';

const store = new Map<string, OsmiCardData>();

export class MockOsmiCardsProvider implements IOsmiCardsProvider {
  async findCardByBarcode(barcode: string): Promise<OsmiCardData | null> {
    for (const card of store.values()) {
      if (card.barcode === barcode.trim()) return card;
    }
    return null;
  }

  async findCardByPhone(
    phone: string,
    _programId: string,
    _context?: import('./types').OsmiFindCardContext,
  ): Promise<OsmiCardData | null> {
    const key = normalizePhone(phone);
    return store.get(key) ?? null;
  }

  async createCard(input: OsmiCreateCardInput): Promise<OsmiCardData> {
    const key = normalizePhone(input.phone);
    const suffix = key.slice(-10).padStart(10, '0');
    const card: OsmiCardData = {
      cardId: `osmi-mock-${key}`,
      barcode: `OSMI${suffix}`,
      walletUrl: undefined,
      membership: {
        id: `membership-${key}`,
        name: 'Безлимитный абонемент',
        status: MembershipStatus.ACTIVE,
        validFrom: new Date().toISOString().slice(0, 10),
        validUntil: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
        visitsRemaining: undefined,
        visitsTotal: undefined,
      },
    };
    store.set(key, card);
    return card;
  }

  async getCard(cardId: string): Promise<OsmiCardData | null> {
    for (const card of store.values()) {
      if (card.cardId === cardId) return card;
    }
    return null;
  }
}
