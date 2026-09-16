/** Last-known club access barcode for instant paint at the door. */

export type CachedAccessCard = {
  barcode: string;
  barcodeFormat?: 'CODE128' | 'PDF417' | 'QR';
  clientName: string;
  clubName: string;
  syncedAt?: string;
  source?: string;
};

const STORAGE_KEY = 'fitgo.access-card.v1';

export function readAccessCardCache(): CachedAccessCard | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedAccessCard;
    if (!parsed?.barcode || typeof parsed.barcode !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeAccessCardCache(card: CachedAccessCard): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        barcode: card.barcode,
        barcodeFormat: card.barcodeFormat ?? 'CODE128',
        clientName: card.clientName,
        clubName: card.clubName,
        syncedAt: card.syncedAt ?? new Date().toISOString(),
        source: card.source,
      }),
    );
  } catch {
    // Quota / private mode — ignore
  }
}
