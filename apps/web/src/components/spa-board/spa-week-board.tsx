'use client';

import type {
  SpaBoardBooking,
  SpaBoardHourBlock,
  SpaBoardResponse,
  SpaBoardStaff,
} from '@fitgo/shared-types';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  addDays,
  defaultSpaWeekScale,
  nudgeSpaWeekScale,
  startOfDay,
  startOfWeekMonday,
  weekDays,
  writeStoredSpaWeekScale,
  type SpaWeekScale,
} from './spa-board-period';

const DAY_START_HOUR = 8;
const DAY_END_HOUR = 22;
const BASE_PX_PER_MIN = 0.95;
const BASE_COL_MIN_REM = 9.5;
const GRID_STEP_MIN = 15;
const MOUSE_DRAG_THRESHOLD_PX = 6;
const TOUCH_SCROLL_SLOP_PX = 16;
const TOUCH_DRAG_DELAY_MS = 400;
const NOW_MARKER_TICK_MS = 30_000;
const EDGE_SCROLL_PX = 48;
const EDGE_SCROLL_STEP = 18;

const STAFF_COLORS = [
  'bg-amber-500/80 border-amber-400/50',
  'bg-violet-500/80 border-violet-400/50',
  'bg-emerald-500/80 border-emerald-400/50',
  'bg-sky-500/80 border-sky-400/50',
  'bg-rose-500/80 border-rose-400/50',
  'bg-orange-500/80 border-orange-400/50',
  'bg-teal-500/80 border-teal-400/50',
  'bg-fuchsia-500/80 border-fuchsia-400/50',
];

function sameCalendarDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDayHeader(d: Date) {
  return d.toLocaleDateString('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function formatDayChip(d: Date) {
  return d.toLocaleDateString('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function formatWeekRange(days: Date[]) {
  const a = days[0];
  const b = days[6];
  if (!a || !b) return '';
  const left = a.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
  });
  const right = b.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  return `${left} – ${right}`;
}

function minutesFromDayStart(iso: string, day: Date) {
  const t = new Date(iso).getTime();
  const base = day.getTime() + DAY_START_HOUR * 60 * 60 * 1000;
  return (t - base) / 60000;
}

function overlapsDay(startIso: string, endIso: string, day: Date) {
  const dayStart = day.getTime();
  const dayEnd = addDays(day, 1).getTime();
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  return s < dayEnd && e > dayStart;
}

function staffFull(s: SpaBoardStaff) {
  return `${s.lastName} ${s.firstName}`.trim();
}

function staffShort(s: SpaBoardStaff) {
  const initial = s.firstName?.charAt(0);
  return initial
    ? `${s.lastName} ${initial}.`
    : s.lastName || s.firstName || '';
}

function staffColorClass(staffId: string, staff: SpaBoardStaff[]) {
  const idx = staff.findIndex((s) => s.id === staffId);
  return STAFF_COLORS[(idx >= 0 ? idx : 0) % STAFF_COLORS.length]!;
}

function hourBandsForDay(
  hours: SpaBoardHourBlock[],
  day: Date,
  specialistId?: string,
) {
  return hours.filter(
    (h) =>
      (!specialistId || h.specialistId === specialistId) &&
      overlapsDay(h.startAt, h.endAt, day),
  );
}

function bookingsForDay(
  bookings: SpaBoardBooking[],
  day: Date,
  specialistId?: string,
) {
  return bookings.filter(
    (b) =>
      (!specialistId || b.specialistId === specialistId) &&
      overlapsDay(b.startAt, b.endAt, day),
  );
}

function isInsidePublishedHours(
  hours: SpaBoardHourBlock[],
  specialistId: string,
  day: Date,
  startMinutes: number,
  durationMin: number,
) {
  const bands = hourBandsForDay(hours, day, specialistId);
  if (bands.length === 0) return false;
  const absStart = DAY_START_HOUR * 60 + startMinutes;
  const absEnd = absStart + durationMin;
  return bands.some((h) => {
    const hs = DAY_START_HOUR * 60 + minutesFromDayStart(h.startAt, day);
    const he = DAY_START_HOUR * 60 + minutesFromDayStart(h.endAt, day);
    return absStart >= hs - 0.5 && absEnd <= he + 0.5;
  });
}

