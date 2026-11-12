'use client';

import type { BookingControlListItem, WorkUnit } from '@fitgo/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createBookingControlApi,
  type BookingControlApiBase,
} from '@/lib/booking-control-api';
import { getToken } from '@/lib/auth';

export type ControlMiss = BookingControlListItem;

type Args = {
  mode: 'super' | 'admin';
  performerId: string;
  from: string;
  to: string;
  workUnits: WorkUnit[] | undefined;
  /** When true, fetch needsReview list. */
  enabled: boolean;
};

/**
 * Booking-control rows that need review and are missing from payroll workUnits
 * (or present but with a different sessionKey alias). Diff by sessionKey.
 */
export function useControlMisses({
  mode,
  performerId,
  from,
  to,
  workUnits,
  enabled,
}: Args) {
  const [items, setItems] = useState<ControlMiss[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const base: BookingControlApiBase =
    mode === 'super' ? 'super-admin' : 'admin';

  const knownKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const u of workUnits ?? []) {
      if (u.sessionKey?.trim()) keys.add(u.sessionKey.trim());
    }
    return keys;
  }, [workUnits]);

  const load = useCallback(async () => {
    if (!enabled || !performerId || !from || !to) {
      setItems([]);
      return;
    }
    const token = getToken();
    if (!token) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const api = createBookingControlApi(base);
      const list = await api.list({
        from,
        to,
        performerId,
        needsReview: true,
      });
      setItems(list);
    } catch (e) {
      setItems([]);
      setError(e instanceof Error ? e.message : 'Ошибка контроля');
    } finally {
      setLoading(false);
    }
  }, [enabled, performerId, from, to, base]);

  useEffect(() => {
    void load();
  }, [load]);

  const misses = useMemo(
    () => items.filter((row) => !knownKeys.has(row.sessionKey)),
    [items, knownKeys],
  );

  return {
    misses,
    allNeedsReview: items,
    loading,
    error,
    reload: load,
  };
}
