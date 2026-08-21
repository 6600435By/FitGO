'use client';

import type { TrainerAvailabilityBlock, TrainerCalendarEvent } from '@fitgo/shared-types';
import { useMemo } from 'react';
import {
  eventBlockClass,
  eventDotClass,
  eventKindLabel,
} from './event-kind-styles';
import {
  dateKey,
  formatMinutesLabel,
  generateTimeLabels,
  getDayWorkBounds,
  getDisplayBoundsForDay,
  getEventLayout,
  getOverlapRegions,
  GRID_SLOT_MINUTES,
  minutesFromIso,
  minutesToTime,
  SLOT_HEIGHT_PX,
  topPxFromMinutes,
} from './schedule-grid';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ScheduleDayGrid({
  date,
  events,
  availabilityBlocks,
  onSelectEvent,
}: {
  date: Date;
  events: TrainerCalendarEvent[];
  availabilityBlocks: TrainerAvailabilityBlock[];
  onSelectEvent?: (event: TrainerCalendarEvent) => void;
}) {
  const dateStr = dateKey(date);

  const dayEvents = useMemo(
    () =>
      events
        .filter((e) => minutesFromIso(dateStr, e.startAt) !== null)
        .sort((a, b) => a.startAt.localeCompare(b.startAt)),
    [events, dateStr],
  );

  const bounds = useMemo(
    () => getDisplayBoundsForDay(dateStr, dayEvents, availabilityBlocks),
    [dayEvents, dateStr, availabilityBlocks],
  );

  const hasWorkSchedule = getDayWorkBounds(dateStr, availabilityBlocks) !== null;

  const timeLabels = useMemo(
    () => generateTimeLabels(bounds.start, bounds.end),
    [bounds],
  );

  const gridHeight = timeLabels.length * SLOT_HEIGHT_PX;
  const overlapRegions = useMemo(
    () => getOverlapRegions(dateStr, dayEvents),
    [dateStr, dayEvents],
  );

  if (!hasWorkSchedule && dayEvents.length === 0) {
    return (
      <div className="rounded-xl border border-slate-700/80 bg-slate-900/40 px-4 py-12 text-center">
        <p className="text-slate-400">На этот день график не задан</p>
        <p className="mt-2 text-sm text-slate-500">
          Откройте «График работы», чтобы указать часы приёма
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-700/80 bg-slate-900/40 shadow-lg">
      <div className="flex min-w-[280px]">
        <div className="sticky left-0 z-20 w-14 shrink-0 border-r border-slate-700/80 bg-slate-900/95">
          <div className="h-[52px] border-b border-slate-700/80" />
          <div className="relative" style={{ height: gridHeight }}>
            {timeLabels.map((m) => (
              <div
                key={m}
                className="absolute right-1.5 text-[10px] text-slate-500"
                style={{
                  top: topPxFromMinutes(m, bounds.start),
                  height: SLOT_HEIGHT_PX,
                }}
              >
                {formatMinutesLabel(m)}
              </div>
            ))}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="h-[52px] border-b border-slate-700/80 px-3 py-2 text-center">
            <p className="truncate text-sm font-semibold text-slate-100">
              {date.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'short' })}
            </p>
            {hasWorkSchedule && (
              <p className="text-[10px] text-emerald-400">
                {minutesToTime(bounds.start)} – {minutesToTime(bounds.end)}
              </p>
            )}
          </div>

          <div
            className="relative"
            style={{ height: gridHeight }}
          >
            {timeLabels.map((m) => (
              <div
                key={m}
                className="absolute left-0 right-0 border-b border-slate-800/80 bg-slate-900/20"
                style={{
                  top: topPxFromMinutes(m, bounds.start),
                  height: SLOT_HEIGHT_PX,
                }}
              />
            ))}

            {overlapRegions.map((region, idx) => (
              <div
                key={`overlap-${idx}`}
                className="pointer-events-none absolute left-0 right-0 z-[8] bg-orange-500/35 ring-1 ring-inset ring-orange-500/50"
                style={{
                  top: topPxFromMinutes(region.start, bounds.start),
                  height:
                    ((region.end - region.start) / GRID_SLOT_MINUTES) * SLOT_HEIGHT_PX,
                }}
                title="Пересечение по времени"
              />
            ))}

            {dayEvents.map((event) => {
              const layout = getEventLayout(dateStr, bounds, event.startAt, event.endAt);
              if (!layout) return null;

              const endMin = minutesFromIso(dateStr, event.endAt);
              const showKind = layout.height >= 44;

              return (
                <button
                  key={event.id}
                  type="button"
                  data-event-block
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectEvent?.(event);
                  }}
                  className={`absolute left-1 right-1 z-10 overflow-hidden rounded px-1.5 py-1 text-left text-[10px] leading-tight shadow-sm transition hover:ring-1 hover:ring-slate-500 ${eventBlockClass(event.kind)}`}
                  style={{ top: layout.top, height: layout.height }}
                  title={event.title}
                >
                  <div className="flex items-center gap-1">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${eventDotClass(event.kind)}`}
                    />
                    <span className="font-semibold">
                      {formatTime(event.startAt)}
                      {endMin !== null ? ` – ${minutesToTime(endMin)}` : ''}
                    </span>
                  </div>
                  <span className="block truncate font-medium">{event.title}</span>
                  {showKind && (
                    <span className="block truncate opacity-75">
                      {eventKindLabel(event.kind)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
