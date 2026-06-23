'use client';

import type { TrainerCalendarEvent } from '@fitgo/shared-types';
import { format, getDay, parse, startOfWeek } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import {
  Calendar,
  dateFnsLocalizer,
  type Event,
  type View,
} from 'react-big-calendar';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import {
  calendarEventStyle,
  eventKindMatchesFilter,
  type ScheduleTypeFilter,
} from './calendar-utils';

const locales = { ru };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }),
  getDay,
  locales,
});

interface CalendarEvent extends Event {
  resource: TrainerCalendarEvent;
}

export function TrainerCalendar({
  events,
  filter,
  view,
  date,
  masterMode,
  onNavigate,
  onViewChange,
  onSelectEvent,
  onSelectSlot,
}: {
  events: TrainerCalendarEvent[];
  filter: ScheduleTypeFilter;
  view: View;
  date: Date;
  masterMode: boolean;
  onNavigate: (date: Date) => void;
  onViewChange: (view: View) => void;
  onSelectEvent?: (event: TrainerCalendarEvent) => void;
  onSelectSlot?: (start: Date, end: Date) => void;
}) {
  const router = useRouter();

  const calendarEvents = useMemo<CalendarEvent[]>(() => {
    return events
      .filter((event) => {
        if (!masterMode && event.kind === 'DRAFT_SLOT') return false;
        return eventKindMatchesFilter(event.kind, filter);
      })
      .map((event) => ({
        title: event.title,
        start: new Date(event.startAt),
        end: new Date(event.endAt),
        resource: event,
      }));
  }, [events, filter, masterMode]);

  const eventPropGetter = (event: CalendarEvent) => {
    const { className, style } = calendarEventStyle(event.resource.kind);
    return { className, style };
  };

  return (
    <div className="trainer-calendar min-h-[480px] rounded-2xl border border-slate-800 bg-slate-900/50 p-2 sm:p-4">
      <Calendar
        localizer={localizer}
        culture="ru"
        events={calendarEvents}
        view={view}
        date={date}
        onNavigate={onNavigate}
        onView={onViewChange}
        views={['month', 'week', 'day']}
        step={60}
        timeslots={1}
        selectable={masterMode}
        onSelectEvent={(event) => {
          const resource = (event as CalendarEvent).resource;
          if (resource.kind === 'PERSONAL' && resource.bookingId && resource.clientId) {
            if (!masterMode) {
              router.push(
                `/trainer/sessions/${resource.bookingId}?clientId=${resource.clientId}`,
              );
              return;
            }
          }
          onSelectEvent?.(resource);
        }}
        onSelectSlot={(slot) => {
          if (masterMode && onSelectSlot) {
            onSelectSlot(slot.start, slot.end);
          }
        }}
        eventPropGetter={eventPropGetter}
        messages={{
          today: 'Сегодня',
          previous: '←',
          next: '→',
          month: 'Месяц',
          week: 'Неделя',
          day: 'День',
          agenda: 'Список',
          date: 'Дата',
          time: 'Время',
          event: 'Событие',
          noEventsInRange: 'Нет событий в этом периоде',
        }}
        style={{ height: view === 'month' ? 520 : 640 }}
      />
    </div>
  );
}
