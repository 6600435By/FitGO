'use client';

import type { TrainerCalendarEvent } from '@fitgo/shared-types';
import {
  Button,
  DateStrip,
  PageHeader,
  SegmentedControl,
  SeatsMeter,
  SkeletonCard,
} from '@fitgo/forma-ui';
import { addDays, format } from 'date-fns';
import { useEffect, useMemo, useState } from 'react';
import { useFeatures } from '@/components/features-provider';
import { api } from '@/lib/api';
import { getToken, getUser } from '@/lib/auth';
import { AddTrainingDialog } from './add-training-dialog';
import { AssignClientDialog } from './assign-client-dialog';
import { BookingActionSheet } from './booking-action-sheet';
import { defaultCalendarDate } from './calendar-period';
import { type ScheduleTypeFilter } from './calendar-utils';
import { PublishScheduleBar } from './publish-schedule-bar';
import { ReserveSheet } from './reserve-sheet';
import { SeriesSheet } from './series-sheet';
import { dateKey } from './schedule-grid';
import type { ScheduleView } from './schedule-grid';
import { ScheduleLegend } from './schedule-legend';
import { ScheduleToolbar, shiftDateByView } from './schedule-toolbar';
import { ScheduleTypeFilterBar } from './schedule-type-filter';
import { TrainerCalendar } from './trainer-calendar';
import { useTrainerCalendar } from './use-trainer-calendar';
import { WorkScheduleSheet } from './work-schedule-sheet';

function LegacyEventDialog({
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
        {event.kind === 'PERSONAL' && event.bookingId ? (
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
        ) : null}
        <button type="button" onClick={onClose} className="btn-secondary w-full">
          Закрыть
        </button>
      </div>
    </div>
  );
}

