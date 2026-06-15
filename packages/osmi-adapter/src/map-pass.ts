import { MembershipStatus, type Membership } from '@fitgo/shared-types';
import type { OsmiCardData } from './types';

export type OsmiBarcodeFormat = 'CODE128' | 'PDF417' | 'QR';

function pickValue(
  values: Array<{ label?: string; value?: string }> | undefined,
  labels: string[],
): string | undefined {
  if (!values) return undefined;
  const normalized = labels.map((l) => l.toLowerCase());
  for (const item of values) {
    const label = item.label?.toLowerCase() ?? '';
    if (normalized.some((needle) => label.includes(needle))) {
      const value = item.value?.trim();
      if (value && value !== '-empty-') return value;
    }
  }
  return undefined;
}

function parseDate(value?: string): string | undefined {
  if (!value || value === '-empty-') return undefined;
  const activeUntil = value.match(/активен\s+до\s+(\d{2})[./](\d{2})[./](\d{4})/i);
  if (activeUntil) return `${activeUntil[3]}-${activeUntil[2]}-${activeUntil[1]}`;
  const iso = value.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (iso) return iso;
  const dmy = value.match(/(\d{2})[./](\d{2})[./](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return undefined;
}

function extractBarcode(body: {
  barcode?: {
    message?: string;
    format?: string;
    template?: { format?: string };
    effective?: { message?: string; format?: string };
    card?: { message?: string; format?: string };
  };
}): { value: string; format: OsmiBarcodeFormat } | null {
  const barcode = body.barcode;
  if (!barcode) return null;

  const message =
    barcode.effective?.message ??
    barcode.card?.message ??
    barcode.message;
  if (!message || message === '-empty-') return null;

  const formatRaw = (
    barcode.effective?.format ??
    barcode.card?.format ??
    barcode.template?.format ??
    barcode.format ??
    'CODE128'
  ).toUpperCase();

  let format: OsmiBarcodeFormat = 'CODE128';
  if (formatRaw.includes('PDF417') || formatRaw.includes('PDF')) {
    format = 'PDF417';
  } else if (formatRaw.includes('QR')) {
    format = 'QR';
  }

  return { value: message, format };
}

function mapMembershipFromPass(
  values: Array<{ label?: string; value?: string }> | undefined,
  general?: { expiryDate?: string; status?: string; template?: string },
): Membership | null {
  const name =
    pickValue(values, ['абонемент', 'тариф', 'membership', 'пакет']) ??
    (general?.template && general.template !== 'Card1' ? general.template : undefined);
  const validUntil =
    parseDate(pickValue(values, ['срок действия', 'действует до', 'срок', 'до', 'окончание'])) ??
    parseDate(general?.expiryDate);
  const validFrom = parseDate(
    pickValue(values, ['действует с', 'дата начала', 'начало']),
  );
  const visitsRaw = pickValue(values, [
    'осталось визит',
    'остаток услуг для абонемента',
  ]);
  const visitsMatch =
    visitsRaw?.match(/(\d+)\s*визит/i) ??
    (visitsRaw && /^\d+$/.test(visitsRaw.trim()) ? visitsRaw.trim().match(/^(\d+)$/) : null);
  const visitsRemaining = visitsMatch?.[1];

  if (!name && !validUntil) return null;

  const statusRaw = (general?.status ?? '').toUpperCase();
  let status = MembershipStatus.ACTIVE;
  if (statusRaw.includes('EXPIR') || statusRaw.includes('VOID') || statusRaw.includes('ИСТЕК')) {
    status = MembershipStatus.EXPIRED;
  } else if (statusRaw.includes('FROZEN') || statusRaw.includes('SUSPEND') || statusRaw.includes('ЗАМОРОЗ')) {
    status = MembershipStatus.FROZEN;
  }

  return {
    id: 'osmi-membership',
    name: name ?? 'Абонемент',
    status,
    validFrom: validFrom ?? new Date().toISOString().slice(0, 10),
    validUntil:
      validUntil ?? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    visitsRemaining: visitsRemaining ? Number(visitsRemaining) : undefined,
  };
}

/** Map OSMI /passes/{serialNo} response to internal card data. */
export function mapOsmiPassResponse(body: unknown): OsmiCardData | null {
  if (!body || typeof body !== 'object') return null;
  const root = body as {
    general?: { serialNo?: string; expiryDate?: string; status?: string; template?: string };
    barcode?: {
      message?: string;
      format?: string;
      template?: { format?: string };
      effective?: { message?: string; format?: string };
      card?: { message?: string; format?: string };
    };
    values?: Array<{ label?: string; value?: string }>;
    link?: string;
    images?: Array<{ imgId?: string; imgType?: string }>;
  };

  const serialNo = root.general?.serialNo;
  const barcode = extractBarcode(root);
  if (!serialNo || !barcode) return null;

  const strip = root.images?.find((img) => img.imgType === 'strip' || img.imgType === 'logo');
  const ownerName = pickValue(root.values, ['владелец', 'фио', 'owner']);

  return {
    cardId: serialNo,
    barcode: barcode.value,
    barcodeFormat: barcode.format,
    ownerName,
    walletUrl: typeof root.link === 'string' ? root.link : undefined,
    stripImageId: strip?.imgId,
    membership: mapMembershipFromPass(root.values, root.general),
  };
}

export function mapOsmiSearchResults(body: unknown): string | null {
  if (!Array.isArray(body) || body.length === 0) return null;
  const first = body[0];
  if (first && typeof first === 'object' && 'serial' in first) {
    const serial = (first as { serial?: string }).serial;
    return serial?.trim() || null;
  }
  return null;
}

export function mapOsmiFindUserResponse(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const root = body as Record<string, unknown>;
  const serial =
    root.serialNo ??
    root.serial ??
    (root.card && typeof root.card === 'object'
      ? (root.card as { serialNo?: string }).serialNo
      : undefined);
  return typeof serial === 'string' && serial.trim() ? serial.trim() : null;
}

export function mapOsmiCreateAutoResponse(body: unknown): {
  serialNo: string;
  link?: string;
} | null {
  if (!body || typeof body !== 'object') return null;
  const root = body as { serialNo?: string; link?: string };
  if (!root.serialNo?.trim()) return null;
  return { serialNo: root.serialNo.trim(), link: root.link };
}