function conflictsWithBooking(
  bookings: SpaBoardBooking[],
  specialistId: string,
  day: Date,
  startMinutes: number,
  durationMin: number,
  excludeId?: string,
) {
  const absStart = DAY_START_HOUR * 60 + startMinutes;
  const absEnd = absStart + durationMin;
  for (const b of bookingsForDay(bookings, day, specialistId)) {
    if (excludeId && b.id === excludeId) continue;
    const bs = DAY_START_HOUR * 60 + minutesFromDayStart(b.startAt, day);
    const be = DAY_START_HOUR * 60 + minutesFromDayStart(b.endAt, day);
    if (absStart < be && absEnd > bs) return true;
  }
  return false;
}

function resolveEmptySlotStartAt(
  clickMinsFromDayStart: number,
  items: SpaBoardBooking[],
  day: Date,
) {
  const hourStart =
    Math.floor(Math.max(0, clickMinsFromDayStart) / 60) * 60;
  const hourEnd = hourStart + 60;

  let prevEndInHour: number | null = null;
  for (const b of items) {
    const end = minutesFromDayStart(b.endAt, day);
    if (end > hourStart && end <= hourEnd) {
      if (prevEndInHour == null || end > prevEndInHour) {
        prevEndInHour = end;
      }
    }
  }

  const startMins = prevEndInHour ?? hourStart;
  return new Date(
    day.getTime() + (DAY_START_HOUR * 60 + startMins) * 60000,
  );
}

function minutesToTimeLabel(total: number) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function isTouchPointer(pointerType: string) {
  return pointerType === 'touch' || pointerType === 'pen';
}

function clientLabel(b: SpaBoardBooking) {
  if (b.busy) return 'Занято';
  return b.clientName || b.guestName || 'Клиент';
}

type DragState = {
  booking: SpaBoardBooking;
  dayKey: string;
  startMinutes: number;
  durationMin: number;
  height: number;
  valid: boolean;
  grabOffsetY: number;
  pointerX: number;
  pointerY: number;
};

type PointerStart = {
  booking: SpaBoardBooking;
  x: number;
  y: number;
  height: number;
  durationMin: number;
  pointerType: string;
  grabOffsetY: number;
};

export type SpaBoardMode = 'specialist' | 'admin';

