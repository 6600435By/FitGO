'use client';

import type { TrainerAvailabilityBlock, TrainerCalendarEvent } from '@fitgo/shared-types';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import {
  eventVisibleInCalendar,
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
  showCancelled,
  view,
  date,
  availabilityBlocks,
  onNavigate,
  onViewChange,
  onSelectEvent,
  onManageEvent,
  onMoveBooking,
}: {
  events: TrainerCalendarEvent[];
  filter: ScheduleTypeFilter;
  showCancelled: boolean;
  view: ScheduleView;
  date: Date;
  availabilityBlocks: TrainerAvailabilityBlock[];
  onNavigate: (date: Date) => void;
  onViewChange: (view: ScheduleView) => void;
  onSelectEvent?: (event: TrainerCalendarEvent) => void;
  /** Open booking edit sheet without navigating to the workout. */
  onManageEvent?: (event: TrainerCalendarEvent) => void;
  onMoveBooking?: (event: TrainerCalendarEvent, newStartAt: string) => void;
}) {
  const router = useRouter();

  const visibleEvents = useMemo(
    () =>
      events.filter((event) =>
        eventVisibleInCalendar(event, filter, showCancelled),
      ),
    [events, filter, showCancelled],
  );

  const handleSelectEvent = (event: TrainerCalendarEvent) => {
    if (
      event.kind === 'PERSONAL' &&
      event.bookingId &&
      event.clientId &&
      event.bookingStatus !== 'CANCELLED'
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
        Клик — открыть сессию, «Изменить» — время и отмена, перетаскивание в
        неделе — перенести. Черновик и свободное окно подписаны текстом; отмены
        — по фильтру «Отмены».
      </p>

      <div className="md:hidden">
        <ScheduleMobileList
          events={visibleEvents}
          onSelectEvent={handleSelectEvent}
          onManageEvent={onManageEvent}
        />
      </div>

      <div className="hidden md:block">
        {view === 'day' && (
          <ScheduleDayGrid
            date={date}
            events={visibleEvents}
            availabilityBlocks={availabilityBlocks}
            onSelectEvent={handleSelectEvent}
            onManageEvent={onManageEvent}
          />
        )}
        {view === 'week' && (
          <ScheduleWeekGrid
            date={date}
            events={visibleEvents}
            availabilityBlocks={availabilityBlocks}
            onSelectEvent={handleSelectEvent}
            onManageEvent={onManageEvent}
            onMoveBooking={onMoveBooking}
          />
        )}
        {view === 'month' && (
          <ScheduleMonthAgenda
            date={date}
            events={visibleEvents}
            availabilityBlocks={availabilityBlocks}
            onSelectEvent={handleSelectEvent}
            onManageEvent={onManageEvent}
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
