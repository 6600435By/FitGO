'use client';

import type { BookingControlListItem, WorkUnit } from '@fitgo/shared-types';
import { bookingControlQueueSegment } from '@fitgo/shared-types';
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
  /** When true, fetch performer control list. */
  enabled: boolean;
};

/**
 * Same «На контроле» bucket as Booking Control for this performer/period
 * (unpaid, not-in-1C, journal, remarks, overdue approval) — not the narrower
 * API needsReview flag (remarks / pending approval only).
 */
export function useControlMisses({
  mode,
  performerId,
  from,
  to,
  enabled,
}: Args) {
  const [items, setItems] = useState<ControlMiss[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());

  const base: BookingControlApiBase =
    mode === 'super' ? 'super-admin' : 'admin';

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
      // Full performer list — pending filter matches Control queue (client-side).
      const list = await api.list({
        from,
        to,
        performerId,
      });
      setNowMs(Date.now());
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

  const pending = useMemo(
    () =>
      items.filter(
        (row) => bookingControlQueueSegment(row, nowMs) === 'pending',
      ),
    [items, nowMs],
  );

  return {
    /** Full «На контроле» list — same set as Booking Control pending. */
    misses: pending,
    allNeedsReview: pending,
    loading,
    error,
    reload: load,
  };
}
