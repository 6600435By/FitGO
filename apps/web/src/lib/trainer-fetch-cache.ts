/**
 * Short-lived in-memory cache for trainer Today / journal list.
 * Soft-cache only — not offline. Invalidate after mutations or date change.
 */

type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

const DEFAULT_TTL_MS = 45_000;

export function trainerCacheGet<T>(key: string): T | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    store.delete(key);
    return null;
  }
  return hit.value as T;
}

export function trainerCacheSet<T>(
  key: string,
  value: T,
  ttlMs = DEFAULT_TTL_MS,
): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function trainerCacheInvalidate(prefixOrKey: string): void {
  if (store.has(prefixOrKey)) {
    store.delete(prefixOrKey);
  }
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefixOrKey)) store.delete(key);
  }
}

export function trainerGpHomeCacheKey(userId: string): string {
  return `gp-home:${userId}`;
}

export function trainerBookingListCacheKey(
  userId: string,
  from: string,
  to: string,
  extra = '',
): string {
  return `bc-list:${userId}:${from}:${to}:${extra}`;
}
