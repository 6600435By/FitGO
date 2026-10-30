/**
 * Per-tab filter memory for club ops screens.
 * sessionStorage keeps short filter fields across client navigations.
 * In-memory map keeps last payroll summary until refresh / logout.
 */

export const VIEW_MEMORY_PREFIX = 'fitgo:view:v1:';

type JsonRecord = Record<string, unknown>;

function storageKey(userId: string, pathname: string, slot: string): string {
  return `${VIEW_MEMORY_PREFIX}${userId}:${pathname}:${slot}`;
}

export function readViewMemory<T extends JsonRecord>(
  userId: string,
  pathname: string,
  slot: string,
): T | null {
  if (typeof window === 'undefined' || !userId) return null;
  try {
    const raw = sessionStorage.getItem(storageKey(userId, pathname, slot));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

export function writeViewMemory(
  userId: string,
  pathname: string,
  slot: string,
  data: JsonRecord,
): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    sessionStorage.setItem(
      storageKey(userId, pathname, slot),
      JSON.stringify(data),
    );
  } catch {
    /* quota / private mode */
  }
}

/** Drop all view-memory keys (call on logout). */
export function clearViewMemory(): void {
  if (typeof window === 'undefined') return;
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(VIEW_MEMORY_PREFIX)) toRemove.push(key);
    }
    for (const key of toRemove) sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
  clearPayrollSummaryCache();
}

/**
 * True when the URL carries at least one of the named params with a
 * non-empty value (deep link / cross-tab handoff). Empty query → false.
 */
export function hasExplicitQuery(
  search: URLSearchParams | { get: (k: string) => string | null },
  keys: string[],
): boolean {
  return keys.some((k) => {
    const v = search.get(k);
    return v != null && v.trim() !== '';
  });
}

/** ISO calendar day YYYY-MM-DD. */
export function isIsoDay(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function pickIsoDay(
  ...candidates: Array<string | null | undefined>
): string | undefined {
  for (const c of candidates) {
    if (isIsoDay(c)) return c;
  }
  return undefined;
}

/* ── Payroll summary in-memory cache (lost on F5) ─────────────────── */

export type PayrollSummaryCacheKey = {
  mode: string;
  userId: string;
  from: string;
  to: string;
};

export type PayrollSummaryCacheEntry<T> = {
  key: PayrollSummaryCacheKey;
  summary: T;
  calculatedAt: number;
};

const payrollSummaryByOwner = new Map<
  string,
  PayrollSummaryCacheEntry<unknown>
>();

function payrollOwnerKey(ownerUserId: string, mode: string): string {
  return `${ownerUserId}:${mode}`;
}

export function getPayrollSummaryCache<T>(
  ownerUserId: string,
  key: PayrollSummaryCacheKey,
): PayrollSummaryCacheEntry<T> | null {
  if (!ownerUserId) return null;
  const entry = payrollSummaryByOwner.get(
    payrollOwnerKey(ownerUserId, key.mode),
  );
  if (!entry) return null;
  if (
    entry.key.userId !== key.userId ||
    entry.key.from !== key.from ||
    entry.key.to !== key.to ||
    entry.key.mode !== key.mode
  ) {
    return null;
  }
  return entry as PayrollSummaryCacheEntry<T>;
}

export function setPayrollSummaryCache<T>(
  ownerUserId: string,
  key: PayrollSummaryCacheKey,
  summary: T,
): void {
  if (!ownerUserId) return;
  payrollSummaryByOwner.set(payrollOwnerKey(ownerUserId, key.mode), {
    key,
    summary,
    calculatedAt: Date.now(),
  });
}

export function clearPayrollSummaryCache(ownerUserId?: string): void {
  if (!ownerUserId) {
    payrollSummaryByOwner.clear();
    return;
  }
  for (const k of [...payrollSummaryByOwner.keys()]) {
    if (k.startsWith(`${ownerUserId}:`)) payrollSummaryByOwner.delete(k);
  }
}

export function formatCalculatedAt(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}
