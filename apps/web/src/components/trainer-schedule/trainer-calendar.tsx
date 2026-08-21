'use client';

import type { TrainerAvailabilityBlock, TrainerCalendarEvent } from '@fitgo/shared-types';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import {
  eventKindMatchesFilter,
  type ScheduleTypeFilter,
} from './calendar-utils';
import { ScheduleDayGrid } from './schedule-day-grid';
import { ScheduleMobileList } from './schedule-mobile-list';
import { ScheduleMonthAgenda } from './schedule-month-agenda';
import type { ScheduleView } from './schedule-grid';
import { ScheduleWeekGrid } from './schedule-week-grid';

export function TrainerCalendar({
  events,
  filter,
  view,
  date,
  availabilityBlocks,
  onNavigate,
  onViewChange,
  onSelectEvent,
}: {
  events: TrainerCalendarEvent[];
  filter: ScheduleTypeFilter;
  view: ScheduleView;
  date: Date;
  availabilityBlocks: TrainerAvailabilityBlock[];
  onNavigate: (date: Date) => void;
  onViewChange: (view: ScheduleView) => void;
  onSelectEvent?: (event: TrainerCalendarEvent) => void;
}) {
  const router = useRouter();

  const visibleEvents = useMemo(
    () =>
      events.filter((event) => {
        if (event.kind === 'DRAFT_SLOT') return false;
        return eventKindMatchesFilter(event.kind, filter);
      }),
    [events, filter],
  );

  const handleSelectEvent = (event: TrainerCalendarEvent) => {
    if (
      event.kind === 'PERSONAL' &&
      event.bookingId &&
      event.clientId
    ) {
      router.push(
        `/trainer/sessions/${event.bookingId}?clientId=${event.clientId}`,
      );
      return;
    }
    onSelectEvent?.(event);
  };

  return (
    <div className="space-y-3">
      <p className="hidden text-xs text-slate-500 md:block">
        Клик по персональной тренировке — открыть сессию. В сетке показаны только часы из опубликованного графика.
      </p>

      <div className="md:hidden">
        <ScheduleMobileList
          events={visibleEvents}
          onSelectEvent={handleSelectEvent}
        />
      </div>

      <div className="hidden md:block">
        {view === 'day' && (
          <ScheduleDayGrid
            date={date}
            events={visibleEvents}
            availabilityBlocks={availabilityBlocks}
            onSelectEvent={handleSelectEvent}
          />
        )}
        {view === 'week' && (
          <ScheduleWeekGrid
            date={date}
            events={visibleEvents}
            availabilityBlocks={availabilityBlocks}
            onSelectEvent={handleSelectEvent}
          />
        )}
        {view === 'month' && (
          <ScheduleMonthAgenda
            date={date}
            events={visibleEvents}
            availabilityBlocks={availabilityBlocks}
            onSelectEvent={handleSelectEvent}
            onSelectDay={(day) => {
              onNavigate(day);
              onViewChange('day');
            }}
          />
        )}
      </div>
    </div>
  );
}