export function TrainerSchedulePage() {
  const { isEnabled } = useFeatures();
  const forma = isEnabled('trainer_ui_v2');
  const me = getUser();
  const freeSchedule = Boolean(me?.trainerClub && !me?.trainerStaff);
  const [date, setDate] = useState(defaultCalendarDate);
  const [view, setView] = useState<ScheduleView>(() =>
    typeof window !== 'undefined' && window.innerWidth < 640 ? 'day' : 'week',
  );
  const [filter, setFilter] = useState<ScheduleTypeFilter>('all');
  const [showWorkSchedule, setShowWorkSchedule] = useState(false);
  const [showAddTraining, setShowAddTraining] = useState(false);
  const [assignAt, setAssignAt] = useState<string | null>(null);
  const [reserveAt, setReserveAt] = useState<string | null>(null);
  const [showSeries, setShowSeries] = useState(false);
  const [clients, setClients] = useState<
    Array<{ id: string; firstName: string; lastName: string; phone?: string }>
  >([]);
  const [selectedEvent, setSelectedEvent] = useState<TrainerCalendarEvent | null>(
    null,
  );

  const {
    events,
    availabilityBlocks,
    draftBlockCount,
    publishSummary,
    loading,
    error,
    period,
    reload,
  } = useTrainerCalendar(date, view);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api
      .trainerClients(token)
      .then((list) =>
        setClients(
          list.map((c) => ({
            id: c.id,
            firstName: c.firstName,
            lastName: c.lastName,
            phone: c.phone,
          })),
        ),
      )
      .catch(() =>
        api
          .trainerMessageRecipients(token)
          .then(setClients)
          .catch(() =>
            api.trainerDashboard(token).then((d) => setClients(d.clients)),
          ),
      );
  }, []);

  const dateStripDays = useMemo(() => {
    const start = addDays(date, -3);
    return Array.from({ length: 14 }, (_, i) => {
      const d = addDays(start, i);
      const key = format(d, 'yyyy-MM-dd');
      const count = events.filter(
        (e) => format(new Date(e.startAt), 'yyyy-MM-dd') === key,
      ).length;
      return { key, count: count || undefined, highlight: count > 0 };
    });
  }, [date, events]);

  const handleCancelBooking = async (bookingId: string) => {
    const token = getToken();
    if (!token) return;
    await api.trainerUpdatePersonalBooking(token, bookingId, {
      action: 'cancel',
    });
    reload();
  };

  const handleMoveBooking = async (
    event: TrainerCalendarEvent,
    newStartAt: string,
  ) => {
    const token = getToken();
    if (!token || !event.bookingId) return;
    try {
      await api.trainerUpdatePersonalBooking(token, event.bookingId, {
        startAt: newStartAt,
        seriesScope: 'one',
      });
      await reload();
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : 'Не удалось перенести запись',
      );
    }
  };

  const handleSelectEvent = (event: TrainerCalendarEvent) => {
    if (
      (event.kind === 'OPEN_SLOT' || event.kind === 'DRAFT_SLOT') &&
      forma
    ) {
      setAssignAt(event.startAt);
      return;
    }
    if (
      (event.kind === 'HOLD_SLOT' || event.kind === 'PERSONAL_BLOCK') &&
      event.blockId &&
      forma
    ) {
      const token = getToken();
      if (!token) return;
      void api.trainerDeleteScheduleHold(token, event.blockId).then(reload);
      return;
    }
    setSelectedEvent(event);
  };

  return (
    <div className={forma ? 'space-y-4 pb-28 lg:pb-8' : 'space-y-4 pb-8'}>
      {forma ? (
        <div className="space-y-3">
          <PageHeader title="Расписание" />
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Button size="sm" className="w-full sm:w-auto" onClick={() => setShowAddTraining(true)}>
              Записать
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="w-full sm:w-auto"
              onClick={() => setReserveAt(new Date(date).toISOString())}
            >
              Резерв
            </Button>
            <Button
              size="sm"
              variant="secondary"
              className="w-full sm:w-auto"
              onClick={() => setShowSeries(true)}
            >
              Серия
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="w-full sm:w-auto"
              onClick={() => setShowWorkSchedule(true)}
            >
              График
            </Button>
          </div>
        </div>
      ) : (
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
              Время вне дежурства
            </button>
          </div>
        </div>
      )}

      {forma ? (
        <>
          <DateStrip
            days={dateStripDays}
            value={format(date, 'yyyy-MM-dd')}
            onChange={(key) => setDate(new Date(`${key}T12:00:00`))}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl<ScheduleTypeFilter>
              layoutId="sched-filter"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'Все' },
                { value: 'personal', label: 'ПТ' },
                { value: 'group', label: 'ГП' },
              ]}
            />
            <SegmentedControl<ScheduleView>
              layoutId="sched-view"
              value={view}
              onChange={setView}
              options={[
                { value: 'day', label: 'День' },
                { value: 'week', label: 'Неделя' },
                { value: 'month', label: 'Месяц' },
              ]}
            />
          </div>
        </>
      ) : (
        <>
          <ScheduleToolbar
            date={date}
            view={view}
            onDateChange={setDate}
            onViewChange={setView}
            onPrev={() => setDate((d) => shiftDateByView(d, view, -1))}
            onNext={() => setDate((d) => shiftDateByView(d, view, 1))}
          />
          <ScheduleTypeFilterBar value={filter} onChange={setFilter} />
        </>
      )}

      <ScheduleLegend />

      {error ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </p>
      ) : null}

      {loading ? (
        forma ? (
          <SkeletonCard lines={6} />
        ) : (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
          </div>
        )
      ) : (
        <>
          {forma && filter !== 'personal'
            ? events
                .filter((e) => e.kind === 'GROUP' && e.capacity != null)
                .slice(0, 3)
                .map((e) => (
                  <div
                    key={`seats-${e.id}`}
                    className="flex items-center justify-between rounded-2xl border border-white/10 bg-ink-elevated px-3 py-2"
                  >
                    <span className="truncate text-sm text-zinc-200">
                      {e.title}
                    </span>
                    <SeatsMeter booked={e.booked ?? 0} capacity={e.capacity ?? 0} />
                  </div>
                ))
            : null}
          <TrainerCalendar
            events={events}
            filter={filter}
            view={view}
            date={date}
            availabilityBlocks={availabilityBlocks}
            onNavigate={setDate}
            onViewChange={setView}
            onSelectEvent={handleSelectEvent}
            onMoveBooking={forma ? handleMoveBooking : undefined}
          />
        </>
      )}

      <PublishScheduleBar
        draftBlockCount={draftBlockCount}
        periodStart={period.periodStart}
        periodEnd={period.periodEnd}
        summary={publishSummary}
        onPublished={reload}
      />

      {showWorkSchedule ? (
        <WorkScheduleSheet
          periodStart={period.periodStart}
          periodEnd={period.periodEnd}
          availabilityBlocks={availabilityBlocks}
          dutyEvents={events.filter((event) => event.kind === 'DUTY')}
          freeSchedule={freeSchedule}
          onClose={() => setShowWorkSchedule(false)}
          onUpdated={reload}
        />
      ) : null}

      {showAddTraining ? (
        <AddTrainingDialog
          clients={clients}
          defaultDate={dateKey(date)}
          onClose={() => setShowAddTraining(false)}
          onAdded={reload}
        />
      ) : null}

      {assignAt ? (
        <AssignClientDialog
          startAt={assignAt}
          clients={clients}
          onClose={() => setAssignAt(null)}
          onAssigned={reload}
        />
      ) : null}

      {reserveAt ? (
        <ReserveSheet
          startAt={reserveAt}
          clients={clients}
          onClose={() => setReserveAt(null)}
          onSaved={reload}
        />
      ) : null}

      {showSeries ? (
        <SeriesSheet
          clients={clients}
          defaultDate={dateKey(date)}
          onClose={() => setShowSeries(false)}
          onSaved={reload}
        />
      ) : null}

      {selectedEvent && forma && selectedEvent.kind === 'PERSONAL' ? (
        <BookingActionSheet
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onChanged={reload}
        />
      ) : null}

      {selectedEvent && !(forma && selectedEvent.kind === 'PERSONAL') ? (
        <LegacyEventDialog
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onCancelBooking={handleCancelBooking}
        />
      ) : null}
    </div>
  );
}
