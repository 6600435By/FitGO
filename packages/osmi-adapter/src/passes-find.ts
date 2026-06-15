import type { OsmiApiClient } from './osmi-client';
import { normalizePhone, phonesMatch } from './normalize';

type PassListItem = {
  serialNo?: string;
  values?: Array<{ label?: string; value?: string }>;
  barcode?: {
    effective?: { message?: string };
    card?: { message?: string };
    message?: string;
  };
};

function barcodeMessage(item: PassListItem): string | undefined {
  const msg =
    item.barcode?.effective?.message ??
    item.barcode?.card?.message ??
    item.barcode?.message;
  return msg?.trim() || undefined;
}

function passPhoneValues(item: PassListItem): string[] {
  const phones: string[] = [];
  for (const field of item.values ?? []) {
    const label = (field.label ?? '').toLowerCase();
    if (label.includes('телефон') || label.includes('phone')) {
      const value = field.value?.trim();
      if (value && value !== '-empty-') phones.push(value);
    }
  }
  return phones;
}

function passMatchesPhone(item: PassListItem, phone: string): boolean {
  for (const regPhone of passPhoneValues(item)) {
    if (phonesMatch(regPhone, phone)) return true;
  }
  return false;
}

async function forEachPassPage(
  client: OsmiApiClient,
  template: string | undefined,
  onPage: (cards: PassListItem[]) => boolean | void,
  maxPages = 120,
): Promise<void> {
  for (let page = 1; page <= maxPages; page++) {
    const query = new URLSearchParams({
      barcode: 'true',
      extendedInfo: 'true',
      page: String(page),
    });
    if (template) query.set('template', template);

    const body = await client.request(`/passes?${query.toString()}`, { method: 'GET' });
    const cards = (body as { cards?: PassListItem[] }).cards ?? [];
    if (!cards.length) break;
    const stop = onPage(cards);
    if (stop) break;
  }
}

/** Find OSMI pass serial by club barcode (effective barcode message after 1C sync). */
export async function findSerialByBarcodeInPasses(
  client: OsmiApiClient,
  barcode: string,
  template?: string,
): Promise<string | null> {
  const target = barcode.trim();
  if (!target) return null;

  let found: string | null = null;
  await forEachPassPage(client, template, (cards) => {
    for (const card of cards) {
      if (barcodeMessage(card) === target) {
        found = card.serialNo?.trim() ?? null;
        return true;
      }
    }
    return false;
  });

  return found;
}

/** Find pass serials in OSMI card database by phone (card fields after 1C sync). */
export async function findSerialsByPhoneInPasses(
  client: OsmiApiClient,
  phone: string,
  template?: string,
): Promise<string[]> {
  const serials = new Set<string>();

  await forEachPassPage(client, template, (cards) => {
    for (const card of cards) {
      if (!passMatchesPhone(card, phone)) continue;
      const serial = card.serialNo?.trim();
      if (serial) serials.add(serial);
    }
  });

  return [...serials];
}

export async function findSerialsByOwnerPhoneSearch(
  client: OsmiApiClient,
  phone: string,
): Promise<string[]> {
  const serials = new Set<string>();
  const digits = normalizePhone(phone);
  const variants = new Set([digits, phone.trim()]);
  if (digits.length === 12 && digits.startsWith('375')) {
    const local = digits.slice(3);
    variants.add(`+375${local}`);
    variants.add(`+3752 ${local.slice(1, 4)}-${local.slice(4, 6)}-${local.slice(6)}`);
  }

  for (const text of variants) {
    const body = await client.request('/search/passes', {
      method: 'POST',
      body: JSON.stringify({ text, front: true, back: true, fields: [] }),
    });
    if (!Array.isArray(body)) continue;
    for (const item of body) {
      const serial = (item as { serial?: string }).serial?.trim();
      if (serial) serials.add(serial);
    }
  }

  return [...serials];
}
