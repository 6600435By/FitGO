'use client';

import type { TrainerCalendarEvent } from '@fitgo/shared-types';
import { useEffect, useState } from 'react';
import type { View } from 'react-big-calendar';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { defaultCalendarDate } from './calendar-period';
import { type ScheduleTypeFilter } from './calendar-utils';
import { AssignClientDialog } from './assign-client-dialog';
import { PublishScheduleBar } from './publish-schedule-bar';
import { ScheduleMasterSheet } from './schedule-master-sheet';
import { ScheduleTypeFilterBar } from './schedule-type-filter';
import { TrainerCalendar } from './trainer-calendar';
import { useTrainerCalendar } from './use-trainer-calendar';

function SlotActionDialog({
  start,
  end,
  groupEvents,
  onClose,
  onAddOpenSlot,
  onAssignClient,
}: {
  start: Date;
  end: Date;
  groupEvents: TrainerCalendarEvent[];
  onClose: () => void;
  onAddOpenSlot: (start: Date, end: Date) => void;
  onAssignClient: (startAt: string) => void;
}) {
  const conflicts = groupEvents.filter(
    (e) => new Date(e.startAt) < end && new Date(e.endAt) > start,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
      <div className="card w-full max-w-sm space-y-3">
        <h3 className="font-semibold">Действие со слотом</h3>
        <p className="text-sm text-slate-400">
          {start.toLocaleString('ru-RU', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
          {' — '}
          {end.toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
        {conflicts.length > 0 && (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
            Пересечение с групповым: {conflicts[0].title}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            onAddOpenSlot(start, end);
            onClose();
          }}
          className="btn-primary w-full"
        >
          Открыть для записи
        </button>
        <button
          type="button"
          onClick={() => {
            onAssignClient(start.toISOString());
            onClose();
          }}
          className="btn-secondary w-full"
        >
          Назначить клиента
        </button>
        <button type="button" onClick={onClose} className="btn-secondary w-full">
          Отмена
        </button>
      </div>
    </div>
  );
}

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
        {(event.kind === 'DRAFT_SLOT' || event.kind === 'OPEN_SLOT') && (
          <p className="text-sm text-slate-400">
            Управление слотом — в списке черновиков мастера расписания.
          </p>
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
  const [view, setView] = useState<View>(() =>
    typeof window !== 'undefined' && window.innerWidth < 640 ? 'day' : 'week',
  );
  const [filter, setFilter] = useState<ScheduleTypeFilter>('all');
  const [masterMode, setMasterMode] = useState(false);
  const [showMasterSheet, setShowMasterSheet] = useState(false);
  const [clients, setClients] = useState<
    Array<{ id: string; firstName: string; lastName: string }>
  >([]);
  const [assignStartAt, setAssignStartAt] = useState<string | null>(null);
  const [slotAction, setSlotAction] = useState<{ start: Date; end: Date } | null>(
    null,
  );
  const [selectedEvent, setSelectedEvent] = useState<TrainerCalendarEvent | null>(
    null,
  );

  const { events, availabilityBlocks, draftBlockCount, loading, error, period, reload } =
    useTrainerCalendar(date, view);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    api
      .trainerMessageRecipients(token)
      .then(setClients)
      .catch(() => api.trainerDashboard(token).then((d) => setClients(d.clients)));
  }, []);

  const handleAddOpenSlot = async (start: Date, end: Date) => {
    const token = getToken();
    if (!token) return;

    const draftBlocks = availabilityBlocks
      .filter((b) => b.status === 'DRAFT')
      .map((b) => ({ startAt: b.startAt, endAt: b.endAt }));

    await api.trainerSetAvailabilityBlocks(token, {
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      blocks: [
        ...draftBlocks,
        { startAt: start.toISOString(), endAt: end.toISOString() },
      ],
    });
    reload();
  };

  const handleCancelBooking = async (bookingId: string) => {
    const token = getToken();
    if (!token) return;
    await api.trainerUpdatePersonalBooking(token, bookingId, {
      action: 'cancel',
    });
    reload();
  };

  const groupEvents = events.filter((e) => e.kind === 'GROUP');

  return (
    <div className="space-y-4 pb-24">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold">Расписание</h2>
          <p className="mt-1 text-sm text-slate-400">
            Групповые занятия из 1С и персональные тренировки FitGO
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMasterMode((v) => !v)}
            className={`shrink-0 rounded-xl px-4 py-3 font-medium transition ${
              masterMode
                ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40'
                : 'btn-primary'
            }`}
          >
            {masterMode ? 'Выйти из мастера' : 'Мастер расписания'}
          </button>
          {masterMode && (
            <button
              type="button"
              onClick={() => setShowMasterSheet(true)}
              className="btn-secondary shrink-0"
            >
              Управление слотами
            </button>
          )}
        </div>
      </div>

      <ScheduleTypeFilterBar value={filter} onChange={setFilter} />

      <div className="flex flex-wrap gap-3 text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-blue-500/50" /> Групповые
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded bg-emerald-500/50" /> Персональные
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded border border-dashed border-emerald-400/60 bg-emerald-500/10" />{' '}
          Открыто для записи
        </span>
        {masterMode && (
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded border border-dashed border-amber-400/50 bg-amber-500/10" />{' '}
            Черновик
          </span>
        )}
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-fitgo-500 border-t-transparent" />
        </div>
      ) : (
        <TrainerCalendar
          events={events}
          filter={filter}
          view={view}
          date={date}
          masterMode={masterMode}
          onNavigate={setDate}
          onViewChange={setView}
          onSelectEvent={(event) => {
            if (masterMode) setSelectedEvent(event);
          }}
          onSelectSlot={(start, end) => setSlotAction({ start, end })}
        />
      )}

      {masterMode && (
        <PublishScheduleBar
          draftBlockCount={draftBlockCount}
          periodStart={period.periodStart}
          periodEnd={period.periodEnd}
          onPublished={reload}
        />
      )}

      {showMasterSheet && (
        <ScheduleMasterSheet
          periodStart={period.periodStart}
          periodEnd={period.periodEnd}
          availabilityBlocks={availabilityBlocks}
          groupEvents={groupEvents}
          onClose={() => setShowMasterSheet(false)}
          onUpdated={reload}
          onAssignClient={setAssignStartAt}
        />
      )}

      {slotAction && (
        <SlotActionDialog
          start={slotAction.start}
          end={slotAction.end}
          groupEvents={groupEvents}
          onClose={() => setSlotAction(null)}
          onAddOpenSlot={handleAddOpenSlot}
          onAssignClient={setAssignStartAt}
        />
      )}

      {selectedEvent && (
        <EventActionDialog
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onCancelBooking={handleCancelBooking}
        />
      )}

      {assignStartAt && (
        <AssignClientDialog
          startAt={assignStartAt}
          clients={clients}
          onClose={() => setAssignStartAt(null)}
          onAssigned={reload}
        />
      )}
    </div>
  );
}
