'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { getUser } from '@/lib/auth';
import {
  hasExplicitQuery,
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

  useEffect(() => {
    if (!enabled || !ownerId) return;
    writeViewMemory(ownerId, pathname, slot, data);
    if (!toSearchParams) return;
    const next = toSearchParams(data);
    const qs = next.toString();
    if (qs === searchParams.toString()) return;
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- persist on serialized snapshot
  }, [serialized, enabled, ownerId, pathname, slot]);
}

export function useViewMemoryOwnerId(): string {
  return getUser()?.id ?? '';
}

export { hasExplicitQuery };
