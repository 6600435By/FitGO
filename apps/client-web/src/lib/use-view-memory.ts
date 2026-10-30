'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { getUser } from '@/lib/auth';
import {
  hasExplicitQuery,
  isIsoDay,
  readViewMemory,
  writeViewMemory,
} from '@/lib/view-memory';

type JsonRecord = Record<string, unknown>;

/**
 * Resolve filters once: explicit URL → memory → defaults.
 * Safe to call inside useState(() => …) on the client.
 */
export function resolveViewFilters<T extends JsonRecord>(opts: {
  userId: string;
  pathname: string;
  slot?: string;
  search: URLSearchParams | { get: (k: string) => string | null };
  urlKeys: string[];
  /** Fields taken from the URL when it has an explicit deep link. */
  fromUrl: (
    search: URLSearchParams | { get: (k: string) => string | null },
  ) => Partial<T>;
  defaults: T;
}): T {
  const slot = opts.slot ?? 'main';
  if (hasExplicitQuery(opts.search, opts.urlKeys)) {
    return { ...opts.defaults, ...opts.fromUrl(opts.search) };
  }
  if (opts.userId) {
    const saved = readViewMemory<T>(opts.userId, opts.pathname, slot);
    if (saved) return { ...opts.defaults, ...saved };
  }
  return opts.defaults;
}

type PersistOpts<T extends JsonRecord> = {
  slot?: string;
  data: T;
  /** Build query string mirrored into the address bar. */
  toSearchParams?: (data: T) => URLSearchParams;
  /** When false, do not write yet. */
  enabled?: boolean;
};

const DRILL_KEYS = [
  'sessionKey',
  'session',
  'externalId',
  'client',
  'clientId',
  'performerId',
  'q',
  'product',
  'kind',
];

/**
 * True when the address bar still has a deep link the in-memory filters
 * have not copied yet. The first persist must not replace that URL.
 */
function liveCarriesUnappliedDrill(
  live: URLSearchParams,
  next: URLSearchParams,
): boolean {
  for (const key of DRILL_KEYS) {
    const value = live.get(key)?.trim();
    if (value && next.get(key) !== value) return true;
  }
  const liveFrom = live.get('from');
  const liveTo = live.get('to');
  if (isIsoDay(liveFrom) && next.get('from') !== liveFrom) return true;
  if (isIsoDay(liveTo) && next.get('to') !== liveTo) return true;
  return false;
}

/**
 * Write filter memory on change and mirror into the URL via replace.
 */
export function usePersistViewMemory<T extends JsonRecord>({
  slot = 'main',
  data,
  toSearchParams,
  enabled = true,
}: PersistOpts<T>) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const ownerId = getUser()?.id ?? '';
  const serialized = JSON.stringify(data);
  const primed = useRef(false);

  useEffect(() => {
    if (!enabled || !ownerId) return;
    const next = toSearchParams ? toSearchParams(data) : null;
    if (!primed.current) {
      primed.current = true;
      if (next && typeof window !== 'undefined') {
        const live = new URLSearchParams(window.location.search);
        if (liveCarriesUnappliedDrill(live, next)) return;
      }
    }
    writeViewMemory(ownerId, pathname, slot, data);
    if (!next) return;
    const qs = next.toString();
    const liveQs =
      typeof window !== 'undefined'
        ? window.location.search.replace(/^\?/, '')
        : searchParams.toString();
    if (qs === liveQs || qs === searchParams.toString()) return;
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- persist on serialized snapshot
  }, [serialized, enabled, ownerId, pathname, slot]);
}

export function useViewMemoryOwnerId(): string {
  return getUser()?.id ?? '';
}

export { hasExplicitQuery };
