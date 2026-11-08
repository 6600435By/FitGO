'use client';

import type {
  TrainerAvailabilityBlock,
  TrainerCalendarEvent,
} from '@fitgo/shared-types';
import { useEffect, useMemo, useRef, useState } from 'react';
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

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function canDragEvent(event: TrainerCalendarEvent): boolean {
  return event.kind === 'PERSONAL' && Boolean(event.bookingId);
}

function durationMin(event: TrainerCalendarEvent): number {
  const ms = new Date(event.endAt).getTime() - new Date(event.startAt).getTime();
  return Math.max(GRID_SLOT_MINUTES, Math.round(ms / 60000));
}

type DragPreview = {
  eventId: string;
  dayKey: string;
  startMin: number;
  durationMin: number;
  valid: boolean;
  label: string;
};

const LONG_PRESS_MS = 280;

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
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const previewRef = useRef<DragPreview | null>(null);
  const dragEventRef = useRef<TrainerCalendarEvent | null>(null);
  const pendingRef = useRef<{
    event: TrainerCalendarEvent;
    pointerId: number;
    x: number;
    y: number;
    timer: number | null;
  } | null>(null);
  const movedRef = useRef(false);
  const colEls = useRef<Map<string, HTMLDivElement>>(new Map());

  previewRef.current = preview;

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

  const evaluateDrop = (
    event: TrainerCalendarEvent,
    dayStr: string,
    startMin: number,
  ): { valid: boolean; label: string } => {
    const dur = durationMin(event);
    const endMin = startMin + dur;
    const conflict = events.some((other) => {
      if (other.id === event.id) return false;
      if (other.kind !== 'PERSONAL' && other.kind !== 'GROUP') return false;
      const otherStart = minutesFromIso(dayStr, other.startAt);
      const otherEnd = minutesFromIso(dayStr, other.endAt);
      if (otherStart == null || otherEnd == null) return false;
      return startMin < otherEnd && endMin > otherStart;
    });
    const dayLabel = new Date(`${dayStr}T12:00:00`).toLocaleDateString('ru-RU', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    return {
      valid: !conflict,
      label: `${dayLabel} · ${minutesToTime(startMin)}${conflict ? ' · занято' : ''}`,
    };
  };

  const resolveFromPoint = (clientX: number, clientY: number) => {
    for (const dayStr of dayKeys) {
      const el = colEls.current.get(dayStr);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right) continue;
      if (clientY < rect.top || clientY > rect.bottom) continue;
      const y = clientY - rect.top;
      const rawMin =
        bounds.start + Math.round(y / SLOT_HEIGHT_PX) * GRID_SLOT_MINUTES;
      const snapped = Math.max(
        bounds.start,
        Math.min(bounds.end - GRID_SLOT_MINUTES, rawMin),
      );
      return { dayStr, startMin: snapped };
    }
    return null;
  };

  const clearPending = () => {
    const p = pendingRef.current;
    if (p?.timer != null) window.clearTimeout(p.timer);
    pendingRef.current = null;
  };

  const beginDrag = (event: TrainerCalendarEvent) => {
    if (!onMoveBooking || !canDragEvent(event)) return;
    dragEventRef.current = event;
    movedRef.current = true;
    const startMin = minutesFromIso(dateKey(new Date(event.startAt)), event.startAt);
    const day = dateKey(new Date(event.startAt));
    const dur = durationMin(event);
    const evaled = evaluateDrop(event, day, startMin ?? bounds.start);
    const next: DragPreview = {
      eventId: event.id,
      dayKey: day,
      startMin: startMin ?? bounds.start,
      durationMin: dur,
      valid: evaled.valid,
      label: evaled.label,
    };
    setPreview(next);
  };

  useEffect(() => {
    if (!onMoveBooking) return;

    const onMove = (e: PointerEvent) => {
      const pending = pendingRef.current;
      if (pending && !dragEventRef.current) {
        const dx = e.clientX - pending.x;
        const dy = e.clientY - pending.y;
        if (Math.hypot(dx, dy) > 12) {
          clearPending();
        }
        return;
      }
      const event = dragEventRef.current;
      if (!event) return;
      e.preventDefault();
      const hit = resolveFromPoint(e.clientX, e.clientY);
      if (!hit) return;
      const evaled = evaluateDrop(event, hit.dayStr, hit.startMin);
      setPreview({
        eventId: event.id,
        dayKey: hit.dayStr,
        startMin: hit.startMin,
        durationMin: durationMin(event),
        valid: evaled.valid,
        label: evaled.label,
      });
    };

    const onUp = (e: PointerEvent) => {
      clearPending();
      const event = dragEventRef.current;
      const current = previewRef.current;
      dragEventRef.current = null;
      if (!event || !current) {
        setPreview(null);
        window.setTimeout(() => {
          movedRef.current = false;
        }, 40);
        return;
      }
      e.preventDefault();
      setPreview(null);
      if (current.valid) {
        const nextStart = isoAtMinutes(current.dayKey, current.startMin);
        if (nextStart !== event.startAt) {
          onMoveBooking(event, nextStart);
        }
      }
      window.setTimeout(() => {
        movedRef.current = false;
      }, 40);
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [onMoveBooking, dayKeys, bounds, events]);

  useEffect(() => {
    if (!preview) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
    return () => {
      document.body.style.userSelect = prev;
      document.body.style.cursor = '';
    };
  }, [preview]);

  return (
    <div className="relative overflow-x-auto rounded-xl border border-slate-700/80 bg-slate-900/40 shadow-lg [-webkit-overflow-scrolling:touch]">
      {onMoveBooking ? (
        <p className="border-b border-slate-800 px-3 py-1.5 text-[11px] text-slate-500">
          Удерживайте запись и перетащите на день или время (шаг 15 мин)
        </p>
      ) : null}
      {preview ? (
        <div className="pointer-events-none sticky top-0 z-30 flex justify-center px-2 py-1">
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold shadow-lg ${
              preview.valid
                ? 'bg-emerald-500 text-ink'
                : 'bg-red-500 text-white'
            }`}
          >
            {preview.label}
          </span>
        </div>
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
          const isDropDay = preview?.dayKey === dayStr;
          const dropOk = Boolean(isDropDay && preview?.valid);
          const dropBad = Boolean(isDropDay && preview && !preview.valid);

          return (
            <div
              key={dayStr}
              className={`w-24 shrink-0 border-r border-slate-700/80 last:border-r-0 sm:w-28 md:w-32 ${
                isToday ? 'bg-fitgo-500/5' : isWeekend ? 'bg-slate-950/50' : ''
              } ${!hasWork ? 'opacity-60' : ''} ${
                dropOk ? 'bg-emerald-500/10' : dropBad ? 'bg-red-500/10' : ''
              }`}
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
                ref={(el) => {
                  if (el) colEls.current.set(dayStr, el);
                  else colEls.current.delete(dayStr);
                }}
                className="relative touch-none"
                style={{ height: gridHeight }}
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

                {isDropDay && preview ? (
                  <div
                    className={`pointer-events-none absolute left-0.5 right-0.5 z-[15] rounded border border-dashed ${
                      preview.valid
                        ? 'border-emerald-400 bg-emerald-500/25'
                        : 'border-red-400 bg-red-500/25'
                    }`}
                    style={{
                      top: topPxFromMinutes(preview.startMin, bounds.start),
                      height:
                        (preview.durationMin / GRID_SLOT_MINUTES) *
                        SLOT_HEIGHT_PX,
                    }}
                  />
                ) : null}

                {dayEvents.map((event) => {
                  const layout = getEventLayout(
                    dayStr,
                    bounds,
                    event.startAt,
                    event.endAt,
                  );
                  if (!layout) return null;
                  const endMin = minutesFromIso(dayStr, event.endAt);
                  const draggable =
                    Boolean(onMoveBooking) && canDragEvent(event);
                  const dragging = preview?.eventId === event.id;

                  return (
                    <button
                      key={event.id}
                      type="button"
                      data-event-block
                      onPointerDown={(ev) => {
                        if (!draggable) return;
                        if (ev.button !== 0) return;
                        ev.currentTarget.setPointerCapture(ev.pointerId);
                        clearPending();
                        const isTouch = ev.pointerType === 'touch';
                        pendingRef.current = {
                          event,
                          pointerId: ev.pointerId,
                          x: ev.clientX,
                          y: ev.clientY,
                          timer: isTouch
                            ? window.setTimeout(() => {
                                beginDrag(event);
                              }, LONG_PRESS_MS)
                            : null,
                        };
                        if (!isTouch) {
                          beginDrag(event);
                        }
                      }}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        if (movedRef.current) return;
                        onSelectEvent?.(event);
                      }}
                      className={`absolute left-0.5 right-0.5 z-10 overflow-hidden rounded px-0.5 py-0.5 text-left text-[9px] leading-tight shadow-sm hover:ring-1 hover:ring-slate-500 sm:text-[10px] ${eventBlockClass(event.kind)} ${
                        draggable ? 'cursor-grab active:cursor-grabbing' : ''
                      } ${dragging ? 'opacity-40' : ''}`}
                      style={{ top: layout.top, height: layout.height }}
                      title={
                        draggable
                          ? `${event.title} · удерживайте и перетащите`
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
