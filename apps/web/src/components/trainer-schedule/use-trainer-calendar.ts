'use client';

import type {
  SchedulePublishSummary,
  TrainerAvailabilityBlock,
  TrainerCalendarEvent,
} from '@fitgo/shared-types';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { getCalendarPeriod } from './calendar-period';
import type { ScheduleView } from './schedule-grid';

export function useTrainerCalendar(date: Date, view: ScheduleView) {
  const [events, setEvents] = useState<TrainerCalendarEvent[]>([]);
  const [availabilityBlocks, setAvailabilityBlocks] = useState<
    TrainerAvailabilityBlock[]
  >([]);
  const [draftBlockCount, setDraftBlockCount] = useState(0);
  const [publishSummary, setPublishSummary] = useState<
    SchedulePublishSummary | undefined
  >();
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
      setPublishSummary(data.publishSummary);
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
    publishSummary,
    loading,
    error,
    period,
    reload: load,
  };
}