export function SpaWeekBoard({
  board,
  mode,
  viewerSpecialistId,
  day,
  onDayChange,
  onEmptySlotClick,
  onBookingDoubleClick,
  onBookingMove,
  filterSpecialistId,
  onFilterSpecialistChange,
}: {
  board: SpaBoardResponse;
  mode: SpaBoardMode;
  viewerSpecialistId?: string;
  day: Date;
  onDayChange: (d: Date) => void;
  onEmptySlotClick?: (args: {
    specialistId: string;
    startAt: Date;
  }) => void;
  onBookingDoubleClick?: (booking: SpaBoardBooking) => void;
  onBookingMove?: (args: {
    booking: SpaBoardBooking;
    specialistId: string;
    startAt: Date;
  }) => void | Promise<void>;
  filterSpecialistId?: string;
  onFilterSpecialistChange?: (id: string) => void;
}) {
  const days = useMemo(() => weekDays(day), [day]);
  const weekStart = days[0] ?? startOfWeekMonday(day);
  const totalMin = (DAY_END_HOUR - DAY_START_HOUR) * 60;
  const today = startOfDay(new Date());

  const staffOptions = useMemo(() => {
    const list = [...board.staff].sort((a, b) =>
      staffFull(a).localeCompare(staffFull(b), 'ru'),
    );
    if (mode === 'specialist' && viewerSpecialistId) {
      return list.filter((s) => s.id === viewerSpecialistId);
    }
    return list;
  }, [board.staff, mode, viewerSpecialistId]);

  const effectiveFilter =
    mode === 'specialist' && viewerSpecialistId
      ? viewerSpecialistId
      : filterSpecialistId || '';

  const [localFilter, setLocalFilter] = useState(effectiveFilter);
  const [weekScale, setWeekScale] = useState<SpaWeekScale>(100);
  useEffect(() => {
    setLocalFilter(effectiveFilter);
  }, [effectiveFilter]);
  useEffect(() => {
    setWeekScale(defaultSpaWeekScale());
  }, []);

  const setScale = (next: SpaWeekScale) => {
    setWeekScale(next);
    writeStoredSpaWeekScale(next);
  };

  const pxPerMin = BASE_PX_PER_MIN * (weekScale / 100);
  const colMinWidthRem = BASE_COL_MIN_REM * (weekScale / 100);

  const activeFilter = onFilterSpecialistChange
    ? effectiveFilter
    : localFilter;

  const setFilter = (id: string) => {
    if (onFilterSpecialistChange) onFilterSpecialistChange(id);
    else setLocalFilter(id);
  };

  const filteredStaffId = activeFilter || undefined;

  const viewport = useMemo(() => {
    let start = Number.POSITIVE_INFINITY;
    let end = Number.NEGATIVE_INFINITY;
    for (const d of days) {
      const bands = hourBandsForDay(board.hours, d, filteredStaffId);
      const items = bookingsForDay(board.bookings, d, filteredStaffId);
      for (const h of bands) {
        start = Math.min(start, minutesFromDayStart(h.startAt, d));
        end = Math.max(end, minutesFromDayStart(h.endAt, d));
      }
      for (const b of items) {
        start = Math.min(start, minutesFromDayStart(b.startAt, d));
        end = Math.max(end, minutesFromDayStart(b.endAt, d));
      }
    }
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return { viewStartMin: 0, viewEndMin: totalMin };
    }
    const viewStartMin = Math.max(0, Math.floor(start / 60) * 60);
    const viewEndMin = Math.min(totalMin, Math.ceil(end / 60) * 60);
    if (viewEndMin <= viewStartMin) {
      return { viewStartMin: 0, viewEndMin: totalMin };
    }
    return { viewStartMin, viewEndMin };
  }, [board.bookings, board.hours, days, filteredStaffId, totalMin]);

  const viewHeight =
    (viewport.viewEndMin - viewport.viewStartMin) * pxPerMin;
  const hourMarks = useMemo(() => {
    const marks: number[] = [];
    for (
      let m = viewport.viewStartMin;
      m <= viewport.viewEndMin;
      m += 60
    ) {
      marks.push(m);
    }
    return marks;
  }, [viewport]);

  const [nowMinutes, setNowMinutes] = useState(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  });
  useEffect(() => {
    const tick = () => {
      const n = new Date();
      setNowMinutes(n.getHours() * 60 + n.getMinutes());
    };
    tick();
    const timer = window.setInterval(tick, NOW_MARKER_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const columnRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pointerStart, setPointerStart] = useState<PointerStart | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pointerStartRef = useRef<PointerStart | null>(null);
  const touchArmTimerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const isMutatingRef = useRef(false);
  dragRef.current = drag;
  pointerStartRef.current = pointerStart;

  const clearTouchArmTimer = useCallback(() => {
    if (touchArmTimerRef.current != null) {
      window.clearTimeout(touchArmTimerRef.current);
      touchArmTimerRef.current = null;
    }
  }, []);

  const canEditBooking = useCallback(
    (b: SpaBoardBooking) => {
      if (b.busy) return false;
      if (mode === 'admin') return true;
      return Boolean(
        viewerSpecialistId && b.specialistId === viewerSpecialistId,
      );
    },
    [mode, viewerSpecialistId],
  );

  const canDrop = useCallback(
    (
      specialistId: string,
      day: Date,
      startMinutes: number,
      durationMin: number,
      excludeId?: string,
    ) => {
      if (mode === 'specialist' && viewerSpecialistId) {
        if (specialistId !== viewerSpecialistId) return false;
      }
      if (startMinutes < 0 || startMinutes + durationMin > totalMin) {
        return false;
      }
      if (
        !isInsidePublishedHours(
          board.hours,
          specialistId,
          day,
          startMinutes,
          durationMin,
        )
      ) {
        return false;
      }
      if (
        conflictsWithBooking(
          board.bookings,
          specialistId,
          day,
          startMinutes,
          durationMin,
          excludeId,
        )
      ) {
        return false;
      }
      return true;
    },
    [board.bookings, board.hours, mode, totalMin, viewerSpecialistId],
  );

  const beginDragFromPending = useCallback(
    (pending: PointerStart) => {
      clearTouchArmTimer();
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate(12);
        } catch {
          /* ignore */
        }
      }
      const bookDay = startOfDay(new Date(pending.booking.startAt));
      const startMin = Math.max(
        0,
        Math.round(minutesFromDayStart(pending.booking.startAt, bookDay)),
      );
      const snapped = Math.floor(startMin / GRID_STEP_MIN) * GRID_STEP_MIN;
      setDrag({
        booking: pending.booking,
        dayKey: dateKey(bookDay),
        startMinutes: snapped,
        durationMin: pending.durationMin,
        height: pending.height,
        grabOffsetY: pending.grabOffsetY,
        pointerX: pending.x,
        pointerY: pending.y,
        valid: canDrop(
          pending.booking.specialistId,
          bookDay,
          snapped,
          pending.durationMin,
          pending.booking.id,
        ),
      });
      setPointerStart(null);
    },
    [canDrop, clearTouchArmTimer],
  );

  const maybeEdgeScroll = useCallback((clientX: number) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    if (clientX < rect.left + EDGE_SCROLL_PX) {
      scroller.scrollLeft -= EDGE_SCROLL_STEP;
    } else if (clientX > rect.right - EDGE_SCROLL_PX) {
      scroller.scrollLeft += EDGE_SCROLL_STEP;
    }
  }, []);

  const resolveDropTarget = useCallback(
    (clientX: number, clientY: number, grabOffsetY: number) => {
      for (const d of days) {
        const key = dateKey(d);
        const el = columnRefs.current.get(key);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (clientX < rect.left || clientX > rect.right) continue;
        const colHeight = Math.max(1, rect.height);
        const adjustedY = clientY - grabOffsetY;
        const relY = Math.max(
          0,
          Math.min(adjustedY - rect.top, colHeight - 1),
        );
        const minsFromView =
          Math.floor(relY / pxPerMin / GRID_STEP_MIN) * GRID_STEP_MIN;
        const maxStart =
          Math.floor(
            (viewport.viewEndMin - viewport.viewStartMin - GRID_STEP_MIN) /
              GRID_STEP_MIN,
          ) * GRID_STEP_MIN;
        const clamped = Math.max(0, Math.min(minsFromView, maxStart));
        return {
          day: d,
          dayKey: key,
          minutes: viewport.viewStartMin + clamped,
        };
      }
      return null;
    },
    [days, pxPerMin, viewport.viewEndMin, viewport.viewStartMin],
  );

  const commitMove = useCallback(
    async (current: DragState) => {
      if (!onBookingMove || isMutatingRef.current || !current.valid) return;
      const targetDay = days.find((d) => dateKey(d) === current.dayKey);
      if (!targetDay) return;
      const originDay = startOfDay(new Date(current.booking.startAt));
      const originMin = Math.round(
        minutesFromDayStart(current.booking.startAt, originDay),
      );
      const moved =
        dateKey(originDay) !== current.dayKey ||
        Math.abs(originMin - current.startMinutes) >= 1;
      if (!moved) return;

      const startAt = new Date(
        targetDay.getTime() +
          (DAY_START_HOUR * 60 + current.startMinutes) * 60000,
      );
      isMutatingRef.current = true;
      try {
        await onBookingMove({
          booking: current.booking,
          specialistId: current.booking.specialistId,
          startAt,
        });
      } finally {
        isMutatingRef.current = false;
      }
    },
    [days, onBookingMove],
  );

  const beginDragFromPendingRef = useRef(beginDragFromPending);
  beginDragFromPendingRef.current = beginDragFromPending;
  const commitMoveRef = useRef(commitMove);
  commitMoveRef.current = commitMove;

  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      const pending = pointerStartRef.current;
      const current = dragRef.current;
      if (!pending && !current) return;

      e.preventDefault();

      if (pending && !current) {
        const dx = e.clientX - pending.x;
        const dy = e.clientY - pending.y;
        const dist = Math.hypot(dx, dy);

        if (isTouchPointer(pending.pointerType)) {
          if (dist > TOUCH_SCROLL_SLOP_PX) {
            clearTouchArmTimer();
            setPointerStart(null);
          }
          return;
        }

        if (dist < MOUSE_DRAG_THRESHOLD_PX) return;
        beginDragFromPendingRef.current(pending);
      }

      const dragNow = dragRef.current;
      if (!dragNow) return;

      maybeEdgeScroll(e.clientX);

      const target = resolveDropTarget(
        e.clientX,
        e.clientY,
        dragNow.grabOffsetY,
      );
      if (!target) {
        setDrag((prev) =>
          prev
            ? {
                ...prev,
                valid: false,
                pointerX: e.clientX,
                pointerY: e.clientY,
              }
            : null,
        );
        return;
      }
      const valid = canDrop(
        dragNow.booking.specialistId,
        target.day,
        target.minutes,
        dragNow.durationMin,
        dragNow.booking.id,
      );
      setDrag({
        ...dragNow,
        dayKey: target.dayKey,
        startMinutes: target.minutes,
        pointerX: e.clientX,
        pointerY: e.clientY,
        valid,
      });
    }

    function onPointerUp() {
      if (!pointerStartRef.current && !dragRef.current) return;
      clearTouchArmTimer();
      const current = dragRef.current;
      setPointerStart(null);
      if (current) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 250);
        void commitMoveRef.current(current);
        setDrag(null);
      }
    }

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [canDrop, clearTouchArmTimer, maybeEdgeScroll, resolveDropTarget]);

  const onBookingPointerDown = (
    e: ReactPointerEvent,
    booking: SpaBoardBooking,
    height: number,
    durationMin: number,
  ) => {
    if (!onBookingMove || !canEditBooking(booking)) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    clearTouchArmTimer();
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const grabOffsetY = Math.max(
      0,
      Math.min(e.clientY - rect.top, Math.max(0, height - 1)),
    );
    const pending: PointerStart = {
      booking,
      x: e.clientX,
      y: e.clientY,
      height,
      durationMin,
      pointerType: e.pointerType,
      grabOffsetY,
    };
    setPointerStart(pending);
    if (isTouchPointer(e.pointerType)) {
      touchArmTimerRef.current = window.setTimeout(() => {
        const still =
          pointerStartRef.current?.booking.id === pending.booking.id;
        if (still) {
          beginDragFromPendingRef.current(pending);
        }
      }, TOUCH_DRAG_DELAY_MS);
    }
  };

  const goPrev = () => onDayChange(addDays(weekStart, -7));
  const goNext = () => onDayChange(addDays(weekStart, 7));
  const goThisWeek = () => onDayChange(startOfDay(new Date()));

  const halfHourMarks = useMemo(() => {
    const marks: number[] = [];
    for (
      let m = viewport.viewStartMin;
      m < viewport.viewEndMin;
      m += 30
    ) {
      if (m % 60 !== 0) marks.push(m);
    }
    return marks;
  }, [viewport]);

  const dragTargetDay = drag
    ? days.find((d) => dateKey(d) === drag.dayKey)
    : null;
  const dragChipLabel = drag
    ? `${dragTargetDay ? formatDayChip(dragTargetDay) : '…'} · ${minutesToTimeLabel(
        DAY_START_HOUR * 60 + drag.startMinutes,
      )}`
    : '';

  const isTracking = Boolean(drag || pointerStart);

  useEffect(() => {
    if (!isTracking) return;
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    if (drag) document.body.style.cursor = 'grabbing';
    return () => {
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
    };
  }, [drag, isTracking]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className="btn-secondary !px-2.5 !py-1 text-xs"
          onClick={goPrev}
        >
          ←
        </button>
        <p className="min-w-[10rem] text-center text-sm font-medium capitalize">
          {formatWeekRange(days)}
        </p>
        <button
          type="button"
          className="btn-secondary !px-2.5 !py-1 text-xs"
          onClick={goNext}
        >
          →
        </button>
        <button
          type="button"
          className="btn-secondary !px-2.5 !py-1 text-xs"
          onClick={goThisWeek}
        >
          Эта неделя
        </button>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className="btn-secondary !px-2 !py-1 text-xs"
            aria-label="Уменьшить журнал"
            disabled={weekScale <= 70}
            onClick={() => setScale(nudgeSpaWeekScale(weekScale, -1))}
          >
            −
          </button>
          <button
            type="button"
            className="btn-secondary !min-w-[3.25rem] !px-2 !py-1 text-xs tabular-nums"
            aria-label="Масштаб 100%"
            onClick={() => setScale(100)}
          >
            {weekScale}%
          </button>
          <button
            type="button"
            className="btn-secondary !px-2 !py-1 text-xs"
            aria-label="Увеличить журнал"
            disabled={weekScale >= 115}
            onClick={() => setScale(nudgeSpaWeekScale(weekScale, 1))}
          >
            +
          </button>
        </div>
      </div>

      {mode === 'admin' && staffOptions.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className={
              !activeFilter
                ? 'btn-primary !px-2.5 !py-1 text-xs'
                : 'btn-secondary !px-2.5 !py-1 text-xs'
            }
            onClick={() => setFilter('')}
          >
            Все
          </button>
          {staffOptions.map((s) => (
            <button
              key={s.id}
              type="button"
              className={
                activeFilter === s.id
                  ? 'btn-primary !px-2.5 !py-1 text-xs'
                  : 'btn-secondary !px-2.5 !py-1 text-xs'
              }
              onClick={() => setFilter(s.id)}
            >
              {staffShort(s)}
            </button>
          ))}
        </div>
      ) : null}

      <div
        className="max-h-[calc(100dvh-var(--app-header-h,3rem)-4.5rem-env(safe-area-inset-bottom,0px))] select-none overflow-y-auto overscroll-contain rounded-xl border border-slate-800 bg-slate-950/40 md:max-h-[calc(100dvh-var(--app-header-h,3rem)-2rem)]"
      >
        <div className="flex w-full">
          <div className="admin-time-rail w-12 shrink-0 border-r border-slate-800 bg-slate-950">
            <div className="h-12 border-b border-slate-800" />
            <div className="relative" style={{ height: viewHeight }}>
              {hourMarks.map((m) => {
                const clockHour = DAY_START_HOUR + m / 60;
                const label = `${String(Math.floor(clockHour)).padStart(2, '0')}:00`;
                const isClosing = m >= viewport.viewEndMin;
                const topPx = isClosing
                  ? (m - viewport.viewStartMin) * pxPerMin
                  : (m - viewport.viewStartMin) * pxPerMin +
                    (60 * pxPerMin) / 2;
                return (
                  <div
                    key={m}
                    className="absolute left-0 right-0 flex justify-end px-1 text-[10px] tabular-nums leading-none text-slate-500"
                    style={{
                      top: topPx,
                      transform: 'translateY(-50%)',
                    }}
                  >
                    {label}
                  </div>
                );
              })}
            </div>
          </div>

          <div
            ref={scrollRef}
            className="min-w-0 flex-1 snap-x snap-mandatory overflow-x-auto [-webkit-overflow-scrolling:touch]"
          >
            <div className="flex w-max min-w-full md:min-w-0 md:w-full">
          {days.map((d) => {
            const key = dateKey(d);
            const isToday = sameCalendarDay(d, today);
            const bands = hourBandsForDay(board.hours, d, filteredStaffId);
            const items = bookingsForDay(
              board.bookings,
              d,
              filteredStaffId,
            ).sort((a, b) => a.startAt.localeCompare(b.startAt));
            const hasWork = bands.length > 0;
            const isDropDay = drag?.dayKey === key;
            const dropOk = Boolean(isDropDay && drag?.valid);
            const dropBad = Boolean(isDropDay && drag && !drag.valid);

            const nowTop =
              isToday &&
              nowMinutes >= DAY_START_HOUR * 60 + viewport.viewStartMin &&
              nowMinutes <= DAY_START_HOUR * 60 + viewport.viewEndMin
                ? (nowMinutes -
                    DAY_START_HOUR * 60 -
                    viewport.viewStartMin) *
                  pxPerMin
                : null;

            return (
              <div
                key={key}
                className={`w-0 shrink-0 grow basis-0 snap-start border-r border-slate-800 last:border-r-0 ${
                  isToday ? 'bg-fitgo-500/5' : ''
                } ${dropOk ? 'bg-fitgo-500/10' : ''} ${
                  dropBad ? 'bg-rose-500/10' : ''
                }`}
                style={{ minWidth: `${colMinWidthRem}rem` }}
              >
                <div
                  className={`flex h-12 flex-col items-center justify-center border-b border-slate-800 px-1 text-center ${
                    isToday ? 'bg-fitgo-500/10' : ''
                  } ${dropOk ? 'ring-1 ring-inset ring-fitgo-500/40' : ''} ${
                    dropBad ? 'ring-1 ring-inset ring-rose-400/50' : ''
                  }`}
                >
                  <span
                    className={`text-[11px] font-medium capitalize ${
                      isToday ? 'text-fitgo-300' : 'text-slate-300'
                    }`}
                  >
                    {formatDayHeader(d)}
                  </span>
                  {!hasWork ? (
                    <span className="text-[9px] text-slate-500">нет смены</span>
                  ) : null}
                </div>

                <div
                  ref={(el) => {
                    if (el) columnRefs.current.set(key, el);
                    else columnRefs.current.delete(key);
                  }}
                  className="relative cursor-pointer"
                  style={{ height: viewHeight }}
                  onClick={(e) => {
                    if (suppressClickRef.current) return;
                    if (!onEmptySlotClick) return;
                    const el = e.currentTarget;
                    const rect = el.getBoundingClientRect();
                    const relY = Math.max(
                      0,
                      Math.min(e.clientY - rect.top, rect.height - 1),
                    );
                    const minsFromView =
                      Math.floor(relY / pxPerMin / GRID_STEP_MIN) *
                      GRID_STEP_MIN;
                    const clickMins = viewport.viewStartMin + minsFromView;

                    let specialistId = filteredStaffId;
                    if (!specialistId) {
                      const hit = bands.find((h) => {
                        const hs = minutesFromDayStart(h.startAt, d);
                        const he = minutesFromDayStart(h.endAt, d);
                        return clickMins >= hs && clickMins < he;
                      });
                      specialistId = hit?.specialistId;
                    }
                    if (!specialistId) {
                      if (mode === 'specialist' && viewerSpecialistId) {
                        specialistId = viewerSpecialistId;
                      } else {
                        return;
                      }
                    }

                    if (
                      !isInsidePublishedHours(
                        board.hours,
                        specialistId,
                        d,
                        clickMins,
                        GRID_STEP_MIN,
                      )
                    ) {
                      return;
                    }

                    const dayItems = bookingsForDay(
                      board.bookings,
                      d,
                      specialistId,
                    );
                    const startAt = resolveEmptySlotStartAt(
                      clickMins,
                      dayItems,
                      d,
                    );
                    onEmptySlotClick({ specialistId, startAt });
                  }}
                >
                  {bands.map((h) => {
                    const top =
                      (minutesFromDayStart(h.startAt, d) -
                        viewport.viewStartMin) *
                      pxPerMin;
                    const height = Math.max(
                      4,
                      (minutesFromDayStart(h.endAt, d) -
                        minutesFromDayStart(h.startAt, d)) *
                        pxPerMin,
                    );
                    return (
                      <div
                        key={h.id}
                        className={
                          h.status === 'DRAFT'
                            ? 'pointer-events-none absolute inset-x-0 border border-dashed border-fitgo-500/40 bg-fitgo-500/5'
                            : 'pointer-events-none absolute inset-x-0 bg-fitgo-500/10'
                        }
                        style={{ top, height }}
                      />
                    );
                  })}

                  {hourMarks.map((m) => (
                    <div
                      key={`line-${m}`}
                      className="pointer-events-none absolute inset-x-0 border-t border-slate-800/70"
                      style={{
                        top: (m - viewport.viewStartMin) * pxPerMin,
                      }}
                    />
                  ))}
                  {halfHourMarks.map((m) => (
                    <div
                      key={`half-${m}`}
                      className="pointer-events-none absolute inset-x-0 border-t border-dashed border-slate-800/40"
                      style={{
                        top: (m - viewport.viewStartMin) * pxPerMin,
                      }}
                    />
                  ))}

                  {nowTop != null ? (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-20"
                      style={{ top: nowTop }}
                      aria-hidden
                    >
                      <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-rose-500/80" />
                    </div>
                  ) : null}

                  {isDropDay && drag ? (
                    <>
                      <div
                        className={`pointer-events-none absolute inset-x-0.5 z-20 rounded-md border-2 border-dashed ${
                          drag.valid
                            ? 'border-fitgo-400/70 bg-fitgo-500/15'
                            : 'border-rose-400/60 bg-rose-500/10'
                        }`}
                        style={{
                          top:
                            (drag.startMinutes - viewport.viewStartMin) *
                            pxPerMin,
                          height: drag.height,
                        }}
                      />
                      <div
                        className={`pointer-events-none absolute inset-x-0.5 z-30 overflow-hidden rounded-md border px-1.5 py-1 text-[10px] leading-tight text-white shadow-lg ring-2 ${
                          drag.valid
                            ? `${
                                !filteredStaffId
                                  ? staffColorClass(
                                      drag.booking.specialistId,
                                      board.staff,
                                    )
                                  : 'bg-amber-500/85 border-amber-400/40'
                              } ring-fitgo-300/70`
                            : 'border-rose-400/60 bg-rose-900/80 ring-rose-400/70'
                        }`}
                        style={{
                          top:
                            (drag.startMinutes - viewport.viewStartMin) *
                            pxPerMin,
                          height: drag.height,
                        }}
                      >
                        <p className="truncate font-semibold tabular-nums">
                          {minutesToTimeLabel(
                            DAY_START_HOUR * 60 + drag.startMinutes,
                          )}
                          –
                          {minutesToTimeLabel(
                            DAY_START_HOUR * 60 +
                              drag.startMinutes +
                              drag.durationMin,
                          )}
                        </p>
                        <p className="truncate">{clientLabel(drag.booking)}</p>
                      </div>
                    </>
                  ) : null}

                  {items.map((b) => {
                    const topMin = minutesFromDayStart(b.startAt, d);
                    const endMin = minutesFromDayStart(b.endAt, d);
                    const durationMin = Math.max(15, endMin - topMin);
                    const top =
                      (topMin - viewport.viewStartMin) * pxPerMin;
                    const height = Math.max(22, durationMin * pxPerMin);
                    const isDragging = drag?.booking.id === b.id;
                    const showMulti = !filteredStaffId;
                    const staff = board.staff.find(
                      (s) => s.id === b.specialistId,
                    );
                    const color = showMulti
                      ? staffColorClass(b.specialistId, board.staff)
                      : 'bg-amber-500/85 border-amber-400/40';
                    const editable = canEditBooking(b) && !!onBookingMove;
                    const timeStart = minutesToTimeLabel(
                      DAY_START_HOUR * 60 + topMin,
                    );
                    const timeEnd = minutesToTimeLabel(
                      DAY_START_HOUR * 60 + endMin,
                    );

                    return (
                      <div
                        key={b.id}
                        role="button"
                        tabIndex={0}
                        title={
                          editable
                            ? 'Удерживайте и перетащите на другой день или время'
                            : undefined
                        }
                        className={`absolute inset-x-0.5 z-10 overflow-hidden rounded-md border px-1.5 py-1 text-[10px] leading-tight text-white shadow-sm touch-none ${color} ${
                          editable
                            ? 'cursor-grab active:cursor-grabbing'
                            : 'cursor-pointer'
                        } ${isDragging ? 'opacity-35' : ''} ${
                          pointerStart?.booking.id === b.id
                            ? 'scale-[1.02] shadow-md ring-2 ring-white/30'
                            : ''
                        }`}
                        style={{ top, height }}
                        onPointerDown={(e) =>
                          onBookingPointerDown(e, b, height, durationMin)
                        }
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (!b.busy) onBookingDoubleClick?.(b);
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-start gap-1">
                          {editable ? (
                            <span
                              className="mt-px flex shrink-0 flex-col gap-0.5 opacity-80"
                              aria-hidden
                            >
                              <span className="block h-0.5 w-2 rounded-full bg-white/90" />
                              <span className="block h-0.5 w-2 rounded-full bg-white/90" />
                              <span className="block h-0.5 w-2 rounded-full bg-white/90" />
                            </span>
                          ) : null}
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold tabular-nums">
                              {timeStart}
                              {height >= 36 ? (
                                <span className="font-normal text-white/80">
                                  –{timeEnd}
                                </span>
                              ) : null}
                            </p>
                            <p className="truncate font-medium">
                              {clientLabel(b)}
                            </p>
                            {height >= 44 && showMulti && staff ? (
                              <p className="truncate text-[9px] text-white/80">
                                {staffShort(staff)}
                              </p>
                            ) : null}
                            {height >= 44 &&
                            !showMulti &&
                            b.serviceName &&
                            !b.busy ? (
                              <p className="hidden truncate text-[9px] text-white/80 sm:block">
                                {b.serviceName}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
            </div>
          </div>
        </div>
      </div>

      {drag ? (
        <div
          className={`pointer-events-none fixed z-[80] -translate-x-1/2 -translate-y-[120%] rounded-full px-3 py-1.5 text-xs font-medium shadow-lg ring-1 ${
            drag.valid
              ? 'bg-fitgo-500 text-white ring-fitgo-300/50'
              : 'bg-rose-600 text-white ring-rose-300/40'
          }`}
          style={{ left: drag.pointerX, top: drag.pointerY }}
        >
          {drag.valid ? dragChipLabel : `${dragChipLabel} · занято`}
        </div>
      ) : null}

      <p className="text-[11px] text-slate-500">
        Удерживайте запись и перетащите на другой день или время. На телефоне —
        долгое нажатие. Между специалистами — в виде «День».
      </p>
    </div>
  );
}
