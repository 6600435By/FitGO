'use client';

import type { TrainerAvailabilityBlock, TrainerCalendarEvent } from '@fitgo/shared-types';
import { useCallback, useEffect, useState } from 'react';
import type { View } from 'react-big-calendar';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { getCalendarPeriod } from './calendar-period';

export function useTrainerCalendar(date: Date, view: View) {
  const [events, setEvents] = useState<TrainerCalendarEvent[]>([]);
  const [availabilityBlocks, setAvailabilityBlocks] = useState<
    TrainerAvailabilityBlock[]
  >([]);
  const [draftBlockCount, setDraftBlockCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState(() => getCalendarPeriod(date, view));

  const load = useCallback(async () => {
    const token = getToken();
    if (!token) return;

    const nextPeriod = getCalendarPeriod(date, view);
    setPeriod(nextPeriod);
    setLoading(true);
    setError('');

    try {
      const data = await api.trainerCalendar(
        token,
        nextPeriod.from,
        nextPeriod.to,
      );
      setEvents(data.events);
      setAvailabilityBlocks(data.availabilityBlocks);
      setDraftBlockCount(data.draftBlockCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [date, view]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    events,
    availabilityBlocks,
    draftBlockCount,
    loading,
    error,
    period,
    reload: load,
  };
}
