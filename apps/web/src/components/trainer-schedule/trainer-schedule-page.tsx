'use client';

import type { TrainerCalendarEvent } from '@fitgo/shared-types';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { defaultCalendarDate } from './calendar-period';
import { type ScheduleTypeFilter } from './calendar-utils';
import { dateKey } from './schedule-grid';
import { AddTrainingDialog } from './add-training-dialog';
import { ScheduleLegend } from './schedule-legend';
import { ScheduleTypeFilterBar } from './schedule-type-filter';
import { ScheduleToolbar, shiftDateByView } from './schedule-toolbar';
import type { ScheduleView } from './schedule-grid';
import { TrainerCalendar } from './trainer-calendar';
import { useTrainerCalendar } from './use-trainer-calendar';
import { WorkScheduleSheet } from './work-schedule-sheet';

function EventActionDialog({
  event,
  onClose,
  onCancelBooking,
}: {
  event: TrainerCalendarEvent;
  onClose: () => void;
  onCancelBooking: (bookingId: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="card w-full max-w-sm space-y-3">
        <h3 className="font-semibold">{event.title}</h3>
        {event.kind === 'PERSONAL' && event.bookingId && (
          <button
            type="button"
            onClick={() => {
              onCancelBooking(event.bookingId!);
              onClose();
            }}
            className="btn-secondary w-full text-red-400"
          >
            Отменить запись
          </button>
        )}
        <button type="button" onClick={onClose} className="btn-secondary w-full">
          Закрыть
        </button>
      </div>
    </div>
  );
}

export function TrainerSchedulePage() {
  const [date, setDate] = useState(defaultCalendarDate);
  const [view, setView] = useState<ScheduleView>(() =>
    typeof window !== 'undefined' && window.innerWidth < 640 ? 'day' : 'week',
  );
  const [filter, setFilter] = useState<ScheduleTypeFilter>('all');
  const [showWorkSchedule, setShowWorkSchedule] = useState(false);
  const [showAddTraining, setShowAddTraining] = useState(false);
  const [clients, setClients] = useState<
    Array<{ id: string; firstName: string; lastName: string }>
  >([]);
  const [selectedEvent, setSelectedEvent] = useState<TrainerCalendarEvent | null>(
    null,
  );

  const { events, availabilityBlocks, loading, error, period, reload } =
    useTrainerCalendar(date, view);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api
      .trainerMessageRecipients(token)
      .then(setClients)
      .catch(() => api.trainerDashboard(token).then((d) => setClients(d.clients)));
  }, []);

  const handleCancelBooking = async (bookingId: string) => {
    const token = getToken();
    if (!token) return;
    await api.trainerUpdatePersonalBooking(token, bookingId, {
      action: 'cancel',
    });
    reload();
  };

  return (
    <div className="space-y-4 pb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold sm:text-2xl">Расписание</h2>
          <p className="mt-1 text-sm text-slate-400">
            Групповые занятия из 1С и персональные тренировки FitGO
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowAddTraining(true)}
            className="btn-primary shrink-0 text-sm"
          >
            + Добавить тренировку
          </button>
          <button
            type="button"
            onClick={() => setShowWorkSchedule(true)}
            className="btn-secondary shrink-0 text-sm"
          >
            График работы
          </button>
        </div>
      </div>

      <ScheduleToolbar
        date={date}
        view={view}
        onDateChange={setDate}
        onViewChange={setView}
        onPrev={() => setDate((d) => shiftDateByView(d, view, -1))}
        onNext={() => setDate((d) => shiftDateByView(d, view, 1))}
      />

      <ScheduleTypeFilterBar value={filter} onChange={setFilter} />

      <ScheduleLegend />

      {error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
        </div>
      ) : (
        <TrainerCalendar
          events={events}
          filter={filter}
          view={view}
          date={date}
          availabilityBlocks={availabilityBlocks}
          onNavigate={setDate}
          onViewChange={setView}
          onSelectEvent={setSelectedEvent}
        />
      )}

      {showWorkSchedule && (
        <WorkScheduleSheet
          periodStart={period.periodStart}
          periodEnd={period.periodEnd}
          availabilityBlocks={availabilityBlocks}
          onClose={() => setShowWorkSchedule(false)}
          onUpdated={reload}
        />
      )}

      {showAddTraining && (
        <AddTrainingDialog
          clients={clients}
          defaultDate={dateKey(date)}
          onClose={() => setShowAddTraining(false)}
          onAdded={reload}
        />
      )}

      {selectedEvent && (
        <EventActionDialog
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onCancelBooking={handleCancelBooking}
        />
      )}
    </div>
  );
}
