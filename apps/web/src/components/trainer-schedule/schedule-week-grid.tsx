'use client';

import type { TrainerAvailabilityBlock, TrainerCalendarEvent } from '@fitgo/shared-types';
import { useMemo, useRef, type DragEvent } from 'react';
import {
  eventBlockClass,
  eventDotClass,
} from './event-kind-styles';
import {
  dateKey,
  formatMinutesLabel,
  generateTimeLabels,
  getDayWorkBounds,
  getEventLayout,
  getOverlapRegions,
  getWeekGridBounds,
  GRID_SLOT_MINUTES,
  isoAtMinutes,
  minutesFromIso,
  minutesToTime,
  SLOT_HEIGHT_PX,
  topPxFromMinutes,
  weekDayKeys,
} from './schedule-grid';

const DRAG_MIME = 'application/x-fitgo-pt-booking';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function canDragEvent(event: TrainerCalendarEvent): boolean {
  return event.kind === 'PERSONAL' && Boolean(event.bookingId);
}

export function ScheduleWeekGrid({
  date,
  events,
  availabilityBlocks,
  onSelectEvent,
  onMoveBooking,
}: {
  date: Date;
  events: TrainerCalendarEvent[];
  availabilityBlocks: TrainerAvailabilityBlock[];
  onSelectEvent?: (event: TrainerCalendarEvent) => void;
  onMoveBooking?: (event: TrainerCalendarEvent, newStartAt: string) => void;
}) {
  const dayKeys = useMemo(() => weekDayKeys(date), [date]);
  const draggedRef = useRef(false);
  const eventsById = useMemo(() => {
    const map = new Map<string, TrainerCalendarEvent>();
    for (const e of events) map.set(e.id, e);
    return map;
  }, [events]);

  const bounds = useMemo(
    () => getWeekGridBounds(events, dayKeys, availabilityBlocks),
    [events, dayKeys, availabilityBlocks],
  );

  const timeLabels = useMemo(
    () => generateTimeLabels(bounds.start, bounds.end),
    [bounds],
  );

  const gridHeight = timeLabels.length * SLOT_HEIGHT_PX;
  const todayKey = dateKey(new Date());

  const dropOnDay = (dayStr: string, e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const raw =
      e.dataTransfer.getData(DRAG_MIME) ||
      e.dataTransfer.getData('text/plain');
    if (!raw || !onMoveBooking) return;
    let payload: { id: string };
    try {
      payload = JSON.parse(raw) as { id: string };
    } catch {
      return;
    }
    const event = eventsById.get(payload.id);
    if (!event || !canDragEvent(event)) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const rawMin =
      bounds.start +
      Math.round(y / SLOT_HEIGHT_PX) * GRID_SLOT_MINUTES;
    const snapped = Math.max(
      bounds.start,
      Math.min(bounds.end - GRID_SLOT_MINUTES, rawMin),
    );
    const nextStart = isoAtMinutes(dayStr, snapped);
    if (nextStart === event.startAt) return;
    onMoveBooking(event, nextStart);
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-700/80 bg-slate-900/40 shadow-lg [-webkit-overflow-scrolling:touch]">
      {onMoveBooking ? (
        <p className="hidden border-b border-slate-800 px-3 py-1.5 text-[11px] text-slate-500 desktop:block">
          Перетащите ПТ на другой день или время (шаг 15 мин)
        </p>
      ) : null}
      <div className="flex min-w-max">
        <div className="admin-time-rail sticky left-0 z-20 w-14 shrink-0 border-r border-slate-700/80 bg-slate-900/95">
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

        {dayKeys.map((dayStr) => {
          const dayDate = new Date(`${dayStr}T12:00:00`);
          const dayEvents = events
            .filter((e) => minutesFromIso(dayStr, e.startAt) !== null)
            .sort((a, b) => a.startAt.localeCompare(b.startAt));
          const overlaps = getOverlapRegions(dayStr, dayEvents);
          const isToday = dayStr === todayKey;
          const isWeekend = dayDate.getDay() === 0 || dayDate.getDay() === 6;
          const hasDuty = dayEvents.some((e) => e.kind === 'DUTY');
          const hasWork =
            hasDuty || getDayWorkBounds(dayStr, availabilityBlocks) !== null;

          return (
            <div
              key={dayStr}
              className={`w-24 shrink-0 border-r border-slate-700/80 last:border-r-0 sm:w-28 md:w-32 ${
                isToday ? 'bg-fitgo-500/5' : isWeekend ? 'bg-slate-950/50' : ''
              } ${!hasWork ? 'opacity-60' : ''}`}
            >
              <div
                className={`h-[52px] border-b border-slate-700/80 px-1 py-1.5 text-center ${
                  isToday ? 'bg-fitgo-500/10' : ''
                }`}
              >
                <p className="text-[10px] uppercase text-slate-500">
                  {dayDate.toLocaleDateString('ru-RU', { weekday: 'short' })}
                </p>
                <p
                  className={`text-sm font-semibold ${
                    isToday ? 'text-fitgo-300' : 'text-slate-100'
                  }`}
                >
                  {dayDate.getDate()}
                </p>
                {!hasWork && (
                  <p className="text-[9px] text-slate-500">выходной</p>
                )}
              </div>

              <div
                className="relative"
                style={{ height: gridHeight }}
                onDragOver={(e) => {
                  if (!onMoveBooking) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(e) => dropOnDay(dayStr, e)}
              >
                {timeLabels.map((m) => (
                  <div
                    key={m}
                    className="absolute left-0 right-0 border-b border-slate-800/60 bg-slate-900/15"
                    style={{
                      top: topPxFromMinutes(m, bounds.start),
                      height: SLOT_HEIGHT_PX,
                    }}
                  />
                ))}

                {overlaps.map((region, idx) => (
                  <div
                    key={`${dayStr}-ov-${idx}`}
                    className="pointer-events-none absolute left-0 right-0 z-[8] bg-orange-500/30 ring-1 ring-inset ring-orange-500/40"
                    style={{
                      top: topPxFromMinutes(region.start, bounds.start),
                      height:
                        ((region.end - region.start) / GRID_SLOT_MINUTES) *
                        SLOT_HEIGHT_PX,
                    }}
                  />
                ))}

                {dayEvents.map((event) => {
                  const layout = getEventLayout(
                    dayStr,
                    bounds,
                    event.startAt,
                    event.endAt,
                  );
                  if (!layout) return null;
                  const endMin = minutesFromIso(dayStr, event.endAt);
                  const draggable = Boolean(onMoveBooking) && canDragEvent(event);

                  return (
                    <button
                      key={event.id}
                      type="button"
                      data-event-block
                      draggable={draggable}
                      onDragStart={(e) => {
                        if (!draggable) return;
                        draggedRef.current = false;
                        const payload = JSON.stringify({ id: event.id });
                        e.dataTransfer.setData(DRAG_MIME, payload);
                        e.dataTransfer.setData('text/plain', payload);
                        e.dataTransfer.effectAllowed = 'move';
                        window.setTimeout(() => {
                          draggedRef.current = true;
                        }, 0);
                      }}
                      onDragEnd={() => {
                        window.setTimeout(() => {
                          draggedRef.current = false;
                        }, 50);
                      }}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        if (draggedRef.current) return;
                        onSelectEvent?.(event);
                      }}
                      className={`absolute left-0.5 right-0.5 z-10 overflow-hidden rounded px-0.5 py-0.5 text-left text-[9px] leading-tight shadow-sm hover:ring-1 hover:ring-slate-500 sm:text-[10px] ${eventBlockClass(event.kind)} ${
                        draggable ? 'desktop:cursor-grab desktop:active:cursor-grabbing' : ''
                      }`}
                      style={{ top: layout.top, height: layout.height }}
                      title={
                        draggable
                          ? `${event.title} · перетащите на ПК`
                          : event.title
                      }
                    >
                      <div className="flex items-center gap-0.5">
                        <span
                          className={`h-1 w-1 shrink-0 rounded-full ${eventDotClass(event.kind)}`}
                        />
                        <span className="truncate font-semibold">
                          {formatTime(event.startAt)}
                        </span>
                      </div>
                      {layout.height >= 36 && (
                        <span className="block truncate">{event.title}</span>
                      )}
                      {layout.height >= 48 &&
                      event.clientIssue &&
                      event.clientIssue !== 'NONE' ? (
                        <span className="block truncate text-amber-300/90">
                          Нет в 1С
                        </span>
                      ) : null}
                      {layout.height >= 52 && endMin !== null && (
                        <span className="block truncate opacity-70">
                          до {minutesToTime(endMin)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
